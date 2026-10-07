import { Injectable } from '@nestjs/common';
import { Prisma, TicketAudience, TicketPrice, TicketType } from '@prisma/client';
import { Clock } from '../../common/clock';
import { AppException } from '../../common/errors/app-exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, RequestContext } from '../audit/audit.service';
import { PaymentsService, PaymentView } from '../payments/payments.service';
import { TokenService } from '../auth/token.service';
import { BookingConfig, BookingConfigService } from './booking-config.service';
import { CreateOrderDto, QuoteDto } from './ticketing.dto';
import { addDays, dateToIso, minutesToHhmm, parkDateOf } from './rules/calendar';
import { CAPACITY_COUNTED_STATUSES, checkCapacity } from './rules/capacity';
import { resolveHours } from './rules/opening-hours';
import { dayTypeOf, PriceRow, selectPrice } from './rules/price-selection';
import { formatOrderNumber, generateTicketRef } from './rules/references';
import { evaluateSale } from './rules/sales-window';
import { MIN_TICKETED_AGE } from './rules/visitors';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrderView, orderView, ORDER_INCLUDE } from './order-view';

type Db = Prisma.TransactionClient | PrismaService;

const SALE_ERRORS = {
  PAST_DATE: ['DATE_IN_THE_PAST', 'That date has already passed. Please choose today or a later date.'],
  TOO_FAR_AHEAD: ['DATE_TOO_FAR_AHEAD', 'That date is too far ahead to book yet.'],
  PARK_CLOSED: ['PARK_CLOSED', 'The park is closed on that date. Please choose another date.'],
  SALES_CLOSED_FOR_TODAY: ['SALES_CLOSED_FOR_TODAY', 'Online tickets for today are no longer on sale. Please choose another date.'],
} as const;

export const priceRow = (p: TicketPrice): PriceRow => ({
  id: p.id, ticketTypeId: p.ticketTypeId, audienceId: p.audienceId, kind: p.kind, amountMinor: p.amountMinor, currency: p.currency, priority: p.priority,
  dowMask: p.dowMask, specialDates: p.specialDates.map(dateToIso), validFrom: dateToIso(p.validFrom), validTo: p.validTo ? dateToIso(p.validTo) : null,
  isActive: p.isActive, createdAt: p.createdAt.getTime(),
});

export interface PricedLine {
  type: TicketType;
  priceId: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
}

export interface Selection {
  visitDate: string;
  audience: TicketAudience;
  lines: PricedLine[];
  totalTickets: number;
  totalMinor: number;
  currency: string;
}

export interface QuoteView {
  visitDate: string;
  dayType: 'WEEKDAY' | 'WEEKEND';
  audience: { code: string; nameEn: string; nameAr: string };
  currency: string;
  lines: Array<{ ticketType: string; nameEn: string; nameAr: string; unitPriceMinor: number; quantity: number; lineTotalMinor: number }>;
  totalTickets: number;
  totalMinor: number;
  expiresInMinutes: number;
}

export interface CreatedOrder {
  order: OrderView;
  /** shown once: the customer's key to see this order again */
  accessToken: string;
  payment: PaymentView;
}

/**
 * Prices and creates online orders. Every figure comes from the database: the request only names a date, an
 * audience and quantities per ticket type; prices, totals and the rules about dates are decided here.
 */
