import { validateEnv } from './env.schema';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };
const prodSecrets = {
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  TICKET_TOKEN_PEPPER: 'c'.repeat(40),
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
    NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@db:5432/x', JWT_ACCESS_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'b'.repeat(40), TICKET_TOKEN_PEPPER: 'c'.repeat(40),
  };
  it('requires https for every origin (the website, the portal and any other)', () => {
    expect(() => validateEnv({ ...prod, CORS_ORIGINS: 'https://alazharpark.com,https://admin.alazharpark.com' })).not.toThrow();
    expect(() => validateEnv({ ...prod, CORS_ORIGINS: 'https://alazharpark.com,http://admin.alazharpark.com' })).toThrow(/must use https/);
  });
});

describe('AUTH_RATE_LIMIT_MULTIPLIER', () => {
  const prod = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@db:5432/x', JWT_ACCESS_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'b'.repeat(40), TICKET_TOKEN_PEPPER: 'c'.repeat(40), CORS_ORIGINS: 'https://alazharpark.com' };
  it('is 1 by default, can be raised outside production, and is refused above 1 in production', () => {
    expect(validateEnv({ DATABASE_URL: 'postgresql://u:p@localhost/x' }).AUTH_RATE_LIMIT_MULTIPLIER).toBe(1);
    expect(validateEnv({ DATABASE_URL: 'postgresql://u:p@localhost/x', AUTH_RATE_LIMIT_MULTIPLIER: '20' }).AUTH_RATE_LIMIT_MULTIPLIER).toBe(20);
    expect(() => validateEnv({ ...prod, AUTH_RATE_LIMIT_MULTIPLIER: '5' })).toThrow(/AUTH_RATE_LIMIT_MULTIPLIER/);
    expect(() => validateEnv({ ...prod })).not.toThrow();
  });
});
