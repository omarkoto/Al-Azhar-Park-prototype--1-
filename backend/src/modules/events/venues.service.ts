import { Injectable } from '@nestjs/common';
import { Prisma, Venue } from '@prisma/client';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, RequestContext } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { CreateVenueDto, UpdateVenueDto } from './events.dto';

export interface VenueView {
  id: string;
  slug: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string | null;
  descriptionAr: string | null;
  addressEn: string | null;
  addressAr: string | null;
  capacity: number | null;
  isActive: boolean;
  sortOrder: number;
  /** events (not archived or cancelled ones excluded? no: every live event) that use this venue */
  eventCount: number;
}

const view = (v: Venue & { _count: { events: number } }): VenueView => ({
  id: v.id, slug: v.slug, nameEn: v.nameEn, nameAr: v.nameAr, descriptionEn: v.descriptionEn, descriptionAr: v.descriptionAr, addressEn: v.addressEn,
  addressAr: v.addressAr, capacity: v.capacity, isActive: v.isActive, sortOrder: v.sortOrder, eventCount: v._count.events,
});

const withCount = { _count: { select: { events: { where: { deletedAt: null } } } } } satisfies Prisma.VenueInclude;

/** Reusable places for events. Deactivating hides a venue from new events; it can be deleted only when no event uses it. */
@Injectable()
export class VenuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<VenueView[]> {
    const rows = await this.prisma.venue.findMany({ where: { deletedAt: null }, include: withCount, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] });
    return rows.map(view);
  }

  async get(id: string): Promise<VenueView> {
    return view(await this.load(id));
  }

  async create(dto: CreateVenueDto, actor: AuthenticatedUser, ctx: RequestContext): Promise<VenueView> {
    if (await this.prisma.venue.findUnique({ where: { slug: dto.slug }, select: { id: true } })) {
      throw new AppException('SLUG_TAKEN', `The address "${dto.slug}" is already used by a venue.`, 409);
    }
    const last = await this.prisma.venue.aggregate({ where: { deletedAt: null }, _max: { sortOrder: true } });
    const created = await this.prisma.venue.create({ data: { ...dto, sortOrder: (last._max.sortOrder ?? 0) + 1 }, include: withCount });
    await this.audit.record({ userId: actor.id, action: 'venue.created', entity: 'venue', entityId: created.id, newValue: this.shape(view(created)) }, ctx);
    return view(created);
  }

  async update(id: string, dto: UpdateVenueDto, actor: AuthenticatedUser, ctx: RequestContext): Promise<VenueView> {
    const before = view(await this.load(id));
    const updated = await this.prisma.venue.update({ where: { id }, data: dto, include: withCount });
    const after = view(updated);
    const action = before.isActive !== after.isActive ? (after.isActive ? 'venue.activated' : 'venue.deactivated') : 'venue.updated';
    await this.audit.record({ userId: actor.id, action, entity: 'venue', entityId: id, oldValue: this.shape(before), newValue: this.shape(after) }, ctx);
    return after;
  }

  async setOrder(ids: string[], actor: AuthenticatedUser, ctx: RequestContext): Promise<VenueView[]> {
    const existing = await this.prisma.venue.findMany({ where: { deletedAt: null }, select: { id: true } });
    if (existing.length !== ids.length || !existing.every((v) => ids.includes(v.id))) {
      throw new AppException('ORDER_MISMATCH', 'The new order must list every venue exactly once.', 422);
    }
    await this.prisma.$transaction(ids.map((id, i) => this.prisma.venue.update({ where: { id }, data: { sortOrder: i + 1 } })));
    await this.audit.record({ userId: actor.id, action: 'venue.reordered', entity: 'venue', newValue: { ids } }, ctx);
    return this.list();
  }

  /** Refused while any event (of any status) still uses the venue: switch it off instead, or move those events first. */
  async remove(id: string, actor: AuthenticatedUser, ctx: RequestContext): Promise<void> {
    const venue = view(await this.load(id));
    if (venue.eventCount > 0) {
      throw new AppException('VENUE_IN_USE', `${venue.eventCount} event(s) use this venue. Move them to another venue first, or switch the venue off instead.`, 409, { eventCount: venue.eventCount });
    }
    await this.prisma.venue.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await this.audit.record({ userId: actor.id, action: 'venue.deleted', entity: 'venue', entityId: id, oldValue: this.shape(venue) }, ctx);
  }

  private async load(id: string) {
    const row = await this.prisma.venue.findFirst({ where: { id, deletedAt: null }, include: withCount });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Venue not found.', 404);
    return row;
  }

  private shape(v: VenueView): Prisma.InputJsonValue {
    const { eventCount: _n, ...rest } = v;
    return rest as unknown as Prisma.InputJsonValue;
  }
}
