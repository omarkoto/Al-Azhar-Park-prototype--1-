import { Injectable } from '@nestjs/common';
import { Payment, Prisma } from '@prisma/client';
import { Clock } from '../../common/clock';
import { AppException } from '../../common/errors/app-exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, RequestContext } from '../audit/audit.service';
import { OrderLifecycleService } from '../ticketing/order-lifecycle.service';
import { PaymentProvider } from './payment-provider';

export interface PaymentView {
  status: Payment['status'];
  provider: string;
  /** the id a payment page or provider uses to report back; only given while a payment is waiting */
  providerTxnId: string | null;
  /** development stand-in: the buttons "pay" / "fail" are shown */
  isMock: boolean;
  amountMinor: number;
  currency: string;
}

export interface ConfirmInput {
  provider: string;
  providerTxnId: string;
  outcome: 'SUCCESS' | 'FAILURE';
  /** what the provider says it took. A real provider's webhook MUST pass it. Omitted only by the development stand-in. */
  amountMinor?: number;
  currency?: string;
  /** the order the provider says this payment is for, when it reports one */
  orderNumber?: string;
}

export type ConfirmResult = { result: 'PAID' | 'ALREADY_PAID' | 'FAILED'; orderNumber: string };

export const paymentView = (p: Payment, isMock: boolean): PaymentView => ({
  status: p.status, provider: p.provider, isMock, amountMinor: p.amountMinor, currency: p.currency,
  providerTxnId: p.status === 'PENDING' ? p.providerTxnId : null,
});

class Concurrent extends Error {}
class NotPayable extends Error {}

