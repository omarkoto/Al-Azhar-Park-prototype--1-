import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Clock } from '../../common/clock';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { dateToIso, parkDateOf } from '../ticketing/rules/calendar';
import { AnalyticsQuery } from './analytics.dto';
import { bucketsOf, resolveRange, ResolvedRange } from './analytics-range';

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const day = (v: unknown): string => (v instanceof Date ? dateToIso(v) : String(v).slice(0, 10));
const share = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

/** The three permissions that already exist for analytics, as three questions a report can ask. */
export interface Access {
  /** money: sales, revenue, order values (analytics:read) */
  money: boolean;
  /** entry, scans, gates, ticket states and counts (analytics:operations, or analytics:read which covers all) */
  operations: boolean;
  /** content statistics such as events (analytics:content, or analytics:read) */
  content: boolean;
}

export function accessOf(actor: AuthenticatedUser): Access {
  const all = actor.permissions.has('analytics:read');
  return { money: all, operations: all || actor.permissions.has('analytics:operations'), content: all || actor.permissions.has('analytics:content') };
}

export interface RangeView {
  key: string;
  from: string;
  to: string;
  days: number;
  granularity: 'day' | 'week' | 'month';
}
const rangeView = (r: ResolvedRange): RangeView => ({ key: r.key, from: r.from, to: r.to, days: r.days, granularity: r.granularity });

const SCAN_CODES = ['ACCESS_GRANTED', 'ALREADY_USED', 'WRONG_DATE', 'CANCELLED', 'EXPIRED', 'TICKET_NOT_VALID', 'TICKET_NOT_FOUND', 'INVALID_QR', 'INVALID_SIGNATURE', 'RETIRED_KEY'] as const;
/** Scans written before Phase 8 recorded only the coarse reason; this maps those to the precise codes' nearest meaning. */
const FROM_REASON: Record<string, string> = { OK: 'ACCESS_GRANTED', NOT_FOUND: 'TICKET_NOT_FOUND', NOT_PAID: 'TICKET_NOT_VALID', INVALID_TOKEN: 'INVALID_QR', REFUNDED: 'TICKET_NOT_VALID' };

export interface TypeAudienceRow {
  ticketTypeId: string;
  ticketTypeCode: string;
  ticketTypeNameEn: string;
  ticketTypeNameAr: string;
  audienceId: string;
  audienceCode: string;
  audienceNameEn: string;
  audienceNameAr: string;
  dayType: 'WEEKDAY' | 'WEEKEND';
}

