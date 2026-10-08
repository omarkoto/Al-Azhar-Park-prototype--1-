import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { isoDate } from '../park/park.dto';
import { RANGE_PRESETS } from './analytics-range';

const code = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,29}$/, 'a ticket type or audience code such as ADULT');

/**
 * The same question for every report: which period, counted by which date, and optional filters. The period is a ready-made
 * name (worked out on the server in Cairo time) or an explicit from and to.
 */
export const analyticsQuerySchema = z.object({
  range: z.enum([...RANGE_PRESETS, 'custom']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  groupBy: z.enum(['day', 'week', 'month']).optional(),
  /** sale: the day the order was placed. visit: the visit date of the ticket. */
  basis: z.enum(['sale', 'visit']).default('sale'),
  ticketType: code.optional(),
  audience: code.optional(),
  dayType: z.enum(['WEEKDAY', 'WEEKEND']).optional(),
  gateId: z.string().uuid().optional(),
});
export class AnalyticsQueryDto extends createZodDto(analyticsQuerySchema) {}
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export const EXPORT_REPORTS = ['sales', 'attendance', 'tickets', 'gates', 'scans', 'events'] as const;
export type ExportReport = (typeof EXPORT_REPORTS)[number];
export class ExportParamDto extends createZodDto(z.object({ report: z.enum(EXPORT_REPORTS) })) {}
