import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Clock } from '../../common/clock';
import { buildMeta, toSkipTake } from '../../common/dto/pagination';
import { AppException } from '../../common/errors/app-exception';
import { PageResult } from '../../common/http/envelope';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, RequestContext } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { TokenService } from '../auth/token.service';
import { PaymentsService, PaymentView } from '../payments/payments.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { ORDER_INCLUDE, OrderView, orderView } from './order-view';
import { dateToIso } from './rules/calendar';
import { ListOrdersQueryDto } from './ticketing.dto';

const NOT_FOUND = () => new AppException('ORDER_NOT_FOUND', 'Order not found.', 404);

/** Orders for the customer (with their access token) and for staff (portal). */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  // ───────────────────────────── customer ─────────────────────────────

  /**
   * One order for the person holding its access token. A wrong order number, a wrong, expired or revoked token
   * all look the same (404), so nobody can probe which order numbers exist.
   */
  async getForCustomer(orderNumber: string, token: string | undefined): Promise<OrderView> {
    const order = await this.authorise(orderNumber, token);
    await this.lifecycle.expireIfDue(order.id);
    return orderView(await this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_INCLUDE }), this.payments.isMock);
  }

  /** A new payment attempt for an unpaid order (after a failed one). */
  async payAgain(orderNumber: string, token: string | undefined): Promise<{ order: OrderView; payment: PaymentView }> {
    const order = await this.authorise(orderNumber, token);
    const payment = await this.payments.startOrReuse(order.id);
    return { order: orderView(await this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_INCLUDE }), this.payments.isMock), payment };
  }

  private async authorise(orderNumber: string, token: string | undefined) {
    if (!token || token.length < 20 || token.length > 200) throw NOT_FOUND();
    const row = await this.prisma.orderAccessToken.findUnique({ where: { tokenHash: this.tokens.hashOpaqueToken(token) }, include: { order: true } });
    const now = this.clock.now();
    if (!row || row.revokedAt || row.expiresAt <= now || row.order.orderNumber !== orderNumber) throw NOT_FOUND();
    await this.prisma.orderAccessToken.update({ where: { id: row.id }, data: { lastUsedAt: now } });
    return row.order;
  }

  // ───────────────────────────── staff ─────────────────────────────

  async list(query: ListOrdersQueryDto, actor: AuthenticatedUser): Promise<PageResult<Record<string, unknown>>> {
    const seeCustomer = actor.permissions.has('customers:read');
    const where: Prisma.OrderWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.visitDate ? { visitDate: new Date(`${query.visitDate}T00:00:00Z`) } : {}),
    };
    if (query.search) {
      const s = query.search;
      // customer details are searchable only by someone allowed to see them
      where.OR = [{ orderNumber: { contains: s, mode: 'insensitive' } }, ...(seeCustomer ? [{ customer: { OR: [{ fullName: { contains: s, mode: 'insensitive' as const } }, { email: { contains: s, mode: 'insensitive' as const } }, { phone: { contains: s } }] } }] : [])];
    }
    const [total, rows] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], ...toSkipTake(query),
        include: { items: true, payments: { orderBy: { createdAt: 'desc' }, take: 1 }, customer: seeCustomer },
      }),
    ]);
    return new PageResult(
      rows.map((o) => ({
        id: o.id, orderNumber: o.orderNumber, status: o.status, channel: o.channel, visitDate: dateToIso(o.visitDate), totalMinor: o.totalMinor, currency: o.currency,
        ticketCount: o.items.reduce((n, i) => n + i.quantity, 0), createdAt: o.createdAt, paidAt: o.paidAt, expiresAt: o.expiresAt,
        paymentStatus: actor.permissions.has('payments:read') ? (o.payments[0]?.status ?? null) : undefined,
        customer: seeCustomer && o.customer ? { fullName: o.customer.fullName, email: o.customer.email, phone: o.customer.phone } : undefined,
      })),
      buildMeta(query, total),
    );
  }

  async get(id: string, actor: AuthenticatedUser): Promise<Record<string, unknown>> {
    await this.lifecycle.expireIfDue(id).catch(() => false);
    const o = await this.prisma.order.findUnique({ where: { id }, include: { ...ORDER_INCLUDE, cancelledBy: { select: { fullName: true } } } });
    if (!o) throw NOT_FOUND();
    const seeCustomer = actor.permissions.has('customers:read');
    const seePayments = actor.permissions.has('payments:read');
    const seeTickets = actor.permissions.has('tickets:read');
    const items = new Map(o.items.map((i) => [i.id, i]));
    const tickets = o.tickets;
    return {
      id: o.id, orderNumber: o.orderNumber, status: o.status, channel: o.channel, visitDate: dateToIso(o.visitDate), currency: o.currency,
      subtotalMinor: o.subtotalMinor, discountMinor: o.discountMinor, totalMinor: o.totalMinor,
      createdAt: o.createdAt, expiresAt: o.expiresAt, paidAt: o.paidAt, cancelledAt: o.cancelledAt, cancelReason: o.cancelReason, cancelledBy: o.cancelledBy?.fullName ?? null,
      customer: seeCustomer && o.customer ? { fullName: o.customer.fullName, email: o.customer.email, phone: o.customer.phone, consentedAt: o.customer.consentedAt } : undefined,
      items: o.items.map((i) => ({
        id: i.id, typeNameEn: i.typeNameEn, typeNameAr: i.typeNameAr, audienceNameEn: i.audienceNameEn, audienceNameAr: i.audienceNameAr,
        unitPriceMinor: i.unitPriceMinor, quantity: i.quantity, lineTotalMinor: i.lineTotalMinor,
      })),
      ticketCounts: tickets.reduce<Record<string, number>>((acc, t) => ({ ...acc, [t.status]: (acc[t.status] ?? 0) + 1 }), {}),
      tickets: seeTickets ? tickets.map((t) => ({ ref: t.publicRef, status: t.status, typeNameEn: items.get(t.orderItemId)?.typeNameEn ?? '', pricePaidMinor: t.pricePaidMinor })) : undefined,
      payments: seePayments ? o.payments.map((p) => ({ id: p.id, provider: p.provider, method: p.method, status: p.status, amountMinor: p.amountMinor, currency: p.currency, paidAt: p.paidAt, createdAt: p.createdAt })) : undefined,
    };
  }

  /**
   * Cancels an order as an operational decision (for example the park closed unexpectedly). It is NOT a refund:
   * nothing is paid back through the system, and a reason is mandatory. Allowed for an unpaid or paid order that
   * has no used ticket; its tickets stop working.
   */
  async cancel(id: string, reason: string, actor: AuthenticatedUser, ctx: RequestContext): Promise<{ orderNumber: string; status: 'CANCELLED' }> {
    const now = this.clock.now();
    const result = await this.prisma.$transaction(async (tx) => {
      const before = await tx.order.findUnique({ where: { id }, include: { tickets: { select: { status: true } } } });
      if (!before) throw NOT_FOUND();
      if (before.status === 'CANCELLED') throw new AppException('ORDER_ALREADY_CANCELLED', 'This order is already cancelled.', 409);
      if (before.status === 'EXPIRED') throw new AppException('ORDER_NOT_CANCELLABLE', 'An expired order is already closed.', 409);
      if (before.tickets.some((t) => t.status === 'USED')) throw new AppException('ORDER_HAS_USED_TICKETS', 'A ticket of this order has already been used, so it cannot be cancelled.', 409);

      const moved = await tx.order.updateMany({
        where: { id, status: { in: ['PENDING_PAYMENT', 'PAID'] } },
        data: { status: 'CANCELLED', cancelledAt: now, cancelReason: reason, cancelledById: actor.id },
      });
      if (moved.count === 0) throw new AppException('ORDER_NOT_CANCELLABLE', 'This order can no longer be cancelled.', 409);
      await tx.ticket.updateMany({ where: { orderId: id, status: { in: ['PENDING', 'VALID'] } }, data: { status: 'CANCELLED', cancelledAt: now, cancelReason: reason } });
      await tx.payment.updateMany({ where: { orderId: id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
      await this.audit.record(
        { userId: actor.id, action: 'order.cancelled', entity: 'order', entityId: id, oldValue: { status: before.status }, newValue: { status: 'CANCELLED', reason, note: 'operational cancellation, not a refund' } },
        ctx,
        tx,
      );
      return { orderNumber: before.orderNumber, status: 'CANCELLED' as const };
    });
    return result;
  }
}
