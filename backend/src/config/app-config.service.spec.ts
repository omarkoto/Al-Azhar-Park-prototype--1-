import { AppConfigService } from './app-config.service';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

describe('AppConfigService secrets', () => {
  it('falls back to the labelled dev secrets when the variables are missing OR empty (as in a fresh .env)', () => {
    for (const raw of [{ ...base }, { ...base, JWT_ACCESS_SECRET: '', JWT_REFRESH_SECRET: '' }]) {
      const config = new AppConfigService(raw);
      expect(config.jwtAccessSecret).toMatch(/^dev-only-/);
      expect(config.tokenHashSecret).toMatch(/^dev-only-/);
      expect(config.jwtAccessSecret).not.toBe(config.tokenHashSecret);
    }
  });

  it('uses configured secrets when present', () => {
    const config = new AppConfigService({ ...base, JWT_ACCESS_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'b'.repeat(40) });
    expect(config.jwtAccessSecret).toBe('a'.repeat(40));
    expect(config.tokenHashSecret).toBe('b'.repeat(40));
  });

  it('never allows the dev fallbacks in production', () => {
    expect(
      () => new AppConfigService({ ...base, NODE_ENV: 'production', CORS_ORIGINS: 'https://example.com', JWT_ACCESS_SECRET: '', JWT_REFRESH_SECRET: '', TICKET_TOKEN_PEPPER: 'p'.repeat(40) }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });
});
