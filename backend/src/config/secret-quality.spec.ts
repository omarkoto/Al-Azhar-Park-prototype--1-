import { randomBytes } from 'node:crypto';
import { DEV_JWT_ACCESS_SECRET, DEV_TICKET_PEPPER, DEV_TOKEN_HASH_SECRET, secretProblem } from './secret-quality';

describe('secretProblem', () => {
  it('accepts what .env.example recommends: 48 random bytes as base64url (no false alarms over many samples)', () => {
    for (let i = 0; i < 2000; i += 1) expect(secretProblem(randomBytes(48).toString('base64url'))).toBeNull();
  });

  it('accepts random hex secrets: 64 characters always, and typical 32 character ones', () => {
    for (let i = 0; i < 500; i += 1) expect(secretProblem(randomBytes(32).toString('hex'))).toBeNull();
    // a 128-bit value written as 32 hex characters is unlucky (and refused) about once in 4,000, so use fixed samples here
    for (const sample of ['3f9a1c7e5b2d8046a1c3e5f7092b4d68', 'b81d94e27a0c63f5d2e9a4b17c80f356', '07c2e9d41ab568f3e0d7c4b19a2f6583']) expect(secretProblem(sample)).toBeNull();
  });

  it('refuses every development fallback the code itself uses', () => {
    for (const dev of [DEV_JWT_ACCESS_SECRET, DEV_TOKEN_HASH_SECRET, DEV_TICKET_PEPPER]) expect(secretProblem(dev)).toMatch(/development value or a placeholder/);
  });

  it.each([
    'CHANGE_ME',
    'change-me-please-change-me-please',
    'changeme1234567890changeme1234567890',
    'REPLACE_ME_WITH_A_REAL_SECRET_VALUE',
    'your-secret-key-goes-here-1234567890',
    'example-example-example-example',
    'p4ssw0rd-password-PASSWORD-1234567890',
  ])('refuses the placeholder %s', (value) => {
    expect(secretProblem(value)).toMatch(/placeholder/);
  });

  it('refuses secrets with too few distinct characters, repeated patterns and low entropy', () => {
    expect(secretProblem('x'.repeat(64))).toMatch(/too few different/);
    expect(secretProblem('Qm7vK2xR9wLzQm7vK2xR9wLzQm7vK2xR9wLz')).toMatch(/repeated/);
    expect(secretProblem('ab'.repeat(30))).toMatch(/too few different/);
    expect(secretProblem('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabcdefghij')).toMatch(/predictable/);
  });

  it('never repeats the secret in its explanation', () => {
    for (const value of ['x'.repeat(64), 'Qm7vK2xR9wLzQm7vK2xR9wLzQm7vK2xR9wLz', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabcdefghij', DEV_JWT_ACCESS_SECRET]) {
      expect(secretProblem(value)).not.toContain(value);
    }
  });
});
