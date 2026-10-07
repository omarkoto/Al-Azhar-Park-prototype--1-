import { Injectable } from '@nestjs/common';
import { Prisma, TicketType } from '@prisma/client';
import { AppException } from '../../common/errors/app-exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, RequestContext } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { MIN_TICKETED_AGE } from './rules/visitors';
import { CreateTicketTypeDto, UpdateTicketTypeDto } from './ticketing.dto';

export interface TicketTypeView {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string | null;
  descriptionAr: string | null;
  minAge: number;
  maxAge: number | null;
  isActive: boolean;
  sortOrder: number;
  /** order lines that already sold this type: its age range is then fixed */
  timesSold: number;
  priceRows: number;
}

const view = (t: TicketType, timesSold: number, priceRows: number): TicketTypeView => ({
  id: t.id, code: t.code, nameEn: t.nameEn, nameAr: t.nameAr, descriptionEn: t.descriptionEn, descriptionAr: t.descriptionAr,
  minAge: t.minAge, maxAge: t.maxAge, isActive: t.isActive, sortOrder: t.sortOrder, timesSold, priceRows,
});

const snapshot = (t: TicketType) => ({ code: t.code, nameEn: t.nameEn, nameAr: t.nameAr, minAge: t.minAge, maxAge: t.maxAge, isActive: t.isActive, sortOrder: t.sortOrder });
const ranges = (a: { minAge: number; maxAge: number | null }, b: { minAge: number; maxAge: number | null }) =>
  a.minAge <= (b.maxAge ?? Infinity) && b.minAge <= (a.maxAge ?? Infinity);

/**
 * Ticket types (Adult, Child, ...). A type is never deleted: orders keep a copy of its name and price, but the
 * type itself is referenced by history, so it is switched off instead. No type may start below age 2, because
 * children under 2 do not need a ticket; the database repeats that rule.
 */
