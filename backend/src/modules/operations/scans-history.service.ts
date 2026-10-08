import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildMeta, toSkipTake } from '../../common/dto/pagination';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { PageResult } from '../../common/http/envelope';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { addDays } from '../ticketing/rules/calendar';
import { parkDayStart } from '../ticketing/rules/event-window';
import { ListScansQueryDto } from './operations.dto';

/**
 * The list of gate scans. Someone with `scans:read` sees everyone's scans (and who scanned); someone with only
 * `scans:read_own` sees their own. Never the scanned text, its fingerprint, the signature or the client address.
 */
@Injectable()
export class ScansHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListScansQueryDto, actor: AuthenticatedUser) {
    const all = actor.permissions.has('scans:read');
    if (!all && !actor.permissions.has('scans:read_own')) throw new AppException(ErrorCode.FORBIDDEN, 'You do not have permission to do this.', 403);
    const where: Prisma.TicketScanWhereInput = {
      ...(all ? {} : { scannedById: actor.id }),
      ...(query.outcome ? { result: query.outcome === 'granted' ? 'VALID' : 'INVALID' } : {}),
      ...(query.gateId ? { gateId: query.gateId } : {}),
      ...(query.date ? { scannedAt: { gte: parkDayStart(query.date), lt: parkDayStart(addDays(query.date, 1)) } } : {}),
      ...(query.search ? { ticket: { publicRef: { contains: query.search.toUpperCase() } } } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.ticketScan.count({ where }),
      this.prisma.ticketScan.findMany({
        where, orderBy: [{ scannedAt: 'desc' }, { id: 'asc' }], ...toSkipTake(query),
        include: { gate: { select: { id: true, code: true, nameEn: true } }, ticket: { select: { id: true, publicRef: true } }, scannedBy: { select: { fullName: true } } },
      }),
    ]);
    return new PageResult(
      rows.map((r) => ({
        id: r.id, scannedAt: r.scannedAt, granted: r.result === 'VALID', result: r.detail ?? r.reason, gate: r.gate, ticketId: r.ticket?.id ?? null, ticketRef: r.ticket?.publicRef ?? null,
        ...(all ? { staff: r.scannedBy.fullName } : {}),
      })),
      buildMeta(query, total),
    );
  }
}
