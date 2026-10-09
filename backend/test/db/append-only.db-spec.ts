import { PrismaClient } from '@prisma/client';
import { expectDbError } from '../helpers/fixtures';
import { createTestPrisma, resetDatabase, seedAll, truncateGuards } from '../helpers/db';

// audit_logs and ticket_scans are append-only: INSERT works, UPDATE, DELETE and (since Phase 11) TRUNCATE are refused.
describe('append-only tables refuse TRUNCATE as well as UPDATE and DELETE (database level)', () => {
  const prisma: PrismaClient = createTestPrisma();

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedAll(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const staff = () => prisma.user.findUniqueOrThrow({ where: { email: 'staff@azharpark.test' } });
  const addAudit = (n = 1) => prisma.auditLog.createMany({ data: Array.from({ length: n }, (_, i) => ({ action: 'test.event', entity: 'test', entityId: `e${i}` })) });
  const addScan = async () => prisma.ticketScan.create({ data: { scannedById: (await staff()).id, result: 'INVALID', reason: 'NOT_FOUND', tokenFingerprint: 'abcd1234' } });
  const counts = async () => ({ audit: await prisma.auditLog.count(), scans: await prisma.ticketScan.count() });

  describe('audit_logs', () => {
    it('still accepts INSERT', async () => {
      const before = await prisma.auditLog.count();
      const row = await prisma.auditLog.create({ data: { action: 'test.insert', entity: 'test' } });
      expect(row.id).toBeTruthy();
      expect(await prisma.auditLog.count()).toBe(before + 1);
    });

    it('refuses UPDATE, DELETE, TRUNCATE and TRUNCATE ... CASCADE, and keeps every row', async () => {
      await addAudit(3);
      const before = await prisma.auditLog.count();
      const [entry] = await prisma.auditLog.findMany({ take: 1 });
      await expectDbError(prisma.auditLog.update({ where: { id: entry.id }, data: { action: 'TAMPERED' } }), /UPDATE on [^a-z]+audit_logs[^a-z]+ is not allowed: this table is append-only/);
      await expectDbError(prisma.auditLog.delete({ where: { id: entry.id } }), /DELETE on [^a-z]+audit_logs[^a-z]+ is not allowed: this table is append-only/);
      await expectDbError(prisma.auditLog.deleteMany(), /append-only/);
      await expectDbError(prisma.$executeRawUnsafe('TRUNCATE audit_logs'), /TRUNCATE on [^a-z]+audit_logs[^a-z]+ is not allowed: this table is append-only/);
      await expectDbError(prisma.$executeRawUnsafe('TRUNCATE audit_logs RESTART IDENTITY CASCADE'), /TRUNCATE on [^a-z]+audit_logs[^a-z]+ is not allowed/);
      expect(await prisma.auditLog.count()).toBe(before);
      expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: entry.id } })).action).toBe('test.event');
    });
  });

  describe('ticket_scans', () => {
    it('still accepts INSERT', async () => {
      const row = await addScan();
      expect(row.id).toBeTruthy();
      expect(await prisma.ticketScan.count()).toBe(1);
    });

    it('refuses UPDATE, DELETE, TRUNCATE and TRUNCATE ... CASCADE, and keeps every row', async () => {
      const scan = await addScan();
      await addScan();
      await expectDbError(prisma.ticketScan.update({ where: { id: scan.id }, data: { reason: 'OK' } }), /UPDATE on [^a-z]+ticket_scans[^a-z]+ is not allowed: this table is append-only/);
      await expectDbError(prisma.ticketScan.delete({ where: { id: scan.id } }), /DELETE on [^a-z]+ticket_scans[^a-z]+ is not allowed: this table is append-only/);
      await expectDbError(prisma.$executeRawUnsafe('TRUNCATE ticket_scans'), /TRUNCATE on [^a-z]+ticket_scans[^a-z]+ is not allowed: this table is append-only/);
      await expectDbError(prisma.$executeRawUnsafe('TRUNCATE ticket_scans RESTART IDENTITY CASCADE'), /TRUNCATE on [^a-z]+ticket_scans[^a-z]+ is not allowed/);
      expect(await prisma.ticketScan.count()).toBe(2);
    });
  });

  describe('emptying them indirectly', () => {
    it('is refused too: TRUNCATE ... CASCADE on a table they reference (users, gates, tickets) does not wipe them (whichever guard fires first)', async () => {
      await addAudit(2);
      await addScan();
      const before = await counts();
      for (const table of ['users', 'tickets', 'gates']) {
        await expectDbError(prisma.$executeRawUnsafe(`TRUNCATE ${table} CASCADE`), /TRUNCATE on [^a-z]+(audit_logs|ticket_scans)[^a-z]+ is not allowed|Truncating [^a-z]+[a-z_]+[^a-z]+ is not allowed: order, payment, ticket and price history must be kept|cannot truncate/);
      }
      expect(await counts()).toEqual(before);
      expect(await prisma.user.count()).toBeGreaterThan(0); // the refused statement rolled back as a whole
    });

    it('a multi-table TRUNCATE naming one of them is refused as a whole (nothing else is emptied either)', async () => {
      await addAudit(1);
      const users = await prisma.user.count();
      await expectDbError(prisma.$executeRawUnsafe('TRUNCATE audit_logs, gates, ticket_scans'), /TRUNCATE on [^a-z]+(audit_logs|ticket_scans)[^a-z]+ is not allowed/);
      expect(await prisma.gate.count()).toBeGreaterThan(0);
      expect(await prisma.user.count()).toBe(users);
    });
  });

  describe('the guards themselves', () => {
    it('exist, are statement-level BEFORE TRUNCATE triggers, and are enabled', async () => {
      const rows = await prisma.$queryRaw<Array<{ tgname: string; relname: string; tgenabled: string; tgtype: number }>>`
        SELECT t.tgname, c.relname, t.tgenabled::text AS tgenabled, t.tgtype
          FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
         WHERE t.tgname IN ('trg_audit_logs_no_truncate', 'trg_ticket_scans_no_truncate') AND NOT t.tgisinternal ORDER BY t.tgname`;
      expect(rows.map((r) => [r.tgname, r.relname])).toEqual([
        ['trg_audit_logs_no_truncate', 'audit_logs'],
        ['trg_ticket_scans_no_truncate', 'ticket_scans'],
      ]);
      for (const r of rows) {
        expect(r.tgenabled).toBe('O'); // enabled
        expect(r.tgtype & 1).toBe(0); // 1 = FOR EACH ROW: this is a statement trigger
        expect(r.tgtype & 2).toBe(2); // 2 = BEFORE
        expect(r.tgtype & 32).toBe(32); // 32 = TRUNCATE
      }
    });

    it('the existing UPDATE / DELETE triggers are still in place', async () => {
      const rows = await prisma.$queryRaw<Array<{ tgname: string }>>`
        SELECT tgname FROM pg_trigger WHERE tgname IN ('trg_audit_logs_append_only', 'trg_ticket_scans_append_only') AND NOT tgisinternal`;
      expect(rows.map((r) => r.tgname).sort()).toEqual(['trg_audit_logs_append_only', 'trg_ticket_scans_append_only']);
    });

    it('the test reset switches them off only inside its own transaction and leaves them enabled', async () => {
      await addAudit(2);
      await addScan();
      await resetDatabase(prisma); // empties everything, including the two guarded tables
      expect(await counts()).toEqual({ audit: 0, scans: 0 });
      const guards = (await truncateGuards(prisma)).map(([, guard]) => guard);
      expect(guards).toEqual(expect.arrayContaining(['trg_audit_logs_no_truncate', 'trg_ticket_scans_no_truncate']));
      const rows = await prisma.$queryRaw<Array<{ tgenabled: string }>>`SELECT tgenabled::text AS tgenabled FROM pg_trigger WHERE tgname = ANY(${guards})`;
      expect(rows).toHaveLength(guards.length);
      expect(rows.every((r) => r.tgenabled === 'O')).toBe(true);
      await seedAll(prisma);
      await addAudit(1);
      await expectDbError(prisma.$executeRawUnsafe('TRUNCATE audit_logs'), /append-only/); // protected again straight away
    });

    it('a reset that fails half way does not leave the guard disabled', async () => {
      await addAudit(1);
      await expect(
        prisma.$transaction([
          prisma.$executeRawUnsafe('ALTER TABLE "audit_logs" DISABLE TRIGGER trg_audit_logs_no_truncate'),
          prisma.$executeRawUnsafe('TRUNCATE "this_table_does_not_exist"'),
        ]),
      ).rejects.toThrow();
      const [guard] = await prisma.$queryRaw<Array<{ tgenabled: string }>>`SELECT tgenabled::text AS tgenabled FROM pg_trigger WHERE tgname = 'trg_audit_logs_no_truncate'`;
      expect(guard.tgenabled).toBe('O');
      await expectDbError(prisma.$executeRawUnsafe('TRUNCATE audit_logs'), /append-only/);
    });
  });
});