@Injectable()
export class TicketTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<TicketTypeView[]> {
    const types = await this.prisma.ticketType.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    const [sold, priced] = await Promise.all([
      this.prisma.orderItem.groupBy({ by: ['ticketTypeId'], _count: { _all: true } }),
      this.prisma.ticketPrice.groupBy({ by: ['ticketTypeId'], _count: { _all: true } }),
    ]);
    return types.map((t) => view(t, sold.find((s) => s.ticketTypeId === t.id)?._count._all ?? 0, priced.find((s) => s.ticketTypeId === t.id)?._count._all ?? 0));
  }

  async audiences() {
    const rows = await this.prisma.ticketAudience.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    return rows.map((a) => ({ id: a.id, code: a.code, nameEn: a.nameEn, nameAr: a.nameAr, descriptionEn: a.descriptionEn, descriptionAr: a.descriptionAr, isActive: a.isActive }));
  }

  async create(dto: CreateTicketTypeDto, actor: AuthenticatedUser, ctx: RequestContext): Promise<TicketTypeView> {
    this.checkAges(dto.minAge, dto.maxAge);
    if (await this.prisma.ticketType.findUnique({ where: { code: dto.code } })) {
      throw new AppException('TICKET_TYPE_CODE_TAKEN', `A ticket type with the code ${dto.code} already exists.`, 409);
    }
    if (dto.isActive) await this.assertNoAgeOverlap(dto.minAge, dto.maxAge);
    const last = await this.prisma.ticketType.aggregate({ _max: { sortOrder: true } });
    const created = await this.prisma.ticketType.create({
      data: { code: dto.code, nameEn: dto.nameEn, nameAr: dto.nameAr, descriptionEn: dto.descriptionEn, descriptionAr: dto.descriptionAr, minAge: dto.minAge, maxAge: dto.maxAge, isActive: dto.isActive, sortOrder: (last._max.sortOrder ?? 0) + 1 },
    });
    await this.audit.record({ userId: actor.id, action: 'ticket_type.created', entity: 'ticket_type', entityId: created.id, newValue: snapshot(created) }, ctx);
    return view(created, 0, 0);
  }

  async update(id: string, dto: UpdateTicketTypeDto, actor: AuthenticatedUser, ctx: RequestContext): Promise<TicketTypeView> {
    const before = await this.find(id);
    this.checkAges(dto.minAge, dto.maxAge);
    const timesSold = await this.prisma.orderItem.count({ where: { ticketTypeId: id } });
    if (timesSold > 0 && (dto.minAge !== before.minAge || dto.maxAge !== before.maxAge)) {
      throw new AppException('TICKET_TYPE_AGES_LOCKED', 'This ticket type has already been sold, so its age range can no longer change. Create a new ticket type instead.', 409);
    }
    if (dto.isActive) await this.assertNoAgeOverlap(dto.minAge, dto.maxAge, id);
    const updated = await this.prisma.ticketType.update({
      where: { id },
      data: { nameEn: dto.nameEn, nameAr: dto.nameAr, descriptionEn: dto.descriptionEn, descriptionAr: dto.descriptionAr, minAge: dto.minAge, maxAge: dto.maxAge, isActive: dto.isActive },
    });
    const action = before.isActive === updated.isActive ? 'ticket_type.updated' : updated.isActive ? 'ticket_type.activated' : 'ticket_type.deactivated';
    await this.audit.record({ userId: actor.id, action, entity: 'ticket_type', entityId: id, oldValue: snapshot(before), newValue: snapshot(updated) }, ctx);
    const priceRows = await this.prisma.ticketPrice.count({ where: { ticketTypeId: id } });
    return view(updated, timesSold, priceRows);
  }

  async setOrder(ids: string[], actor: AuthenticatedUser, ctx: RequestContext): Promise<TicketTypeView[]> {
    const types = await this.prisma.ticketType.findMany({ where: { deletedAt: null }, select: { id: true } });
    const known = new Set(types.map((t) => t.id));
    if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((i) => !known.has(i))) {
      throw new AppException('ORDER_MISMATCH', 'List every ticket type exactly once.', 422);
    }
    await this.prisma.$transaction(ids.map((id, index) => this.prisma.ticketType.update({ where: { id }, data: { sortOrder: index + 1 } })));
    await this.audit.record({ userId: actor.id, action: 'ticket_type.reordered', entity: 'ticket_type', newValue: { ids } as Prisma.InputJsonValue }, ctx);
    return this.list();
  }

  private checkAges(minAge: number, maxAge: number | null): void {
    if (minAge < MIN_TICKETED_AGE) throw new AppException('UNDER_TWO_NOT_TICKETED', 'Children under 2 enter free and do not need a ticket, so no ticket type may start below age 2.', 422);
    if (maxAge !== null && maxAge < minAge) throw new AppException('INVALID_AGE_RANGE', 'The oldest age cannot be below the youngest age.', 422);
  }

  /** two switched-on types cannot cover the same age: which one a visitor needs would be ambiguous */
  private async assertNoAgeOverlap(minAge: number, maxAge: number | null, ignoreId?: string): Promise<void> {
    const others = await this.prisma.ticketType.findMany({ where: { isActive: true, deletedAt: null, ...(ignoreId ? { id: { not: ignoreId } } : {}) } });
    const clash = others.find((o) => ranges({ minAge, maxAge }, o));
    if (clash) {
      throw new AppException('AGE_RANGE_OVERLAP', `${clash.nameEn} already covers ages ${clash.minAge}${clash.maxAge === null ? '+' : `–${clash.maxAge}`}. Two active ticket types cannot cover the same age.`, 409);
    }
  }

  private async find(id: string) {
    const t = await this.prisma.ticketType.findFirst({ where: { id, deletedAt: null } });
    if (!t) throw new AppException('NOT_FOUND', 'Ticket type not found.', 404);
    return t;
  }
}
