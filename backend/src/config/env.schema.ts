import { z } from 'zod';
import { secretProblem } from './secret-quality';

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
    /**
     * No default, on purpose: a server started without it must not quietly become a development server (mock payments,
     * public development secrets). Set it to production, or development / test for local work.
     */
    NODE_ENV: z.enum(['development', 'test', 'production'], {
      error: (issue) => (issue.input === undefined ? 'is required: set NODE_ENV to production, development or test (it has no default)' : 'must be one of: production, development, test'),
    }),
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
    AUTH_RATE_LIMIT_MULTIPLIER: z.coerce.number().int().min(1).max(100).default(1),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
    /** the longest period a report may cover, so one request cannot ask the database for years of data */
    ANALYTICS_MAX_RANGE_DAYS: z.coerce.number().int().min(1).max(3660).default(366),
    /** the most rows one CSV export may hold */
    ANALYTICS_EXPORT_MAX_ROWS: z.coerce.number().int().min(100).max(1_000_000).default(100_000),
    /** gate scans per minute per address: a busy gate scans a few tickets a second, so this is higher than the general limit */
    SCAN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(5000).default(300),
    /** API documentation. Unset: on outside production, OFF in production (switch it on there explicitly with SWAGGER_ENABLED=true). */
    SWAGGER_ENABLED: bool.optional(),

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

    /** where uploaded files are stored on disk (the storage provider is swappable; see MediaStorage) */
    MEDIA_DIR: z.string().min(1).default('./storage/media'),
    MEDIA_MAX_IMAGE_MB: z.coerce.number().min(0.1).max(50).default(8),
    MEDIA_MAX_PDF_MB: z.coerce.number().min(0.1).max(100).default(15),

    /**
     * Which payment provider takes online payments. 'mock' is a DEVELOPMENT stand-in that lets a tester press
     * "pay" or "fail" (nothing real happens); it is refused in production. 'none' = online payment switched off.
     * Unset: 'mock' in development and test, 'none' in production.
     */
    PAYMENT_PROVIDER: z.enum(['none', 'mock']).optional(),

    /**
     * How e-mail is delivered. 'log' (development) writes the message to the log instead of sending it; 'smtp' sends
     * it through EMAIL_SMTP_URL; 'none' sends nothing (messages wait in the outbox and show as failed in the portal).
     * Unset: 'log' outside production, 'none' in production.
     */
    EMAIL_PROVIDER: z.enum(['none', 'log', 'smtp']).optional(),
    /** e.g. smtps://user:password@smtp.example.com:465 — a secret: never logged */
    EMAIL_SMTP_URL: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
    /** the website's address, used for links in e-mails, e.g. https://www.azharpark.com */
    PUBLIC_SITE_URL: z.string().url().optional(),

    /**
     * QR signing keys, to rotate them: a JSON object of key id → secret (each at least 32 characters), for example
     * {"1":"…","2":"…"}. Tickets say which key signed them, so old tickets keep working after a rotation.
     * Unset: key 1 is TICKET_TOKEN_PEPPER. New tickets are signed with TICKET_QR_ACTIVE_KEY_ID (default 1).
     */
    TICKET_QR_KEYS: z.string().optional(),
    TICKET_QR_ACTIVE_KEY_ID: z.coerce.number().int().min(0).max(999).default(1),

    SEED_DEV_PASSWORD: z.string().min(12, 'must be at least 12 characters').optional(),
  })
  .superRefine((env, ctx) => {
    if (env.TICKET_QR_KEYS !== undefined) {
      try {
        const keys = JSON.parse(env.TICKET_QR_KEYS) as Record<string, unknown>;
        const ok = keys && typeof keys === 'object' && !Array.isArray(keys) && Object.keys(keys).length > 0 &&
          Object.entries(keys).every(([id, secret]) => /^\d{1,3}$/.test(id) && typeof secret === 'string' && secret.length >= 32);
        if (!ok) throw new Error('shape');
        if (!(String(env.TICKET_QR_ACTIVE_KEY_ID) in keys)) {
          ctx.addIssue({ code: 'custom', path: ['TICKET_QR_ACTIVE_KEY_ID'], message: 'must be one of the key ids in TICKET_QR_KEYS' });
        }
      } catch {
        ctx.addIssue({ code: 'custom', path: ['TICKET_QR_KEYS'], message: 'must be a JSON object of key id → secret (each at least 32 characters)' });
      }
    }
    if (env.NODE_ENV !== 'production') return;

    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'TICKET_TOKEN_PEPPER'] as const) {
      const value = env[key];
      if (!value || value.length < 32) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'is required in production (min 32 characters)' });
      } else {
        const problem = secretProblem(value);
        if (problem) ctx.addIssue({ code: 'custom', path: [key], message: `${problem}` });
      }
    }
    // each purpose gets its own secret: one leaked or guessed value must not open another door
    const access = env.JWT_ACCESS_SECRET;
    const refresh = env.JWT_REFRESH_SECRET;
    const pepper = env.TICKET_TOKEN_PEPPER;
    let qrKeys: Record<string, string> = {};
    try {
      qrKeys = env.TICKET_QR_KEYS ? (JSON.parse(env.TICKET_QR_KEYS) as Record<string, string>) : {};
    } catch {
      qrKeys = {}; // already reported above
    }
    if (access && refresh && access === refresh) {
      ctx.addIssue({ code: 'custom', path: ['JWT_REFRESH_SECRET'], message: 'must differ from JWT_ACCESS_SECRET' });
    }
    // the ticket pepper is also QR key 1 when TICKET_QR_KEYS is not set, so a QR key may equal the pepper; nothing else may be shared
    for (const [id, secret] of Object.entries(qrKeys)) {
      const problem = typeof secret === 'string' ? secretProblem(secret) : null;
      if (problem) ctx.addIssue({ code: 'custom', path: ['TICKET_QR_KEYS'], message: `key ${id} ${problem}` });
      if (secret === access || secret === refresh) ctx.addIssue({ code: 'custom', path: ['TICKET_QR_KEYS'], message: `key ${id} must differ from the JWT secrets` });
    }
    const qrValues = Object.values(qrKeys);
    if (new Set(qrValues).size !== qrValues.length) ctx.addIssue({ code: 'custom', path: ['TICKET_QR_KEYS'], message: 'every key must have its own secret' });
    if (pepper && (pepper === access || pepper === refresh)) {
      ctx.addIssue({ code: 'custom', path: ['TICKET_TOKEN_PEPPER'], message: 'must differ from the JWT secrets' });
    }
    if (env.EMAIL_PROVIDER === 'smtp' && (!env.EMAIL_SMTP_URL || !env.EMAIL_FROM)) {
      ctx.addIssue({ code: 'custom', path: ['EMAIL_PROVIDER'], message: 'smtp needs EMAIL_SMTP_URL and EMAIL_FROM' });
    }
    if (env.EMAIL_PROVIDER === 'log') {
      ctx.addIssue({ code: 'custom', path: ['EMAIL_PROVIDER'], message: 'the log provider is for development only (it sends nothing) and is refused in production' });
    }
    if (env.PAYMENT_PROVIDER === 'mock') {
      ctx.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: 'the mock payment provider is for development only and is refused in production' });
    }
    if (env.AUTH_RATE_LIMIT_MULTIPLIER > 1) {
      ctx.addIssue({ code: 'custom', path: ['AUTH_RATE_LIMIT_MULTIPLIER'], message: 'must be 1 in production (it weakens brute-force protection)' });
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
  })
  .transform((env) => ({ ...env, SWAGGER_ENABLED: env.SWAGGER_ENABLED ?? env.NODE_ENV !== 'production' }));

export type Env = z.infer<typeof envSchema>;

/** Validates raw process.env. Error messages name the variable but never echo its value (secrets!). */
export function validateEnv(raw: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw);
  if (result.success) return result.data;

  const lines = result.error.issues.map((i) => `  - ${i.path.join('.') || '(env)'}: ${i.message}`);
  throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
}
