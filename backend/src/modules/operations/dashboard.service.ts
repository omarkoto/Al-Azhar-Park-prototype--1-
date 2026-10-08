import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { describeEventTimes } from '../events/event-time';
import { BookingConfigService } from '../ticketing/booking-config.service';
import { addDays, dateToIso, minutesToHhmm, parkMoment, timeToHhmm } from '../ticketing/rules/calendar';
import { parkDayStart } from '../ticketing/rules/event-window';
import { coveringSpecial, resolveHours } from '../ticketing/rules/opening-hours';
import { evaluateSale } from '../ticketing/rules/sales-window';

const DAY = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** The state of the park right now, from the same opening-hours tables the ticket sales use. */
export interface ParkStatusView {
  date: string;
  /** OPEN: inside today's hours. BEFORE_OPENING / AFTER_CLOSING: a normal open day, outside the hours. CLOSED_TODAY: the whole day is closed. */
  status: 'OPEN' | 'BEFORE_OPENING' | 'AFTER_CLOSING' | 'CLOSED_TODAY';
  opens: string | null;
  closes: string | null;
  source: 'WEEKLY' | 'SPECIAL' | 'NONE';
  special: { labelEn: string; labelAr: string; kind: string; noteEn: string | null; noteAr: string | null } | null;
  /** online sales for today: open until `closesAt` (closing time minus the cut-off), or closed */
  onlineSales: { open: boolean; closesAt: string | null };
  upcomingSpecial: Array<{ labelEn: string; labelAr: string; kind: string; dateFrom: string; dateTo: string; isClosed: boolean; opens: string | null; closes: string | null }>;
}

export interface DashboardView {
  generatedAt: Date;
  /** today in Cairo, YYYY-MM-DD: every figure below is "today" by the park's calendar, never the browser's */
  date: string;
  park?: ParkStatusView;
  /** orders CREATED today, and the money from the ones that are paid (stored order totals, never recalculated) */
  orders?: {
    createdToday: number;
    paidToday: number;
    cancelledToday: number;
    expiredToday: number;
    pendingToday: number;
    revenueMinor: number;
    currency: string;
    /** unpaid orders waiting right now, whatever their visit date */
    pendingPaymentNow: number;
  };
  /** tickets for visit date TODAY, by what they are now */
  tickets?: { forToday: number; valid: number; used: number; cancelled: number; pending: number; expired: number };
  entry?: {
    scope: 'ALL' | 'OWN';
    granted: number;
    denied: number;
    deniedByReason: Record<string, number>;
    recent: Array<{ id: string; scannedAt: Date; granted: boolean; result: string; gate: { code: string; nameEn: string } | null; ticketRef: string | null; staff?: string }>;
  };
  gates?: Array<{ id: string; code: string; nameEn: string; nameAr: string; isActive: boolean; entriesToday?: number }>;
  events?: { today: DashboardEvent[]; upcoming: DashboardEvent[] };
  activity?: Array<{ id: string; at: Date; action: string; entity: string; actor: string | null }>;
}

export interface DashboardEvent {
  id: string;
  titleEn: string;
  titleAr: string;
  status: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  venue: string | null;
}

