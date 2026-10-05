import { Injectable } from '@nestjs/common';
import { Prisma, SpecialHours } from '@prisma/client';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, RequestContext } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { dateToIso, parkDateOf, timeToHhmm } from '../ticketing/rules/calendar';
import { SpecialHoursDto, UpdateWeeklyHoursDto } from './park.dto';

export interface WeeklyDay {
  dayOfWeek: number;
  isClosed: boolean;
  opens: string | null;
  closes: string | null;
}

export interface SpecialView {
  id: string;
  kind: 'HOLIDAY' | 'TEMPORARY_CLOSURE' | 'SPECIAL_HOURS';
  dateFrom: string;
  dateTo: string;
  isClosed: boolean;
  opens: string | null;
  closes: string | null;
  labelEn: string;
  labelAr: string;
  noteEn: string | null;
  noteAr: string | null;
  priority: number;
  isActive: boolean;
}

const OVERLAP_CONSTRAINT = 'ex_special_hours_no_overlap';
const toTime = (hhmm: string | null | undefined) => (hhmm ? new Date(`1970-01-01T${hhmm}:00Z`) : null);

export const specialView = (s: SpecialHours): SpecialView => ({
  id: s.id, kind: s.kind, dateFrom: dateToIso(s.dateFrom), dateTo: dateToIso(s.dateTo), isClosed: s.isClosed,
  opens: s.opens ? timeToHhmm(s.opens) : null, closes: s.closes ? timeToHhmm(s.closes) : null,
  labelEn: s.labelEn, labelAr: s.labelAr, noteEn: s.noteEn, noteAr: s.noteAr, priority: s.priority, isActive: s.isActive,
});

/**
 * Weekly opening hours and special hours (holidays, Ramadan, closures). This is the SAME data the ticket-sales
 * rules read, so changing it here changes when same-day tickets stop being sold.
 */
@Injectable()
export class HoursService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getWeekly(): Promise<WeeklyDay[]> {
    const rows = await this.prisma.openingHour.findMany({ orderBy: { dayOfWeek: 'asc' } });
    return rows.map((r) => ({
      dayOfWeek: r.dayOfWeek, isClosed: r.isClosed, opens: r.opens ? timeToHhmm(r.opens) : null, closes: r.closes ? timeToHhmm(r.closes) : null,
    }));
  }

  async setWeekly(dto: UpdateWeeklyHoursDto, actor: AuthenticatedUser, ctx: RequestContext): Promise<WeeklyDay[]> {
    const before = await this.getWeekly();
    await this.prisma.$transaction(
      dto.days.map((d) => {
        const closed = d.isClosed;
        const data = { isClosed: closed, opens: closed ? null : toTime(d.opens), closes: closed ? null : toTime(d.closes) };
        return this.prisma.openingHour.upsert({ where: { dayOfWeek: d.dayOfWeek }, update: data, create: { dayOfWeek: d.dayOfWeek, ...data } });
      }),
    );
    const after = await this.getWeekly();
    await this.audit.record(
      {
        userId: actor.id, action: 'hours.weekly_updated', entity: 'opening_hours',
        oldValue: before as unknown as Prisma.InputJsonValue, newValue: after as unknown as Prisma.InputJsonValue,
      },
      ctx,
    );
    return after;
  }

  async listSpecial(when: 'upcoming' | 'past' | 'all'): Promise<SpecialView[]> {
    const today = new Date(`${parkDateOf(new Date())}T00:00:00Z`);
    const where: Prisma.SpecialHoursWhereInput =
      when === 'upcoming' ? { dateTo: { gte: today } } : when === 'past' ? { dateTo: { lt: today } } : {};
    const rows = await this.prisma.specialHours.findMany({ where, orderBy: [{ dateFrom: when === 'past' ? 'desc' : 'asc' }, { priority: 'desc' }] });
    return rows.map(specialView);
  }

  async createSpecial(dto: SpecialHoursDto, actor: AuthenticatedUser, ctx: RequestContext): Promise<SpecialView> {
    await this.assertNoOverlap(dto);
    const created = await this.guard(() => this.prisma.specialHours.create({ data: this.data(dto) }));
    const view = specialView(created);
    await this.audit.record({ userId: actor.id, action: 'hours.special_created', entity: 'special_hours', entityId: created.id, newValue: view as unknown as Prisma.InputJsonValue }, ctx);
    return view;
  }

  async updateSpecial(id: string, dto: SpecialHoursDto, actor: AuthenticatedUser, ctx: RequestContext): Promise<SpecialView> {
    const existing = await this.find(id);
    await this.assertNoOverlap(dto, id);
    const updated = await this.guard(() => this.prisma.specialHours.update({ where: { id }, data: this.data(dto) }));
    const view = specialView(updated);
    await this.audit.record(
      { userId: actor.id, action: 'hours.special_updated', entity: 'special_hours', entityId: id, oldValue: specialView(existing) as unknown as Prisma.InputJsonValue, newValue: view as unknown as Prisma.InputJsonValue },
      ctx,
    );
    return view;
  }

  async deleteSpecial(id: string, actor: AuthenticatedUser, ctx: RequestContext): Promise<void> {
    const existing = await this.find(id);
    await this.prisma.specialHours.delete({ where: { id } });
    await this.audit.record(
      { userId: actor.id, action: 'hours.special_deleted', entity: 'special_hours', entityId: id, oldValue: specialView(existing) as unknown as Prisma.InputJsonValue },
      ctx,
    );
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private async find(id: string) {
    const row = await this.prisma.specialHours.findUnique({ where: { id } });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Special hours entry not found.', 404);
    return row;
  }

  private data(dto: SpecialHoursDto): Prisma.SpecialHoursUncheckedCreateInput {
    return {
      kind: dto.kind, dateFrom: new Date(`${dto.dateFrom}T00:00:00Z`), dateTo: new Date(`${dto.dateTo}T00:00:00Z`),
      isClosed: dto.isClosed, opens: dto.isClosed ? null : toTime(dto.opens), closes: dto.isClosed ? null : toTime(dto.closes),
      labelEn: dto.labelEn, labelAr: dto.labelAr, noteEn: dto.noteEn, noteAr: dto.noteAr, priority: dto.priority, isActive: dto.isActive,
    };
  }

  /** Two active periods with the same priority may not cover the same day: which one applies would be ambiguous. */
  private async assertNoOverlap(dto: SpecialHoursDto, ignoreId?: string): Promise<void> {
    if (!dto.isActive) return;
    const clash = await this.prisma.specialHours.findFirst({
      where: {
        isActive: true, priority: dto.priority, ...(ignoreId ? { id: { not: ignoreId } } : {}),
        dateFrom: { lte: new Date(`${dto.dateTo}T00:00:00Z`) }, dateTo: { gte: new Date(`${dto.dateFrom}T00:00:00Z`) },
      },
    });
    if (clash) {
      throw new AppException(
        'SPECIAL_HOURS_OVERLAP',
        `"${clash.labelEn}" (${dateToIso(clash.dateFrom)} to ${dateToIso(clash.dateTo)}) already uses priority ${dto.priority} on those dates. Give one of them a different priority.`,
        409,
      );
    }
  }

  /** The database also enforces the overlap rule, so two simultaneous edits cannot both slip through. */
  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (String((error as Error).message).includes(OVERLAP_CONSTRAINT)) {
        throw new AppException('SPECIAL_HOURS_OVERLAP', 'Another special-hours period with the same priority covers those dates.', 409);
      }
      throw error;
    }
  }
}