@Injectable()
export class PurchaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: BookingConfigService,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
    private readonly tokens: TokenService,
    private readonly clock: Clock,
    private readonly lifecycle: OrderLifecycleService,
  ) {}

  // ───────────────────────────── catalog ─────────────────────────────

  /** What the booking page needs: who can buy, which tickets, the rules, and (for a date) hours, availability and prices. */
  async catalog(date?: string) {
    const cfg = await this.config.load();
    const now = this.clock.now();
    const today = parkDateOf(now);
    const [audiences, types, prices] = await Promise.all([
      this.prisma.ticketAudience.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.ticketType.findMany({ where: { isActive: true, deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.ticketPrice.findMany({ where: { isActive: true } }),
    ]);

    let day: unknown = null;
    if (date) {
      const sale = evaluateSale({ now, visitDate: date, weekly: cfg.weekly, special: cfg.special, policy: cfg.policy });
      const hours = resolveHours(date, cfg.weekly, cfg.special);
      const rows = prices.map(priceRow);
      day = {
        date,
        dayType: dayTypeOf(date),
        opens: hours.opensMinutes === null ? null : minutesToHhmm(hours.opensMinutes),
        closes: hours.closesMinutes === null ? null : minutesToHhmm(hours.closesMinutes),
        sale: sale.allowed
          ? { allowed: true, salesCloseAt: sale.salesCloseAtMinutes === null ? null : minutesToHhmm(sale.salesCloseAtMinutes) }
          : { allowed: false, reason: SALE_ERRORS[sale.reason][0] },
        prices: sale.allowed
          ? audiences.flatMap((a) =>
              types.flatMap((t) => {
                const p = selectPrice(rows, { ticketTypeId: t.id, audienceId: a.id, date });
                return p ? [{ audience: a.code, ticketType: t.code, amountMinor: p.amountMinor, currency: p.currency }] : [];
              }),
            )
          : [],
      };
    }

    // what a visitor pays on the next weekday and the next weekend day, for the public price list
    const nextOfKind = (kind: 'WEEKDAY' | 'WEEKEND') => {
      for (let i = 0; i < 7; i += 1) if (dayTypeOf(addDays(today, i)) === kind) return addDays(today, i);
      return today;
    };
    const listRows = prices.map(priceRow);
    const weekday = nextOfKind('WEEKDAY');
    const weekend = nextOfKind('WEEKEND');
    const priceList = audiences.flatMap((a) =>
      types.map((t) => ({
        audience: a.code,
        ticketType: t.code,
        weekdayMinor: selectPrice(listRows, { ticketTypeId: t.id, audienceId: a.id, date: weekday })?.amountMinor ?? null,
        weekendMinor: selectPrice(listRows, { ticketTypeId: t.id, audienceId: a.id, date: weekend })?.amountMinor ?? null,
      })),
    );

    return {
      currency: 'EGP',
      today,
      lastBookableDate: addDays(today, cfg.policy.maxAdvanceDays),
      freeUnderAge: MIN_TICKETED_AGE,
      policy: {
        maxAdvanceDays: cfg.policy.maxAdvanceDays,
        sameDayCutoffMinutesBeforeClose: cfg.policy.sameDayCutoffMinutesBeforeClose,
        maxTicketsPerOrder: cfg.maxTicketsPerOrder,
        pendingExpiryMinutes: cfg.pendingExpiryMinutes,
      },
      onlinePayment: this.payments.isAvailable,
      audiences: audiences.map((a) => ({ code: a.code, nameEn: a.nameEn, nameAr: a.nameAr, descriptionEn: a.descriptionEn, descriptionAr: a.descriptionAr })),
      ticketTypes: types.map((t) => ({ code: t.code, nameEn: t.nameEn, nameAr: t.nameAr, descriptionEn: t.descriptionEn, descriptionAr: t.descriptionAr, minAge: t.minAge, maxAge: t.maxAge })),
      priceList,
      day,
    };
  }

  // ───────────────────────────── pricing ─────────────────────────────

  /**
   * Validates a request and prices it from the database. Throws a clear error for: a date that cannot be booked,
   * an unknown or switched-off audience or ticket type, too many tickets, or a ticket with no price configured.
   */
  async price(db: Db, cfg: BookingConfig, input: { visitDate: string; audience: string; items: Array<{ ticketType: string; quantity: number }> }): Promise<Selection> {
    const now = this.clock.now();
    const sale = evaluateSale({ now, visitDate: input.visitDate, weekly: cfg.weekly, special: cfg.special, policy: cfg.policy });
    if (!sale.allowed) {
      const [code, message] = SALE_ERRORS[sale.reason];
      throw new AppException(code, message, 422);
    }

    const audience = await db.ticketAudience.findUnique({ where: { code: input.audience } });
    if (!audience || !audience.isActive) throw new AppException('INVALID_AUDIENCE', 'Choose Egyptian / resident or non-resident visitor.', 422);

    const totalTickets = input.items.reduce((n, i) => n + i.quantity, 0);
    if (totalTickets > cfg.maxTicketsPerOrder) {
      throw new AppException('TOO_MANY_TICKETS', `An order can hold at most ${cfg.maxTicketsPerOrder} tickets. Please reduce the quantities.`, 422, { max: cfg.maxTicketsPerOrder });
    }

    const types = await db.ticketType.findMany({ where: { code: { in: input.items.map((i) => i.ticketType) }, isActive: true, deletedAt: null } });
    const prices = (await db.ticketPrice.findMany({ where: { isActive: true, audienceId: audience.id, ticketTypeId: { in: types.map((t) => t.id) } } })).map(priceRow);

    const lines: PricedLine[] = [];
    for (const item of input.items) {
      const type = types.find((t) => t.code === item.ticketType);
      if (!type) throw new AppException('INVALID_TICKET_TYPE', `"${item.ticketType}" is not a ticket you can buy.`, 422, { ticketType: item.ticketType });
      const chosen = selectPrice(prices, { ticketTypeId: type.id, audienceId: audience.id, date: input.visitDate });
      if (!chosen) throw new AppException('PRICE_NOT_AVAILABLE', `No price is set for ${type.nameEn} on that date, so it cannot be booked.`, 422, { ticketType: type.code });
      lines.push({ type, priceId: chosen.id, quantity: item.quantity, unitPriceMinor: chosen.amountMinor, lineTotalMinor: chosen.amountMinor * item.quantity });
    }
    lines.sort((a, b) => a.type.sortOrder - b.type.sortOrder || a.type.code.localeCompare(b.type.code));
    return { visitDate: input.visitDate, audience, lines, totalTickets, totalMinor: lines.reduce((n, l) => n + l.lineTotalMinor, 0), currency: 'EGP' };
  }

  async quote(dto: QuoteDto): Promise<QuoteView> {
    const cfg = await this.config.load();
    const s = await this.price(this.prisma, cfg, dto);
    return {
      visitDate: s.visitDate, dayType: dayTypeOf(s.visitDate), audience: { code: s.audience.code, nameEn: s.audience.nameEn, nameAr: s.audience.nameAr }, currency: s.currency,
      lines: s.lines.map((l) => ({ ticketType: l.type.code, nameEn: l.type.nameEn, nameAr: l.type.nameAr, unitPriceMinor: l.unitPriceMinor, quantity: l.quantity, lineTotalMinor: l.lineTotalMinor })),
      totalTickets: s.totalTickets, totalMinor: s.totalMinor, expiresInMinutes: cfg.pendingExpiryMinutes,
    };
  }

  // ───────────────────────────── ordering ─────────────────────────────

  async createOrder(dto: CreateOrderDto, idempotencyKey: string | undefined, ctx: RequestContext): Promise<CreatedOrder & { replayed: boolean }> {
    this.payments.assertAvailable();
    if (idempotencyKey !== undefined) {
      const replay = await this.replay(idempotencyKey, dto);
      if (replay) return replay;
    }

    const cfg = await this.config.load();
    let created: { orderId: string; accessToken: string };
    try {
      created = await this.prisma.$transaction((tx) => this.createInTransaction(tx, cfg, dto, idempotencyKey), { timeout: 20_000 });
    } catch (error) {
      // the same Idempotency-Key arrived twice at the same moment: the other request created the order
      if (idempotencyKey !== undefined && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const replay = await this.replay(idempotencyKey, dto);
        if (replay) return replay;
      }
      throw error;
    }

    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: created.orderId }, include: ORDER_INCLUDE });
    const payment = await this.payments.start(order);
    await this.audit.record(
      {
        action: 'order.created', entity: 'order', entityId: order.id,
        newValue: { orderNumber: order.orderNumber, channel: 'ONLINE', visitDate: dateToIso(order.visitDate), totalMinor: order.totalMinor, tickets: order.items.map((i) => ({ type: i.typeNameEn, audience: i.audienceNameEn, quantity: i.quantity, unitPriceMinor: i.unitPriceMinor })) },
      },
      ctx,
    );
    const view = orderView(await this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_INCLUDE }), this.payments.isMock);
    return { order: view, accessToken: created.accessToken, payment, replayed: false };
  }

  private async createInTransaction(tx: Prisma.TransactionClient, cfg: BookingConfig, dto: CreateOrderDto, idempotencyKey: string | undefined): Promise<{ orderId: string; accessToken: string }> {
    const now = this.clock.now();
    const selection = await this.price(tx, cfg, dto);

    if (cfg.capacityLimit !== null) {
      // one buyer at a time per day while a limit is on, so two orders cannot both take the last places
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`capacity:${dto.visitDate}`}, 0))`;
      const already = await tx.ticket.count({ where: { visitDate: new Date(`${dto.visitDate}T00:00:00Z`), status: { in: [...CAPACITY_COUNTED_STATUSES] } } });
      const decision = checkCapacity({ limit: cfg.capacityLimit, alreadyTicketed: already, requested: selection.totalTickets });
      if (!decision.ok) {
        throw new AppException('SOLD_OUT', decision.remaining === 0 ? 'Tickets for that date are sold out.' : `Only ${decision.remaining} tickets are left for that date.`, 409, { remaining: decision.remaining });
      }
    }

    const customer = await tx.customer.create({
      data: { fullName: dto.customer.fullName, email: dto.customer.email, phone: dto.customer.phone, consentedAt: now, privacyNoticeVersion: cfg.privacyNoticeVersion },
    });

    const year = Number(parkDateOf(now).slice(0, 4));
    const rows = await tx.$queryRaw<Array<{ last_value: number }>>`
      INSERT INTO reference_counters (kind, year, last_value) VALUES ('ORDER', ${year}, 1)
      ON CONFLICT (kind, year) DO UPDATE SET last_value = reference_counters.last_value + 1
      RETURNING last_value`;
    const orderNumber = formatOrderNumber(year, Number(rows[0].last_value));

    const order = await tx.order.create({
      data: {
        orderNumber, customerId: customer.id, channel: 'ONLINE', status: 'PENDING_PAYMENT', visitDate: new Date(`${dto.visitDate}T00:00:00Z`),
        subtotalMinor: selection.totalMinor, discountMinor: 0, totalMinor: selection.totalMinor, currency: selection.currency,
        idempotencyKey: idempotencyKey ?? null, expiresAt: new Date(now.getTime() + cfg.pendingExpiryMinutes * 60_000),
      },
    });

    for (const line of selection.lines) {
      const item = await tx.orderItem.create({
        data: {
          orderId: order.id, ticketTypeId: line.type.id, audienceId: selection.audience.id, ticketPriceId: line.priceId,
          typeNameEn: line.type.nameEn, typeNameAr: line.type.nameAr, audienceNameEn: selection.audience.nameEn, audienceNameAr: selection.audience.nameAr,
          unitPriceMinor: line.unitPriceMinor, currency: selection.currency, quantity: line.quantity, lineTotalMinor: line.lineTotalMinor,
        },
      });
      await tx.ticket.createMany({
        data: Array.from({ length: line.quantity }, () => ({
          publicRef: generateTicketRef(), orderId: order.id, orderItemId: item.id, customerId: customer.id, ticketTypeId: line.type.id, audienceId: selection.audience.id,
          visitDate: order.visitDate, pricePaidMinor: line.unitPriceMinor, currency: selection.currency, holderName: null, status: 'PENDING' as const,
        })),
      });
    }

    const accessToken = this.tokens.newOpaqueToken();
    await tx.orderAccessToken.create({
      data: { orderId: order.id, tokenHash: this.tokens.hashOpaqueToken(accessToken), expiresAt: new Date(new Date(`${dto.visitDate}T00:00:00Z`).getTime() + 8 * 86_400_000) },
    });
    return { orderId: order.id, accessToken };
  }

  /** The same Idempotency-Key with the same request returns the same order; with a different request it is refused. */
  private async replay(key: string, dto: CreateOrderDto): Promise<(CreatedOrder & { replayed: boolean }) | null> {
    const existing = await this.prisma.order.findUnique({ where: { idempotencyKey: key }, include: ORDER_INCLUDE });
    if (!existing) return null;
    const wanted = [...dto.items].sort((a, b) => a.ticketType.localeCompare(b.ticketType)).map((i) => `${i.ticketType}:${i.quantity}`).join(',');
    const typeCodes = await this.prisma.ticketType.findMany({ where: { id: { in: existing.items.map((i) => i.ticketTypeId) } }, select: { id: true, code: true } });
    const audience = existing.items[0] ? await this.prisma.ticketAudience.findUnique({ where: { id: existing.items[0].audienceId } }) : null;
    const hadItems = existing.items.map((i) => `${typeCodes.find((t) => t.id === i.ticketTypeId)?.code}:${i.quantity}`).sort().join(',');
    const same = dateToIso(existing.visitDate) === dto.visitDate && audience?.code === dto.audience && hadItems === wanted.split(',').sort().join(',') && existing.customer?.email?.toLowerCase() === dto.customer.email;
    if (!same) throw new AppException('IDEMPOTENCY_KEY_REUSED', 'That Idempotency-Key was already used for a different order.', 409);

    await this.lifecycle.expireIfDue(existing.id);
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: existing.id }, include: ORDER_INCLUDE });
    const accessToken = this.tokens.newOpaqueToken();
    await this.prisma.orderAccessToken.create({
      data: { orderId: order.id, tokenHash: this.tokens.hashOpaqueToken(accessToken), expiresAt: new Date(order.visitDate.getTime() + 8 * 86_400_000) },
    });
    const waiting = order.payments.find((p) => p.status === 'PENDING') ?? order.payments[0];
    const payment: PaymentView = waiting
      ? { status: waiting.status, provider: waiting.provider, isMock: this.payments.isMock, amountMinor: waiting.amountMinor, currency: waiting.currency, providerTxnId: waiting.status === 'PENDING' ? waiting.providerTxnId : null }
      : { status: 'PENDING', provider: this.payments.providerCode, isMock: this.payments.isMock, amountMinor: order.totalMinor, currency: order.currency, providerTxnId: null };
    return { order: orderView(order, this.payments.isMock), accessToken, payment, replayed: true };
  }
}
