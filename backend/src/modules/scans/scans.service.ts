import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Clock } from '../../common/clock';
import { AppException } from '../../common/errors/app-exception';
import { qrFingerprint } from '../../common/security/ticket-qr';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, RequestContext } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { dateToIso } from '../ticketing/rules/calendar';
import { evaluateScan } from '../ticketing/rules/scan-validity';
import { QrService } from '../ticketing/qr.service';
import { CODE_OF_VERDICT, MESSAGE_OF, REASON_OF, ScanResultCode } from './scan-results';

export interface GateView {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
}

/** What the scanner may show about a ticket: no name, e-mail, phone or price. */
export interface ScanTicketView {
  ref: string;
  visitDate: string;
  typeNameEn: string;
  typeNameAr: string;
  audienceNameEn: string;
  audienceNameAr: string;
}

export interface ScanOutcome {
  result: ScanResultCode;
  granted: boolean;
  message: string;
  /** the id of the scan record (for the audit trail) */
  scanId: string;
  scannedAt: Date;
  gate: GateView;
  ticket?: ScanTicketView;
  /** ALREADY_USED: when the ticket was first used */
  usedAt?: Date;
}

const gateView = (g: { id: string; code: string; nameEn: string; nameAr: string }): GateView => ({ id: g.id, code: g.code, nameEn: g.nameEn, nameAr: g.nameAr });

/**
 * The gate: one request in, one decision out. The backend is the only authority:
 *
 *   1. the gate must exist and be active;
 *   2. the code is checked by the Phase 7 QR scheme (shape first, then key and signature in constant time), before
 *      any ticket is looked up;
 *   3. the ticket is found by the reference in the code, and the code's key must be the key that signed THAT ticket;
 *   4. the ticket is consumed by ONE conditional statement — `UPDATE … WHERE status = 'VALID' AND visit_date = today
 *      (Cairo) RETURNING` — so of any number of simultaneous scans exactly one can win; the others re-read the ticket
 *      and are told why they lost;
 *   5. the attempt is recorded in `ticket_scans` (append-only). Only a 12-character fingerprint of the code is stored,
 *      never the code.
 *
 * Nothing in the request is trusted except the code itself and the gate id, and both are verified here.
 */
@Injectable()
export class ScansService {
  private readonly log = new Logger('Scans');

