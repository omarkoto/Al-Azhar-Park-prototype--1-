import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const postgresUrl = z
  .string()
  .min(1, 'is required')
  .refine((v) => /^postgres(ql)?:\/\//.test(v), 'must be a PostgreSQL connection string (postgresql://…)');

/**
 * Every environment variable the API reads, validated once at start-up.
 * The server refuses to boot on a bad configuration instead of failing later in the middle of a request.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().min(1).default('0.0.0.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    DATABASE_URL: postgresUrl,
    TEST_DATABASE_URL: postgresUrl.optional(),

    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      )
      .pipe(
        z.array(
          z
            .string()
            .refine((o) => o !== '*', 'wildcard origins are not allowed')
            .refine((o) => {
              try {
                return new URL(o).origin === o;
              } catch {
                return false;
              }
            }, 'must be an origin like https://example.com (no path, no trailing slash)'),
        ),
      ),
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
    RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().min(1).default(60),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
    SWAGGER_ENABLED: bool.default(true),

    // Secrets — used from Phase 2 onward; mandatory (and strong) in production.
    JWT_ACCESS_SECRET: z.string().optional(),
    JWT_REFRESH_SECRET: z.string().optional(),
    TICKET_TOKEN_PEPPER: z.string().optional(),

    ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    SESSION_MAX_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
    LOGIN_MAX_FAILURES: z.coerce.number().int().min(3).max(20).default(5),
    LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),

    SEED_DEV_PASSWORD: z.string().min(12, 'must be at least 12 characters').optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'TICKET_TOKEN_PEPPER'] as const) {
      const value = env[key];
      if (!value || value.length < 32) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'is required in production (min 32 characters)' });
      }
    }
    if (env.JWT_ACCESS_SECRET && env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['JWT_REFRESH_SECRET'], message: 'must differ from JWT_ACCESS_SECRET' });
    }
    if (env.CORS_ORIGINS.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'must list the allowed origins in production' });
    }
    for (const origin of env.CORS_ORIGINS) {
      if (!origin.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: `${origin} must use https in production` });
      }
    }
    if (env.DATABASE_URL.includes('CHANGE_ME')) {
      ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'still contains the CHANGE_ME placeholder password' });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Validates raw process.env. Error messages name the variable but never echo its value (secrets!). */
export function validateEnv(raw: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw);
  if (result.success) return result.data;

  const lines = result.error.issues.map((i) => `  - ${i.path.join('.') || '(env)'}: ${i.message}`);
  throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
}
