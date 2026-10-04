import { PrismaClient, TicketStatus } from '@prisma/client';
import { addDays, cairoToday, createPaidOrder, expectDbError, orderNumber, randomTicketRef } from '../helpers/fixtures';
import { createTestPrisma, resetDatabase, seedAll } from '../helpers/db';

describe('data integrity rules (database level)', () => {
  const prisma: PrismaClient = createTestPrisma();

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedAll(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const staff = () => prisma.user.findUniqueOrThrow({ where: { email: 'staff@azharpark.test' } });

  describe('append-only history', () => {
    it('keeps audit log entries forever: no update, no delete', async () => {
      const entry = await prisma.auditLog.create({ data: { action: 'PRICE_CHANGED', entity: 'TicketPrice', entityId: 'x', newValue: { a: 1 } } });
      await expectDbError(prisma.auditLog.update({ where: { id: entry.id }, data: { action: 'TAMPERED' } }), /append-only/);
      await expectDbError(prisma.auditLog.delete({ where: { id: entry.id } }), /append-only/);
      expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: entry.id } })).action).toBe('PRICE_CHANGED');
    });

    it('keeps scan history forever: no update, no delete', async () => {
      const user = await staff();
      const scan = await prisma.ticketScan.create({ data: { scannedById: user.id, result: 'INVALID', reason: 'NOT_FOUND', tokenFingerprint: 'abcd1234' } });
      await expectDbError(prisma.ticketScan.update({ where: { id: scan.id }, data: { reason: 'OK' } }), /append-only/);
      await expectDbError(prisma.ticketScan.delete({ where: { id: scan.id } }), /append-only/);
    });

    it('only accepts consistent scan outcomes (VALID ⇔ OK)', async () => {
      const user = await staff();
      await expectDbError(prisma.ticketScan.create({ data: { scannedById: user.id, result: 'VALID', reason: 'ALREADY_USED' } }), /ck_ticket_scans_result_reason/);
      await expectDbError(prisma.ticketScan.create({ data: { scannedById: user.id, result: 'INVALID', reason: 'OK' } }), /ck_ticket_scans_result_reason/);
    });

    it('records an invalid scan even when the token matched no ticket (ticket_id is null)', async () => {
      const user = await staff();
      const scan = await prisma.ticketScan.create({ data: { scannedById: user.id, result: 'INVALID', reason: 'INVALID_TOKEN' } });
      expect(scan.ticketId).toBeNull();
    });
  });

  describe('financial history is never deleted', () => {
    it('refuses to delete orders, order items, payments and tickets', async () => {
      const today = await cairoToday(prisma);
      const { order, item, tickets } = await createPaidOrder(prisma, { visitDate: today });
      const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
      // (the server message reaches us JSON-escaped, so allow a few non-word characters around the table name)
      await expectDbError(prisma.ticket.delete({ where: { id: tickets[0].id } }), /Deleting rows from \W{0,6}tickets/);
      await expectDbError(prisma.payment.delete({ where: { id: payment.id } }), /Deleting rows from \W{0,6}payments/);
      await expectDbError(prisma.orderItem.delete({ where: { id: item.id } }), /Deleting rows from \W{0,6}order_items/);
      await expectDbError(prisma.order.delete({ where: { id: order.id } }), /Deleting rows from \W{0,6}orders/);
    });

    it('does not let a customer with orders be deleted (they are anonymised instead)', async () => {
      const today = await cairoToday(prisma);
      const { customer } = await createPaidOrder(prisma, { visitDate: today });
      await expectDbError(prisma.customer.delete({ where: { id: customer.id } }), /foreign key|violat/i);
      const anonymised = await prisma.customer.update({
        where: { id: customer.id },
        data: { fullName: 'Anonymised', email: null, phone: null, country: null, anonymizedAt: new Date() },
      });
      expect(anonymised.email).toBeNull();
      expect(await prisma.order.count({ where: { customerId: customer.id } })).toBe(1); // order history intact
    });

    it('does not let a ticket type or audience used by orders be deleted', async () => {
      const today = await cairoToday(prisma);
      const { type, audience } = await createPaidOrder(prisma, { visitDate: today });
      await expectDbError(prisma.ticketType.delete({ where: { id: type.id } }), /foreign key|violat/i);
      await expectDbError(prisma.ticketAudience.delete({ where: { id: audience.id } }), /foreign key|violat/i);
    });
  });

  describe('ticket lifecycle is one-way', () => {
    const allowed: Array<[TicketStatus, TicketStatus]> = [
      ['PENDING', 'VALID'], ['PENDING', 'CANCELLED'], ['PENDING', 'EXPIRED'],
      ['VALID', 'USED'], ['VALID', 'CANCELLED'], ['VALID', 'EXPIRED'],
    ];
    const forbidden: Array<[TicketStatus, TicketStatus]> = [
      ['USED', 'VALID'], ['USED', 'PENDING'], ['USED', 'CANCELLED'], ['USED', 'REFUNDED'],
      ['CANCELLED', 'VALID'], ['EXPIRED', 'VALID'], ['CANCELLED', 'USED'], ['VALID', 'REFUNDED'],
      ['PENDING', 'USED'], ['PENDING', 'REFUNDED'], ['VALID', 'PENDING'],
    ];

    const move = async (from: TicketStatus, to: TicketStatus) => {
      const today = await cairoToday(prisma);
      const seq = Math.floor(Math.random() * 900_000) + 1;
      const { tickets } = await createPaidOrder(prisma, { seq, visitDate: today, ticketStatus: from });
      return prisma.ticket.update({
        where: { id: tickets[0].id },
        data: {
          status: to,
          ...(to === 'USED' ? { usedAt: new Date() } : {}),
          ...(to === 'CANCELLED' ? { cancelledAt: new Date(), cancelReason: 'operational reason (test)' } : {}),
        },
      });
    };

    it.each(allowed)('allows %s → %s', async (from, to) => {
      await expect(move(from, to)).resolves.toMatchObject({ status: to });
    });

    it.each(forbidden)('forbids %s → %s', async (from, to) => {
      await expectDbError(move(from, to), /illegal ticket status change/);
    });

    it('never lets a used ticket become valid again, even through direct SQL', async () => {
      const today = await cairoToday(prisma);
      const { tickets } = await createPaidOrder(prisma, { visitDate: today, ticketStatus: 'USED' });
      await expectDbError(
        prisma.$executeRaw`UPDATE tickets SET status = 'VALID'::ticket_status, used_at = NULL WHERE id = ${tickets[0].id}::uuid`,
        /illegal ticket status change/,
      );
    });

    it('requires a timestamp when a ticket is marked used', async () => {
      const today = await cairoToday(prisma);
      const { tickets } = await createPaidOrder(prisma, { visitDate: today });
      await expectDbError(prisma.ticket.update({ where: { id: tickets[0].id }, data: { status: 'USED' } }), /ck_tickets_used/);
    });

    it('freezes the ticket reference, order link and visit date', async () => {
      const today = await cairoToday(prisma);
      const { tickets } = await createPaidOrder(prisma, { visitDate: today });
      await expectDbError(prisma.ticket.update({ where: { id: tickets[0].id }, data: { publicRef: randomTicketRef() } }), /immutable/);
      await expectDbError(prisma.ticket.update({ where: { id: tickets[0].id }, data: { visitDate: addDays(today, 5) } }), /immutable/);
    });
  });

  describe('formats and money', () => {
    it.each(['AZP-26-000001', 'AZP-2026-1', 'azp-2026-000001', 'ORD-2026-000001', 'AZP-2026-0000001'])('rejects order number %s', async (bad) => {
      const today = await cairoToday(prisma);
      await expectDbError(
        prisma.order.create({ data: { orderNumber: bad, channel: 'ONLINE', visitDate: today, subtotalMinor: 100, totalMinor: 100 } }),
        /ck_orders_number_format/,
      );
    });

    it.each(['TKT-SHORT', 'tkt-8f3k2lq7zp', '8F3K2LQ7ZP', 'TKT-8F3K2L Q7ZP', 'TKT-8F3K2LQ7ZP12345678'])('rejects ticket reference %s', async (bad) => {
      const today = await cairoToday(prisma);
      const { order, item, type, audience } = await createPaidOrder(prisma, { visitDate: today });
      await expectDbError(
        prisma.ticket.create({
          data: { publicRef: bad, orderId: order.id, orderItemId: item.id, ticketTypeId: type.id, audienceId: audience.id, visitDate: today, pricePaidMinor: 5000, status: 'VALID' },
        }),
        /ck_tickets_ref_format/,
      );
    });

    it('rejects an order whose total does not equal subtotal minus discount', async () => {
      const today = await cairoToday(prisma);
      await expectDbError(
        prisma.order.create({ data: { orderNumber: orderNumber(1), channel: 'ONLINE', visitDate: today, subtotalMinor: 10000, discountMinor: 1000, totalMinor: 10000 } }),
        /ck_orders_money/,
      );
    });

    it('rejects an order item whose line total does not equal price × quantity, or with zero quantity', async () => {
      const today = await cairoToday(prisma);
      const { order, type, audience, price } = await createPaidOrder(prisma, { visitDate: today });
      const base = {
        orderId: order.id, ticketTypeId: type.id, audienceId: audience.id, ticketPriceId: price.id,
        typeNameEn: 'x', typeNameAr: 'x', audienceNameEn: 'x', audienceNameAr: 'x', unitPriceMinor: 5000,
      };
      await expectDbError(prisma.orderItem.create({ data: { ...base, quantity: 2, lineTotalMinor: 5000 } }), /ck_order_items_money/);
      await expectDbError(prisma.orderItem.create({ data: { ...base, quantity: 0, lineTotalMinor: 0 } }), /ck_order_items_quantity/);
    });
  });

  describe('uniqueness', () => {
    it('rejects duplicate order numbers, ticket references, idempotency keys and provider transactions', async () => {
      const today = await cairoToday(prisma);
      const first = await createPaidOrder(prisma, { seq: 1, visitDate: today });
      await expectDbError(
        prisma.order.create({ data: { orderNumber: orderNumber(1), channel: 'ONLINE', visitDate: today, subtotalMinor: 100, totalMinor: 100 } }),
        /Unique constraint|order_number/,
      );
      await expectDbError(
        prisma.ticket.create({
          data: {
            publicRef: first.tickets[0].publicRef, orderId: first.order.id, orderItemId: first.item.id,
            ticketTypeId: first.type.id, audienceId: first.audience.id, visitDate: today, pricePaidMinor: 5000,
          },
        }),
        /Unique constraint|public_ref/,
      );

      await prisma.order.create({ data: { orderNumber: orderNumber(2), channel: 'ONLINE', visitDate: today, subtotalMinor: 100, totalMinor: 100, idempotencyKey: 'key-1' } });
      await expectDbError(
        prisma.order.create({ data: { orderNumber: orderNumber(3), channel: 'ONLINE', visitDate: today, subtotalMinor: 100, totalMinor: 100, idempotencyKey: 'key-1' } }),
        /Unique constraint|idempotency_key/,
      );

      await prisma.payment.create({ data: { orderId: first.order.id, provider: 'PAYMOB', method: 'ONLINE', providerTxnId: 'txn-1', amountMinor: 100 } });
      await expectDbError(
        prisma.payment.create({ data: { orderId: first.order.id, provider: 'PAYMOB', method: 'ONLINE', providerTxnId: 'txn-1', amountMinor: 100 } }),
        /Unique constraint/,
      );
    });

    it('treats user emails case-insensitively', async () => {
      await expectDbError(prisma.user.create({ data: { email: 'Admin@AzharPark.test', fullName: 'Dup', passwordHash: 'x' } }), /Unique constraint|email/);
    });
  });

  describe('counter sales and manual payments leave a trail', () => {
    it('records the channel, the staff member and who recorded the cash payment', async () => {
      const today = await cairoToday(prisma);
      const user = await staff();
      const order = await prisma.order.create({
        data: { orderNumber: orderNumber(10), channel: 'COUNTER_SALE', status: 'PAID', visitDate: today, subtotalMinor: 5000, totalMinor: 5000, createdById: user.id, paidAt: new Date() },
      });
      const payment = await prisma.payment.create({
        data: { orderId: order.id, provider: 'MANUAL', method: 'CASH', amountMinor: 5000, status: 'PAID', paidAt: new Date(), recordedById: user.id },
      });
      expect(order.channel).toBe('COUNTER_SALE');
      expect(payment.recordedById).toBe(user.id);
      await expectDbError(prisma.payment.update({ where: { id: payment.id }, data: { amountMinor: 1 } }), /immutable/);
      await expectDbError(prisma.order.update({ where: { id: order.id }, data: { channel: 'ONLINE' } }), /immutable/);
    });
  });

  describe('opening hours and park content', () => {
    it('rejects hours where closing is not after opening, unless the day is closed', async () => {
      await expectDbError(
        prisma.openingHour.update({ where: { dayOfWeek: 1 }, data: { opens: new Date('1970-01-01T22:00:00Z'), closes: new Date('1970-01-01T09:00:00Z') } }),
        /ck_opening_hours_times/,
      );
      const closed = await prisma.openingHour.update({ where: { dayOfWeek: 1 }, data: { isClosed: true, opens: null, closes: null } });
      expect(closed.isClosed).toBe(true);
    });

    it('stores special dates (holiday, Ramadan, closure) without a schema change, and validates ranges', async () => {
      const ramadan = await prisma.specialHours.create({
        data: {
          kind: 'SPECIAL_HOURS', dateFrom: new Date('2027-02-08'), dateTo: new Date('2027-03-09'),
          opens: new Date('1970-01-01T10:00:00Z'), closes: new Date('1970-01-01T23:59:00Z'), labelEn: 'Ramadan', labelAr: 'رمضان', priority: 5,
        },
      });
      expect(ramadan.kind).toBe('SPECIAL_HOURS');
      const closure = await prisma.specialHours.create({
        data: { kind: 'TEMPORARY_CLOSURE', dateFrom: new Date('2027-05-01'), dateTo: new Date('2027-05-01'), isClosed: true, labelEn: 'Maintenance', labelAr: 'صيانة' },
      });
      expect(closure.isClosed).toBe(true);
      await expectDbError(
        prisma.specialHours.create({ data: { kind: 'HOLIDAY', dateFrom: new Date('2027-05-10'), dateTo: new Date('2027-05-01'), isClosed: true, labelEn: 'x', labelAr: 'x' } }),
        /ck_special_hours_range/,
      );
    });

    it('keeps park settings and contact information to a single row', async () => {
      await expectDbError(prisma.parkSettings.create({ data: { id: 2, nameEn: 'x', nameAr: 'x' } }), /ck_park_settings_singleton/);
      await expectDbError(prisma.contactInformation.create({ data: { id: 2, addressEn: 'x', addressAr: 'x' } }), /ck_contact_information_singleton/);
    });
  });
});
