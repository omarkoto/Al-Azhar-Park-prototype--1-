import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Plain text only: no control characters, trimmed. (React escapes output; this keeps stored data clean.) */
const clean = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    // eslint-disable-next-line no-control-regex
    .refine((v) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(v), 'contains control characters');

const optionalText = (max: number) =>
  z
    .union([clean(1, max), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v ? v : null));

export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be a time like 09:00 (24-hour)');

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date like 2026-10-31')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'is not a real calendar date');

const httpsUrl = (hosts?: readonly string[]) =>
  z
    .string()
    .trim()
    .max(500)
    .refine((v) => {
      try {
        const u = new URL(v);
        if (u.protocol !== 'https:') return false;
        return !hosts || hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
      } catch {
        return false;
      }
    }, hosts ? `must be an https link on ${hosts.join(', ')}` : 'must be an https link');

const MAPS_HOSTS = ['google.com', 'goo.gl', 'maps.app.goo.gl'] as const;

// ───────────────────────────── park information ─────────────────────────────

export const statSchema = z.object({
  value: clean(1, 20),
  labelEn: clean(1, 120),
  labelAr: clean(1, 120),
});

export const updateParkSchema = z.object({
  nameEn: clean(2, 100),
  nameAr: clean(2, 100),
  taglineEn: optionalText(200),
  taglineAr: optionalText(200),
  descriptionEn: optionalText(2000),
  descriptionAr: optionalText(2000),
  stats: z.array(statSchema).max(8),
});
export class UpdateParkDto extends createZodDto(updateParkSchema) {}

// ───────────────────────────── contact ─────────────────────────────

const phone = z
  .string()
  .trim()
  .regex(/^[0-9+()\-\s]{6,25}$/, 'must be a phone number (digits, spaces, + ( ) -)')
  .refine((v) => v.replace(/\D/g, '').length >= 6, 'must contain at least 6 digits');

const social = z.object({
  facebook: httpsUrl().nullish(),
  instagram: httpsUrl().nullish(),
  x: httpsUrl().nullish(),
  youtube: httpsUrl().nullish(),
  tiktok: httpsUrl().nullish(),
  linkedin: httpsUrl().nullish(),
});

export const updateContactSchema = z
  .object({
    addressEn: clean(3, 300),
    addressAr: clean(3, 300),
    phones: z.array(phone).max(6),
    fax: z.union([phone, z.literal(''), z.null()]).optional().transform((v) => (v ? v : null)),
    email: z
      .union([z.string().trim().toLowerCase().email().max(254), z.literal(''), z.null()])
      .optional()
      .transform((v) => (v ? v : null)),
    mapsUrl: z.union([httpsUrl(MAPS_HOSTS), z.literal(''), z.null()]).optional().transform((v) => (v ? v : null)),
    latitude: z.number().min(-90).max(90).nullish(),
    longitude: z.number().min(-180).max(180).nullish(),
    socialLinks: social.default({}),
  })
  .superRefine((v, ctx) => {
    if ((v.latitude === null || v.latitude === undefined) !== (v.longitude === null || v.longitude === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['latitude'], message: 'latitude and longitude must be given together' });
    }
    if (new Set(v.phones.map((p) => p.replace(/\D/g, ''))).size !== v.phones.length) {
      ctx.addIssue({ code: 'custom', path: ['phones'], message: 'contains the same phone number twice' });
    }
  });
export class UpdateContactDto extends createZodDto(updateContactSchema) {}

// ───────────────────────────── opening hours ─────────────────────────────

const timesOk = (v: { isClosed: boolean; opens?: string | null; closes?: string | null }, ctx: z.RefinementCtx) => {
  if (v.isClosed) {
    if (v.opens || v.closes) ctx.addIssue({ code: 'custom', path: ['opens'], message: 'a closed day has no opening or closing time' });
    return;
  }
  if (!v.opens || !v.closes) {
    ctx.addIssue({ code: 'custom', path: ['opens'], message: 'opening and closing times are required for an open day' });
    return;
  }
  if (v.opens >= v.closes) ctx.addIssue({ code: 'custom', path: ['closes'], message: 'the park must close after it opens (same day)' });
};

export const weeklyDaySchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    isClosed: z.boolean().default(false),
    opens: hhmm.nullish(),
    closes: hhmm.nullish(),
  })
  .superRefine(timesOk);

export const updateWeeklySchema = z.object({
  days: z
    .array(weeklyDaySchema)
    .length(7, 'give all 7 days')
    .refine((d) => new Set(d.map((x) => x.dayOfWeek)).size === 7, 'each weekday (0 = Sunday … 6 = Saturday) must appear exactly once'),
});
export class UpdateWeeklyHoursDto extends createZodDto(updateWeeklySchema) {}

export const specialHoursSchema = z
  .object({
    kind: z.enum(['HOLIDAY', 'TEMPORARY_CLOSURE', 'SPECIAL_HOURS']),
    dateFrom: isoDate,
    dateTo: isoDate,
    isClosed: z.boolean().default(false),
    opens: hhmm.nullish(),
    closes: hhmm.nullish(),
    labelEn: clean(2, 120),
    labelAr: clean(2, 120),
    noteEn: optionalText(500),
    noteAr: optionalText(500),
    priority: z.number().int().min(0).max(100).default(10),
    isActive: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.dateTo < v.dateFrom) ctx.addIssue({ code: 'custom', path: ['dateTo'], message: 'must not be before the start date' });
    const days = (Date.parse(`${v.dateTo}T00:00:00Z`) - Date.parse(`${v.dateFrom}T00:00:00Z`)) / 86_400_000;
    if (days > 366) ctx.addIssue({ code: 'custom', path: ['dateTo'], message: 'a special period can be at most one year long' });
    // a temporary closure is always closed (any times sent are ignored); the other kinds need hours unless explicitly closed
    if (v.kind !== 'TEMPORARY_CLOSURE') timesOk({ isClosed: v.isClosed, opens: v.opens, closes: v.closes }, ctx);
  })
  .transform((v) => (v.kind === 'TEMPORARY_CLOSURE' ? { ...v, isClosed: true, opens: null, closes: null } : v));
export class SpecialHoursDto extends createZodDto(specialHoursSchema) {}

export class ListSpecialHoursQueryDto extends createZodDto(
  z.object({ when: z.enum(['upcoming', 'past', 'all']).default('upcoming') }),
) {}