  constructor(
    private readonly prisma: PrismaService,
    private readonly qr: QrService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /** The gates a staff member can work at. */
  async activeGates(): Promise<GateView[]> {
    const gates = await this.prisma.gate.findMany({ where: { isActive: true }, orderBy: [{ code: 'asc' }] });
    return gates.map(gateView);
  }

  async scan(input: { qr: string; gateId: string }, actor: AuthenticatedUser, ctx: RequestContext): Promise<ScanOutcome> {
    const gate = await this.prisma.gate.findUnique({ where: { id: input.gateId } });
    if (!gate) throw new AppException('GATE_NOT_FOUND', 'That gate does not exist.', 404);
    if (!gate.isActive) throw new AppException('GATE_INACTIVE', 'That gate is switched off.', 422);

    const fingerprint = qrFingerprint(input.qr);
    const base = { actorId: actor.id, gate, fingerprint, ctx };
    const now = this.clock.now();

    // 2. the code itself: shape, key, signature. No database access for a malformed code.
    const verified = this.qr.verify(input.qr);
    if (!verified.ok) {
      const code: ScanResultCode = verified.reason === 'MALFORMED' ? 'INVALID_QR' : verified.reason === 'UNKNOWN_KEY' ? 'RETIRED_KEY' : 'INVALID_SIGNATURE';
      return this.deny(code, base, now);
    }

    // 3. the ticket
    const ticket = await this.prisma.ticket.findUnique({ where: { publicRef: verified.ticketRef }, include: { orderItem: true } });
    if (!ticket) return this.deny('TICKET_NOT_FOUND', base, now);
    // a code must be signed with the key its ticket was issued under; another key of the ring does not count
    if (verified.keyId !== ticket.qrKeyId) return this.deny('INVALID_SIGNATURE', base, now, ticket.id);
    const view: ScanTicketView = {
      ref: ticket.publicRef, visitDate: dateToIso(ticket.visitDate), typeNameEn: ticket.orderItem.typeNameEn, typeNameAr: ticket.orderItem.typeNameAr,
      audienceNameEn: ticket.orderItem.audienceNameEn, audienceNameAr: ticket.orderItem.audienceNameAr,
    };

    // 4. consume it, atomically, together with the record of the scan
    const outcome = await this.prisma.$transaction(async (tx) => {
      const won = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE tickets
           SET status = 'USED'::ticket_status, used_at = ${now}::timestamptz, used_by_id = ${actor.id}::uuid
         WHERE id = ${ticket.id}::uuid
           AND status = 'VALID'::ticket_status
           AND visit_date = azharpark_date_of(${now}::timestamptz)
        RETURNING id`;
      if (won.length === 1) {
        const scan = await this.record(tx, 'ACCESS_GRANTED', base, now, ticket.id);
        await this.audit.record(
          { userId: actor.id, action: 'ticket.scanned', entity: 'ticket', entityId: ticket.id, newValue: { ref: ticket.publicRef, gate: gate.code, scanId: scan.id } },
          ctx,
          tx,
        );
        return { result: 'ACCESS_GRANTED' as const, scan, usedAt: undefined };
      }
      // lost (or never eligible): read the ticket again to say why
      const fresh = await tx.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      // (REFUNDED exists in the enum for the day a refund policy is chosen; the database refuses it today, and it never admits)
      const verdict = fresh.status === 'REFUNDED' ? 'NOT_PAID' : evaluateScan({ status: fresh.status, visitDate: dateToIso(fresh.visitDate) }, now);
      const code: ScanResultCode = verdict === 'OK' ? 'TICKET_NOT_VALID' : CODE_OF_VERDICT[verdict];
      const scan = await this.record(tx, code, base, now, ticket.id);
      return { result: code, scan, usedAt: fresh.status === 'USED' ? (fresh.usedAt ?? undefined) : undefined };
    });

    if (outcome.result !== 'ACCESS_GRANTED') this.log.log(`denied ${outcome.result} ref=${ticket.publicRef} gate=${gate.code} fp=${fingerprint}`);
    return {
      result: outcome.result, granted: outcome.result === 'ACCESS_GRANTED', message: MESSAGE_OF[outcome.result], scanId: outcome.scan.id, scannedAt: outcome.scan.scannedAt,
      gate: gateView(gate), ticket: view, ...(outcome.usedAt ? { usedAt: outcome.usedAt } : {}),
    };
  }

  private async deny(code: ScanResultCode, base: Base, now: Date, ticketId?: string): Promise<ScanOutcome> {
    const scan = await this.record(this.prisma, code, base, now, ticketId);
    this.log.log(`denied ${code} gate=${base.gate.code} fp=${base.fingerprint}`);
    return { result: code, granted: false, message: MESSAGE_OF[code], scanId: scan.id, scannedAt: scan.scannedAt, gate: gateView(base.gate) };
  }

  /** One row per attempt. The code is never stored: only its short fingerprint. */
  private record(db: Prisma.TransactionClient | PrismaService, code: ScanResultCode, base: Base, now: Date, ticketId?: string) {
    return db.ticketScan.create({
      data: {
        ticketId: ticketId ?? null, tokenFingerprint: base.fingerprint, scannedById: base.actorId, gateId: base.gate.id,
        result: code === 'ACCESS_GRANTED' ? 'VALID' : 'INVALID', reason: REASON_OF[code], detail: code, scannedAt: now,
        ip: base.ctx.ip ?? null, device: base.ctx.userAgent ? { userAgent: base.ctx.userAgent.slice(0, 200) } : undefined,
      },
    });
  }
}

interface Base {
  actorId: string;
  gate: { id: string; code: string; nameEn: string; nameAr: string };
  fingerprint: string;
  ctx: RequestContext;
}
