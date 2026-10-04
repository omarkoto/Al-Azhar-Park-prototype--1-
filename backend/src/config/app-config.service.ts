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

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get isTest(): boolean {
    return this.env.NODE_ENV === 'test';
  }
}
