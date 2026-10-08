import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { paginationQuerySchema } from '../../common/dto/pagination';
import { isoDate } from '../park/park.dto';

// eslint-disable-next-line no-control-regex
const NO_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const text = (min: number, max: number) => z.string().trim().min(min).max(max).refine((v) => !NO_CONTROL.test(v), 'contains control characters');
const code = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,29}$/, 'use capital letters, digits and underscores, e.g. ADULT');

/** What the customer chose: a ticket type and how many. The price is never part of the request. */
const lineSchema = z.strictObject({
  ticketType: code,
  quantity: z.number().int().min(1, 'quantity must be at least 1').max(1000, 'quantity is too large'),
});

const selectionFields = {
  visitDate: isoDate,
  audience: code,
  items: z.array(lineSchema).min(1, 'choose at least one ticket').max(20),
};
const noDuplicates = (v: { items: Array<{ ticketType: string }> }, ctx: z.RefinementCtx) => {
  const seen = new Set<string>();
  for (const [i, item] of v.items.entries()) {
    if (seen.has(item.ticketType)) ctx.addIssue({ code: 'custom', path: ['items', i, 'ticketType'], message: 'list each ticket type once and give the quantity' });
    seen.add(item.ticketType);
  }
};

export const quoteSchema = z.object(selectionFields).strict().superRefine(noDuplicates);
export class QuoteDto extends createZodDto(quoteSchema) {}

const customerSchema = z
  .object({
    fullName: text(2, 120),
    email: z.string().trim().toLowerCase().email().max(200),
    phone: z.union([z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/, 'enter a valid phone number'), z.literal(''), z.null()]).optional().transform((v) => (v ? v : null)),
  })
  .strict();

export const createOrderSchema = z
  .object({
    ...selectionFields,
    customer: customerSchema,
    /** the customer must tick the box that says they read the booking terms (no refunds, valid on the chosen date) */
    acceptTerms: z.literal(true, { error: 'you must accept the booking terms' }),
    locale: z.enum(['en', 'ar']).default('en'),
  })
  .strict()
  .superRefine(noDuplicates);
export class CreateOrderDto extends createZodDto(createOrderSchema) {}

export class CatalogQueryDto extends createZodDto(z.object({ date: isoDate.optional() })) {}

export class TicketPdfQueryDto extends createZodDto(z.object({ lang: z.enum(['en', 'ar']).optional() })) {}

export class MockCompleteDto extends createZodDto(
  z
    .object({
      outcome: z.enum(['SUCCESS', 'FAILURE']),
      amountMinor: z.number().int().optional(),
      currency: z.string().length(3).optional(),
      orderNumber: z.string().max(40).optional(),
    })
    .strict(),
) {}

export const ORDER_STATUSES = ['PENDING_PAYMENT', 'PAID', 'CANCELLED', 'EXPIRED'] as const;
export class ListOrdersQueryDto extends createZodDto(
  paginationQuerySchema.extend({
    status: z.enum(ORDER_STATUSES).optional(),
    visitDate: isoDate.optional(),
    channel: z.enum(['ONLINE', 'COUNTER_SALE']).optional(),
  }),
) {}

export class CancelOrderDto extends createZodDto(z.object({ reason: text(5, 500) }).strict()) {}

// ── ticket types ──
const ticketTypeFields = {
  nameEn: text(2, 60),
  nameAr: text(2, 60),
  descriptionEn: z.union([text(1, 300), z.literal(''), z.null()]).optional().transform((v) => (v ? v : null)),
  descriptionAr: z.union([text(1, 300), z.literal(''), z.null()]).optional().transform((v) => (v ? v : null)),
  minAge: z.number().int().min(2, 'children under 2 do not need a ticket, so no ticket type may start below age 2').max(120),
  maxAge: z.number().int().min(2).max(120).nullable().optional().transform((v) => v ?? null),
  isActive: z.boolean().default(true),
};
export class CreateTicketTypeDto extends createZodDto(z.object({ code, ...ticketTypeFields }).strict()) {}
export class UpdateTicketTypeDto extends createZodDto(z.object(ticketTypeFields).strict()) {}
export class OrderIdsDto extends createZodDto(z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }).strict()) {}

// ── prices ──
export class ListPricesQueryDto extends createZodDto(
  z.object({
    ticketTypeId: z.string().uuid().optional(),
    audienceId: z.string().uuid().optional(),
    status: z.enum(['current', 'upcoming', 'ended', 'inactive']).optional(),
  }),
) {}

export class CreatePriceDto extends createZodDto(
  z
    .object({
      ticketTypeId: z.string().uuid(),
      audienceId: z.string().uuid(),
      days: z.enum(['WEEKDAY', 'WEEKEND', 'EVERY_DAY']),
      amountMinor: z.number().int().min(1, 'a price must be above zero').max(10_000_000),
      validFrom: isoDate,
      notes: z.union([text(1, 300), z.literal(''), z.null()]).optional().transform((v) => (v ? v : null)),
    })
    .strict(),
) {}
export class SetPriceActiveDto extends createZodDto(z.object({ isActive: z.boolean() }).strict()) {}
