import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { paginationQuerySchema } from '../../common/dto/pagination';
import { isoDate } from '../park/park.dto';

// eslint-disable-next-line no-control-regex
const NO_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const text = (min: number, max: number) => z.string().trim().min(min).max(max).refine((v) => !NO_CONTROL.test(v), 'contains control characters');
const code = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,29}$/, 'use capital letters, digits and underscores, e.g. MAIN');

export const TICKET_STATUSES = ['PENDING', 'VALID', 'USED', 'CANCELLED', 'EXPIRED'] as const;

export class ListTicketsQueryDto extends createZodDto(
  paginationQuerySchema.extend({
    status: z.enum(TICKET_STATUSES).optional(),
    visitDate: isoDate.optional(),
    ticketType: code.optional(),
    audience: code.optional(),
  }),
) {}

export const SCAN_FILTER_RESULTS = ['granted', 'denied'] as const;
export class ListScansQueryDto extends createZodDto(
  paginationQuerySchema.extend({
    outcome: z.enum(SCAN_FILTER_RESULTS).optional(),
    gateId: z.string().uuid().optional(),
    /** the Cairo calendar day of the scan */
    date: isoDate.optional(),
  }),
) {}

const gateFields = { nameEn: text(2, 80), nameAr: text(2, 80) };
export class CreateGateDto extends createZodDto(z.object({ code, ...gateFields }).strict()) {}
export class UpdateGateDto extends createZodDto(z.object(gateFields).strict()) {}
export class SetGateActiveDto extends createZodDto(z.object({ isActive: z.boolean() }).strict()) {}
