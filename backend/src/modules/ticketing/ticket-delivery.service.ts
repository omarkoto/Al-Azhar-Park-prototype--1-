import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Notification, Prisma } from '@prisma/client';
import { Clock } from '../../common/clock';
import { AppException } from '../../common/errors/app-exception';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, RequestContext } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { TokenService } from '../auth/token.service';
import { EmailProvider } from '../email/email-provider';
import { buildConfirmationEmail } from './confirmation-email';
import { dateToIso } from './rules/calendar';

export const CONFIRMATION_TEMPLATE = 'order_confirmation';
/** After this many failed attempts a message stays failed until someone resends it from the portal. */
export const MAX_EMAIL_ATTEMPTS = 5;
const RETRY_BASE_MINUTES = 2;
const ACCESS_LINK_MIN_DAYS = 1;
const ACCESS_LINK_AFTER_VISIT_DAYS = 8;

/** One line for the portal: what happened to a message, without anything private. */
export interface EmailStatusView {
  id: string;
  template: string;
  recipient: string;
  status: Notification['status'];
  attempts: number;
  lastError: string | null;
  sentAt: Date | null;
  createdAt: Date;
  /** failed, will be tried again automatically at this time */
  nextAttemptAt: Date | null;
}

/** Error text that is safe to store and show: no addresses with credentials, no long dumps. */
export function safeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s]*/gi, '[url]').replace(/\s+/g, ' ').slice(0, 300);
}

/**
 * Ticket e-mails, delivered through an outbox (the `notifications` table):
 *
 *  - the confirmation is queued once per order (a unique key), so repeating the payment confirmation cannot queue a
 *    second one;
 *  - sending is attempted straight away, but a failure only marks the message failed and schedules a retry: it can
 *    never undo the payment or the tickets;
 *  - each attempt is claimed with a conditional update, so two workers cannot send the same attempt;
 *  - the outbox row holds no secret. The private link in the e-mail carries a fresh access key created for that
 *    attempt (only its hash is stored), which is why a retry or a resend simply makes a new link.
 *
 * A message can be delivered twice only if the process dies after the mail service accepted it and before the row
 * was marked sent; the next retry would then send it again (at-least-once delivery).
 */
