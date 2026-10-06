import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { paginationQuerySchema } from '../../common/dto/pagination';
import { hhmm, isoDate } from '../park/park.dto';
import { EVENT_STATUSES } from './event-status';

// eslint-disable-next-line no-control-regex
const NO_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const text = (min: number, max: number) =>
  z.string().trim().min(min).max(max).refine((v) => !NO_CONTROL.test(v), 'contains control characters');
const optionalText = (max: number) => z.union([text(1, max), z.literal(''), z.null()]).optional().transform((v) => (v ? v : null));
const uuid = z.string().uuid();
const optionalUuid = z.union([uuid, z.literal(''), z.null()]).optional().transform((v) => (v ? v : null));

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'use lower-case letters, digits and single hyphens, e.g. cairo-jazz-nights');

const eventFields = {
  titleEn: text(2, 150),
  titleAr: text(2, 150),
  shortDescriptionEn: text(10, 300),
  shortDescriptionAr: text(10, 300),
  descriptionEn: text(10, 6000),
  descriptionAr: text(10, 6000),
  eventDate: isoDate,
  startTime: hhmm.nullish().transform((v) => v ?? null),
  endTime: hhmm.nullish().transform((v) => v ?? null),
  venueId: optionalUuid,
  /** a place that is not a venue ("Colonnade & Lake Side Restaurant"); a venue, when chosen, takes precedence */
  locationNameEn: optionalText(200),
  locationNameAr: optionalText(200),
  /** wording shown instead of the computed date / time, e.g. "8 Feb – 9 Mar 2027", "Nightly, 8:00 PM – 1:00 AM" */
  dateLabelEn: optionalText(120),
  dateLabelAr: optionalText(120),
  timeLabelEn: optionalText(120),
  timeLabelAr: optionalText(120),
  isFeatured: z.boolean().default(false),
  heroMediaId: optionalUuid,
};

const timesTogether = (v: { startTime?: string | null; endTime?: string | null }, ctx: z.RefinementCtx) => {
  if (Boolean(v.startTime) !== Boolean(v.endTime)) {
    ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'give both the start time and the end time, or neither' });
  }
};

export const createEventSchema = z.object({ slug: slugSchema, ...eventFields }).superRefine(timesTogether);
export const updateEventSchema = z.object({ slug: slugSchema.optional(), ...eventFields }).superRefine(timesTogether);
export class CreateEventDto extends createZodDto(createEventSchema) {}
export class UpdateEventDto extends createZodDto(updateEventSchema) {}

export class SetEventStatusDto extends createZodDto(z.object({ status: z.enum(EVENT_STATUSES) })) {}

export class SetEventGalleryDto extends createZodDto(
  z.object({
    items: z
      .array(z.object({ mediaId: uuid, captionEn: optionalText(200), captionAr: optionalText(200) }))
      .max(30)
      .refine((items) => new Set(items.map((i) => i.mediaId)).size === items.length, 'the same photo is listed twice'),
  }),
) {}

export class EventOrderDto extends createZodDto(
  z.object({ ids: z.array(uuid).min(1).max(500).refine((a) => new Set(a).size === a.length, 'an id is listed twice') }),
) {}

export class ListEventsQueryDto extends createZodDto(
  paginationQuerySchema.extend({ status: z.enum(EVENT_STATUSES).optional() }),
) {}

export class PublicEventsQueryDto extends createZodDto(z.object({ when: z.enum(['upcoming', 'past', 'all']).default('upcoming') })) {}

// ───────────────────────────── venues ─────────────────────────────

const venueFields = {
  nameEn: text(2, 100),
  nameAr: text(2, 100),
  descriptionEn: optionalText(1000),
  descriptionAr: optionalText(1000),
  addressEn: optionalText(300),
  addressAr: optionalText(300),
  capacity: z.number().int().min(1).max(1_000_000).nullish().transform((v) => v ?? null),
  isActive: z.boolean().default(true),
};

export const createVenueSchema = z.object({ slug: slugSchema.max(60), ...venueFields });
export const updateVenueSchema = z.object(venueFields);
export class CreateVenueDto extends createZodDto(createVenueSchema) {}
export class UpdateVenueDto extends createZodDto(updateVenueSchema) {}
