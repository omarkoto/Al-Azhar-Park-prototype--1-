import { validateEnv } from './env.schema';

// independent, random-looking secrets (production now refuses repeated patterns, placeholders and reuse)
const SECRET_A = 'Qm7vK2xR9wLz4TnB8dYc1HfJ6sPa3GuE5ioVrXtN0Wk';
const SECRET_B = 'h3Zt8PqLw0YcN5vBx2RkM9aUe7GdJ4sFoT1iXn6VyEr';
const SECRET_C = 'Bn5Xc8Wq2Lk7Rv0Ty3ZmJ9dPs4GhUe1AoFi6NtYxVrQw';

const base = { NODE_ENV: 'development', DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };
const prodSecrets = {
  JWT_ACCESS_SECRET: SECRET_A,
  JWT_REFRESH_SECRET: SECRET_B,
  TICKET_TOKEN_PEPPER: SECRET_C,
  CORS_ORIGINS: 'https://www.azharpark.com',
};

describe('validateEnv', () => {
  it('applies safe defaults in development', () => {
    const env = validateEnv(base);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.CORS_ORIGINS).toEqual([]);
    expect(env.SWAGGER_ENABLED).toBe(true);
    expect(env.TRUST_PROXY).toBe(0);
  });

  it('refuses to boot without DATABASE_URL', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a DATABASE_URL that is not PostgreSQL', () => {
    expect(() => validateEnv({ DATABASE_URL: 'mysql://localhost/db' })).toThrow(/PostgreSQL/);
  });

  it('coerces numbers and booleans from strings', () => {
    const env = validateEnv({ ...base, PORT: '8080', SWAGGER_ENABLED: 'false', RATE_LIMIT_MAX: '10' });
    expect(env.PORT).toBe(8080);
    expect(env.SWAGGER_ENABLED).toBe(false);
    expect(env.RATE_LIMIT_MAX).toBe(10);
  });

  it('parses a comma-separated CORS allow-list', () => {
    const env = validateEnv({ ...base, CORS_ORIGINS: 'http://localhost:5173, https://portal.azharpark.com' });
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173', 'https://portal.azharpark.com']);
  });

  it.each(['*', 'https://example.com/', 'example.com', 'https://example.com/path'])('rejects CORS origin %s', (origin) => {
    expect(() => validateEnv({ ...base, CORS_ORIGINS: origin })).toThrow(/CORS_ORIGINS/);
  });

  it('rejects an out-of-range port', () => {
    expect(() => validateEnv({ ...base, PORT: '70000' })).toThrow(/PORT/);
  });

  describe('production', () => {
    it('accepts a fully configured production environment', () => {
      expect(() => validateEnv({ ...base, NODE_ENV: 'production', ...prodSecrets })).not.toThrow();
    });

    it('requires strong secrets', () => {
      expect(() => validateEnv({ ...base, NODE_ENV: 'production', CORS_ORIGINS: 'https://x.com' })).toThrow(/JWT_ACCESS_SECRET/);
      expect(() =>
        validateEnv({ ...base, NODE_ENV: 'production', ...prodSecrets, JWT_ACCESS_SECRET: 'short' }),
      ).toThrow(/JWT_ACCESS_SECRET/);
    });

    it('requires different access and refresh secrets', () => {
      expect(() =>
        validateEnv({ ...base, NODE_ENV: 'production', ...prodSecrets, JWT_REFRESH_SECRET: prodSecrets.JWT_ACCESS_SECRET }),
      ).toThrow(/must differ/);
    });

    it('requires an explicit CORS allow-list', () => {
      expect(() => validateEnv({ ...base, NODE_ENV: 'production', ...prodSecrets, CORS_ORIGINS: '' })).toThrow(/CORS_ORIGINS/);
    });

    it('rejects the placeholder database password', () => {
      expect(() =>
        validateEnv({ ...base, DATABASE_URL: 'postgresql://u:CHANGE_ME@h/db', NODE_ENV: 'production', ...prodSecrets }),
      ).toThrow(/CHANGE_ME/);
    });
  });

  it('never echoes secret values in error messages', () => {
    try {
      validateEnv({ ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'super-secret-but-short' });
      throw new Error('should have thrown');
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('super-secret-but-short');
    }
  });
});

describe('production CORS origins', () => {
  const prod = {
    NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@db:5432/x', JWT_ACCESS_SECRET: SECRET_A, JWT_REFRESH_SECRET: SECRET_B, TICKET_TOKEN_PEPPER: SECRET_C,
  };
  it('requires https for every origin (the website, the portal and any other)', () => {
    expect(() => validateEnv({ ...prod, CORS_ORIGINS: 'https://alazharpark.com,https://admin.alazharpark.com' })).not.toThrow();
    expect(() => validateEnv({ ...prod, CORS_ORIGINS: 'https://alazharpark.com,http://admin.alazharpark.com' })).toThrow(/must use https/);
  });
});

