import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { paginationQuerySchema } from '../../common/dto/pagination';
import { slugSchema } from '../events/events.dto';
import { JOURNAL_STATUSES } from './journal-status';

// eslint-disable-next-line no-control-regex
const NO_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** One line of text: trimmed, no control characters (a line break is not allowed here). */
const line = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((v) => !NO_CONTROL.test(v) && !/[\r\n]/.test(v), 'must be a single line without control characters');

/** Text with paragraphs: a blank line starts a new paragraph. Plain text only (the website shows it as text, never as HTML). */
const paragraphs = (min: number, max: number) =>
  z
    .string()
    .transform((v) => v.replace(/\r\n?/g, '\n').trim())
    .pipe(z.string().min(min).max(max).refine((v) => !NO_CONTROL.test(v), 'contains control characters'));

const optionalLine = (max: number) => z.union([line(1, max), z.literal(''), z.null()]).optional().transform((v) => (v ? v : null));
const uuid = z.string().uuid();
const optionalUuid = z.union([uuid, z.literal(''), z.null()]).optional().transform((v) => (v ? v : null));

const articleFields = {
  titleEn: line(2, 150),
  titleAr: line(2, 150),
  /** the one tag on the card, e.g. "History" */
  tagEn: line(2, 40),
  tagAr: line(2, 40),
  /** shown on the card */
  shortDescriptionEn: paragraphs(10, 300),
  shortDescriptionAr: paragraphs(10, 300),
  /** the whole article, opened with "Read more" */
  bodyEn: paragraphs(10, 20000),
  bodyAr: paragraphs(10, 20000),
  /** optional wording on the card, e.g. "2006", "1990s", "Ongoing" */
  dateLabelEn: optionalLine(60),
  dateLabelAr: optionalLine(60),
  isFeatured: z.boolean().default(false),
  coverMediaId: optionalUuid,
};

export const createJournalSchema = z.object({ slug: slugSchema, ...articleFields });
export const updateJournalSchema = z.object({ slug: slugSchema.optional(), ...articleFields });

export class CreateJournalDto extends createZodDto(createJournalSchema) {}
export class UpdateJournalDto extends createZodDto(updateJournalSchema) {}
export class SetJournalStatusDto extends createZodDto(z.object({ status: z.enum(JOURNAL_STATUSES) })) {}

export class SetJournalGalleryDto extends createZodDto(
  z.object({
    items: z
      .array(z.object({ mediaId: uuid, captionEn: optionalLine(200), captionAr: optionalLine(200) }))
      .max(30)
      .refine((items) => new Set(items.map((i) => i.mediaId)).size === items.length, 'the same photo is listed twice'),
  }),
) {}

export class ListJournalQueryDto extends createZodDto(paginationQuerySchema.extend({ status: z.enum(JOURNAL_STATUSES).optional() })) {}
