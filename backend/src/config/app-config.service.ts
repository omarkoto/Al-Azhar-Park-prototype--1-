import { Injectable } from '@nestjs/common';
import { Env, validateEnv } from './env.schema';

/** Typed, validated access to configuration. Inject this instead of reading process.env. */
@Injectable()
export class AppConfigService {
  readonly env: Env;

  constructor(raw: Record<string, string | undefined> = process.env) {
    this.env = validateEnv(raw);
  }

  get<K extends keyof Env>(key: K): Env[K] {
    return this.env[key];
  }

  /**
   * Signing secrets. Production requires real ones (enforced by the schema). Outside production a fixed,
   * clearly-labelled development value is used so a fresh checkout works; it must never be deployed.
   */
  get jwtAccessSecret(): string {
    return this.env.JWT_ACCESS_SECRET || 'dev-only-access-secret-do-not-deploy-0123456789';
  }

  get tokenHashSecret(): string {
    return this.env.JWT_REFRESH_SECRET || 'dev-only-refresh-secret-do-not-deploy-9876543210';
  }

  /** The payment provider in use: the configured one, else 'mock' outside production and 'none' in production. */
  get paymentProvider(): 'none' | 'mock' {
    return this.env.PAYMENT_PROVIDER ?? (this.isProduction ? 'none' : 'mock');
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get isTest(): boolean {
    return this.env.NODE_ENV === 'test';
  }
}
