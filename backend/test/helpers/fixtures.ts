import { randomBytes } from 'node:crypto';
import { PrismaClient, TicketStatus } from '@prisma/client';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Test-only stand-in for the real reference generators (built in Phase 7). */
export function randomTicketRef(length = 10): string {
  const bytes = randomBytes(length);
  return `TKT-${Array.from(bytes, (b) => CROCKFORD[b % 32]).join('')}`;
}

export function orderNumber(seq: number, year = 2026): string {
  return `AZP-${year}-${String(seq).padStart(6, '0')}`;
}

/** The park's "today": Africa/Cairo, computed by the database exactly as the scan rule does. */
export async function cairoToday(prisma: PrismaClient): Promise<Date> {
  const rows = await prisma.$queryRaw<Array<{ d: Date }>>`SELECT azharpark_today() AS d`;
  return rows[0].d;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export interface PaidOrderOptions {
  seq?: number;
  visitDate: Date;
  quantity?: number;
  unitPriceMinor?: number;
  ticketStatus?: TicketStatus;
  usedAt?: Date | null;
}

/** A complete paid order: customer → order → item (price snapshot) → payment → N tickets. */
export async function createPaidOrder(prisma: PrismaClient, opts: PaidOrderOptions) {
  const quantity = opts.quantity ?? 1;
  const unitPriceMinor = opts.unitPriceMinor ?? 5000;
  const type = await prisma.ticketType.findUniqueOrThrow({ where: { code: 'ADULT' } });
  const audience = await prisma.ticketAudience.findUniqueOrThrow({ where: { code: 'RESIDENT' } });
  const price = await prisma.ticketPrice.findFirstOrThrow({ where: { ticketTypeId: type.id, audienceId: audience.id } });

  const customer = await prisma.customer.create({ data: { fullName: 'Test Customer', email: `c${opts.seq ?? 1}@example.test` } });
  const order = await prisma.order.create({
    data: {
      orderNumber: orderNumber(opts.seq ?? 1),
      customerId: customer.id,
      channel: 'ONLINE',
      status: 'PAID',
      visitDate: opts.visitDate,
      subtotalMinor: unitPriceMinor * quantity,
      totalMinor: unitPriceMinor * quantity,
      paidAt: new Date(),
    },
  });
  const item = await prisma.orderItem.create({
    data: {
      orderId: order.id,
      ticketTypeId: type.id,
      audienceId: audience.id,
      ticketPriceId: price.id,
      typeNameEn: type.nameEn,
      typeNameAr: type.nameAr,
      audienceNameEn: audience.nameEn,
      audienceNameAr: audience.nameAr,
      unitPriceMinor,
      quantity,
      lineTotalMinor: unitPriceMinor * quantity,
    },
  });
  await prisma.payment.create({
    data: { orderId: order.id, provider: 'MANUAL', method: 'CASH', amountMinor: unitPriceMinor * quantity, status: 'PAID', paidAt: new Date() },
  });

  const status = opts.ticketStatus ?? 'VALID';
  const tickets = [];
  for (let i = 0; i < quantity; i++) {
    tickets.push(
      await prisma.ticket.create({
        data: {
          publicRef: randomTicketRef(),
          orderId: order.id,
          orderItemId: item.id,
          customerId: customer.id,
          ticketTypeId: type.id,
          audienceId: audience.id,
          visitDate: opts.visitDate,
          pricePaidMinor: unitPriceMinor,
          status,
          issuedAt: new Date(),
          usedAt: status === 'USED' ? (opts.usedAt ?? new Date()) : null,
          cancelledAt: status === 'CANCELLED' ? new Date() : null,
          cancelReason: status === 'CANCELLED' ? 'Cancelled by an administrator (test)' : null,
        },
      }),
    );
  }
  return { customer, order, item, tickets, type, audience, price };
}

/** Postgres integrity-violation errors surface through Prisma with the server message; match on that. */
export async function expectDbError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  let error: unknown;
  try {
    await promise;
  } catch (e) {
    error = e;
  }
  if (!error) throw new Error(`Expected the database to reject this, but it succeeded (wanted ${pattern}).`);
  expect(String((error as Error).message)).toMatch(pattern);
}
