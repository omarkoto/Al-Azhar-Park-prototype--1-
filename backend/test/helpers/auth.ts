import type { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { hashPassword } from '../../src/common/security/password';
import { TEST_PASSWORD } from './db';

export const API = '/api/v1';
export const NEW_PASSWORD = 'A-Brand-New-Passphrase-77';

let ipCounter = 1;
/** Every call gets its own client address (the test app trusts X-Forwarded-For), so rate limits never bleed between tests. */
export const nextIp = () => `10.20.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

let cachedHash: Promise<string> | undefined;
const testHash = () => (cachedHash ??= hashPassword(TEST_PASSWORD));

let userCounter = 0;
/** Creates an extra user directly in the database (fast; the seeded dev users stay untouched). */
export async function createUser(
  prisma: PrismaClient,
  opts: { role?: string; roles?: string[]; email?: string; fullName?: string; isActive?: boolean } = {},
) {
  const email = opts.email ?? `user${++userCounter}.${Date.now()}@azharpark.test`;
  const roleCodes = opts.roles ?? [opts.role ?? 'ANALYST'];
  const roles = await prisma.role.findMany({ where: { code: { in: roleCodes } } });
  return prisma.user.create({
    data: {
      email, fullName: opts.fullName ?? 'Test Person', passwordHash: await testHash(), isActive: opts.isActive ?? true,
      roles: { create: roles.map((r) => ({ roleId: r.id })) },
    },
  });
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  ip: string;
  auth: { Authorization: string };
}

export async function login(app: NestExpressApplication, email: string, password = TEST_PASSWORD, ip = nextIp()): Promise<Session> {
  const res = await request(app.getHttpServer())
    .post(`${API}/auth/login`)
    .set('X-Forwarded-For', ip)
    .set('X-Token-Delivery', 'body')
    .send({ email, password })
    .expect(200);
  return { accessToken: res.body.data.accessToken, refreshToken: res.body.data.refreshToken, ip, auth: { Authorization: `Bearer ${res.body.data.accessToken}` } };
}

/** A hand-built access token, for forging attempts. */
export function forgeToken(app: NestExpressApplication, claims: Record<string, unknown>, opts: { secret?: string; expiresIn?: number; algorithm?: 'HS256' | 'HS512' } = {}) {
  return app.get(JwtService).signAsync(claims, {
    secret: opts.secret ?? process.env.JWT_ACCESS_SECRET,
    algorithm: opts.algorithm ?? 'HS256',
    expiresIn: opts.expiresIn ?? 600,
    issuer: 'azharpark-api',
    audience: 'azharpark-portal',
  });
}

/**
 * Runs `fn` with a protection trigger switched off, to set up states the application can no longer produce
 * (for example an already-expired token whose expiry is immutable). Tests run serially, so this is safe.
 */
export async function withoutTrigger<T>(prisma: PrismaClient, table: string, trigger: string, fn: () => Promise<T>): Promise<T> {
  await prisma.$executeRawUnsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
  try {
    return await fn();
  } finally {
    await prisma.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
  }
}