/**
 * Reports over the operational database. Every figure is a PostgreSQL aggregate over stored rows (never a price
 * recalculated from today's price list, never a pile of rows summed in Node), and every period is whole Cairo days.
 *
 * Three different questions are kept apart on purpose:
 *   SALES      orders that are PAID, counted by the day the order was placed (basis "sale") or by the ticket's visit date
 *              (basis "visit"). Money is the stored order total.
 *   TICKETS    what each ticket is NOW (valid, used, cancelled ...). The database keeps no history of state changes.
 *   ENTRY      successful gate scans, by the day of the scan. A ticket sold is not a visitor admitted.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly config: AppConfigService,
  ) {}

  /** Validates the period and works it out on the Cairo calendar. */
  range(query: AnalyticsQuery): ResolvedRange {
    return resolveRange(query, parkDateOf(this.clock.now()), this.config.get('ANALYTICS_MAX_RANGE_DAYS'));
  }

  // ───────────────────────────── building blocks ─────────────────────────────

  /** The Cairo date a row belongs to for this basis, as SQL. `o` is orders, `t` is tickets. */
  private bucketSql(basis: 'sale' | 'visit', g: ResolvedRange['granularity'], alias: 'o' | 't' = 'o'): Prisma.Sql {
    const date = basis === 'sale' ? Prisma.sql`azharpark_date_of(o.created_at)` : alias === 'o' ? Prisma.sql`o.visit_date` : Prisma.sql`t.visit_date`;
    return g === 'day' ? date : g === 'week' ? Prisma.sql`date_trunc('week', ${date}::timestamp)::date` : Prisma.sql`date_trunc('month', ${date}::timestamp)::date`;
  }

  /** Which orders belong to the period. Orders are compared by an instant range (so the index on created_at is used) or by visit date. */
  private periodSql(basis: 'sale' | 'visit', r: ResolvedRange): Prisma.Sql {
    return basis === 'sale' ? Prisma.sql`o.created_at >= ${r.start} AND o.created_at < ${r.end}` : Prisma.sql`o.visit_date >= ${new Date(`${r.from}T00:00:00Z`)}::date AND o.visit_date <= ${new Date(`${r.to}T00:00:00Z`)}::date`;
  }

  private ticketFilters(q: AnalyticsQuery): Prisma.Sql {
    const parts: Prisma.Sql[] = [];
    if (q.ticketType) parts.push(Prisma.sql`AND tt.code = ${q.ticketType}`);
    if (q.audience) parts.push(Prisma.sql`AND ta.code = ${q.audience}`);
    if (q.dayType) parts.push(q.dayType === 'WEEKEND' ? Prisma.sql`AND EXTRACT(DOW FROM t.visit_date) IN (5, 6)` : Prisma.sql`AND EXTRACT(DOW FROM t.visit_date) NOT IN (5, 6)`);
    return parts.length ? Prisma.join(parts, ' ') : Prisma.empty;
  }

  private isFiltered(q: AnalyticsQuery): boolean {
    return Boolean(q.ticketType || q.audience || q.dayType);
  }

  private zeroFill<T extends { bucket: string }>(range: ResolvedRange, rows: T[], empty: Omit<T, 'bucket'>): T[] {
    const byBucket = new Map(rows.map((r) => [r.bucket, r]));
    return bucketsOf(range).map((bucket) => byBucket.get(bucket) ?? ({ bucket, ...empty } as T));
  }

  // ───────────────────────────── sales ─────────────────────────────

  async sales(q: AnalyticsQuery, access: Access) {
    this.require(access.money);
    const range = this.range(q);
    const basis = q.basis;
    const filtered = this.isFiltered(q);
    const period = this.periodSql(basis, range);
    const filters = this.ticketFilters(q);
    const bucket = this.bucketSql(basis, range.granularity);

    // tickets of paid orders: what was sold, what was cancelled inside a paid order, and what they were sold for
    const [seriesRows, breakdownRows, orderSeries, cancelled, placed] = await Promise.all([
      this.prisma.$queryRaw<Array<{ bucket: Date; orders: bigint; tickets: bigint; cancelled: bigint; value: bigint }>>`
        SELECT ${bucket} AS bucket, count(DISTINCT o.id) AS orders, count(t.id) AS tickets,
               count(t.id) FILTER (WHERE t.status = 'CANCELLED') AS cancelled, coalesce(sum(t.price_paid_minor), 0) AS value
          FROM tickets t JOIN orders o ON o.id = t.order_id
          JOIN ticket_types tt ON tt.id = t.ticket_type_id JOIN ticket_audiences ta ON ta.id = t.audience_id
         WHERE o.status = 'PAID' AND ${period} ${filters}
         GROUP BY 1 ORDER BY 1`,
      this.breakdown(Prisma.sql`o.status = 'PAID' AND ${period} ${filters}`),
      // unfiltered: order count and money come from the stored ORDER totals themselves
      filtered
        ? Promise.resolve([])
        : this.prisma.$queryRaw<Array<{ bucket: Date; orders: bigint; value: bigint }>>`
            SELECT ${bucket} AS bucket, count(*) AS orders, coalesce(sum(o.total_minor), 0) AS value
              FROM orders o WHERE o.status = 'PAID' AND ${period} GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<Array<{ orders: bigint; tickets: bigint; value: bigint }>>`
        SELECT count(DISTINCT o.id) AS orders, count(t.id) AS tickets, coalesce(sum(t.price_paid_minor), 0) AS value
          FROM tickets t JOIN orders o ON o.id = t.order_id
          JOIN ticket_types tt ON tt.id = t.ticket_type_id JOIN ticket_audiences ta ON ta.id = t.audience_id
         WHERE o.status = 'CANCELLED' AND o.paid_at IS NOT NULL AND ${period} ${filters}`,
      // orders placed, whatever became of them (only meaningful by the day they were placed, and only without ticket filters)
      basis === 'sale' && !filtered
        ? this.prisma.$queryRaw<Array<{ status: string; orders: bigint; value: bigint }>>`
            SELECT o.status::text AS status, count(*) AS orders, coalesce(sum(o.total_minor), 0) AS value FROM orders o WHERE ${period} GROUP BY 1`
        : Promise.resolve(null),
    ]);

    const orderValue = new Map(orderSeries.map((r) => [day(r.bucket), { orders: num(r.orders), value: num(r.value) }]));
    const series = this.zeroFill(
      range,
      seriesRows.map((r) => {
        const b = day(r.bucket);
        const o = orderValue.get(b);
        return { bucket: b, paidOrders: filtered ? num(r.orders) : (o?.orders ?? 0), tickets: num(r.tickets), cancelledTickets: num(r.cancelled), paidSalesMinor: filtered ? num(r.value) : (o?.value ?? 0) };
      }),
      { paidOrders: 0, tickets: 0, cancelledTickets: 0, paidSalesMinor: 0 },
    );
    const paidOrders = series.reduce((n, s) => n + s.paidOrders, 0);
    const paidSalesMinor = series.reduce((n, s) => n + s.paidSalesMinor, 0);
    const tickets = series.reduce((n, s) => n + s.tickets, 0);
    const cancelledTickets = series.reduce((n, s) => n + s.cancelledTickets, 0);
    const placedBy = (s: string) => placed?.find((p) => p.status === s);

    return {
      range: rangeView(range), basis, filtered, currency: 'EGP',
      kpis: {
        paidOrders, ticketsSold: tickets, ticketsCancelledInPaidOrders: cancelledTickets, paidSalesMinor,
        averagePaidOrderMinor: paidOrders > 0 ? Math.round(paidSalesMinor / paidOrders) : null,
        /** paid orders that staff cancelled later: the sale was withdrawn; the system does not refund */
        cancelledAfterPayment: { orders: num(cancelled[0]?.orders), tickets: num(cancelled[0]?.tickets), valueMinor: num(cancelled[0]?.value) },
      },
      ordersPlaced: placed
        ? { total: placed.reduce((n, p) => n + num(p.orders), 0), paid: num(placedBy('PAID')?.orders), unpaid: num(placedBy('PENDING_PAYMENT')?.orders), expired: num(placedBy('EXPIRED')?.orders), cancelled: num(placedBy('CANCELLED')?.orders) }
        : null,
      series,
      byTicketType: this.rollup(breakdownRows, (r) => r.ticketTypeId, (r) => ({ id: r.ticketTypeId, code: r.ticketTypeCode, nameEn: r.ticketTypeNameEn, nameAr: r.ticketTypeNameAr })),
      byAudience: this.rollup(breakdownRows, (r) => r.audienceId, (r) => ({ id: r.audienceId, code: r.audienceCode, nameEn: r.audienceNameEn, nameAr: r.audienceNameAr })),
      byDayType: this.rollup(breakdownRows, (r) => r.dayType, (r) => ({ id: r.dayType, code: r.dayType, nameEn: r.dayType === 'WEEKEND' ? 'Weekend (Fri–Sat)' : 'Weekday (Sun–Thu)', nameAr: r.dayType === 'WEEKEND' ? 'عطلة نهاية الأسبوع (الجمعة–السبت)' : 'أيام الأسبوع (الأحد–الخميس)' })),
      byTicketTypeAndAudience: this.rollupPairs(breakdownRows),
    };
  }

  /** Tickets of the orders matched by `where`, grouped by type, audience and weekday/weekend. */
  private async breakdown(where: Prisma.Sql) {
    const rows = await this.prisma.$queryRaw<
      Array<{ tt_id: string; tt_code: string; tt_en: string; tt_ar: string; ta_id: string; ta_code: string; ta_en: string; ta_ar: string; weekend: boolean; tickets: bigint; cancelled: bigint; value: bigint }>
    >`
      SELECT tt.id AS tt_id, tt.code AS tt_code, tt.name_en AS tt_en, tt.name_ar AS tt_ar, ta.id AS ta_id, ta.code AS ta_code, ta.name_en AS ta_en, ta.name_ar AS ta_ar,
             (EXTRACT(DOW FROM t.visit_date) IN (5, 6)) AS weekend, count(t.id) AS tickets,
             count(t.id) FILTER (WHERE t.status = 'CANCELLED') AS cancelled, coalesce(sum(t.price_paid_minor), 0) AS value
        FROM tickets t JOIN orders o ON o.id = t.order_id
        JOIN ticket_types tt ON tt.id = t.ticket_type_id JOIN ticket_audiences ta ON ta.id = t.audience_id
       WHERE ${where}
       GROUP BY tt.id, tt.code, tt.name_en, tt.name_ar, ta.id, ta.code, ta.name_en, ta.name_ar, weekend
       ORDER BY tt.code, ta.code, weekend`;
    return rows.map((r) => ({
      ticketTypeId: r.tt_id, ticketTypeCode: r.tt_code, ticketTypeNameEn: r.tt_en, ticketTypeNameAr: r.tt_ar,
      audienceId: r.ta_id, audienceCode: r.ta_code, audienceNameEn: r.ta_en, audienceNameAr: r.ta_ar,
      dayType: (r.weekend ? 'WEEKEND' : 'WEEKDAY') as 'WEEKDAY' | 'WEEKEND', tickets: num(r.tickets), cancelled: num(r.cancelled), valueMinor: num(r.value),
    }));
  }

  private rollup<T extends { tickets: number; cancelled: number; valueMinor: number }>(rows: T[], key: (r: T) => string, label: (r: T) => { id: string; code: string; nameEn: string; nameAr: string }) {
    const total = rows.reduce((n, r) => n + r.tickets, 0);
    const out = new Map<string, { id: string; code: string; nameEn: string; nameAr: string; tickets: number; cancelled: number; valueMinor: number }>();
    for (const r of rows) {
      const k = key(r);
      const cur = out.get(k) ?? { ...label(r), tickets: 0, cancelled: 0, valueMinor: 0 };
      cur.tickets += r.tickets;
      cur.cancelled += r.cancelled;
      cur.valueMinor += r.valueMinor;
      out.set(k, cur);
    }
    return [...out.values()].map((r) => ({ ...r, shareOfTicketsPercent: share(r.tickets, total) })).sort((a, b) => b.tickets - a.tickets || a.code.localeCompare(b.code));
  }

  private rollupPairs(rows: Array<TypeAudienceRow & { tickets: number; cancelled: number; valueMinor: number }>) {
    const out = new Map<string, Omit<TypeAudienceRow, 'dayType'> & { tickets: number; cancelled: number; valueMinor: number }>();
    for (const { dayType, ...r } of rows) {
      void dayType;
      const key = `${r.ticketTypeId}|${r.audienceId}`;
      const cur = out.get(key) ?? { ...r, tickets: 0, cancelled: 0, valueMinor: 0 };
      cur.tickets += r.tickets;
      cur.cancelled += r.cancelled;
      cur.valueMinor += r.valueMinor;
      out.set(key, cur);
    }
    return [...out.values()];
  }

  // ───────────────────────────── attendance ─────────────────────────────

  async attendance(q: AnalyticsQuery, access: Access) {
    this.require(access.operations);
    const range = this.range(q);
    const where = this.scanWhere(q, range);
    const bucketScan = range.granularity === 'day' ? Prisma.sql`azharpark_date_of(s.scanned_at)` : range.granularity === 'week' ? Prisma.sql`date_trunc('week', azharpark_date_of(s.scanned_at)::timestamp)::date` : Prisma.sql`date_trunc('month', azharpark_date_of(s.scanned_at)::timestamp)::date`;
    const [seriesRows, resultRows, gateRows, entryRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ bucket: Date; entries: bigint; refused: bigint }>>`
        SELECT ${bucketScan} AS bucket, count(*) FILTER (WHERE s.result = 'VALID') AS entries, count(*) FILTER (WHERE s.result = 'INVALID') AS refused
          FROM ticket_scans s ${this.scanJoins(q)} WHERE ${where} GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<Array<{ detail: string | null; reason: string; scans: bigint }>>`
        SELECT s.detail, s.reason::text AS reason, count(*) AS scans FROM ticket_scans s ${this.scanJoins(q)} WHERE ${where} GROUP BY 1, 2`,
      this.prisma.$queryRaw<Array<{ id: string | null; code: string | null; name_en: string | null; name_ar: string | null; entries: bigint; refused: bigint }>>`
        SELECT g.id, g.code, g.name_en, g.name_ar, count(*) FILTER (WHERE s.result = 'VALID') AS entries, count(*) FILTER (WHERE s.result = 'INVALID') AS refused
          FROM ticket_scans s LEFT JOIN gates g ON g.id = s.gate_id ${this.scanJoins(q)} WHERE ${where} GROUP BY g.id, g.code, g.name_en, g.name_ar ORDER BY g.code NULLS LAST`,
      this.prisma.$queryRaw<Array<{ tt_id: string; tt_code: string; tt_en: string; tt_ar: string; ta_id: string; ta_code: string; ta_en: string; ta_ar: string; entries: bigint }>>`
        SELECT tt.id AS tt_id, tt.code AS tt_code, tt.name_en AS tt_en, tt.name_ar AS tt_ar, ta.id AS ta_id, ta.code AS ta_code, ta.name_en AS ta_en, ta.name_ar AS ta_ar, count(*) AS entries
          FROM ticket_scans s JOIN tickets t ON t.id = s.ticket_id
          JOIN ticket_types tt ON tt.id = t.ticket_type_id JOIN ticket_audiences ta ON ta.id = t.audience_id
         WHERE s.result = 'VALID' AND ${where} GROUP BY 1, 2, 3, 4, 5, 6, 7, 8 ORDER BY tt.code, ta.code`,
    ]);

    const series = this.zeroFill(range, seriesRows.map((r) => ({ bucket: day(r.bucket), entries: num(r.entries), refused: num(r.refused) })), { entries: 0, refused: 0 });
    const entries = series.reduce((n, s) => n + s.entries, 0);
    const refused = series.reduce((n, s) => n + s.refused, 0);

    const counts = new Map<string, number>();
    for (const r of resultRows) {
      const code = r.detail ?? FROM_REASON[r.reason] ?? r.reason;
      counts.set(code, (counts.get(code) ?? 0) + num(r.scans));
    }
    const results = [...SCAN_CODES, ...[...counts.keys()].filter((c) => !(SCAN_CODES as readonly string[]).includes(c))].map((code) => ({ code, granted: code === 'ACCESS_GRANTED', scans: counts.get(code) ?? 0 }));
    const total = entries + refused;

    const known = await this.prisma.gate.findMany({ where: q.gateId ? { id: q.gateId } : { isActive: true }, select: { id: true, code: true, nameEn: true, nameAr: true } });
    for (const g of known) if (!gateRows.some((r) => r.id === g.id)) gateRows.push({ id: g.id, code: g.code, name_en: g.nameEn, name_ar: g.nameAr, entries: 0n, refused: 0n });
    gateRows.sort((a, b) => (a.code ?? '￿').localeCompare(b.code ?? '￿'));
    const gates = gateRows.map((g) => ({ id: g.id, code: g.code ?? 'UNKNOWN', nameEn: g.name_en ?? 'Removed gate', nameAr: g.name_ar ?? '—', entries: num(g.entries), refused: num(g.refused), scans: num(g.entries) + num(g.refused), shareOfEntriesPercent: share(num(g.entries), entries) }));
    const busiest = [...gates].filter((g) => g.entries > 0).sort((a, b) => b.entries - a.entries || a.code.localeCompare(b.code))[0] ?? null;
    return {
      range: rangeView(range),
      kpis: { entries, refusedScans: refused, totalScans: total, refusedSharePercent: share(refused, total), busiestGate: busiest ? { code: busiest.code, nameEn: busiest.nameEn, entries: busiest.entries } : null },
      series,
      results: results.map((r) => ({ ...r, sharePercent: share(r.scans, total) })),
      byGate: gates,
      entriesByTicketType: this.entriesBy(entryRows, entries, (r) => ({ id: r.tt_id, code: r.tt_code, nameEn: r.tt_en, nameAr: r.tt_ar })),
      entriesByAudience: this.entriesBy(entryRows, entries, (r) => ({ id: r.ta_id, code: r.ta_code, nameEn: r.ta_en, nameAr: r.ta_ar })),
    };
  }

  /** Successful entries grouped by one dimension of the ticket (its type, or its audience). */
  private entriesBy<R extends { entries: bigint }>(rows: R[], total: number, label: (r: R) => { id: string; code: string; nameEn: string; nameAr: string }) {
    const out = new Map<string, { id: string; code: string; nameEn: string; nameAr: string; entries: number }>();
    for (const r of rows) {
      const l = label(r);
      const cur = out.get(l.id) ?? { ...l, entries: 0 };
      cur.entries += num(r.entries);
      out.set(l.id, cur);
    }
    return [...out.values()].map((r) => ({ ...r, shareOfEntriesPercent: share(r.entries, total) })).sort((x, y) => y.entries - x.entries || x.code.localeCompare(y.code));
  }

  private scanJoins(q: AnalyticsQuery): Prisma.Sql {
    return q.ticketType || q.audience
      ? Prisma.sql`JOIN tickets t ON t.id = s.ticket_id JOIN ticket_types tt ON tt.id = t.ticket_type_id JOIN ticket_audiences ta ON ta.id = t.audience_id`
      : Prisma.empty;
  }

  private scanWhere(q: AnalyticsQuery, r: ResolvedRange): Prisma.Sql {
    const parts: Prisma.Sql[] = [Prisma.sql`s.scanned_at >= ${r.start} AND s.scanned_at < ${r.end}`];
    if (q.gateId) parts.push(Prisma.sql`s.gate_id = ${q.gateId}::uuid`);
    if (q.ticketType) parts.push(Prisma.sql`tt.code = ${q.ticketType}`);
    if (q.audience) parts.push(Prisma.sql`ta.code = ${q.audience}`);
    return Prisma.join(parts, ' AND ');
  }

  // ───────────────────────────── ticket states ─────────────────────────────

  async tickets(q: AnalyticsQuery, access: Access) {
    this.require(access.operations);
    const range = this.range(q);
    const basis = q.basis;
    const today = parkDateOf(this.clock.now());
    const todayDate = new Date(`${today}T00:00:00Z`);
    const period = this.periodSql(basis, range);
    const filters = this.ticketFilters(q);
    const bucket = this.bucketSql(basis, range.granularity, 't');
    const [byStatusRows, seriesRows, pastRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ status: string; tt_id: string; tt_code: string; tt_en: string; tt_ar: string; ta_id: string; ta_code: string; ta_en: string; ta_ar: string; tickets: bigint; value: bigint }>>`
        SELECT t.status::text AS status, tt.id AS tt_id, tt.code AS tt_code, tt.name_en AS tt_en, tt.name_ar AS tt_ar, ta.id AS ta_id, ta.code AS ta_code, ta.name_en AS ta_en, ta.name_ar AS ta_ar,
               count(t.id) AS tickets, coalesce(sum(t.price_paid_minor), 0) AS value
          FROM tickets t JOIN orders o ON o.id = t.order_id
          JOIN ticket_types tt ON tt.id = t.ticket_type_id JOIN ticket_audiences ta ON ta.id = t.audience_id
         WHERE ${period} ${filters} GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9 ORDER BY tt.code, ta.code, 1`,
      this.prisma.$queryRaw<Array<{ bucket: Date; valid: bigint; used: bigint; cancelled: bigint; other: bigint }>>`
        SELECT ${bucket} AS bucket, count(*) FILTER (WHERE t.status = 'VALID') AS valid, count(*) FILTER (WHERE t.status = 'USED') AS used,
               count(*) FILTER (WHERE t.status = 'CANCELLED') AS cancelled, count(*) FILTER (WHERE t.status IN ('PENDING', 'EXPIRED')) AS other
          FROM tickets t JOIN orders o ON o.id = t.order_id
          JOIN ticket_types tt ON tt.id = t.ticket_type_id JOIN ticket_audiences ta ON ta.id = t.audience_id
         WHERE ${period} ${filters} GROUP BY 1 ORDER BY 1`,
      // tickets whose day has passed: how many were used, and how many were never used
      this.prisma.$queryRaw<Array<{ used: bigint; unused: bigint }>>`
        SELECT count(*) FILTER (WHERE t.status = 'USED') AS used, count(*) FILTER (WHERE t.status = 'VALID') AS unused
          FROM tickets t JOIN orders o ON o.id = t.order_id
          JOIN ticket_types tt ON tt.id = t.ticket_type_id JOIN ticket_audiences ta ON ta.id = t.audience_id
         WHERE ${period} ${filters} AND t.visit_date < ${todayDate}::date`,
    ]);
    const status = (s: string) => byStatusRows.filter((r) => r.status === s).reduce((n, r) => n + num(r.tickets), 0);
    const total = byStatusRows.reduce((n, r) => n + num(r.tickets), 0);
    const pastUsed = num(pastRows[0]?.used);
    const pastUnused = num(pastRows[0]?.unused);
    return {
      range: rangeView(range), basis, asOf: today,
      /** the state each ticket is in NOW. The database keeps no history of how a ticket got there. */
      kpis: { total, valid: status('VALID'), used: status('USED'), cancelled: status('CANCELLED'), pending: status('PENDING'), expired: status('EXPIRED'), usedAfterVisitDate: pastUsed, validButDatePassed: pastUnused, usedSharePercentOfPastValid: share(pastUsed, pastUsed + pastUnused) },
      series: this.zeroFill(range, seriesRows.map((r) => ({ bucket: day(r.bucket), valid: num(r.valid), used: num(r.used), cancelled: num(r.cancelled), notPaid: num(r.other) })), { valid: 0, used: 0, cancelled: 0, notPaid: 0 }),
      byTypeAudienceStatus: byStatusRows.map((r) => ({ status: r.status, ticketTypeCode: r.tt_code, ticketTypeNameEn: r.tt_en, ticketTypeNameAr: r.tt_ar, audienceCode: r.ta_code, audienceNameEn: r.ta_en, audienceNameAr: r.ta_ar, tickets: num(r.tickets), ...(access.money ? { valueMinor: num(r.value) } : {}) })),
    };
  }

  // ───────────────────────────── events ─────────────────────────────

  async events(q: AnalyticsQuery, access: Access) {
    this.require(access.content);
    const range = this.range(q);
    const bucket = range.granularity === 'day' ? Prisma.sql`azharpark_date_of(e.starts_at)` : range.granularity === 'week' ? Prisma.sql`date_trunc('week', azharpark_date_of(e.starts_at)::timestamp)::date` : Prisma.sql`date_trunc('month', azharpark_date_of(e.starts_at)::timestamp)::date`;
    const [allByStatus, inRange, series, byVenue] = await Promise.all([
      this.prisma.event.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.event.findMany({ where: { startsAt: { gte: range.start, lt: range.end } }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], take: 500, include: { venue: { select: { nameEn: true, nameAr: true } } } }),
      this.prisma.$queryRaw<Array<{ bucket: Date; events: bigint }>>`
        SELECT ${bucket} AS bucket, count(*) AS events FROM events e
         WHERE e.starts_at >= ${range.start} AND e.starts_at < ${range.end} AND e.status IN ('COMING_SOON', 'PUBLISHED') GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<Array<{ venue_en: string | null; venue_ar: string | null; events: bigint }>>`
        SELECT v.name_en AS venue_en, v.name_ar AS venue_ar, count(*) AS events FROM events e LEFT JOIN venues v ON v.id = e.venue_id
         WHERE e.starts_at >= ${range.start} AND e.starts_at < ${range.end} AND e.status IN ('COMING_SOON', 'PUBLISHED') GROUP BY 1, 2 ORDER BY count(*) DESC, 1`,
    ]);
    const count = (s: string) => allByStatus.find((r) => r.status === s)?._count._all ?? 0;
    const inStatus = (s: string) => inRange.filter((e) => e.status === s).length;
    return {
      range: rangeView(range),
      /** content statistics only: events are not linked to tickets (a ticket admits a visitor to the park, not to an event) */
      kpis: {
        inPeriod: inRange.length, publishedInPeriod: inStatus('PUBLISHED'), comingSoonInPeriod: inStatus('COMING_SOON'), draftInPeriod: inStatus('DRAFT'), cancelledInPeriod: inStatus('CANCELLED'), archivedInPeriod: inStatus('ARCHIVED'),
        allTime: { draft: count('DRAFT'), comingSoon: count('COMING_SOON'), published: count('PUBLISHED'), cancelled: count('CANCELLED'), archived: count('ARCHIVED') },
      },
      series: this.zeroFill(range, series.map((r) => ({ bucket: day(r.bucket), events: num(r.events) })), { events: 0 }),
      byVenue: byVenue.map((v) => ({ venueEn: v.venue_en ?? 'No venue (other location)', venueAr: v.venue_ar ?? '—', events: num(v.events) })),
      list: inRange.map((e) => ({ id: e.id, titleEn: e.titleEn, titleAr: e.titleAr, status: e.status, date: parkDateOf(e.startsAt), venueEn: e.venue?.nameEn ?? e.locationNameEn ?? null, venueAr: e.venue?.nameAr ?? e.locationNameAr ?? null })),
      listTruncated: inRange.length === 500,
    };
  }

  // ───────────────────────────── overview ─────────────────────────────

  /** The headline numbers of every report the caller may see, and the two curves (sales and entries), for one period. */
  async overview(q: AnalyticsQuery, access: Access) {
    if (!access.money && !access.operations && !access.content) throw new AppException(ErrorCode.FORBIDDEN, 'You do not have permission to do this.', 403);
    const range = this.range(q);
    const [sales, attendance, tickets, events] = await Promise.all([
      access.money ? this.sales(q, access) : null,
      access.operations ? this.attendance({ ...q, gateId: undefined, ticketType: undefined, audience: undefined }, access) : null,
      access.operations ? this.tickets({ ...q, ticketType: undefined, audience: undefined, dayType: undefined }, access) : null,
      access.content ? this.events(q, access) : null,
    ]);
    return {
      range: rangeView(range), basis: q.basis,
      ...(sales ? { sales: { kpis: sales.kpis, ordersPlaced: sales.ordersPlaced, series: sales.series, byTicketType: sales.byTicketType, byAudience: sales.byAudience } } : {}),
      ...(attendance ? { attendance: { kpis: attendance.kpis, series: attendance.series, results: attendance.results } } : {}),
      ...(tickets ? { tickets: { kpis: tickets.kpis } } : {}),
      ...(events ? { events: { kpis: events.kpis } } : {}),
    };
  }

  private require(allowed: boolean): void {
    if (!allowed) throw new AppException(ErrorCode.FORBIDDEN, 'You do not have permission to do this.', 403);
  }
}
