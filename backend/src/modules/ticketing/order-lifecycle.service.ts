import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Clock } from '../../common/clock';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Unpaid online orders expire. Expiring means: the order becomes EXPIRED, its tickets (never valid) become
 * EXPIRED, and any payment attempt still waiting is cancelled. Capacity frees up again because only
 * PENDING / VALID / USED tickets are counted.
 *
 * Every transition is a conditional UPDATE ("only if still pending"), so expiring twice, or racing with a
 * payment confirmation, can never move an order twice.
 */
@Injectable()
export class OrderLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /** Expires ONE order if it is unpaid and past its deadline. Returns true when it was expired by this call. */
  async expireIfDue(orderId: string, db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<boolean> {
    const now = this.clock.now();
    const run = async (tx: Prisma.TransactionClient): Promise<boolean> => {
      const moved = await tx.order.updateMany({ where: { id: orderId, status: 'PENDING_PAYMENT', expiresAt: { lte: now } }, data: { status: 'EXPIRED' } });
      if (moved.count === 0) return false;
      await tx.ticket.updateMany({ where: { orderId, status: 'PENDING' }, data: { status: 'EXPIRED' } });
      await tx.payment.updateMany({ where: { orderId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
      await this.audit.record({ action: 'order.expired', entity: 'order', entityId: orderId, newValue: { status: 'EXPIRED' } }, {}, tx);
      return true;
    };
    if ('$transaction' in db) return this.prisma.$transaction(run);
    return run(db);
  }

  /** Expires every unpaid order past its deadline (the background sweep). Returns how many. */
  async expireAllDue(limit = 200): Promise<number> {
    const due = await this.prisma.order.findMany({ where: { status: 'PENDING_PAYMENT', expiresAt: { lte: this.clock.now() } }, select: { id: true }, take: limit, orderBy: { expiresAt: 'asc' } });
    let n = 0;
    for (const { id } of due) if (await this.expireIfDue(id)) n += 1;
    return n;
  }
}
