import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, RequestContext } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { dateToIso, parkDateOf } from '../ticketing/rules/calendar';
import { AnalyticsQuery, ExportReport } from './analytics.dto';
import { ResolvedRange } from './analytics-range';
import { Access, AnalyticsService } from './analytics.service';
import { CsvCell, csvLines } from './csv';

const egp = (minor: number) => (minor / 100).toFixed(2);
const day = (v: unknown) => (v instanceof Date ? dateToIso(v) : String(v).slice(0, 10));
const num = (v: unknown) => Number(v ?? 0);
const FROM_REASON: Record<string, string> = { OK: 'ACCESS_GRANTED', NOT_FOUND: 'TICKET_NOT_FOUND', NOT_PAID: 'TICKET_NOT_VALID', INVALID_TOKEN: 'INVALID_QR', REFUNDED: 'TICKET_NOT_VALID' };

export interface CsvFile {
  filename: string;
  lines: Iterable<string>;
  rows: number;
}

/**
 * CSV exports of the same aggregates the reports show, for the same period, date basis and filters. Every row is a
 * count or an amount grouped by date, ticket type, audience, gate or result: there is no customer, order, ticket,
 * QR or address data in any of them. The file is produced a line at a time.
 */
@Injectable()
export class AnalyticsExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  async build(report: ExportReport, q: AnalyticsQuery, access: Access, actor: AuthenticatedUser, ctx: RequestContext): Promise<CsvFile> {
    const allowed = report === 'sales' ? access.money : report === 'events' ? access.content : access.operations;
    if (!allowed) throw new AppException(ErrorCode.FORBIDDEN, 'You do not have permission to do this.', 403);
    const range = this.analytics.range(q);
    const [headers, rows] = await this.rows(report, q, range);
    const max = this.config.get('ANALYTICS_EXPORT_MAX_ROWS');
    if (rows.length > max) throw new AppException('EXPORT_TOO_LARGE', `This export would have ${rows.length} rows; the limit is ${max}. Choose a shorter period or add a filter.`, 422);
    await this.audit.record(
      {
        userId: actor.id, action: 'analytics.exported', entity: 'analytics',
        newValue: { report, from: range.from, to: range.to, basis: q.basis, filters: { ticketType: q.ticketType ?? null, audience: q.audience ?? null, dayType: q.dayType ?? null, gateId: q.gateId ?? null }, rows: rows.length } as Prisma.InputJsonValue,
      },
      ctx,
    );
    const basis = report === 'sales' || report === 'tickets' ? `-${q.basis}` : '';
    return { filename: `azharpark-${report}-${range.from}_${range.to}${basis}.csv`, lines: csvLines(headers, rows), rows: rows.length };
  }

  private async rows(report: ExportReport, q: AnalyticsQuery, range: ResolvedRange): Promise<[string[], CsvCell[][]]> {
    const all: Access = { money: true, operations: true, content: true }; // the caller was checked above; the reports are reused as they are
    switch (report) {
      case 'sales':
        return [['period_start', 'granularity', 'basis', 'ticket_type_code', 'ticket_type', 'audience_code', 'audience', 'day_type', 'tickets_sold', 'tickets_cancelled', 'value_egp', 'currency'], await this.salesRows(q, range)];
      case 'attendance':
        return [['period_start', 'granularity', 'ticket_type_code', 'ticket_type', 'audience_code', 'audience', 'entries'], await this.attendanceRows(q, range)];
      case 'tickets': {
        const t = await this.analytics.tickets(q, all);
        return [
          ['basis', 'from', 'to', 'ticket_type_code', 'ticket_type', 'audience_code', 'audience', 'status', 'tickets', 'ticket_value_egp'],
          t.byTypeAudienceStatus.map((r) => [q.basis, range.from, range.to, r.ticketTypeCode, r.ticketTypeNameEn, r.audienceCode, r.audienceNameEn, r.status, r.tickets, egp(r.valueMinor ?? 0)]),
        ];
      }
      case 'gates': {
        const a = await this.analytics.attendance(q, all);
        return [['gate_code', 'gate', 'entries', 'refused_scans', 'total_scans', 'share_of_entries_percent'], a.byGate.map((g) => [g.code, g.nameEn, g.entries, g.refused, g.scans, g.shareOfEntriesPercent])];
      }
      case 'scans':
        return [['period_start', 'granularity', 'gate_code', 'result', 'scans'], await this.scanRows(q, range)];
      case 'events': {
        const events = await this.prisma.event.findMany({
          where: { startsAt: { gte: range.start, lt: range.end } }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], take: this.config.get('ANALYTICS_EXPORT_MAX_ROWS') + 1,
          include: { venue: { select: { nameEn: true, nameAr: true } } },
        });
        return [['event_date', 'status', 'title_en', 'title_ar', 'venue_en', 'venue_ar'], events.map((e) => [parkDateOf(e.startsAt), e.status, e.titleEn, e.titleAr, e.venue?.nameEn ?? e.locationNameEn, e.venue?.nameAr ?? e.locationNameAr])];
      }
    }
  }

  private bucket(date: Prisma.Sql, g: 'day' | 'week' | 'month'): Prisma.Sql {
    return g === 'day' ? date : g === 'week' ? Prisma.sql`date_trunc('week', ${date}::timestamp)::date` : Prisma.sql`date_trunc('month', ${date}::timestamp)::date`;
  }

  private async salesRows(q: AnalyticsQuery, r: ResolvedRange): Promise<CsvCell[][]> {
    const date = q.basis === 'sale' ? Prisma.sql`azharpark_date_of(o.created_at)` : Prisma.sql`o.visit_date`;
    const period =
      q.basis === 'sale'
        ? Prisma.sql`o.created_at >= ${r.start} AND o.created_at < ${r.end}`
        : Prisma.sql`o.visit_date >= ${new Date(`${r.from}T00:00:00Z`)}::date AND o.visit_date <= ${new Date(`${r.to}T00:00:00Z`)}::date`;
    const filters: Prisma.Sql[] = [];
    if (q.ticketType) filters.push(Prisma.sql`AND tt.code = ${q.ticketType}`);
    if (q.audience) filters.push(Prisma.sql`AND ta.code = ${q.audience}`);
    if (q.dayType) filters.push(q.dayType === 'WEEKEND' ? Prisma.sql`AND EXTRACT(DOW FROM t.visit_date) IN (5, 6)` : Prisma.sql`AND EXTRACT(DOW FROM t.visit_date) NOT IN (5, 6)`);
    const rows = await this.prisma.$queryRaw<Array<{ bucket: Date; tt_code: string; tt_en: string; ta_code: string; ta_en: string; weekend: boolean; tickets: bigint; cancelled: bigint; value: bigint }>>`
      SELECT ${this.bucket(date, r.granularity)} AS bucket, tt.code AS tt_code, tt.name_en AS tt_en, ta.code AS ta_code, ta.name_en AS ta_en, (EXTRACT(DOW FROM t.visit_date) IN (5, 6)) AS weekend,
             count(t.id) AS tickets, count(t.id) FILTER (WHERE t.status = 'CANCELLED') AS cancelled, coalesce(sum(t.price_paid_minor), 0) AS value
        FROM tickets t JOIN orders o ON o.id = t.order_id
        JOIN ticket_types tt ON tt.id = t.ticket_type_id JOIN ticket_audiences ta ON ta.id = t.audience_id
       WHERE o.status = 'PAID' AND ${period} ${filters.length ? Prisma.join(filters, ' ') : Prisma.empty}
       GROUP BY 1, 2, 3, 4, 5, 6 ORDER BY 1, 2, 4, 6`;
    return rows.map((x) => [day(x.bucket), r.granularity, q.basis, x.tt_code, x.tt_en, x.ta_code, x.ta_en, x.weekend ? 'WEEKEND' : 'WEEKDAY', num(x.tickets), num(x.cancelled), egp(num(x.value)), 'EGP']);
  }

  private scanBucket(r: ResolvedRange) {
    return this.bucket(Prisma.sql`azharpark_date_of(s.scanned_at)`, r.granularity);
  }

  private scanFilters(q: AnalyticsQuery, r: ResolvedRange) {
    const parts: Prisma.Sql[] = [Prisma.sql`s.scanned_at >= ${r.start} AND s.scanned_at < ${r.end}`];
    if (q.gateId) parts.push(Prisma.sql`s.gate_id = ${q.gateId}::uuid`);
    if (q.ticketType) parts.push(Prisma.sql`tt.code = ${q.ticketType}`);
    if (q.audience) parts.push(Prisma.sql`ta.code = ${q.audience}`);
    return {
      where: Prisma.join(parts, ' AND '),
      joins: q.ticketType || q.audience ? Prisma.sql`JOIN tickets t ON t.id = s.ticket_id JOIN ticket_types tt ON tt.id = t.ticket_type_id JOIN ticket_audiences ta ON ta.id = t.audience_id` : Prisma.empty,
    };
  }

  private async attendanceRows(q: AnalyticsQuery, r: ResolvedRange): Promise<CsvCell[][]> {
    const f = this.scanFilters(q, r);
    const filtered = q.ticketType || q.audience;
    // the type and audience of the entered ticket come from the ticket itself; when a filter already joined it, reuse that join
    const rows = await this.prisma.$queryRaw<Array<{ bucket: Date; tt_code: string; tt_en: string; ta_code: string; ta_en: string; entries: bigint }>>`
      SELECT ${this.scanBucket(r)} AS bucket, tt2.code AS tt_code, tt2.name_en AS tt_en, ta2.code AS ta_code, ta2.name_en AS ta_en, count(*) AS entries
        FROM ticket_scans s ${f.joins} ${filtered ? Prisma.sql`JOIN tickets t2 ON t2.id = t.id` : Prisma.sql`JOIN tickets t2 ON t2.id = s.ticket_id`}
        JOIN ticket_types tt2 ON tt2.id = t2.ticket_type_id JOIN ticket_audiences ta2 ON ta2.id = t2.audience_id
       WHERE s.result = 'VALID' AND ${f.where} GROUP BY 1, 2, 3, 4, 5 ORDER BY 1, 2, 4`;
    return rows.map((x) => [day(x.bucket), r.granularity, x.tt_code, x.tt_en, x.ta_code, x.ta_en, num(x.entries)]);
  }

  private async scanRows(q: AnalyticsQuery, r: ResolvedRange): Promise<CsvCell[][]> {
    const f = this.scanFilters(q, r);
    const rows = await this.prisma.$queryRaw<Array<{ bucket: Date; gate: string | null; detail: string | null; reason: string; scans: bigint }>>`
      SELECT ${this.scanBucket(r)} AS bucket, g.code AS gate, s.detail, s.reason::text AS reason, count(*) AS scans
        FROM ticket_scans s LEFT JOIN gates g ON g.id = s.gate_id ${f.joins} WHERE ${f.where} GROUP BY 1, 2, 3, 4 ORDER BY 1, 2`;
    const merged = new Map<string, CsvCell[]>();
    for (const x of rows) {
      const result = x.detail ?? FROM_REASON[x.reason] ?? x.reason;
      const key = `${day(x.bucket)}|${x.gate}|${result}`;
      const cur = merged.get(key);
      if (cur) cur[4] = (cur[4] as number) + num(x.scans);
      else merged.set(key, [day(x.bucket), r.granularity, x.gate ?? 'UNKNOWN', result, num(x.scans)]);
    }
    return [...merged.values()].sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[2]).localeCompare(String(b[2])) || String(a[3]).localeCompare(String(b[3])));
  }
}