/**
 * Starting and confirming online payments. The provider (mock today, Paymob later) only ever reports back
 * through confirm(), which never trusts the report blindly:
 *   - the payment must exist, and belong to the order the provider names;
 *   - the amount and currency must equal what the order costs; a mismatch leaves everything unpaid;
 *   - the order must still be waiting for payment and not expired;
 *   - a repeated confirmation of an already-paid payment changes nothing and succeeds;
 *   - a failed, cancelled or expired payment can never become paid.
 * Payment amounts are written once (a database trigger refuses to change them), so a payment can only ever be
 * for the exact total computed by the server when the order was created.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: PaymentProvider,
    private readonly audit: AuditService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly clock: Clock,
  ) {}

  get providerCode(): string {
    return this.provider.code;
  }

  get isMock(): boolean {
    return this.provider.developmentOnly;
  }

  /** Online payment can only be offered when a provider is configured. */
  get isAvailable(): boolean {
    return this.provider.code !== 'NONE';
  }

  assertAvailable(): void {
    if (!this.isAvailable) throw new AppException('PAYMENT_NOT_AVAILABLE', 'Online payment is not available yet.', 503);
  }

  /** Starts a payment attempt for an unpaid order, for exactly the order's total. */
  async start(order: { id: string; orderNumber: string; totalMinor: number; currency: string }, db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<PaymentView> {
    this.assertAvailable();
    const charge = await this.provider.createCharge({ orderNumber: order.orderNumber, amountMinor: order.totalMinor, currency: order.currency, description: `Al-Azhar Park tickets ${order.orderNumber}` });
    const payment = await db.payment.create({
      data: { orderId: order.id, provider: this.provider.code, method: 'ONLINE', providerTxnId: charge.providerTxnId, amountMinor: order.totalMinor, currency: order.currency, status: 'PENDING' },
    });
    return paymentView(payment, this.isMock);
  }

  /** The payment to show for an unpaid order: the one waiting, or a new attempt after a failed one. */
  async startOrReuse(orderId: string): Promise<PaymentView> {
    this.assertAvailable();
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { payments: { orderBy: { createdAt: 'desc' } } } });
    if (!order) throw new AppException('ORDER_NOT_FOUND', 'Order not found.', 404);
    if (await this.lifecycle.expireIfDue(order.id)) throw new AppException('ORDER_EXPIRED', 'This order has expired. Please start a new order.', 409);
    if (order.status !== 'PENDING_PAYMENT') throw new AppException('ORDER_NOT_PAYABLE', `This order is ${order.status.toLowerCase().replace('_', ' ')} and cannot be paid.`, 409);
    const waiting = order.payments.find((p) => p.status === 'PENDING');
    if (waiting) return paymentView(waiting, this.isMock);
    return this.start(order);
  }

  async confirm(input: ConfirmInput, ctx: RequestContext = {}): Promise<ConfirmResult> {
    const payment = await this.prisma.payment.findUnique({
      where: { provider_providerTxnId: { provider: input.provider, providerTxnId: input.providerTxnId } },
      include: { order: true },
    });
    if (!payment) throw new AppException('PAYMENT_NOT_FOUND', 'Payment not found.', 404);
    const { order } = payment;
    const reject = async (code: string, message: string): Promise<never> => {
      await this.audit.record(
        {
          action: 'payment.rejected', entity: 'payment', entityId: payment.id,
          newValue: { code, orderNumber: order.orderNumber, reportedOrder: input.orderNumber ?? null, reportedAmountMinor: input.amountMinor ?? null, expectedAmountMinor: payment.amountMinor },
        },
        ctx,
      );
      throw new AppException(code, message, 409);
    };

    if (input.orderNumber !== undefined && input.orderNumber !== order.orderNumber) {
      return reject('ORDER_MISMATCH', 'This payment does not belong to that order.');
    }

    if (input.outcome === 'FAILURE') {
      const failed = await this.prisma.payment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: 'FAILED' } });
      if (failed.count === 0) {
        const now = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
        if (now.status === 'FAILED') return { result: 'FAILED', orderNumber: order.orderNumber };
        return reject('PAYMENT_NOT_PENDING', `This payment is already ${now.status.toLowerCase()}.`);
      }
      await this.audit.record({ action: 'payment.failed', entity: 'payment', entityId: payment.id, newValue: { orderNumber: order.orderNumber } }, ctx);
      return { result: 'FAILED', orderNumber: order.orderNumber };
    }

    if ((input.amountMinor !== undefined && input.amountMinor !== payment.amountMinor) || (input.currency !== undefined && input.currency !== payment.currency)) {
      return reject('AMOUNT_MISMATCH', 'The amount paid does not match the order total.');
    }
    if (payment.status === 'PAID') return { result: 'ALREADY_PAID', orderNumber: order.orderNumber };

    await this.lifecycle.expireIfDue(order.id);
    const fresh = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id }, include: { order: true } });
    if (fresh.status === 'PAID') return { result: 'ALREADY_PAID', orderNumber: order.orderNumber };
    if (fresh.order.status === 'EXPIRED') return reject('ORDER_EXPIRED', 'This order has expired, so the payment cannot be applied.');
    if (fresh.status !== 'PENDING') return reject('PAYMENT_NOT_PENDING', `This payment is already ${fresh.status.toLowerCase()}.`);

    const now = this.clock.now();
    try {
      await this.prisma.$transaction(async (tx) => {
        const paid = await tx.payment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: 'PAID', paidAt: now } });
        if (paid.count === 0) throw new Concurrent();
        const moved = await tx.order.updateMany({ where: { id: order.id, status: 'PENDING_PAYMENT', expiresAt: { gt: now } }, data: { status: 'PAID', paidAt: now } });
        if (moved.count === 0) throw new NotPayable();
        await tx.ticket.updateMany({ where: { orderId: order.id, status: 'PENDING' }, data: { status: 'VALID', issuedAt: now } });
        await this.audit.record({ action: 'payment.confirmed', entity: 'payment', entityId: payment.id, newValue: { orderNumber: order.orderNumber, amountMinor: payment.amountMinor } }, ctx, tx);
      });
    } catch (error) {
      if (error instanceof Concurrent) {
        // another confirmation won the race; if it paid, this one is simply the repeat
        const settled = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
        if (settled.status === 'PAID') return { result: 'ALREADY_PAID', orderNumber: order.orderNumber };
        return reject('PAYMENT_NOT_PENDING', `This payment is already ${settled.status.toLowerCase()}.`);
      }
      if (error instanceof NotPayable) return reject('ORDER_NOT_PAYABLE', 'This order can no longer be paid.');
      throw error;
    }
    return { result: 'PAID', orderNumber: order.orderNumber };
  }
}
