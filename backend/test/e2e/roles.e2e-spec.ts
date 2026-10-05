import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestPrisma, resetDatabase, seedAll } from '../helpers/db';
import { createTestApp } from '../helpers/app';
import { API, createUser, login, nextIp } from '../helpers/auth';

describe('role and permission management (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  const tokens: Record<string, string> = {};

  type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
  const call = (method: Method, path: string, as?: string | { raw: string }, body?: object) =>
    request(app.getHttpServer())[method](`${API}${path}`).set('X-Forwarded-For', nextIp())
      .set(as ? { Authorization: `Bearer ${typeof as === 'string' ? tokens[as] : as.raw}` } : {}).send(body);
  const audit = (action: string) => prisma.auditLog.findMany({ where: { action }, orderBy: { createdAt: 'asc' } });
  const roleId = async (code: string) => (await prisma.role.findUniqueOrThrow({ where: { code } })).id;

  beforeAll(async () => {
    prisma = createTestPrisma(5);
    app = await createTestApp({ TRUST_PROXY: '1' });
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedAll(prisma);
    tokens.super = (await login(app, 'superadmin@azharpark.test')).accessToken;
    tokens.admin = (await login(app, 'admin@azharpark.test')).accessToken;
    tokens.analyst = (await login(app, 'analyst@azharpark.test')).accessToken;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('viewing', () => {
    it('lets anyone with roles:read see roles, their permissions and holders; the catalogue comes from the backend', async () => {
      const roles = (await call('get', '/roles', 'admin').expect(200)).body.data;
      const staff = roles.find((r: { code: string }) => r.code === 'TICKET_STAFF');
      expect(staff).toMatchObject({ isSystem: true, userCount: 1 });
      expect(staff.permissions).toEqual(expect.arrayContaining(['scans:create']));

      const catalogue = (await call('get', '/permissions', 'admin').expect(200)).body.data;
      expect(catalogue.length).toBe(await prisma.permission.count());
      expect(catalogue[0]).toEqual({ code: expect.any(String), description: expect.any(String) });

      const one = await call('get', `/roles/${staff.id}`, 'admin').expect(200);
      expect(one.body.data.code).toBe('TICKET_STAFF');
      await call('get', '/roles/00000000-0000-4000-8000-000000000000', 'admin').expect(404);
      await call('get', '/roles/nope', 'admin').expect(400);
      await call('get', '/roles', 'analyst').expect(403);
    });
  });

  describe('who may edit', () => {
    it('lets only the super administrator write (an administrator can read but not change roles)', async () => {
      const id = await roleId('ANALYST');
      await call('put', `/roles/${id}/permissions`, 'admin', { permissionCodes: ['orders:read'] }).expect(403);
      await call('post', '/roles', 'admin', { code: 'X_ROLE', name: 'X', permissionCodes: [] }).expect(403);
      await call('patch', `/roles/${id}`, 'admin', { name: 'Hacked' }).expect(403);
      await call('delete', `/roles/${id}`, 'admin').expect(403);
      await call('post', '/roles', undefined, { code: 'X_ROLE', name: 'X', permissionCodes: [] }).expect(401);
    });
  });

  describe('creating, renaming and deleting', () => {
    it('creates a custom role with chosen permissions, audited', async () => {
      const res = await call('post', '/roles', 'super', {
        code: 'EVENT_COORDINATOR', name: 'Event coordinator', description: 'Runs events', permissionCodes: ['events:read', 'events:write', 'events:read'],
      }).expect(201);
      expect(res.body.data).toMatchObject({ code: 'EVENT_COORDINATOR', isSystem: false, userCount: 0, permissions: ['events:read', 'events:write'] });
      const [entry] = await audit('role.created');
      expect(entry.newValue).toMatchObject({ code: 'EVENT_COORDINATOR', permissions: ['events:read', 'events:write'] });
    });

    it.each([
      ['a lower-case code', { code: 'event_coordinator' }],
      ['a too-short code', { code: 'X' }],
      ['a code with spaces', { code: 'BAD CODE' }],
      ['an empty name', { name: '' }],
      ['a malformed permission', { permissionCodes: ['not a permission'] }],
    ])('rejects %s', async (_l, override) => {
      await call('post', '/roles', 'super', { code: 'GOOD_ROLE', name: 'Good', permissionCodes: [], ...override }).expect(400);
    });

    it('rejects a duplicate code and unknown permissions', async () => {
      expect((await call('post', '/roles', 'super', { code: 'ANALYST', name: 'Dup', permissionCodes: [] }).expect(409)).body.error.code).toBe('ROLE_CODE_TAKEN');
      const res = await call('post', '/roles', 'super', { code: 'NEW_ROLE', name: 'New', permissionCodes: ['made:up'] }).expect(422);
      expect(res.body.error.code).toBe('UNKNOWN_PERMISSION');
      expect(await prisma.role.count({ where: { code: 'NEW_ROLE' } })).toBe(0);
    });

    it('renames a role and changes its description, but never its code', async () => {
      const id = await roleId('ANALYST');
      const res = await call('patch', `/roles/${id}`, 'super', { name: 'Data analyst', description: null }).expect(200);
      expect(res.body.data).toMatchObject({ code: 'ANALYST', name: 'Data analyst', description: null });
      const [entry] = await audit('role.updated');
      expect(entry.oldValue).toMatchObject({ name: 'Analyst' });
      expect(entry.newValue).toMatchObject({ name: 'Data analyst' });
    });

    it('deletes an unused custom role, but never a built-in role or one that still has holders', async () => {
      const made = (await call('post', '/roles', 'super', { code: 'TEMP_ROLE', name: 'Temp', permissionCodes: ['events:read'] }).expect(201)).body.data;
      const user = await createUser(prisma, { role: 'TEMP_ROLE' });
      expect((await call('delete', `/roles/${made.id}`, 'super').expect(409)).body.error.code).toBe('ROLE_IN_USE');
      await prisma.userRole.deleteMany({ where: { userId: user.id } });
      await call('delete', `/roles/${made.id}`, 'super').expect(200);
      expect(await prisma.role.count({ where: { code: 'TEMP_ROLE' } })).toBe(0);
      expect((await audit('role.deleted')).length).toBe(1);

      expect((await call('delete', `/roles/${await roleId('ANALYST')}`, 'super').expect(409)).body.error.code).toBe('SYSTEM_ROLE');
    });
  });

  describe('assigning and removing permissions', () => {
    it('takes effect on the very next request, with no re-login', async () => {
      const made = (await call('post', '/roles', 'super', { code: 'USER_VIEWER', name: 'User viewer', permissionCodes: ['users:read'] }).expect(201)).body.data;
      const person = await createUser(prisma, { role: 'USER_VIEWER' });
      const token = (await login(app, person.email)).accessToken;

      await call('get', '/users', { raw: token }).expect(200);
      await call('get', '/roles', { raw: token }).expect(403);

      await call('put', `/roles/${made.id}/permissions`, 'super', { permissionCodes: ['roles:read'] }).expect(200); // swap
      await call('get', '/users', { raw: token }).expect(403);
      await call('get', '/roles', { raw: token }).expect(200);

      await call('put', `/roles/${made.id}/permissions`, 'super', { permissionCodes: [] }).expect(200); // remove all
      await call('get', '/roles', { raw: token }).expect(403);
      await call('get', '/auth/me', { raw: token }).expect(200); // still signed in, just no permissions
      expect((await call('get', '/auth/me', { raw: token })).body.data.permissions).toEqual([]);
    });

    it('shows added and removed permissions in the audit log', async () => {
      const id = await roleId('ANALYST');
      const current = (await call('get', `/roles/${id}`, 'super')).body.data.permissions as string[];
      const next = [...current.filter((p) => p !== 'scans:read'), 'events:write'];
      const res = await call('put', `/roles/${id}/permissions`, 'super', { permissionCodes: next }).expect(200);
      expect(res.body.data.permissions).toEqual(next.slice().sort());
      const [entry] = await audit('role.permissions_changed');
      expect(entry.newValue).toMatchObject({ added: ['events:write'], removed: ['scans:read'] });
      const actor = await prisma.user.findUniqueOrThrow({ where: { email: 'superadmin@azharpark.test' } });
      expect(entry.userId).toBe(actor.id);
    });

    it('rejects unknown permissions without changing anything', async () => {
      const id = await roleId('ANALYST');
      const before = (await call('get', `/roles/${id}`, 'super')).body.data.permissions;
      await call('put', `/roles/${id}/permissions`, 'super', { permissionCodes: ['orders:read', 'bogus:thing'] }).expect(422);
      expect((await call('get', `/roles/${id}`, 'super')).body.data.permissions).toEqual(before);
    });

    it('also lets a built-in role be edited (for example give analysts event editing)', async () => {
      const id = await roleId('ANALYST');
      const current = (await call('get', `/roles/${id}`, 'super')).body.data.permissions as string[];
      await call('put', `/roles/${id}/permissions`, 'super', { permissionCodes: [...current, 'events:write'] }).expect(200);
      expect((await call('get', '/auth/me', await (async () => ({ raw: (await login(app, 'analyst@azharpark.test')).accessToken }))())).body.data.permissions).toContain('events:write');
    });
  });

  describe('safeguards', () => {
    /** A manager who can edit roles but holds only a few permissions. */
    async function limitedManager() {
      const role = (await call('post', '/roles', 'super', { code: 'ROLE_MANAGER', name: 'Role manager', permissionCodes: ['roles:read', 'roles:write', 'permissions:read', 'events:read'] }).expect(201)).body.data;
      const user = await createUser(prisma, { role: 'ROLE_MANAGER' });
      return { role, token: (await login(app, user.email)).accessToken };
    }

    it('never lets you grant a permission you do not hold yourself', async () => {
      const { token } = await limitedManager();
      const res = await call('post', '/roles', { raw: token }, { code: 'SNEAKY', name: 'Sneaky', permissionCodes: ['events:read', 'users:write'] }).expect(403);
      expect(res.body.error.code).toBe('PERMISSION_NOT_GRANTABLE');
      expect(await prisma.role.count({ where: { code: 'SNEAKY' } })).toBe(0);
      const ok = await call('post', '/roles', { raw: token }, { code: 'FINE_ROLE', name: 'Fine', permissionCodes: ['events:read'] }).expect(201);
      expect(ok.body.data.permissions).toEqual(['events:read']);
    });

    it('never lets you give yourself more power by editing your own role', async () => {
      const { role, token } = await limitedManager();
      await call('put', `/roles/${role.id}/permissions`, { raw: token }, { permissionCodes: [...role.permissions, 'users:write'] }).expect(403);
    });

    it('never lets you edit a role that is more powerful than you', async () => {
      const { token } = await limitedManager();
      await call('put', `/roles/${await roleId('SUPER_ADMIN')}/permissions`, { raw: token }, { permissionCodes: [] }).expect(403);
      await call('put', `/roles/${await roleId('ADMIN')}/permissions`, { raw: token }, { permissionCodes: ['events:read'] }).expect(403);
    });

    it('never removes the last way to manage roles', async () => {
      const superId = await roleId('SUPER_ADMIN');
      const all = (await call('get', `/roles/${superId}`, 'super')).body.data.permissions as string[];
      const res = await call('put', `/roles/${superId}/permissions`, 'super', { permissionCodes: all.filter((p) => p !== 'roles:write') }).expect(409);
      expect(res.body.error.code).toBe('LAST_ADMINISTRATOR');
      expect((await call('get', `/roles/${superId}`, 'super')).body.data.permissions).toContain('roles:write');
    });

    it('allows it once another active person can still manage roles', async () => {
      const second = (await call('post', '/roles', 'super', { code: 'BACKUP_ADMIN', name: 'Backup admin', permissionCodes: ['roles:read', 'roles:write'] }).expect(201)).body.data;
      expect(second.permissions).toContain('roles:write');
      await createUser(prisma, { role: 'BACKUP_ADMIN' });
      const superId = await roleId('SUPER_ADMIN');
      const all = (await call('get', `/roles/${superId}`, 'super')).body.data.permissions as string[];
      await call('put', `/roles/${superId}/permissions`, 'super', { permissionCodes: all.filter((p) => p !== 'roles:write') }).expect(200);
    });

    it('does not count an inactive person as a remaining administrator', async () => {
      await call('post', '/roles', 'super', { code: 'BACKUP_ADMIN', name: 'Backup admin', permissionCodes: ['roles:read', 'roles:write'] }).expect(201);
      await createUser(prisma, { role: 'BACKUP_ADMIN', isActive: false });
      const superId = await roleId('SUPER_ADMIN');
      const all = (await call('get', `/roles/${superId}`, 'super')).body.data.permissions as string[];
      await call('put', `/roles/${superId}/permissions`, 'super', { permissionCodes: all.filter((p) => p !== 'roles:write') }).expect(409);
    });
  });
});
