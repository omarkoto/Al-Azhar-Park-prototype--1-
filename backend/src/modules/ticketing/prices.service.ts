import { Injectable } from '@nestjs/common';
import { Prisma, TicketAudience, TicketPrice, TicketType } from '@prisma/client';
import { Clock } from '../../common/clock';
import { AppException } from '../../common/errors/app-exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, RequestContext } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { priceRow } from './purchase.service';
import { addDays, dateToIso, parkDateOf } from './rules/calendar';
import { DOW_EVERY_DAY, DOW_WEEKDAY, DOW_WEEKEND, dayTypeOf, selectPrice } from './rules/price-selection';
import { CreatePriceDto, ListPricesQueryDto } from './ticketing.dto';

export type PriceStatus = 'current' | 'upcoming' | 'ended' | 'inactive';
const OVERLAP = /overlapping standard price|trg_ticket_prices_overlap|ex_ticket_prices_no_overlap/;
const MASKS = { WEEKDAY: DOW_WEEKDAY, WEEKEND: DOW_WEEKEND, EVERY_DAY: DOW_EVERY_DAY } as const;
const daysOf = (mask: number): 'WEEKDAY' | 'WEEKEND' | 'EVERY_DAY' | 'CUSTOM' => (mask === DOW_WEEKDAY ? 'WEEKDAY' : mask === DOW_WEEKEND ? 'WEEKEND' : mask === DOW_EVERY_DAY ? 'EVERY_DAY' : 'CUSTOM');

type Row = TicketPrice & { ticketType: TicketType; audience: TicketAudience };

export interface PriceView {
  id: string;
  ticketTypeId: string;
  ticketType: { code: string; nameEn: string; nameAr: string };
  audienceId: string;
  audience: { code: string; nameEn: string; nameAr: string };
  kind: TicketPrice['kind'];
  days: 'WEEKDAY' | 'WEEKEND' | 'EVERY_DAY' | 'CUSTOM';
  amountMinor: number;
  currency: string;
  validFrom: string;
  validTo: string | null;
  isActive: boolean;
  status: PriceStatus;
  notes: string | null;
  /** how many order lines sold at exactly this price */
  timesUsed: number;
  createdAt: Date;
}

const statusOf = (p: { isActive: boolean; validFrom: string; validTo: string | null }, today: string): PriceStatus =>
  !p.isActive ? 'inactive' : p.validTo !== null && p.validTo < today ? 'ended' : p.validFrom > today ? 'upcoming' : 'current';

/**
 * Ticket prices are history. Changing a price never edits a row: it adds a NEW row that starts on a future
 * date and closes the previous row the day before. Orders copy the price they were sold at, so nothing in the
 * past can change; the database also refuses to edit or delete a price row.
 */