@Injectable()
export class TicketDeliveryService {
  private readonly log = new Logger('TicketDelivery');

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailProvider,
    private readonly tokens: TokenService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /** Queues the confirmation of a paid order (once) and tries to send it. Never throws. */
  async queueConfirmation(orderId: string): Promise<void> {
    try {
      const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { customer: true } });
      const to = order?.customer?.email;
      if (!order || !to) return;
      let row: Notification;
      try {
        row = await this.prisma.notification.create({
          data: {
            channel: 'EMAIL', template: CONFIRMATION_TEMPLATE, recipient: to, relatedOrderId: orderId, dedupeKey: `${CONFIRMATION_TEMPLATE}:${orderId}`,
            payload: { orderNumber: order.orderNumber, locale: order.locale },
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return; // already queued
        throw error;
      }
      await this.attempt(row.id);
    } catch (error) {
      this.log.error(`could not queue the confirmation for order ${orderId}: ${safeError(error)}`);
    }
  }

  /** Staff: send the confirmation again, on purpose (a new outbox message, so the first one stays on record). */
  async resend(orderId: string, actor: AuthenticatedUser, ctx: RequestContext): Promise<EmailStatusView> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { customer: true } });
    if (!order) throw new AppException('ORDER_NOT_FOUND', 'Order not found.', 404);
    if (order.status !== 'PAID') throw new AppException('ORDER_NOT_PAID', 'Tickets can only be e-mailed for a paid order.', 409);
    const to = order.customer?.email;
    if (!to) throw new AppException('NO_RECIPIENT', 'This order has no e-mail address.', 409);
    const row = await this.prisma.notification.create({
      data: {
        channel: 'EMAIL', template: CONFIRMATION_TEMPLATE, recipient: to, relatedOrderId: orderId, dedupeKey: `${CONFIRMATION_TEMPLATE}:${orderId}:resend:${randomUUID()}`,
        payload: { orderNumber: order.orderNumber, locale: order.locale },
      },
    });
    await this.audit.record({ userId: actor.id, action: 'order.email_resent', entity: 'order', entityId: orderId, newValue: { orderNumber: order.orderNumber, notificationId: row.id } }, ctx);
    await this.attempt(row.id);
    return this.view(await this.prisma.notification.findUniqueOrThrow({ where: { id: row.id } }));
  }

  /** The messages sent about an order, newest first (for the portal). */
  async forOrder(orderId: string): Promise<EmailStatusView[]> {
    const rows = await this.prisma.notification.findMany({ where: { relatedOrderId: orderId, channel: 'EMAIL' }, orderBy: { createdAt: 'desc' } });
    return rows.map((r) => this.view(r));
  }

  /** Retries every failed message whose time has come. Returns how many were attempted. */
  async retryDue(limit = 50): Promise<number> {
    const due = await this.prisma.notification.findMany({
      where: { channel: 'EMAIL', status: 'FAILED', attempts: { lt: MAX_EMAIL_ATTEMPTS }, nextAttemptAt: { lte: this.clock.now() } },
      orderBy: { nextAttemptAt: 'asc' }, take: limit, select: { id: true },
    });
    for (const { id } of due) await this.attempt(id);
    return due.length;
  }

  /** One send attempt. Safe to call twice at once: only one caller wins the claim. */
  async attempt(id: string): Promise<void> {
    const row = await this.prisma.notification.findUnique({ where: { id } });
    if (!row || row.status === 'SENT' || row.attempts >= MAX_EMAIL_ATTEMPTS) return;
    const claimed = await this.prisma.notification.updateMany({ where: { id, status: { in: ['PENDING', 'FAILED'] }, attempts: row.attempts }, data: { attempts: row.attempts + 1 } });
    if (claimed.count === 0) return;
    const attempts = row.attempts + 1;
    try {
      const message = await this.compose(row);
      await this.email.send(message);
      await this.prisma.notification.update({ where: { id }, data: { status: 'SENT', sentAt: this.clock.now(), lastError: null, nextAttemptAt: null } });
    } catch (error) {
      const terminal = attempts >= MAX_EMAIL_ATTEMPTS || error instanceof NotDeliverable;
      await this.prisma.notification.update({
        where: { id },
        data: {
          status: 'FAILED', lastError: safeError(error),
          nextAttemptAt: terminal ? null : new Date(this.clock.now().getTime() + RETRY_BASE_MINUTES * 2 ** (attempts - 1) * 60_000),
        },
      });
      this.log.warn(`e-mail ${id} (attempt ${attempts}) failed: ${safeError(error)}`);
    }
  }

  private async compose(row: Notification) {
    if (!row.relatedOrderId) throw new NotDeliverable('the message has no order');
    const order = await this.prisma.order.findUnique({ where: { id: row.relatedOrderId }, include: { customer: true, tickets: { select: { status: true } } } });
    if (!order) throw new NotDeliverable('the order no longer exists');
    // never send tickets for an order that is not paid (it may have been cancelled since the message was queued)
    if (order.status !== 'PAID') throw new NotDeliverable(`the order is ${order.status.toLowerCase()}, so its tickets are not sent`);
    const visit = dateToIso(order.visitDate);
    const key = this.tokens.newOpaqueToken();
    const floor = this.clock.now().getTime() + ACCESS_LINK_MIN_DAYS * 86_400_000;
    const expiresAt = new Date(Math.max(order.visitDate.getTime() + ACCESS_LINK_AFTER_VISIT_DAYS * 86_400_000, floor));
    await this.prisma.orderAccessToken.create({ data: { orderId: order.id, tokenHash: this.tokens.hashOpaqueToken(key), expiresAt } });
    return buildConfirmationEmail(row.recipient, {
      locale: order.locale === 'ar' ? 'ar' : 'en', customerName: order.customer?.fullName ?? '', orderNumber: order.orderNumber, visitDate: visit,
      totalMinor: order.totalMinor, currency: order.currency, ticketCount: order.tickets.filter((t) => t.status === 'VALID').length,
      link: `${this.config.publicSiteUrl}/orders/${order.orderNumber}#k=${key}`,
    });
  }

  private view(r: Notification): EmailStatusView {
    return { id: r.id, template: r.template, recipient: r.recipient, status: r.status, attempts: r.attempts, lastError: r.lastError, sentAt: r.sentAt, createdAt: r.createdAt, nextAttemptAt: r.nextAttemptAt };
  }
}

/** A message that can never be sent (not a temporary problem), so it is not retried. */
class NotDeliverable extends Error {}
