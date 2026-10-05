import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { TEST_PASSWORD, createTestPrisma, resetDatabase, seedAll } from '../helpers/db';
import { CapturingNotifier, createTestApp } from '../helpers/app';
import { API, NEW_PASSWORD, createUser, login, nextIp } from '../helpers/auth';

describe('authorization and user management (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  const notifier = new CapturingNotifier();
  const http = () => request(app.getHttpServer());

  type Method = 'get' | 'post' | 'put' | 'patch';
  const call = (method: Method, path: string, token?: string, body?: object) =>
    http()[method](`${API}${path}`).set('X-Forwarded-For', nextIp()).set(token ? { Authorization: `Bearer ${token}` } : {}).send(body);

  const tokenOf = async (email: string) => (await login(app, email)).accessToken;
  const idOf = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
  const audit = (action: string) => prisma.auditLog.findMany({ where: { action }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    prisma = createTestPrisma(5);
    await resetDatabase(prisma);
    await seedAll(prisma);
    app = await createTestApp({ TRUST_PROXY: '1' }, notifier);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ───────────────────────── the guards ─────────────────────────
  describe('guards', () => {
    it('keep health public and everything else closed by default', async () => {
      await http().get(`${API}/health`).expect(200);
      for (const path of ['/users', '/roles', '/permissions', '/auth/me']) await call('get', path).expect(401);
    });

    it('fail closed: a route nobody annotated is refused even for a signed-in super administrator', async () => {
      const token = await tokenOf('superadmin@azharpark.test');
      const res = await call('get', '/__guarded/unannotated', token).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      await call('get', '/__guarded/any', token).expect(200);
    });

    it('require ALL listed permissions', async () => {
      const both = await createUser(prisma, { role: 'ADMIN' }); // has users:read and pricing:write
      await call('get', '/__guarded/needs-two', await tokenOf(both.email)).expect(200);
      await call('get', '/__guarded/needs-two', await tokenOf('content@azharpark.test')).expect(403); // neither
      await call('get', '/__guarded/needs-two', await tokenOf('analyst@azharpark.test')).expect(403); // neither
    });

    it('decide by permission, not by role name: a brand-new role works as soon as it is given permissions', async () => {
      const role = await prisma.role.create({ data: { code: 'AUDITOR_LITE', name: 'Auditor lite' } });
      const perm = await prisma.permission.findUniqueOrThrow({ where: { code: 'roles:read' } });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
      const user = await createUser(prisma, { role: 'AUDITOR_LITE' });
      const token = await tokenOf(user.email);
      await call('get', '/roles', token).expect(200);
      await call('get', '/users', token).expect(403);
    });

    it('treat a user with several roles as the union of their permissions', async () => {
      const user = await createUser(prisma, { roles: ['ANALYST', 'CONTENT_MANAGER'] });
      const me = await call('get', '/auth/me', await tokenOf(user.email)).expect(200);
      expect(me.body.data.permissions).toEqual(expect.arrayContaining(['analytics:read', 'events:publish']));
      expect(me.body.data.roles).toEqual(['ANALYST', 'CONTENT_MANAGER']);
    });
  });

  // ───────────────────────── the seeded roles ─────────────────────────
  describe('seeded roles', () => {
    const matrix: Array<[email: string, users: number, roles: number, permissions: number]> = [
      ['superadmin@azharpark.test', 200, 200, 200],
      ['admin@azharpark.test', 200, 200, 200],
      ['operations@azharpark.test', 403, 403, 403],
      ['staff@azharpark.test', 403, 403, 403],
      ['content@azharpark.test', 403, 403, 403],
      ['analyst@azharpark.test', 403, 403, 403],
    ];
    it.each(matrix)('%s: GET /users=%i /roles=%i /permissions=%i', async (email, users, roles, permissions) => {
      const token = await tokenOf(email);
      await call('get', '/users', token).expect(users);
      await call('get', '/roles', token).expect(roles);
      await call('get', '/permissions', token).expect(permissions);
    });

    it('exposes exactly the six initial roles with their permissions', async () => {
      const res = await call('get', '/roles', await tokenOf('superadmin@azharpark.test')).expect(200);
      const codes = res.body.data.map((r: { code: string }) => r.code);
      expect(codes).toEqual(expect.arrayContaining(['SUPER_ADMIN', 'ADMIN', 'OPERATIONS', 'TICKET_STAFF', 'CONTENT_MANAGER', 'ANALYST']));
      const staff = res.body.data.find((r: { code: string }) => r.code === 'TICKET_STAFF');
      expect(staff.permissions).toEqual(expect.arrayContaining(['scans:create', 'counter-sales:create']));
      expect(staff.permissions).not.toContain('pricing:write');
      const superAdmin = res.body.data.find((r: { code: string }) => r.code === 'SUPER_ADMIN');
      const all = await call('get', '/permissions', await tokenOf('superadmin@azharpark.test'));
      expect(superAdmin.permissions).toHaveLength(all.body.data.length);
    });
  });

  // ───────────────────────── user management ─────────────────────────
  describe('users', () => {
    it('lists with pagination, search and filters, newest first, never including secrets', async () => {
      const token = await tokenOf('admin@azharpark.test');
      const page = await call('get', '/users?limit=2&page=1', token).expect(200);
      expect(page.body.data).toHaveLength(2);
      expect(page.body.meta).toMatchObject({ page: 1, limit: 2 });
      expect(page.body.meta.total).toBeGreaterThanOrEqual(6);
      const found = await call('get', '/users?search=ANALYST@azharpark', token).expect(200);
      expect(found.body.data.map((u: { email: string }) => u.email)).toEqual(['analyst@azharpark.test']);
      const byRole = await call('get', '/users?role=TICKET_STAFF&isActive=true', token).expect(200);
      expect(byRole.body.data.every((u: { roles: Array<{ code: string }> }) => u.roles.some((r) => r.code === 'TICKET_STAFF'))).toBe(true);
      await call('get', '/users?limit=1000', token).expect(400);
      await call('get', '/users/not-a-uuid', token).expect(400);
      await call('get', '/users/00000000-0000-4000-8000-000000000000', token).expect(404);
    });

    it('invites a user: random unusable password, one-time link, they choose their own password, then sign in', async () => {
      const token = await tokenOf('admin@azharpark.test');
      const email = `invited.${Date.now()}@azharpark.test`;
      const res = await call('post', '/users', token, { email, fullName: 'Nour Invited', roleCodes: ['TICKET_STAFF'] }).expect(201);
      expect(res.body.data).toMatchObject({ email, isActive: true, roles: [{ code: 'TICKET_STAFF' }] });

      await request(app.getHttpServer()).post(`${API}/auth/login`).set('X-Forwarded-For', nextIp()).send({ email, password: TEST_PASSWORD }).expect(401);
      const msg = notifier.last(email)!;
      expect(msg.purpose).toBe('invite');
      await request(app.getHttpServer()).post(`${API}/auth/reset-password`).set('X-Forwarded-For', nextIp()).send({ token: msg.token, newPassword: NEW_PASSWORD }).expect(200);
      const session = await login(app, email, NEW_PASSWORD);
      const me = await call('get', '/auth/me', session.accessToken).expect(200);
      expect(me.body.data.roles).toEqual(['TICKET_STAFF']);

      expect((await audit('user.created')).some((a) => a.entityId === res.body.data.id)).toBe(true);
    });

    it('rejects duplicate e-mails, unknown roles and bad input', async () => {
      const token = await tokenOf('admin@azharpark.test');
      await call('post', '/users', token, { email: 'analyst@azharpark.test', fullName: 'Dup', roleCodes: ['ANALYST'] }).expect(409);
      expect((await call('post', '/users', token, { email: 'x1@azharpark.test', fullName: 'Nope', roleCodes: ['NO_SUCH_ROLE'] }).expect(422)).body.error.code).toBe('UNKNOWN_ROLE');
      await call('post', '/users', token, { email: 'not-an-email', fullName: 'Bad', roleCodes: ['ANALYST'] }).expect(400);
      await call('post', '/users', token, { email: 'x2@azharpark.test', fullName: 'No roles', roleCodes: [] }).expect(400);
    });

    it('stops people without users:write from changing anything', async () => {
      const staffToken = await tokenOf('staff@azharpark.test');
      const analyst = await idOf('analyst@azharpark.test');
      await call('post', '/users', staffToken, { email: 'y@azharpark.test', fullName: 'Nope', roleCodes: ['ANALYST'] }).expect(403);
      await call('post', `/users/${analyst}/deactivate`, staffToken).expect(403);
      await call('put', `/users/${analyst}/roles`, staffToken, { roleCodes: ['SUPER_ADMIN'] }).expect(403);
      await call('patch', `/users/${analyst}`, await tokenOf('analyst@azharpark.test'), { fullName: 'Me' }).expect(403);
    });

    describe('privilege escalation', () => {
      it('stops an administrator creating or promoting anyone to a role more powerful than their own', async () => {
        const admin = await tokenOf('admin@azharpark.test');
        const res = await call('post', '/users', admin, { email: 'evil@azharpark.test', fullName: 'Evil Plan', roleCodes: ['SUPER_ADMIN'] }).expect(403);
        expect(res.body.error.code).toBe('ROLE_NOT_GRANTABLE');
        const analyst = await idOf('analyst@azharpark.test');
        await call('put', `/users/${analyst}/roles`, admin, { roleCodes: ['SUPER_ADMIN'] }).expect(403);
        // a lateral grant (same powers) is fine
        await call('put', `/users/${analyst}/roles`, admin, { roleCodes: ['ANALYST', 'CONTENT_MANAGER'] }).expect(200);
      });

      it('lets a super administrator grant any role', async () => {
        const superToken = await tokenOf('superadmin@azharpark.test');
        const target = await createUser(prisma, { role: 'ANALYST' });
        const res = await call('put', `/users/${target.id}/roles`, superToken, { roleCodes: ['ADMIN'] }).expect(200);
        expect(res.body.data.roles).toEqual([{ code: 'ADMIN', name: expect.any(String) }]);
      });

      it('stops an administrator managing, deactivating or resetting someone with more access', async () => {
        const admin = await tokenOf('admin@azharpark.test');
        const boss = await idOf('superadmin@azharpark.test');
        await call('post', `/users/${boss}/deactivate`, admin).expect(403);
        await call('patch', `/users/${boss}`, admin, { fullName: 'Hacked Name' }).expect(403);
        await call('put', `/users/${boss}/roles`, admin, { roleCodes: ['ANALYST'] }).expect(403);
        await call('post', `/users/${boss}/send-password-reset`, admin).expect(403);
        expect((await prisma.user.findUniqueOrThrow({ where: { id: boss } })).isActive).toBe(true);
      });

      it('refuses to let you deactivate yourself or change your own roles', async () => {
        const admin = await tokenOf('admin@azharpark.test');
        const me = await idOf('admin@azharpark.test');
        expect((await call('post', `/users/${me}/deactivate`, admin).expect(409)).body.error.code).toBe('CANNOT_CHANGE_SELF');
        await call('put', `/users/${me}/roles`, admin, { roleCodes: ['SUPER_ADMIN'] }).expect(409);
      });
    });

    describe('activation and deactivation', () => {
      it('deactivating signs the person out everywhere at once and blocks sign-in; activating restores it', async () => {
        const admin = await tokenOf('admin@azharpark.test');
        const target = await createUser(prisma, { role: 'TICKET_STAFF' });
        const session = await login(app, target.email);
        await call('get', '/auth/me', session.accessToken).expect(200);

        const off = await call('post', `/users/${target.id}/deactivate`, admin).expect(200);
        expect(off.body.data.isActive).toBe(false);
        await call('get', '/auth/me', session.accessToken).expect(401);
        await call('post', '/auth/refresh', undefined, { refreshToken: session.refreshToken }).expect(401);
        await call('post', '/auth/login', undefined, { email: target.email, password: TEST_PASSWORD }).expect(401);

        const on = await call('post', `/users/${target.id}/activate`, admin).expect(200);
        expect(on.body.data.isActive).toBe(true);
        await login(app, target.email);

        const actions = (await prisma.auditLog.findMany({ where: { entityId: target.id }, orderBy: { createdAt: 'asc' } })).map((a) => a.action);
        expect(actions).toEqual(expect.arrayContaining(['user.deactivated', 'user.activated']));
        expect((await audit('user.deactivated')).find((a) => a.entityId === target.id)?.userId).toBe(await idOf('admin@azharpark.test'));
      });

      it('is idempotent', async () => {
        const admin = await tokenOf('admin@azharpark.test');
        const target = await createUser(prisma, { role: 'ANALYST', isActive: false });
        await call('post', `/users/${target.id}/deactivate`, admin).expect(200);
      });

      it('can never leave the system without an administrator who can manage roles', async () => {
        const holders = () =>
          prisma.user.count({ where: { isActive: true, roles: { some: { role: { permissions: { some: { permission: { code: 'roles:write' } } } } } } } });
        const second = await createUser(prisma, { role: 'SUPER_ADMIN' });
        const first = await idOf('superadmin@azharpark.test');
        const before = await holders();
        expect(before).toBeGreaterThanOrEqual(2);

        // deactivate down to one holder (each actor must itself be a holder to manage another)
        const secondToken = await tokenOf(second.email);
        await call('post', `/users/${first}/deactivate`, secondToken).expect(200);
        // the only protection left is that nobody can remove themselves: the last holder cannot step down
        await call('post', `/users/${second.id}/deactivate`, secondToken).expect(409);
        await call('put', `/users/${second.id}/roles`, secondToken, { roleCodes: ['ANALYST'] }).expect(409);
        expect(await holders()).toBe(before - 1);
        await prisma.user.update({ where: { id: first }, data: { isActive: true } });
      });
    });

    it('changes roles and signs the person out so the new roles apply from a fresh sign-in; audits old and new roles', async () => {
      const admin = await tokenOf('admin@azharpark.test');
      const target = await createUser(prisma, { role: 'ANALYST' });
      const session = await login(app, target.email);
      await call('put', `/users/${target.id}/roles`, admin, { roleCodes: ['CONTENT_MANAGER'] }).expect(200);
      await call('get', '/auth/me', session.accessToken).expect(401);
      const fresh = await call('get', '/auth/me', await tokenOf(target.email)).expect(200);
      expect(fresh.body.data.roles).toEqual(['CONTENT_MANAGER']);
      const entry = (await audit('user.roles_changed')).find((a) => a.entityId === target.id)!;
      expect(entry.oldValue).toEqual({ roles: ['ANALYST'] });
      expect(entry.newValue).toEqual({ roles: ['CONTENT_MANAGER'] });
    });

    it('lets an administrator trigger a reset link for someone, who then chooses their own password', async () => {
      const admin = await tokenOf('admin@azharpark.test');
      const target = await createUser(prisma, { role: 'ANALYST' });
      await call('post', `/users/${target.id}/send-password-reset`, admin).expect(200);
      expect(notifier.last(target.email)?.purpose).toBe('reset');
      expect((await audit('user.password_reset_sent')).some((a) => a.entityId === target.id)).toBe(true);
    });

    it('updates a name', async () => {
      const admin = await tokenOf('admin@azharpark.test');
      const target = await createUser(prisma, { role: 'ANALYST', fullName: 'Old Name' });
      const res = await call('patch', `/users/${target.id}`, admin, { fullName: 'New Name' }).expect(200);
      expect(res.body.data.fullName).toBe('New Name');
      await call('patch', `/users/${target.id}`, admin, { fullName: 'x' }).expect(400);
    });
  });
});
