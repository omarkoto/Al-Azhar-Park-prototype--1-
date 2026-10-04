import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id with the library defaults (m = 19 MiB, t = 2, p = 1 — OWASP's minimum recommendation).
 * The algorithm is passed as its numeric value because the library exports a `const enum`, which
 * cannot be imported under isolatedModules / ts-jest.
 */
const ARGON2ID = 2;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, { algorithm: ARGON2ID });
}

/** Never throws on a malformed hash: a bad stored value simply fails verification. */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain);
  } catch {
    return false;
  }
}
