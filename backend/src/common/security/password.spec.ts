import { hashPassword, verifyPassword } from './password';

describe('password hashing (argon2id)', () => {
  it('produces an argon2id hash, never the plain text', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('correct horse');
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('Secret-Passw0rd!');
    await expect(verifyPassword(hash, 'Secret-Passw0rd!')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'secret-passw0rd!')).resolves.toBe(false);
  });

  it('salts: the same password hashes differently each time', async () => {
    const [a, b] = await Promise.all([hashPassword('same-password-1'), hashPassword('same-password-1')]);
    expect(a).not.toBe(b);
  });

  it('treats a malformed stored hash as a failed login instead of throwing', async () => {
    await expect(verifyPassword('not-a-hash', 'anything')).resolves.toBe(false);
    await expect(verifyPassword('', 'anything')).resolves.toBe(false);
  });
});
