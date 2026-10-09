import { randomBytes } from 'node:crypto';
import { AppConfigService } from './app-config.service';
import { validateEnv } from './env.schema';

// Phase 11 (security hardening): NODE_ENV is required, Swagger is off in production by default, and production refuses weak,
// placeholder and shared secrets.

const SECRET_A = 'Qm7vK2xR9wLz4TnB8dYc1HfJ6sPa3GuE5ioVrXtN0Wk';
const SECRET_B = 'h3Zt8PqLw0YcN5vBx2RkM9aUe7GdJ4sFoT1iXn6VyEr';
const SECRET_C = 'Bn5Xc8Wq2Lk7Rv0Ty3ZmJ9dPs4GhUe1AoFi6NtYxVrQw';
const url = { DATABASE_URL: 'postgresql://u:p@db:5432/x' };
const prod = { ...url, NODE_ENV: 'production', CORS_ORIGINS: 'https://www.azharpark.com', JWT_ACCESS_SECRET: SECRET_A, JWT_REFRESH_SECRET: SECRET_B, TICKET_TOKEN_PEPPER: SECRET_C };

describe('NODE_ENV is required (it has no default)', () => {
  it('refuses to start when it is missing, so a server can never quietly become a development server', () => {
    expect(() => validateEnv(url)).toThrow(/NODE_ENV: is required/);
    expect(() => validateEnv({ ...url, NODE_ENV: undefined })).toThrow(/NODE_ENV/);
  });

  it.each(['', 'prod', 'Production', 'staging', 'dev', ' production', 'true'])('refuses the invalid value %j', (value) => {
    expect(() => validateEnv({ ...url, NODE_ENV: value })).toThrow(/NODE_ENV: must be one of: production, development, test/);
  });

  it.each(['development', 'test'])('accepts %s without any production secrets', (value) => {
    expect(validateEnv({ ...url, NODE_ENV: value }).NODE_ENV).toBe(value);
  });

  it('with production, still demands every production safeguard (no silent fall back to development behaviour)', () => {
    expect(() => validateEnv({ ...url, NODE_ENV: 'production' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(validateEnv(prod).NODE_ENV).toBe('production');
  });

  it('in production the payment and e-mail providers can never default to the development stand-ins', () => {
    const config = new AppConfigService(prod);
    expect(config.paymentProvider).toBe('none');
    expect(config.isProduction).toBe(true);
    expect(() => new AppConfigService({ ...prod, PAYMENT_PROVIDER: 'mock' })).toThrow(/development only/);
    expect(() => new AppConfigService({ ...prod, EMAIL_PROVIDER: 'log' })).toThrow(/development only/);
    // the development default still works for local work
    expect(new AppConfigService({ ...url, NODE_ENV: 'development' }).paymentProvider).toBe('mock');
  });

  it('does not echo the offending value back (it could be pasted by mistake next to a secret)', () => {
    expect(() => validateEnv({ ...url, NODE_ENV: 'sup3r-s3cret-value' })).toThrow(/NODE_ENV/);
    try {
      validateEnv({ ...url, NODE_ENV: 'sup3r-s3cret-value' });
    } catch (error) {
      expect((error as Error).message).not.toContain('sup3r-s3cret-value');
    }
  });
});

describe('Swagger (API documentation) default', () => {
  it('is on in development and test, as before', () => {
    expect(validateEnv({ ...url, NODE_ENV: 'development' }).SWAGGER_ENABLED).toBe(true);
    expect(validateEnv({ ...url, NODE_ENV: 'test' }).SWAGGER_ENABLED).toBe(true);
  });

  it('is OFF in production unless it is switched on explicitly', () => {
    expect(validateEnv(prod).SWAGGER_ENABLED).toBe(false);
    expect(validateEnv({ ...prod, SWAGGER_ENABLED: 'true' }).SWAGGER_ENABLED).toBe(true);
    expect(validateEnv({ ...prod, SWAGGER_ENABLED: '1' }).SWAGGER_ENABLED).toBe(true);
    expect(validateEnv({ ...prod, SWAGGER_ENABLED: 'false' }).SWAGGER_ENABLED).toBe(false);
  });

  it('can still be switched off outside production', () => {
    expect(validateEnv({ ...url, NODE_ENV: 'development', SWAGGER_ENABLED: 'false' }).SWAGGER_ENABLED).toBe(false);
  });
});

describe('production secret quality', () => {
  const secrets = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'TICKET_TOKEN_PEPPER'] as const;

  it('accepts three independent random secrets, and generated ones of the recommended kind', () => {
    expect(() => validateEnv(prod)).not.toThrow();
    for (let i = 0; i < 50; i += 1) {
      const generated = Object.fromEntries(secrets.map((k) => [k, randomBytes(48).toString('base64url')]));
      expect(() => validateEnv({ ...prod, ...generated })).not.toThrow();
    }
  });

  const bad: Array<[string, string, RegExp]> = [
    ['the development access secret that is public in the repository', 'dev-only-access-secret-do-not-deploy-0123456789', /development value or a placeholder/],
    ['the development refresh secret', 'dev-only-refresh-secret-do-not-deploy-9876543210', /development value or a placeholder/],
    ['the development ticket pepper', 'dev-only-ticket-pepper-do-not-deploy-0123456789abcdef', /development value or a placeholder/],
    ['a CHANGE_ME placeholder', 'CHANGE_ME_CHANGE_ME_CHANGE_ME_CHANGE_ME', /placeholder/],
    ['a placeholder with different casing and separators', 'please-Change-Me-to-something-long-enough-1', /placeholder/],
    ['a sentence mentioning password', 'my-very-long-password-for-the-park-1234', /placeholder/],
    ['one character repeated', 'a'.repeat(48), /too few different characters/],
    ['a short pattern repeated', 'Qm7vK2xR9wLzQm7vK2xR9wLzQm7vK2xR9wLz', /repeated/],
    ['only a handful of characters', 'abababcabcabcabaabbccabcbacbacbabcabcab', /few different characters/],
    ['a 32 character secret of only 8 distinct characters', '12121212343434345656565678787878', /few different characters/],
  ];

  describe.each(secrets)('%s', (name) => {
    it.each(bad)('is refused in production when it is %s', (_label, value, message) => {
      expect(() => validateEnv({ ...prod, [name]: value })).toThrow(new RegExp(`${name}: `));
      expect(() => validateEnv({ ...prod, [name]: value })).toThrow(message);
    });

    it('is not checked for quality outside production (development keeps working with simple values)', () => {
      expect(() => validateEnv({ ...prod, NODE_ENV: 'development', [name]: 'a'.repeat(40) })).not.toThrow();
    });
  });

  it('never prints the rejected secret', () => {
    for (const value of ['a'.repeat(48), 'dev-only-access-secret-do-not-deploy-0123456789']) {
      let message = '';
      try {
        validateEnv({ ...prod, JWT_ACCESS_SECRET: value });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain('JWT_ACCESS_SECRET');
      expect(message).not.toContain(value);
    }
  });

  describe('secrets are not shared between purposes', () => {
    const QR_1 = 'Zk4Lp9Wc2Vx7Nb0Qa5Hs8Tr3Yu6Jm1Gd4FeKiOtRwXv';
    const QR_2 = 'Tx9Rm3Lc7Wq1Zv5Nb8Hk2Ya6Pd0JsGe4FuOiVtBwAnMr';

    it('refuses the same secret for both JWT secrets, or for a JWT secret and the ticket pepper', () => {
      expect(() => validateEnv({ ...prod, JWT_REFRESH_SECRET: SECRET_A })).toThrow(/JWT_REFRESH_SECRET: must differ/);
      expect(() => validateEnv({ ...prod, TICKET_TOKEN_PEPPER: SECRET_A })).toThrow(/TICKET_TOKEN_PEPPER: must differ from the JWT secrets/);
      expect(() => validateEnv({ ...prod, TICKET_TOKEN_PEPPER: SECRET_B })).toThrow(/TICKET_TOKEN_PEPPER: must differ from the JWT secrets/);
    });

    it('accepts independent QR keys, and a QR key that equals the pepper (the pepper IS key 1 by default)', () => {
      expect(() => validateEnv({ ...prod, TICKET_QR_KEYS: JSON.stringify({ 1: QR_1, 2: QR_2 }), TICKET_QR_ACTIVE_KEY_ID: '2' })).not.toThrow();
      expect(() => validateEnv({ ...prod, TICKET_QR_KEYS: JSON.stringify({ 1: SECRET_C, 2: QR_2 }), TICKET_QR_ACTIVE_KEY_ID: '2' })).not.toThrow();
    });

    it('refuses a QR key that equals a JWT secret, two QR keys that are equal, and weak QR keys', () => {
      expect(() => validateEnv({ ...prod, TICKET_QR_KEYS: JSON.stringify({ 1: SECRET_A }) })).toThrow(/key 1 must differ from the JWT secrets/);
      expect(() => validateEnv({ ...prod, TICKET_QR_KEYS: JSON.stringify({ 1: SECRET_B }) })).toThrow(/key 1 must differ from the JWT secrets/);
      expect(() => validateEnv({ ...prod, TICKET_QR_KEYS: JSON.stringify({ 1: QR_1, 2: QR_1 }), TICKET_QR_ACTIVE_KEY_ID: '2' })).toThrow(/every key must have its own secret/);
      expect(() => validateEnv({ ...prod, TICKET_QR_KEYS: JSON.stringify({ 1: 'k'.repeat(40) }) })).toThrow(/key 1 uses too few different characters/);
      expect(() => validateEnv({ ...prod, TICKET_QR_KEYS: JSON.stringify({ 1: 'dev-only-qr-key-do-not-deploy-0123456789abc' }) })).toThrow(/key 1 looks like a development value/);
    });

    it('does not check QR key quality outside production', () => {
      expect(() => validateEnv({ ...url, NODE_ENV: 'development', TICKET_QR_KEYS: JSON.stringify({ 1: 'k'.repeat(40) }) })).not.toThrow();
    });
  });
});