describe('AUTH_RATE_LIMIT_MULTIPLIER', () => {
  const prod = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@db:5432/x', JWT_ACCESS_SECRET: SECRET_A, JWT_REFRESH_SECRET: SECRET_B, TICKET_TOKEN_PEPPER: SECRET_C, CORS_ORIGINS: 'https://alazharpark.com' };
  it('is 1 by default, can be raised outside production, and is refused above 1 in production', () => {
    expect(validateEnv({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://u:p@localhost/x' }).AUTH_RATE_LIMIT_MULTIPLIER).toBe(1);
    expect(validateEnv({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://u:p@localhost/x', AUTH_RATE_LIMIT_MULTIPLIER: '20' }).AUTH_RATE_LIMIT_MULTIPLIER).toBe(20);
    expect(() => validateEnv({ ...prod, AUTH_RATE_LIMIT_MULTIPLIER: '5' })).toThrow(/AUTH_RATE_LIMIT_MULTIPLIER/);
    expect(() => validateEnv({ ...prod })).not.toThrow();
  });
});

describe('PAYMENT_PROVIDER', () => {
  const base = { NODE_ENV: 'development', DATABASE_URL: 'postgresql://u:p@localhost/x' };
  const prod = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@db:5432/x', JWT_ACCESS_SECRET: SECRET_A, JWT_REFRESH_SECRET: SECRET_B, TICKET_TOKEN_PEPPER: SECRET_C, CORS_ORIGINS: 'https://alazharpark.com' };
  it('is optional, accepts none and mock outside production, and refuses mock in production', () => {
    expect(validateEnv(base).PAYMENT_PROVIDER).toBeUndefined();
    expect(validateEnv({ ...base, PAYMENT_PROVIDER: 'mock' }).PAYMENT_PROVIDER).toBe('mock');
    expect(() => validateEnv({ ...base, PAYMENT_PROVIDER: 'paymob' })).toThrow(/PAYMENT_PROVIDER/);
    expect(() => validateEnv({ ...prod, PAYMENT_PROVIDER: 'mock' })).toThrow(/development only/);
    expect(() => validateEnv({ ...prod, PAYMENT_PROVIDER: 'none' })).not.toThrow();
  });
});

describe('e-mail and QR key settings', () => {
  const base = { NODE_ENV: 'development', DATABASE_URL: 'postgresql://u:p@localhost/x' };
  const prod = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@db:5432/x', JWT_ACCESS_SECRET: SECRET_A, JWT_REFRESH_SECRET: SECRET_B, TICKET_TOKEN_PEPPER: SECRET_C, CORS_ORIGINS: 'https://alazharpark.com' };
  it('accepts the three e-mail providers outside production, and refuses unknown ones', () => {
    for (const p of ['none', 'log', 'smtp']) expect(validateEnv({ ...base, EMAIL_PROVIDER: p }).EMAIL_PROVIDER).toBe(p);
    expect(() => validateEnv({ ...base, EMAIL_PROVIDER: 'carrier-pigeon' })).toThrow(/EMAIL_PROVIDER/);
  });
  it('production refuses the development log provider and needs smtp settings for smtp', () => {
    expect(() => validateEnv({ ...prod, EMAIL_PROVIDER: 'log' })).toThrow(/development only/);
    expect(() => validateEnv({ ...prod, EMAIL_PROVIDER: 'smtp' })).toThrow(/EMAIL_SMTP_URL/);
    expect(() => validateEnv({ ...prod, EMAIL_PROVIDER: 'smtp', EMAIL_SMTP_URL: 'smtps://u:p@mail.example.com:465', EMAIL_FROM: 'Park <t@example.com>' })).not.toThrow();
    expect(() => validateEnv({ ...prod, EMAIL_PROVIDER: 'none' })).not.toThrow();
  });
  it('checks the QR key ring: JSON, long secrets, and an active key that exists', () => {
    const keys = JSON.stringify({ 1: 'a'.repeat(32), 2: 'b'.repeat(32) });
    expect(() => validateEnv({ ...base, TICKET_QR_KEYS: keys, TICKET_QR_ACTIVE_KEY_ID: '2' })).not.toThrow();
    expect(() => validateEnv({ ...base, TICKET_QR_KEYS: keys, TICKET_QR_ACTIVE_KEY_ID: '3' })).toThrow(/key ids/);
    expect(() => validateEnv({ ...base, TICKET_QR_KEYS: '{"1":"short"}' })).toThrow(/TICKET_QR_KEYS/);
    expect(() => validateEnv({ ...base, TICKET_QR_KEYS: 'not json' })).toThrow(/TICKET_QR_KEYS/);
    expect(() => validateEnv({ ...base, TICKET_QR_KEYS: '[]' })).toThrow(/TICKET_QR_KEYS/);
  });
});

describe('analytics limits', () => {
  it('defaults to a year-and-a-day period and 100,000 exported rows', () => {
    const env = validateEnv(base);
    expect(env.ANALYTICS_MAX_RANGE_DAYS).toBe(366);
    expect(env.ANALYTICS_EXPORT_MAX_ROWS).toBe(100_000);
  });

  it('can be configured within sensible bounds', () => {
    const env = validateEnv({ ...base, ANALYTICS_MAX_RANGE_DAYS: '31', ANALYTICS_EXPORT_MAX_ROWS: '5000' });
    expect(env.ANALYTICS_MAX_RANGE_DAYS).toBe(31);
    expect(env.ANALYTICS_EXPORT_MAX_ROWS).toBe(5000);
  });

  it('rejects a period or row cap that is zero, negative, absurd or not a number', () => {
    for (const v of ['0', '-5', '3661', 'many']) expect(() => validateEnv({ ...base, ANALYTICS_MAX_RANGE_DAYS: v })).toThrow(/ANALYTICS_MAX_RANGE_DAYS/);
    for (const v of ['99', '1000001', 'lots']) expect(() => validateEnv({ ...base, ANALYTICS_EXPORT_MAX_ROWS: v })).toThrow(/ANALYTICS_EXPORT_MAX_ROWS/);
  });
});
