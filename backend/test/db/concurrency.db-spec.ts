import { PrismaClient, ScanReason } from '@prisma/client';
import { addDays, cairoToday, createPaidOrder } from '../helpers/fixtures';
import { createTestPrisma, resetDatabase, seedAll } from '../helpers/db';

/**
 * The guarantees the whole ticketing system depends on, proved against a real PostgreSQL with genuinely
 * parallel connections (pool of 30). The atomic statement below is the exact claim that the scan service
 * will use in Phase 8.
 */
describe('concurrency guarantees (database level)', () => {
  const prisma: PrismaClient = createTestPrisma(30);

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedAll(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Atomically move VALID → USED, only for today's visit date. Returns the id if (and only if) this call won. */
  const claim = (ticketId: string, staffId: string) =>
    prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE tickets
         SET status = 'USED'::ticket_status, used_at = now(), used_by_id = ${staffId}::uuid
       WHERE id = ${ticketId}::uuid
         AND status = 'VALID'
         AND visit_date = azharpark_today()
      RETURNING id`;

  /** A scan as the service will do it: claim + record the attempt in ONE transaction. */
  async function scan(ticketId: string, staffId: string): Promise<'VALID' | ScanReason> {
    return prisma.$transaction(async (tx) => {
      const won = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE tickets
           SET status = 'USED'::ticket_status, used_at = now(), used_by_id = ${staffId}::uuid
         WHERE id = ${ticketId}::uuid AND status = 'VALID' AND visit_date = azharpark_today()
        RETURNING id`;
      if (won.length === 1) {
        await tx.ticketScan.create({ data: { ticketId, scannedById: staffId, result: 'VALID', reason: 'OK' } });
        return 'VALID';
      }
      const t = await tx.ticket.findUniqueOrThrow({ where: { id: ticketId } });
      const reason: ScanReason = t.status === 'USED' ? 'ALREADY_USED' : t.status === 'CANCELLED' ? 'CANCELLED' : 'WRONG_DATE';
      await tx.ticketScan.create({ data: { ticketId, scannedById: staffId, result: 'INVALID', reason } });
      return reason;
    });
  }

  const staffIds = async () => (await prisma.user.findMany({ where: { roles: { some: { role: { code: 'TICKET_STAFF' } } } } })).map((u) => u.id);
  const anyStaff = async () => (await staffIds())[0];

  it('lets exactly ONE of 50 simultaneous claims succeed for the same ticket', async () => {
    const today = await cairoToday(prisma);
    const { tickets } = await createPaidOrder(prisma, { visitDate: today });
    const staff = await anyStaff();

    const results = await Promise.all(Array.from({ length: 50 }, () => claim(tickets[0].id, staff)));
    const winners = results.filter((rows) => rows.length === 1);
    expect(winners).toHaveLength(1);

    const reloaded = await prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0].id } });
    expect(reloaded.status).toBe('USED');
    expect(reloaded.usedById).toBe(staff);
    expect(reloaded.usedAt).not.toBeNull();
  });

  it('records one VALID scan and 39 ALREADY_USED when 40 staff scan the same ticket at once', async () => {
    const today = await cairoToday(prisma);
    const { tickets } = await createPaidOrder(prisma, { visitDate: today });
    const staff = await anyStaff();

    const outcomes = await Promise.all(Array.from({ length: 40 }, () => scan(tickets[0].id, staff)));
    expect(outcomes.filter((o) => o === 'VALID')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'ALREADY_USED')).toHaveLength(39);

    const scans = await prisma.ticketScan.findMany({ where: { ticketId: tickets[0].id } });
    expect(scans).toHaveLength(40); // every attempt is on record
    expect(scans.filter((s) => s.result === 'VALID')).toHaveLength(1);
  });

  it('lets each of 20 different tickets in exactly once when three staff members scan them all in parallel', async () => {
    const today = await cairoToday(prisma);
    const { tickets } = await createPaidOrder(prisma, { visitDate: today, quantity: 20 });
    const staff = await staffIds();
    const attempts = tickets.flatMap((t) => [0, 1, 2].map((i) => scan(t.id, staff[i % staff.length])));

    const outcomes = await Promise.all(attempts);
    expect(outcomes.filter((o) => o === 'VALID')).toHaveLength(20);
    expect(await prisma.ticket.count({ where: { status: 'USED' } })).toBe(20);
    expect(await prisma.ticketScan.count({ where: { result: 'VALID' } })).toBe(20);
  });

  it('refuses a ticket for another day', async () => {
    const today = await cairoToday(prisma);
    const staff = await anyStaff();
    const future = await createPaidOrder(prisma, { seq: 1, visitDate: addDays(today, 3) });
    const past = await createPaidOrder(prisma, { seq: 2, visitDate: addDays(today, -1) });
    expect(await claim(future.tickets[0].id, staff)).toHaveLength(0);
    expect(await claim(past.tickets[0].id, staff)).toHaveLength(0);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: future.tickets[0].id } })).status).toBe('VALID');
  });

  it.each(['CANCELLED', 'EXPIRED', 'PENDING'] as const)('refuses a %s ticket', async (status) => {
    const today = await cairoToday(prisma);
    const { tickets } = await createPaidOrder(prisma, { visitDate: today, ticketStatus: status });
    expect(await claim(tickets[0].id, await anyStaff())).toHaveLength(0);
  });

  it('reports why a cancelled ticket was refused, and still records the attempt', async () => {
    const today = await cairoToday(prisma);
    const { tickets } = await createPaidOrder(prisma, { visitDate: today, ticketStatus: 'CANCELLED' });
    expect(await scan(tickets[0].id, await anyStaff())).toBe('CANCELLED');
    expect(await prisma.ticketScan.count({ where: { ticketId: tickets[0].id, reason: 'CANCELLED' } })).toBe(1);
  });

  it('cancelling and scanning at the same moment can never produce a cancelled ticket that was also admitted', async () => {
    const today = await cairoToday(prisma);
    const { tickets } = await createPaidOrder(prisma, { visitDate: today, quantity: 10 });
    const staff = await anyStaff();

    await Promise.all(
      tickets.flatMap((t) => [
        claim(t.id, staff),
        prisma.$executeRaw`UPDATE tickets SET status = 'CANCELLED'::ticket_status, cancelled_at = now(), cancel_reason = 'operational' WHERE id = ${t.id}::uuid AND status = 'VALID'`.catch(() => 0),
      ]),
    );

    const final = await prisma.ticket.findMany({ where: { id: { in: tickets.map((t) => t.id) } } });
    for (const t of final) {
      // each ticket ended in exactly one terminal state, never both
      expect(['USED', 'CANCELLED']).toContain(t.status);
      expect(t.status === 'USED' ? t.cancelledAt : t.usedAt).toBeNull();
    }
  });

  describe('human order numbers', () => {
    it('hands out 40 distinct, gap-free sequence numbers to 40 simultaneous requests', async () => {
      const next = () =>
        prisma.$queryRaw<Array<{ last_value: number }>>`
          INSERT INTO reference_counters (kind, year, last_value) VALUES ('ORDER', 2026, 1)
          ON CONFLICT (kind, year) DO UPDATE SET last_value = reference_counters.last_value + 1
          RETURNING last_value`;
      const values = (await Promise.all(Array.from({ length: 40 }, next))).map((r) => r[0].last_value).sort((a, b) => a - b);
      expect(values).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    });
  });

  describe('the park calendar', () => {
    it('azharpark_today() is the date in Africa/Cairo, not UTC', async () => {
      const dbToday = (await cairoToday(prisma)).toISOString().slice(0, 10);
      const cairo = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      expect(dbToday).toBe(cairo);
    });
  });
});
