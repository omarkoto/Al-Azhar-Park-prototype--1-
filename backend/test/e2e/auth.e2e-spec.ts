import type { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { TEST_PASSWORD, createTestPrisma, resetDatabase, seedAll } from '../helpers/db';
import { CapturingNotifier, createTestApp } from '../helpers/app';
import { API, NEW_PASSWORD, createUser, forgeToken, login, nextIp, withoutTrigger } from '../helpers/auth';

describe('authentication (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  const notifier = new CapturingNotifier();
  const http = () => request(app.getHttpServer());

  const post = (path: string, body: object = {}, ip = nextIp(), headers: Record<string, string> = {}) =>
    http().post(`${API}${path}`).set('X-Forwarded-For', ip).set(headers).send(body);
  const get = (path: string, token?: string) => http().get(`${API}${path}`).set('X-Forwarded-For', nextIp()).set(token ? { Authorization: `Bearer ${token}` } : {});
  const auditActions = async (userId?: string) =>
    (await prisma.auditLog.findMany({ where: userId ? { userId } : {}, orderBy: { createdAt: 'asc' } })).map((a) => a.action);

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

  // ───────────────────────── login ─────────────────────────
  describe('login', () => {
    it('signs in with e-mail and password, returning a short-lived access token and the effective permissions', async () => {
      const res = await post('/auth/login', { email: 'admin@azharpark.test', password: TEST_PASSWORD }, nextIp(), { 'X-Token-Delivery': 'body' }).expect(200);
      expect(res.body.data).toMatchObject({ tokenType: 'Bearer', expiresIn: 900, user: { email: 'admin@azharpark.test', roles: ['ADMIN'] } });
      expect(res.body.data.user.permissions).toEqual(expect.arrayContaining(['users:read', 'pricing:write']));
      expect(res.body.data.user.permissions).not.toContain('roles:write');
      expect(res.body.data.user.passwordHash).toBeUndefined();
      const claims = app.get(JwtService).decode(res.body.data.accessToken) as Record<string, unknown>;
      expect(Object.keys(claims).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'sid', 'sub', 'tv']); // no roles/permissions inside the token
    });

    it('is case-insensitive on the e-mail address', async () => {
      await post('/auth/login', { email: '  ADMIN@AzharPark.TEST ', password: TEST_PASSWORD }).expect(200);
    });

    it('delivers the refresh token as an httpOnly, strict, path-scoped cookie by default — and not in the body', async () => {
      const res = await post('/auth/login', { email: 'admin@azharpark.test', password: TEST_PASSWORD }).expect(200);
      expect(res.body.data.refreshToken).toBeUndefined();
      const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('azp_refresh='));
      expect(cookie).toBeDefined();
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
      expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
      expect(cookie).toMatch(/Max-Age=60479[89]|Max-Age=604800/); // 7 days
    });

    it('gives the same answer for a wrong password, an unknown e-mail and an inactive account', async () => {
      const inactive = await createUser(prisma, { isActive: false });
      const wrong = await post('/auth/login', { email: 'admin@azharpark.test', password: 'not-the-password-1' }).expect(401);
      const unknown = await post('/auth/login', { email: 'nobody@azharpark.test', password: TEST_PASSWORD }).expect(401);
      const off = await post('/auth/login', { email: inactive.email, password: TEST_PASSWORD }).expect(401);
      for (const res of [wrong, unknown, off]) {
        expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
        expect(res.body.error.message).toBe(wrong.body.error.message);
      }
    });

    it('validates the request shape', async () => {
      await post('/auth/login', { email: 'a@b.test' }).expect(400);
      await post('/auth/login', { email: 'a@b.test', password: 'x'.repeat(2000) }).expect(400);
      await post('/auth/login', {}).expect(400);
    });

    it('locks the account after 5 wrong passwords — even the right password is then refused — and audits it', async () => {
      const user = await createUser(prisma);
      for (let i = 0; i < 5; i++) await post('/auth/login', { email: user.email, password: `wrong-password-${i}` }).expect(401);
      const locked = await post('/auth/login', { email: user.email, password: TEST_PASSWORD }).expect(401);
      expect(locked.body.error.code).toBe('INVALID_CREDENTIALS'); // same answer: lock state is not revealed
      const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);

      const actions = await auditActions(user.id);
      expect(actions.filter((a) => a === 'auth.login.failed')).toHaveLength(4);
      expect(actions).toEqual(expect.arrayContaining(['auth.login.locked', 'auth.login.blocked']));

      // once the lock has passed the account works again
      await prisma.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
      await post('/auth/login', { email: user.email, password: TEST_PASSWORD }).expect(200);
    });

    it('resets the failure counter after a successful sign-in', async () => {
      const user = await createUser(prisma);
      for (let i = 0; i < 4; i++) await post('/auth/login', { email: user.email, password: `wrong-password-${i}` }).expect(401);
      await post('/auth/login', { email: user.email, password: TEST_PASSWORD }).expect(200);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).failedLoginCount).toBe(0);
      for (let i = 0; i < 4; i++) await post('/auth/login', { email: user.email, password: `wrong-password-${i}` }).expect(401);
      await post('/auth/login', { email: user.email, password: TEST_PASSWORD }).expect(200); // 4 + 4 failures, never 5 in a row
    });

    it('audits success and failure, without ever storing a password', async () => {
      const user = await createUser(prisma);
      await post('/auth/login', { email: user.email, password: 'a-wrong-password-9' }).expect(401);
      await post('/auth/login', { email: user.email, password: TEST_PASSWORD }).expect(200);
      expect(await auditActions(user.id)).toEqual(['auth.login.failed', 'auth.login.success']);

      await post('/auth/login', { email: 'someone.else@azharpark.test', password: 'tried-this-123' }).expect(401);
      const everything = JSON.stringify(await prisma.auditLog.findMany());
      expect(everything).not.toContain(TEST_PASSWORD);
      expect(everything).not.toContain('a-wrong-password-9');
      expect(everything).not.toContain('tried-this-123');
    });

    it('does not record a password typed into the e-mail field', async () => {
      await post('/auth/login', { email: 'Sup3r-Secret-Typed-Here', password: 'whatever-123456' }).expect(401);
      expect(JSON.stringify(await prisma.auditLog.findMany())).not.toContain('Sup3r-Secret-Typed-Here');
    });

    it('rate-limits sign-in attempts per client address (429, with Retry-After) without affecting other clients', async () => {
      const ip = nextIp();
      for (let i = 0; i < 10; i++) await post('/auth/login', { email: 'nobody@azharpark.test', password: 'x'.repeat(12) }, ip).expect(401);
      const limited = await post('/auth/login', { email: 'nobody@azharpark.test', password: 'x'.repeat(12) }, ip).expect(429);
      expect(limited.body.error.code).toBe('RATE_LIMITED');
      expect(limited.headers['retry-after']).toBeDefined();
      await post('/auth/login', { email: 'admin@azharpark.test', password: TEST_PASSWORD }, nextIp()).expect(200);
    });
  });

  // ───────────────────────── access tokens ─────────────────────────
  describe('access tokens', () => {
    it('are required for protected routes', async () => {
      const res = await get('/auth/me').expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      await get('/auth/me', 'not-a-token-at-all-not-a-token').expect(401);
    });

    it('accept a real token and reject forgeries, expiry and tampering', async () => {
      const user = await createUser(prisma);
      const session = await login(app, user.email);
      const claims = app.get(JwtService).decode(session.accessToken) as { sid: string };

      // control: a hand-forged token with the right secret and a live session IS accepted, so the failures below are meaningful
      await get('/auth/me', await forgeToken(app, { sub: user.id, tv: 0, sid: claims.sid })).expect(200);

      await get('/auth/me', await forgeToken(app, { sub: user.id, tv: 0, sid: claims.sid }, { secret: 'a-completely-different-secret-value-x' })).expect(401);
      await get('/auth/me', await forgeToken(app, { sub: user.id, tv: 0, sid: claims.sid }, { expiresIn: -10 })).expect(401);
      await get('/auth/me', await forgeToken(app, { sub: user.id, tv: 0, sid: claims.sid }, { algorithm: 'HS512' })).expect(401);
      await get('/auth/me', await forgeToken(app, { sub: user.id, tv: 99, sid: claims.sid })).expect(401); // wrong token version
      await get('/auth/me', await forgeToken(app, { sub: user.id, tv: 0, sid: '00000000-0000-4000-8000-000000000000' })).expect(401); // no such session
      await get('/auth/me', await forgeToken(app, { sub: '00000000-0000-4000-8000-000000000000', tv: 0, sid: claims.sid })).expect(401);
      await get('/auth/me', await forgeToken(app, { tv: 0, sid: claims.sid })).expect(401); // no subject

      const [header, payload] = session.accessToken.split('.');
      const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${payload}.`;
      await get('/auth/me', none).expect(401);
      await get('/auth/me', `${header}.${payload}.${'A'.repeat(43)}`).expect(401);
    });

    it('stop working the moment the user is deactivated, with no need to wait for expiry', async () => {
      const user = await createUser(prisma);
      const session = await login(app, user.email);
      await get('/auth/me', session.accessToken).expect(200);
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
      await get('/auth/me', session.accessToken).expect(401);
    });

    it('do not carry permissions: a role change applies to the very next request', async () => {
      const role = await prisma.role.create({ data: { code: 'TEMP_VIEWER', name: 'Temp viewer' } });
      const perm = await prisma.permission.findUniqueOrThrow({ where: { code: 'users:read' } });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
      const user = await createUser(prisma, { role: 'TEMP_VIEWER' });
      const session = await login(app, user.email);

      await http().get(`${API}/users`).set(session.auth).expect(200);
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      await http().get(`${API}/users`).set(session.auth).expect(403);
    });
  });

  // ───────────────────────── refresh rotation and reuse detection ─────────────────────────
  describe('refresh tokens', () => {
    const refresh = (token: string, ip = nextIp()) => post('/auth/refresh', { refreshToken: token }, ip);

    it('rotate on every use: a new refresh token each time, and the old one stops working', async () => {
      const user = await createUser(prisma);
      const first = await login(app, user.email);
      const res = await refresh(first.refreshToken).set('X-Token-Delivery', 'body').expect(200);
      const second = res.body.data.refreshToken as string;
      expect(second).toBeDefined();
      expect(second).not.toBe(first.refreshToken);
      await get('/auth/me', res.body.data.accessToken).expect(200);
      await refresh(first.refreshToken).expect(401);
    });

    it('keeps all rotations in one session (family) and links each token to its successor', async () => {
      const user = await createUser(prisma);
      const first = await login(app, user.email);
      const r1 = await refresh(first.refreshToken).set('X-Token-Delivery', 'body').expect(200);
      await refresh(r1.body.data.refreshToken).set('X-Token-Delivery', 'body').expect(200);
      const rows = await prisma.refreshToken.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } });
      expect(rows).toHaveLength(3);
      expect(new Set(rows.map((r) => r.familyId)).size).toBe(1);
      expect(rows[0].replacedById).toBe(rows[1].id);
      expect(rows[1].replacedById).toBe(rows[2].id);
      expect(rows[2].revokedAt).toBeNull();
    });

    it('detect REUSE of a rotated token: the whole session is revoked, including the newest token and its access token', async () => {
      const user = await createUser(prisma);
      const first = await login(app, user.email);
      const rotated = await refresh(first.refreshToken).set('X-Token-Delivery', 'body').expect(200);
      await get('/auth/me', rotated.body.data.accessToken).expect(200);

      // an attacker (or a stale copy) replays the old token
      await refresh(first.refreshToken).expect(401);

      // the legitimate newest token and its access token are now dead too
      await refresh(rotated.body.data.refreshToken).expect(401);
      await get('/auth/me', rotated.body.data.accessToken).expect(401);
      expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
      expect(await auditActions(user.id)).toContain('auth.token.reuse_detected');
    });

    it('lets exactly one of two simultaneous refreshes with the same token succeed', async () => {
      const user = await createUser(prisma);
      const first = await login(app, user.email);
      const results = await Promise.all([refresh(first.refreshToken), refresh(first.refreshToken), refresh(first.refreshToken)]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 401)).toHaveLength(2);
      // two requests tried the same token: treated as reuse, so the session is closed
      expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    });

    it('work from the httpOnly cookie, with no body', async () => {
      const login1 = await post('/auth/login', { email: 'admin@azharpark.test', password: TEST_PASSWORD }).expect(200);
      const cookie = ([] as string[]).concat(login1.headers['set-cookie']).map((c) => c.split(';')[0]).join('; ');
      const res = await http().post(`${API}/auth/refresh`).set('X-Forwarded-For', nextIp()).set('Cookie', cookie).send({}).expect(200);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.refreshToken).toBeUndefined();
      expect(([] as string[]).concat(res.headers['set-cookie']).some((c) => c.startsWith('azp_refresh='))).toBe(true);
    });

    it('reject missing, malformed, unknown and expired tokens', async () => {
      const user = await createUser(prisma);
      const session = await login(app, user.email);
      await post('/auth/refresh', {}).expect(401);
      await refresh('x'.repeat(40)).expect(401);
      await post('/auth/refresh', { refreshToken: 'short' }).expect(400);
      await withoutTrigger(prisma, 'refresh_tokens', 'trg_refresh_tokens_guard', () =>
        prisma.refreshToken.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } }),
      );
      await refresh(session.refreshToken).expect(401);
    });

    describe('absolute session lifetime (30 days)', () => {
      const backdate = (userId: string, days: number) =>
        withoutTrigger(prisma, 'refresh_tokens', 'trg_refresh_tokens_guard', () =>
          prisma.refreshToken.updateMany({ where: { userId }, data: { sessionStartedAt: new Date(Date.now() - days * 86_400_000) } }),
        );

      it('every rotated token inherits the original login time, so rotation cannot reset the clock', async () => {
        const user = await createUser(prisma);
        const first = await login(app, user.email);
        const r1 = await refresh(first.refreshToken).set('X-Token-Delivery', 'body').expect(200);
        await refresh(r1.body.data.refreshToken).set('X-Token-Delivery', 'body').expect(200);
        const rows = await prisma.refreshToken.findMany({ where: { userId: user.id } });
        expect(rows).toHaveLength(3);
        expect(new Set(rows.map((r) => r.sessionStartedAt.getTime())).size).toBe(1);
      });

      it('ends the session once it is 30 days old, however recently it was refreshed', async () => {
        const user = await createUser(prisma);
        const first = await login(app, user.email);
        const r1 = await refresh(first.refreshToken).set('X-Token-Delivery', 'body').expect(200); // a fresh, unexpired token
        await backdate(user.id, 30.01);

        const res = await refresh(r1.body.data.refreshToken).expect(401);
        expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
        expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
        await get('/auth/me', r1.body.data.accessToken).expect(401); // its access token dies with the session
        expect(await auditActions(user.id)).toContain('auth.session.expired');
      });

      it('still allows a refresh on day 29, but the new token cannot outlive day 30', async () => {
        const user = await createUser(prisma);
        const first = await login(app, user.email);
        await backdate(user.id, 29);
        await refresh(first.refreshToken).set('X-Token-Delivery', 'body').expect(200);
        const newest = await prisma.refreshToken.findFirstOrThrow({ where: { userId: user.id, revokedAt: null } });
        const end = newest.sessionStartedAt.getTime() + 30 * 86_400_000;
        expect(newest.expiresAt.getTime()).toBe(end); // capped at the session end, not "now + 7 days"
        expect(newest.expiresAt.getTime() - Date.now()).toBeLessThan(86_400_000 + 5_000);
      });

      it('gives a normal session the usual 7-day refresh token', async () => {
        const user = await createUser(prisma);
        await login(app, user.email);
        const row = await prisma.refreshToken.findFirstOrThrow({ where: { userId: user.id } });
        const days = (row.expiresAt.getTime() - Date.now()) / 86_400_000;
        expect(days).toBeGreaterThan(6.99);
        expect(days).toBeLessThanOrEqual(7);
      });

      it('requires a fresh sign-in after expiry, which starts a new 30-day session', async () => {
        const user = await createUser(prisma);
        const old = await login(app, user.email);
        await backdate(user.id, 31);
        await refresh(old.refreshToken).expect(401);
        const again = await login(app, user.email);
        await refresh(again.refreshToken).expect(200);
      });
    });

    describe('cookie origin check (CSRF defence in depth)', () => {
      it('refuses a cookie-borne refresh or logout from a foreign origin, and accepts our own', async () => {
        const res = await post('/auth/login', { email: 'admin@azharpark.test', password: TEST_PASSWORD }).expect(200);
        const cookie = ([] as string[]).concat(res.headers['set-cookie']).map((c) => c.split(';')[0]).join('; ');
        const send = (path: string, origin: string) =>
          http().post(`${API}${path}`).set('X-Forwarded-For', nextIp()).set('Cookie', cookie).set('Origin', origin).send({});

        expect((await send('/auth/refresh', 'https://evil.example').expect(403)).body.error.code).toBe('ORIGIN_NOT_ALLOWED');
        await send('/auth/logout', 'https://evil.example').expect(403);
        await send('/auth/refresh', 'http://localhost:5173').expect(200); // allowed origin; the refusals did not consume the token
      });
    });

    it('are stored only as a keyed hash, never in plain text', async () => {
      const user = await createUser(prisma);
      const session = await login(app, user.email);
      const row = await prisma.refreshToken.findFirstOrThrow({ where: { userId: user.id } });
      expect(row.tokenHash).not.toContain(session.refreshToken);
      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('are refused (and the session closed) once the user is deactivated', async () => {
      const user = await createUser(prisma);
      const session = await login(app, user.email);
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
      await refresh(session.refreshToken).expect(401);
      expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    });
  });

  // ───────────────────────── logout ─────────────────────────
  describe('logout', () => {
    it('ends the session: the refresh token and the access token both stop working', async () => {
      const user = await createUser(prisma);
      const session = await login(app, user.email);
      await post('/auth/logout', { refreshToken: session.refreshToken }).expect(200);
      await post('/auth/refresh', { refreshToken: session.refreshToken }).expect(401);
      await get('/auth/me', session.accessToken).expect(401);
      expect(await auditActions(user.id)).toContain('auth.logout');
    });

    it('is idempotent, never errors on junk, and a logged-out token is not mistaken for a stolen one', async () => {
      const user = await createUser(prisma);
      const session = await login(app, user.email);
      await post('/auth/logout', { refreshToken: session.refreshToken }).expect(200);
      await post('/auth/logout', { refreshToken: session.refreshToken }).expect(200);
      await post('/auth/logout', {}).expect(200);
      await post('/auth/logout', { refreshToken: 'y'.repeat(40) }).expect(200);
      await post('/auth/refresh', { refreshToken: session.refreshToken }).expect(401);
      expect(await auditActions(user.id)).not.toContain('auth.token.reuse_detected');
    });

    it('only ends its own session; logout-all ends every session', async () => {
      const user = await createUser(prisma);
      const a = await login(app, user.email);
      const b = await login(app, user.email);
      await post('/auth/logout', { refreshToken: a.refreshToken }).expect(200);
      await get('/auth/me', b.accessToken).expect(200);

      const c = await login(app, user.email);
      await http().post(`${API}/auth/logout-all`).set(c.auth).expect(200);
      await get('/auth/me', b.accessToken).expect(401);
      await get('/auth/me', c.accessToken).expect(401);
      await post('/auth/refresh', { refreshToken: b.refreshToken }).expect(401);
    });
  });

  // ───────────────────────── change password ─────────────────────────
  describe('change password', () => {
    const change = (token: string, body: object) => http().post(`${API}/auth/change-password`).set('X-Forwarded-For', nextIp()).set({ Authorization: `Bearer ${token}` }).send(body);

    it('requires the current password and a policy-compliant new one', async () => {
      const user = await createUser(prisma, { fullName: 'Karim Mostafa' });
      const s = await login(app, user.email);
      expect((await change(s.accessToken, { currentPassword: 'wrong-current-1', newPassword: NEW_PASSWORD }).expect(400)).body.error.code).toBe('INVALID_CURRENT_PASSWORD');
      expect((await change(s.accessToken, { currentPassword: TEST_PASSWORD, newPassword: 'short' }).expect(422)).body.error.code).toBe('WEAK_PASSWORD');
      await change(s.accessToken, { currentPassword: TEST_PASSWORD, newPassword: 'Karim-is-my-name-1' }).expect(422);
      expect((await change(s.accessToken, { currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD }).expect(400)).body.error.code).toBe('PASSWORD_UNCHANGED');
    });

    it('changes the password, ends every session, and audits it', async () => {
      const user = await createUser(prisma);
      const s1 = await login(app, user.email);
      const s2 = await login(app, user.email);
      await change(s1.accessToken, { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD }).expect(200);

      await get('/auth/me', s1.accessToken).expect(401);
      await get('/auth/me', s2.accessToken).expect(401);
      await post('/auth/refresh', { refreshToken: s2.refreshToken }).expect(401);
      await post('/auth/login', { email: user.email, password: TEST_PASSWORD }).expect(401);
      await login(app, user.email, NEW_PASSWORD);
      expect(await auditActions(user.id)).toContain('auth.password.changed');
      const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
      expect(row.passwordChangedAt).not.toBeNull();
    });

    it('requires a signed-in user', async () => {
      await post('/auth/change-password', { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD }).expect(401);
    });
  });

  // ───────────────────────── password reset ─────────────────────────
  describe('password reset', () => {
    const forgot = (email: string, ip = nextIp()) => post('/auth/forgot-password', { email }, ip);

    it('gives the identical answer whether or not the account exists, and sends nothing for unknown or inactive accounts', async () => {
      const inactive = await createUser(prisma, { isActive: false });
      const known = await createUser(prisma);
      const before = notifier.messages.length;
      const a = await forgot(known.email).expect(200);
      const b = await forgot('ghost@azharpark.test').expect(200);
      const c = await forgot(inactive.email).expect(200);
      expect(b.body).toEqual(a.body);
      expect(c.body).toEqual(a.body);
      expect(notifier.messages.length).toBe(before + 1);
      expect(notifier.last(known.email)).toMatchObject({ purpose: 'reset' });
    });

    it('resets the password with the emailed token: single use, ends all sessions, clears a lock, audits it', async () => {
      const user = await createUser(prisma);
      const session = await login(app, user.email);
      await prisma.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() + 600_000), failedLoginCount: 3 } });
      await forgot(user.email).expect(200);
      const { token } = notifier.last(user.email)!;

      await post('/auth/reset-password', { token, newPassword: NEW_PASSWORD }).expect(200);
      await post('/auth/reset-password', { token, newPassword: 'Another-Great-Passphrase-5' }).expect(400); // single use
      await get('/auth/me', session.accessToken).expect(401);
      await post('/auth/login', { email: user.email, password: TEST_PASSWORD }).expect(401);
      await login(app, user.email, NEW_PASSWORD);
      expect(await auditActions(user.id)).toEqual(expect.arrayContaining(['auth.password.reset_requested', 'auth.password.reset_completed']));
    });

    it('stores only a hash of the token', async () => {
      const user = await createUser(prisma);
      await forgot(user.email).expect(200);
      const { token } = notifier.last(user.email)!;
      const row = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
      expect(row.tokenHash).not.toContain(token);
      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejects expired, unknown and malformed tokens, and weak new passwords', async () => {
      const user = await createUser(prisma);
      await forgot(user.email).expect(200);
      const { token } = notifier.last(user.email)!;

      expect((await post('/auth/reset-password', { token: 'z'.repeat(43), newPassword: NEW_PASSWORD }).expect(400)).body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
      await post('/auth/reset-password', { token: 'short', newPassword: NEW_PASSWORD }).expect(400);
      expect((await post('/auth/reset-password', { token, newPassword: 'weak' }).expect(422)).body.error.code).toBe('WEAK_PASSWORD');

      await withoutTrigger(prisma, 'password_reset_tokens', 'trg_password_reset_tokens_guard', () =>
        prisma.passwordResetToken.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } }),
      );
      await post('/auth/reset-password', { token, newPassword: NEW_PASSWORD }).expect(400);
    });

    it('lets only the newest link work, and sends at most one link a minute per account', async () => {
      const user = await createUser(prisma);
      await forgot(user.email).expect(200);
      const first = notifier.last(user.email)!.token;
      await forgot(user.email).expect(200); // within a minute: ignored
      expect(notifier.messages.filter((m) => m.email === user.email)).toHaveLength(1);

      await prisma.passwordResetToken.updateMany({ where: { userId: user.id }, data: { createdAt: new Date(Date.now() - 120_000) } });
      await forgot(user.email).expect(200);
      const second = notifier.last(user.email)!.token;
      expect(second).not.toBe(first);
      await post('/auth/reset-password', { token: first, newPassword: NEW_PASSWORD }).expect(400);
      await post('/auth/reset-password', { token: second, newPassword: NEW_PASSWORD }).expect(200);
    });

    it('rate-limits reset requests per client address', async () => {
      const ip = nextIp();
      for (let i = 0; i < 5; i++) await forgot('ghost@azharpark.test', ip).expect(200);
      await forgot('ghost@azharpark.test', ip).expect(429);
    });

    it('does not let a deactivated account complete a reset it had already been sent', async () => {
      const user = await createUser(prisma);
      await forgot(user.email).expect(200);
      const { token } = notifier.last(user.email)!;
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
      await post('/auth/reset-password', { token, newPassword: NEW_PASSWORD }).expect(400);
    });
  });

  // ───────────────────────── password hashing ─────────────────────────
  describe('password storage', () => {
    it('uses argon2id for every seeded account and never exposes hashes through the API', async () => {
      const users = await prisma.user.findMany();
      expect(users.length).toBeGreaterThan(5);
      for (const u of users) expect(u.passwordHash).toMatch(/^\$argon2id\$/);
      const s = await login(app, 'superadmin@azharpark.test');
      const list = await http().get(`${API}/users`).set(s.auth).expect(200);
      expect(JSON.stringify(list.body)).not.toMatch(/argon2|passwordHash|tokenHash/);
    });
  });
});
