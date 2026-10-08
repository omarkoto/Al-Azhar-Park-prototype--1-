import { Injectable } from '@nestjs/common';
import { Gate, Prisma } from '@prisma/client';
import { Clock } from '../../common/clock';
import { AppException } from '../../common/errors/app-exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, RequestContext } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { addDays, parkDateOf } from '../ticketing/rules/calendar';
import { parkInstant } from '../ticketing/rules/event-window';
import { CreateGateDto, UpdateGateDto } from './operations.dto';

export interface GateRow {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  isActive: boolean;
  createdAt: Date;
  /** how the gate has been used, for people who may see scans */
  usage?: { entriesToday: number; deniedToday: number; totalScans: number; lastScanAt: Date | null };
}

const snapshot = (g: Gate) => ({ code: g.code, nameEn: g.nameEn, nameAr: g.nameAr, isActive: g.isActive });

/**
 * The entrances. A gate is switched off, never deleted: scans already made at it keep pointing to it. A switched-off
 * gate cannot be chosen for a new scan (the scan service refuses it). Phase 8's rule stands: any staff member who may
 * scan may use any active gate, so there is no staff-to-gate assignment here.
 */
@Injectable()
export class GatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async list(actor: AuthenticatedUser): Promise<GateRow[]> {
    const gates = await this.prisma.gate.findMany({ orderBy: { code: 'asc' } });
    if (!actor.permissions.has('scans:read')) return gates.map((g) => ({ id: g.id, code: g.code, nameEn: g.nameEn, nameAr: g.nameAr, isActive: g.isActive, createdAt: g.createdAt }));
    const today = parkDateOf(this.clock.now());
    const range = { gte: parkInstant(today, '00:00'), lt: parkInstant(addDays(today, 1), '00:00') };
    const [totals, todays, last] = await Promise.all([
      this.prisma.ticketScan.groupBy({ by: ['gateId'], _count: { _all: true } }),
      this.prisma.ticketScan.groupBy({ by: ['gateId', 'result'], where: { scannedAt: range }, _count: { _all: true } }),
      this.prisma.ticketScan.groupBy({ by: ['gateId'], _max: { scannedAt: true } }),
    ]);
    return gates.map((g) => ({
      id: g.id, code: g.code, nameEn: g.nameEn, nameAr: g.nameAr, isActive: g.isActive, createdAt: g.createdAt,
      usage: {
        entriesToday: todays.find((t) => t.gateId === g.id && t.result === 'VALID')?._count._all ?? 0,
        deniedToday: todays.find((t) => t.gateId === g.id && t.result === 'INVALID')?._count._all ?? 0,
        totalScans: totals.find((t) => t.gateId === g.id)?._count._all ?? 0,
        lastScanAt: last.find((t) => t.gateId === g.id)?._max.scannedAt ?? null,
      },
    }));
  }

  async create(dto: CreateGateDto, actor: AuthenticatedUser, ctx: RequestContext): Promise<GateRow> {
    try {
      const g = await this.prisma.gate.create({ data: { code: dto.code, nameEn: dto.nameEn, nameAr: dto.nameAr } });
      await this.audit.record({ userId: actor.id, action: 'gate.created', entity: 'gate', entityId: g.id, newValue: snapshot(g) }, ctx);
      return { id: g.id, code: g.code, nameEn: g.nameEn, nameAr: g.nameAr, isActive: g.isActive, createdAt: g.createdAt };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AppException('GATE_CODE_TAKEN', `A gate with the code ${dto.code} already exists.`, 409);
      throw error;
    }
  }

  async update(id: string, dto: UpdateGateDto, actor: AuthenticatedUser, ctx: RequestContext): Promise<GateRow> {
    const before = await this.find(id);
    const g = await this.prisma.gate.update({ where: { id }, data: { nameEn: dto.nameEn, nameAr: dto.nameAr } });
    await this.audit.record({ userId: actor.id, action: 'gate.updated', entity: 'gate', entityId: id, oldValue: snapshot(before), newValue: snapshot(g) }, ctx);
    return { id: g.id, code: g.code, nameEn: g.nameEn, nameAr: g.nameAr, isActive: g.isActive, createdAt: g.createdAt };
  }

  async setActive(id: string, isActive: boolean, actor: AuthenticatedUser, ctx: RequestContext): Promise<GateRow> {
    const before = await this.find(id);
    if (before.isActive === isActive) return { id: before.id, code: before.code, nameEn: before.nameEn, nameAr: before.nameAr, isActive: before.isActive, createdAt: before.createdAt };
    const g = await this.prisma.gate.update({ where: { id }, data: { isActive } });
    await this.audit.record({ userId: actor.id, action: isActive ? 'gate.activated' : 'gate.deactivated', entity: 'gate', entityId: id, oldValue: { isActive: before.isActive }, newValue: snapshot(g) }, ctx);
    return { id: g.id, code: g.code, nameEn: g.nameEn, nameAr: g.nameAr, isActive: g.isActive, createdAt: g.createdAt };
  }

  private async find(id: string): Promise<Gate> {
    const g = await this.prisma.gate.findUnique({ where: { id } });
    if (!g) throw new AppException('GATE_NOT_FOUND', 'Gate not found.', 404);
    return g;
  }
}
