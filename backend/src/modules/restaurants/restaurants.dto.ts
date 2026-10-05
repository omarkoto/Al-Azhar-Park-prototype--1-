import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { hhmm } from '../park/park.dto';

// eslint-disable-next-line no-control-regex
const NO_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const text = (min: number, max: number) =>
  z.string().trim().min(min).max(max).refine((v) => !NO_CONTROL.test(v), 'contains control characters');
const optionalText = (max: number) =>
  z.union([text(1, max), z.literal(''), z.null()]).optional().transform((v) => (v ? v : null));

const https = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => {
    try {
      return new URL(v).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'must be an https link');
const optionalUrl = z.union([https, z.literal(''), z.null()]).optional().transform((v) => (v ? v : null));

const phone = z
  .string()
  .trim()
  .regex(/^[0-9+()\-\s]{6,25}$/, 'must be a phone number (digits, spaces, + ( ) -)')
  .refine((v) => v.replace(/\D/g, '').length >= 6, 'must contain at least 6 digits');

const uuid = z.string().uuid();
const optionalUuid = z.union([uuid, z.literal(''), z.null()]).optional().transform((v) => (v ? v : null));

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'use lower-case letters, digits and single hyphens, e.g. lake-side');

const restaurantFields = {
  nameEn: text(2, 100),
  nameAr: text(2, 100),
  brandEn: optionalText(100),
  brandAr: optionalText(100),
  taglineEn: optionalText(200),
  taglineAr: optionalText(200),
  shortDescriptionEn: optionalText(300),
  shortDescriptionAr: optionalText(300),
  descriptionEn: text(10, 4000),
  descriptionAr: text(10, 4000),
  atmosphereEn: optionalText(500),
  atmosphereAr: optionalText(500),
  locationEn: optionalText(200),
  locationAr: optionalText(200),
  opensAt: hhmm.nullish().transform((v) => v ?? null),
  closesAt: hhmm.nullish().transform((v) => v ?? null),
  phones: z.array(phone).max(6).default([]),
  reservationUrl: optionalUrl,
  websiteUrl: optionalUrl,
  instagramUrl: optionalUrl,
  heroMediaId: optionalUuid,
  isActive: z.boolean().default(true),
};

function hoursTogether(v: { opens?: string | null; closes?: string | null }, ctx: z.RefinementCtx) {
  if (Boolean(v.opens) !== Boolean(v.closes)) {
    ctx.addIssue({ code: 'custom', path: ['closesAt'], message: 'give both the opening and the closing time, or neither' });
  }
}

function restaurantRules(v: { opensAt?: string | null; closesAt?: string | null; phones: string[] }, ctx: z.RefinementCtx) {
  hoursTogether({ opens: v.opensAt, closes: v.closesAt }, ctx);
  if (new Set(v.phones.map((p) => p.replace(/\D/g, ''))).size !== v.phones.length) {
    ctx.addIssue({ code: 'custom', path: ['phones'], message: 'contains the same phone number twice' });
  }
}

export const createRestaurantSchema = z.object({ slug: slugSchema, ...restaurantFields }).superRefine(restaurantRules);
export const updateRestaurantSchema = z.object(restaurantFields).superRefine(restaurantRules);
export class CreateRestaurantDto extends createZodDto(createRestaurantSchema) {}
export class UpdateRestaurantDto extends createZodDto(updateRestaurantSchema) {}

export class SetGalleryDto extends createZodDto(
  z.object({
    items: z
      .array(z.object({ mediaId: uuid, captionEn: optionalText(200), captionAr: optionalText(200) }))
      .max(20)
      .refine((items) => new Set(items.map((i) => i.mediaId)).size === items.length, 'the same photo is listed twice'),
  }),
) {}

export class OrderDto extends createZodDto(
  z.object({ ids: z.array(uuid).min(1).max(200).refine((a) => new Set(a).size === a.length, 'an id is listed twice') }),
) {}

const menuSchema = z
  .object({
    nameEn: text(2, 100),
    nameAr: text(2, 100),
    externalUrl: optionalUrl,
    pdfMediaId: optionalUuid,
    isActive: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (Boolean(v.externalUrl) === Boolean(v.pdfMediaId)) {
      ctx.addIssue({ code: 'custom', path: ['externalUrl'], message: 'give either a link to the menu or an uploaded PDF (exactly one)' });
    }
  });
export class MenuDto extends createZodDto(menuSchema) {}
