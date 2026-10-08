import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildMeta, toSkipTake } from '../../common/dto/pagination';
import { AppException } from '../../common/errors/app-exception';
import { PageResult } from '../../common/http/envelope';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, RequestContext } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { dateToIso } from '../ticketing/rules/calendar';
import { TicketPdfService } from '../ticketing/ticket-pdf.service';
import { ListTicketsQueryDto } from './operations.dto';

const include = { orderItem: true, order: { select: { id: true, orderNumber: true, status: true } } } satisfies Prisma.TicketInclude;
type Row = Prisma.TicketGetPayload<{ include: typeof include }>;

const row = (t: Row) => ({
  id: t.id, ref: t.publicRef, status: t.status, orderId: t.order.id, orderNumber: t.order.orderNumber, orderStatus: t.order.status, visitDate: dateToIso(t.visitDate),
  typeNameEn: t.orderItem.typeNameEn, typeNameAr: t.orderItem.typeNameAr, audienceNameEn: t.orderItem.audienceNameEn, audienceNameAr: t.orderItem.audienceNameAr,
  pricePaidMinor: t.pricePaidMinor, currency: t.currency, issuedAt: t.issuedAt, usedAt: t.usedAt, cancelledAt: t.cancelledAt, cancelReason: t.cancelReason,
});

/**
 * Tickets for staff: find them, read them, see what happened to them. Read only: a ticket's reference, type, audience,
 * visit date and price are immutable, and its status moves only through the payment, the cancellation and the gate scan.
 */
@Injectable()
export class TicketsOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: TicketPdfService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListTicketsQueryDto): Promise<PageResult<ReturnType<typeof row>>> {
    const where: Prisma.TicketWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.visitDate ? { visitDate: new Date(`${query.visitDate}T00:00:00Z`) } : {}),
      ...(query.ticketType ? { ticketType: { code: query.ticketType } } : {}),
      ...(query.audience ? { audience: { code: query.audience } } : {}),
      ...(query.search ? { OR: [{ publicRef: { contains: query.search.toUpperCase() } }, { order: { orderNumber: { contains: query.search.toUpperCase() } } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.ticket.count({ where }),
      this.prisma.ticket.findMany({ where, include, orderBy: [{ createdAt: 'desc' }, { publicRef: 'asc' }], ...toSkipTake(query) }),
    ]);
    return new PageResult(rows.map(row), buildMeta(query, total));
  }

  async get(id: string, actor: AuthenticatedUser) {
    const t = await this.prisma.ticket.findUnique({ where: { id }, include: { ...include, usedBy: { select: { fullName: true } }, order: { select: { id: true, orderNumber: true, status: true, createdAt: true, paidAt: true, totalMinor: true, currency: true, payments: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true } } } } } });
    if (!t) throw new AppException('TICKET_NOT_FOUND', 'Ticket not found.', 404);
    const seeScans = actor.permissions.has('scans:read');
    const scans = seeScans
      ? await this.prisma.ticketScan.findMany({ where: { ticketId: id }, orderBy: [{ scannedAt: 'desc' }, { id: 'asc' }], take: 50, include: { gate: { select: { code: true, nameEn: true } }, scannedBy: { select: { fullName: true } } } })
      : undefined;
    return {
      ...row({ ...t, order: { id: t.order.id, orderNumber: t.order.orderNumber, status: t.order.status } }),
      order: { id: t.order.id, orderNumber: t.order.orderNumber, status: t.order.status, createdAt: t.order.createdAt, paidAt: t.order.paidAt, totalMinor: t.order.totalMinor, currency: t.order.currency },
      paymentStatus: actor.permissions.has('payments:read') ? (t.order.payments[0]?.status ?? null) : undefined,
      /** a code exists for a ticket that has been issued; whether it is accepted today is decided only by the gate */
      qrIssued: t.issuedAt !== null && (t.status === 'VALID' || t.status === 'USED'),
      usedByName: seeScans ? (t.usedBy?.fullName ?? null) : undefined,
      scans: scans?.map((s) => ({ id: s.id, scannedAt: s.scannedAt, granted: s.result === 'VALID', result: s.detail ?? s.reason, gate: s.gate, staff: s.scannedBy.fullName })),
    };
  }

  /**
   * The ticket as a PDF, for staff who re-deliver tickets (the same permission as the e-mail resend). It carries the live
   * QR code, so every download is audited.
   */
  async pdfOf(id: string, actor: AuthenticatedUser, ctx: RequestContext): Promise<{ filename: string; data: Buffer }> {
    const t = await this.prisma.ticket.findUnique({ where: { id }, include: { orderItem: true, order: { select: { orderNumber: true, locale: true } } } });
    if (!t) throw new AppException('TICKET_NOT_FOUND', 'Ticket not found.', 404);
    if (t.status !== 'VALID' && t.status !== 'USED') throw new AppException('TICKET_NOT_AVAILABLE', `A ${t.status.toLowerCase()} ticket has no PDF.`, 409);
    const data = await this.pdf.render({
      locale: t.order.locale === 'ar' ? 'ar' : 'en', orderNumber: t.order.orderNumber, visitDate: dateToIso(t.visitDate),
      tickets: [{ publicRef: t.publicRef, qrKeyId: t.qrKeyId, status: t.status, typeNameEn: t.orderItem.typeNameEn, typeNameAr: t.orderItem.typeNameAr, audienceNameEn: t.orderItem.audienceNameEn, audienceNameAr: t.orderItem.audienceNameAr, pricePaidMinor: t.pricePaidMinor, currency: t.currency }],
    });
    await this.audit.record({ userId: actor.id, action: 'ticket.pdf_downloaded', entity: 'ticket', entityId: t.id, newValue: { ref: t.publicRef, orderNumber: t.order.orderNumber } }, ctx);
    return { filename: `${t.publicRef}.pdf`, data };
  }
}