@Injectable()
export class PricesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  private toView(p: Row, today: string, used: number): PriceView {
    const validFrom = dateToIso(p.validFrom);
    const validTo = p.validTo ? dateToIso(p.validTo) : null;
    return {
      id: p.id, ticketTypeId: p.ticketTypeId, ticketType: { code: p.ticketType.code, nameEn: p.ticketType.nameEn, nameAr: p.ticketType.nameAr },
      audienceId: p.audienceId, audience: { code: p.audience.code, nameEn: p.audience.nameEn, nameAr: p.audience.nameAr }, kind: p.kind, days: daysOf(p.dowMask),
      amountMinor: p.amountMinor, currency: p.currency, validFrom, validTo, isActive: p.isActive, status: statusOf({ isActive: p.isActive, validFrom, validTo }, today), notes: p.notes, timesUsed: used, createdAt: p.createdAt,
    };
  }

  async list(query: ListPricesQueryDto): Promise<PriceView[]> {
    const today = parkDateOf(this.clock.now());
    const rows = await this.prisma.ticketPrice.findMany({
      where: { ...(query.ticketTypeId ? { ticketTypeId: query.ticketTypeId } : {}), ...(query.audienceId ? { audienceId: query.audienceId } : {}) },
      include: { ticketType: true, audience: true },
      orderBy: [{ validFrom: 'desc' }, { createdAt: 'desc' }],
    });
    const used = await this.prisma.orderItem.groupBy({ by: ['ticketPriceId'], _count: { _all: true } });
    const views = rows.map((r) => this.toView(r, today, used.find((u) => u.ticketPriceId === r.id)?._count._all ?? 0));
    const filtered = query.status ? views.filter((v) => v.status === query.status) : views;
    return filtered.sort((a, b) => a.ticketType.nameEn.localeCompare(b.ticketType.nameEn) || a.audience.nameEn.localeCompare(b.audience.nameEn) || a.days.localeCompare(b.days) || (a.validFrom < b.validFrom ? 1 : -1));
  }

  /** The price a customer would pay today, on the next weekday and the next weekend day, for every audience and type. */
  async current() {
    const today = parkDateOf(this.clock.now());
    const [audiences, types, prices] = await Promise.all([
      this.prisma.ticketAudience.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.ticketType.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.ticketPrice.findMany({ where: { isActive: true } }),
    ]);
    const rows = prices.map(priceRow);
    const next = (kind: 'WEEKDAY' | 'WEEKEND') => {
      for (let i = 0; i < 7; i += 1) if (dayTypeOf(addDays(today, i)) === kind) return addDays(today, i);
      return today;
    };
    const wd = next('WEEKDAY');
    const we = next('WEEKEND');
    return {
      today,
      audiences: audiences.map((a) => ({ id: a.id, code: a.code, nameEn: a.nameEn, nameAr: a.nameAr })),
      types: types.map((t) => ({ id: t.id, code: t.code, nameEn: t.nameEn, nameAr: t.nameAr, isActive: t.isActive })),
      cells: audiences.flatMap((a) =>
        types.map((t) => ({
          audienceId: a.id, ticketTypeId: t.id,
          weekdayMinor: selectPrice(rows, { ticketTypeId: t.id, audienceId: a.id, date: wd })?.amountMinor ?? null,
          weekendMinor: selectPrice(rows, { ticketTypeId: t.id, audienceId: a.id, date: we })?.amountMinor ?? null,
        })),
      ),
    };
  }

  async create(dto: CreatePriceDto, actor: AuthenticatedUser, ctx: RequestContext): Promise<PriceView> {
    const today = parkDateOf(this.clock.now());
    if (dto.validFrom < today) throw new AppException('PRICE_START_IN_THE_PAST', 'A new price must start today or later. Past prices cannot be rewritten.', 422);
    const mask = MASKS[dto.days];

    const result = await this.guard(() =>
      this.prisma.$transaction(async (tx) => {
        const type = await tx.ticketType.findFirst({ where: { id: dto.ticketTypeId, deletedAt: null } });
        if (!type) throw new AppException('NOT_FOUND', 'Ticket type not found.', 404);
        if (!type.isActive) throw new AppException('TICKET_TYPE_INACTIVE', 'This ticket type is switched off.', 422);
        const audience = await tx.ticketAudience.findUnique({ where: { id: dto.audienceId } });
        if (!audience) throw new AppException('NOT_FOUND', 'Audience not found.', 404);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`price:${dto.ticketTypeId}:${dto.audienceId}`}, 0))`;

        const from = new Date(`${dto.validFrom}T00:00:00Z`);
        const overlapping = await tx.ticketPrice.findMany({
          where: { ticketTypeId: dto.ticketTypeId, audienceId: dto.audienceId, isActive: true, kind: 'STANDARD', OR: [{ validTo: null }, { validTo: { gte: from } }] },
        });
        const closed: Array<{ id: string; validTo: string }> = [];
        for (const r of overlapping) {
          if ((r.dowMask & mask) === 0) continue;
          if (r.validFrom >= from) {
            throw new AppException('PRICE_CONFLICT', `A price starting ${dateToIso(r.validFrom)} already exists for these days. Switch it off first, or choose a later start date.`, 409);
          }
          if (r.dowMask !== mask) {
            throw new AppException('PRICE_CONFLICT', 'An existing price covers these days under a different grouping (for example every day). Switch it off first, then add the new weekday and weekend prices.', 409);
          }
          const validTo = addDays(dto.validFrom, -1);
          await tx.ticketPrice.update({ where: { id: r.id }, data: { validTo: new Date(`${validTo}T00:00:00Z`) } });
          closed.push({ id: r.id, validTo });
        }
        const created = await tx.ticketPrice.create({
          data: { ticketTypeId: dto.ticketTypeId, audienceId: dto.audienceId, kind: 'STANDARD', amountMinor: dto.amountMinor, currency: 'EGP', priority: 0, dowMask: mask, validFrom: from, validTo: null, isActive: true, notes: dto.notes, createdById: actor.id },
          include: { ticketType: true, audience: true },
        });
        await this.audit.record(
          {
            userId: actor.id, action: 'price.created', entity: 'ticket_price', entityId: created.id,
            newValue: { ticketType: type.code, audience: audience.code, days: dto.days, amountMinor: dto.amountMinor, validFrom: dto.validFrom, closedPrevious: closed } as Prisma.InputJsonValue,
          },
          ctx,
          tx,
        );
        return created;
      }),
    );
    return this.toView(result, today, 0);
  }

  async setActive(id: string, isActive: boolean, actor: AuthenticatedUser, ctx: RequestContext): Promise<PriceView> {
    const before = await this.prisma.ticketPrice.findUnique({ where: { id }, include: { ticketType: true, audience: true } });
    if (!before) throw new AppException('NOT_FOUND', 'Price not found.', 404);
    if (before.isActive === isActive) return this.toView(before, parkDateOf(this.clock.now()), 0);
    const updated = await this.guard(() => this.prisma.ticketPrice.update({ where: { id }, data: { isActive }, include: { ticketType: true, audience: true } }));
    await this.audit.record(
      {
        userId: actor.id, action: isActive ? 'price.activated' : 'price.deactivated', entity: 'ticket_price', entityId: id,
        oldValue: { isActive: before.isActive }, newValue: { isActive, ticketType: before.ticketType.code, audience: before.audience.code, amountMinor: before.amountMinor, validFrom: dateToIso(before.validFrom) },
      },
      ctx,
    );
    const used = await this.prisma.orderItem.count({ where: { ticketPriceId: id } });
    return this.toView(updated, parkDateOf(this.clock.now()), used);
  }

  /** The database refuses overlapping active prices even when two staff members act at the same moment. */
  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (OVERLAP.test(String((error as Error).message))) {
        throw new AppException('PRICE_OVERLAP', 'Another active price already covers some of the same days and dates.', 409);
      }
      throw error;
    }
  }
}
