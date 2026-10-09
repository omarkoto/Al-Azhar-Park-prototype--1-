import { Injectable } from '@nestjs/common';
import { Env, validateEnv } from './env.schema';
import { DEV_JWT_ACCESS_SECRET, DEV_TICKET_PEPPER, DEV_TOKEN_HASH_SECRET } from './secret-quality';

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
    return this.env.JWT_ACCESS_SECRET || DEV_JWT_ACCESS_SECRET;
  }

  get tokenHashSecret(): string {
    return this.env.JWT_REFRESH_SECRET || DEV_TOKEN_HASH_SECRET;
  }

  /** The payment provider in use: the configured one, else 'mock' outside production and 'none' in production. */
  get paymentProvider(): 'none' | 'mock' {
    return this.env.PAYMENT_PROVIDER ?? (this.isProduction ? 'none' : 'mock');
  }

  /** Which key signs new ticket QR codes, and every key that may still be presented (for verifying). */
  get qrKeyRing(): Readonly<Record<number, string>> {
    if (this.env.TICKET_QR_KEYS) {
      const parsed = JSON.parse(this.env.TICKET_QR_KEYS) as Record<string, string>;
      return Object.fromEntries(Object.entries(parsed).map(([id, secret]) => [Number(id), secret]));
    }
    return { 1: this.env.TICKET_TOKEN_PEPPER || DEV_TICKET_PEPPER };
  }

  get qrActiveKeyId(): number {
    return this.env.TICKET_QR_ACTIVE_KEY_ID;
  }

  /** The e-mail provider in use: the configured one, else 'log' outside production and 'none' in production. */
  get emailProvider(): 'none' | 'log' | 'smtp' {
    return this.env.EMAIL_PROVIDER ?? (this.isProduction ? 'none' : 'log');
  }

  /** The website address used in e-mail links. */
  get publicSiteUrl(): string {
    return (this.env.PUBLIC_SITE_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get isTest(): boolean {
    return this.env.NODE_ENV === 'test';
  }
}