/**
 * The operations dashboard, computed on the server. Each section is included only if the caller holds the permission
 * that already protects that data elsewhere in the portal, so the dashboard can never show someone more than the
 * pages behind it would. Nothing is analysis: these are counts for today and the latest few records.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: BookingConfigService,
    private readonly clock: Clock,
  ) {}

  async today(actor: AuthenticatedUser): Promise<DashboardView> {
    const now = this.clock.now();
    const date = parkMoment(now).date;
    const start = parkDayStart(date);
    const end = parkDayStart(addDays(date, 1));
    const has = (p: string) => actor.permissions.has(p);
    const view: DashboardView = { generatedAt: now, date };

    const jobs: Array<Promise<void>> = [];
    if (has('park:read') || has('hours:read')) jobs.push(this.park(now, date).then((v) => void (view.park = v)));
    if (has('orders:read')) jobs.push(this.orders(now, start, end).then((v) => void (view.orders = v)));
    if (has('tickets:read')) jobs.push(this.tickets(date).then((v) => void (view.tickets = v)));
    if (has('scans:read') || has('scans:read_own')) jobs.push(this.entry(actor, start, end).then((v) => void (view.entry = v)));
    if (has('gates:read') || has('scans:create')) jobs.push(this.gates(has('scans:read'), start, end).then((v) => void (view.gates = v)));
    if (has('events:read')) jobs.push(this.events(start, end).then((v) => void (view.events = v)));
    if (has('audit:read')) jobs.push(this.activity().then((v) => void (view.activity = v)));
    await Promise.all(jobs);
    return view;
  }

  private async park(now: Date, date: string): Promise<ParkStatusView> {
    const cfg = await this.config.load();
    const hours = resolveHours(date, cfg.weekly, cfg.special);
    const special = await this.prisma.specialHours.findMany({ where: { isActive: true, dateTo: { gte: DAY(date) } }, orderBy: [{ dateFrom: 'asc' }, { priority: 'desc' }] });
    const asRule = special.map((s) => ({
      row: s, dateFrom: dateToIso(s.dateFrom), dateTo: dateToIso(s.dateTo), isClosed: s.isClosed, priority: s.priority, isActive: s.isActive,
      opens: s.opens ? timeToHhmm(s.opens) : null, closes: s.closes ? timeToHhmm(s.closes) : null,
    }));
    const covering = coveringSpecial(date, asRule);
    const minutes = Math.floor(parkMoment(now).secondsOfDay / 60);
    const status: ParkStatusView['status'] =
      hours.isClosed || hours.opensMinutes === null || hours.closesMinutes === null
        ? 'CLOSED_TODAY'
        : minutes < hours.opensMinutes ? 'BEFORE_OPENING' : minutes >= hours.closesMinutes ? 'AFTER_CLOSING' : 'OPEN';
    const sale = evaluateSale({ now, visitDate: date, weekly: cfg.weekly, special: cfg.special, policy: cfg.policy });
    const horizon = addDays(date, 30);
    return {
      date, status, opens: hours.opensMinutes === null ? null : minutesToHhmm(hours.opensMinutes), closes: hours.closesMinutes === null ? null : minutesToHhmm(hours.closesMinutes),
      source: hours.source,
      special: covering ? { labelEn: covering.row.labelEn, labelAr: covering.row.labelAr, kind: covering.row.kind, noteEn: covering.row.noteEn, noteAr: covering.row.noteAr } : null,
      onlineSales: sale.allowed ? { open: true, closesAt: sale.salesCloseAtMinutes === null ? null : minutesToHhmm(sale.salesCloseAtMinutes) } : { open: false, closesAt: null },
      upcomingSpecial: asRule
        .filter((r) => r.dateTo >= date && r.dateFrom <= horizon && r !== covering)
        .slice(0, 6)
        .map((r) => ({ labelEn: r.row.labelEn, labelAr: r.row.labelAr, kind: r.row.kind, dateFrom: r.dateFrom, dateTo: r.dateTo, isClosed: r.isClosed, opens: r.opens, closes: r.closes })),
    };
  }

  private async orders(now: Date, start: Date, end: Date): Promise<NonNullable<DashboardView['orders']>> {
    const [byStatus, pendingNow] = await Promise.all([
      this.prisma.order.groupBy({ by: ['status'], where: { createdAt: { gte: start, lt: end } }, _count: { _all: true }, _sum: { totalMinor: true } }),
      this.prisma.order.count({ where: { status: 'PENDING_PAYMENT', expiresAt: { gt: now } } }),
    ]);
    const n = (s: string) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
    return {
      createdToday: byStatus.reduce((sum, r) => sum + r._count._all, 0), paidToday: n('PAID'), cancelledToday: n('CANCELLED'), expiredToday: n('EXPIRED'), pendingToday: n('PENDING_PAYMENT'),
      // revenue is the stored total of the orders that are paid; a cancelled order is not counted (the park does not refund, but it did cancel the visit)
      revenueMinor: byStatus.find((r) => r.status === 'PAID')?._sum.totalMinor ?? 0, currency: 'EGP', pendingPaymentNow: pendingNow,
    };
  }

  private async tickets(date: string): Promise<NonNullable<DashboardView['tickets']>> {
    const rows = await this.prisma.ticket.groupBy({ by: ['status'], where: { visitDate: DAY(date) }, _count: { _all: true } });
    const n = (s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
    return { forToday: n('VALID') + n('USED'), valid: n('VALID'), used: n('USED'), cancelled: n('CANCELLED'), pending: n('PENDING'), expired: n('EXPIRED') };
  }

  private async entry(actor: AuthenticatedUser, start: Date, end: Date): Promise<NonNullable<DashboardView['entry']>> {
    const all = actor.permissions.has('scans:read');
    const where = { scannedAt: { gte: start, lt: end }, ...(all ? {} : { scannedById: actor.id }) };
    const [groups, recent] = await Promise.all([
      this.prisma.ticketScan.groupBy({ by: ['result', 'reason', 'detail'], where, _count: { _all: true } }),
      this.prisma.ticketScan.findMany({
        where, orderBy: [{ scannedAt: 'desc' }, { id: 'asc' }], take: 10,
        include: { gate: { select: { code: true, nameEn: true } }, ticket: { select: { publicRef: true } }, scannedBy: { select: { fullName: true } } },
      }),
    ]);
    let granted = 0;
    let denied = 0;
    const deniedByReason: Record<string, number> = {};
    for (const g of groups) {
      if (g.result === 'VALID') granted += g._count._all;
      else {
        denied += g._count._all;
        const key = g.detail ?? g.reason;
        deniedByReason[key] = (deniedByReason[key] ?? 0) + g._count._all;
      }
    }
    return {
      scope: all ? 'ALL' : 'OWN', granted, denied, deniedByReason,
      recent: recent.map((r) => ({
        id: r.id, scannedAt: r.scannedAt, granted: r.result === 'VALID', result: r.detail ?? r.reason, gate: r.gate, ticketRef: r.ticket?.publicRef ?? null,
        ...(all ? { staff: r.scannedBy.fullName } : {}),
      })),
    };
  }

  private async gates(withUsage: boolean, start: Date, end: Date): Promise<NonNullable<DashboardView['gates']>> {
    const gates = await this.prisma.gate.findMany({ orderBy: { code: 'asc' } });
    const usage = withUsage
      ? await this.prisma.ticketScan.groupBy({ by: ['gateId'], where: { result: 'VALID', scannedAt: { gte: start, lt: end } }, _count: { _all: true } })
      : [];
    return gates.map((g) => ({
      id: g.id, code: g.code, nameEn: g.nameEn, nameAr: g.nameAr, isActive: g.isActive,
      ...(withUsage ? { entriesToday: usage.find((u) => u.gateId === g.id)?._count._all ?? 0 } : {}),
    }));
  }

  private async events(start: Date, end: Date): Promise<NonNullable<DashboardView['events']>> {
    const live = { status: { in: ['DRAFT', 'COMING_SOON', 'PUBLISHED'] as Array<'DRAFT' | 'COMING_SOON' | 'PUBLISHED'> } };
    const [today, upcoming] = await Promise.all([
      this.prisma.event.findMany({ where: { ...live, startsAt: { gte: start, lt: end } }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], include: { venue: true } }),
      this.prisma.event.findMany({ where: { ...live, startsAt: { gte: end } }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], take: 6, include: { venue: true } }),
    ]);
    const shape = (e: (typeof today)[number]): DashboardEvent => ({
      id: e.id, titleEn: e.titleEn, titleAr: e.titleAr, status: e.status, ...describeEventTimes(e.startsAt, e.endsAt), venue: e.venue?.nameEn ?? e.locationNameEn ?? null,
    });
    return { today: today.map(shape), upcoming: upcoming.map(shape) };
  }

  /** The latest changes made by staff and by the system (sign-in noise left out). Who and what, never the values. */
  private async activity(): Promise<NonNullable<DashboardView['activity']>> {
    const rows = await this.prisma.auditLog.findMany({
      where: { NOT: { action: { startsWith: 'auth.' } } }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 12, include: { user: { select: { fullName: true } } },
    });
    return rows.map((r) => ({ id: r.id, at: r.createdAt, action: r.action, entity: r.entity, actor: r.user?.fullName ?? null }));
  }
}
