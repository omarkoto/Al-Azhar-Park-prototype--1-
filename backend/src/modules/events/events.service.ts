import { Injectable } from '@nestjs/common';
import { Event, EventMedia, Media, Prisma, Venue } from '@prisma/client';
import { buildMeta, toSkipTake } from '../../common/dto/pagination';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { PageResult } from '../../common/http/envelope';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, RequestContext } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { MediaService, mediaView, MediaView } from '../media/media.service';
import { parkDateOf } from '../ticketing/rules/calendar';
import { parkDayStart } from '../ticketing/rules/event-window';
import { auditActionFor, canTransition, EventStatusValue, PUBLIC_STATUSES } from './event-status';
import { describeEventTimes, EventTimeError, resolveEventTimes } from './event-time';
import { CreateEventDto, UpdateEventDto } from './events.dto';

type EventRow = Event & {
  venue: Venue | null;
  heroMedia: Media | null;
  gallery: Array<EventMedia & { media: Media }>;
};

const include = {
  venue: true,
  heroMedia: true,
  gallery: { include: { media: true }, orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.EventInclude;

/** Deterministic order everywhere: the editors' order first, then the date, then creation, then id. */
const ORDER: Prisma.EventOrderByWithRelationInput[] = [{ sortOrder: 'asc' }, { startsAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }];

export interface VenueSummary {
  id: string;
  slug: string;
  nameEn: string;
  nameAr: string;
  isActive: boolean;
}

export interface EventView {
  id: string;
  slug: string;
  status: EventStatusValue;
  titleEn: string;
  titleAr: string;
  shortDescriptionEn: string;
  shortDescriptionAr: string;
  descriptionEn: string;
  descriptionAr: string;
  /** the Cairo calendar day the event starts on (an event after midnight still belongs to this day) */
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  /** it ends on the day after it starts (for example 20:00 – 01:00) */
  crossesMidnight: boolean;
  startsAt: Date;
  endsAt: Date | null;
  venue: VenueSummary | null;
  locationNameEn: string | null;
  locationNameAr: string | null;
  dateLabelEn: string | null;
  dateLabelAr: string | null;
  timeLabelEn: string | null;
  timeLabelAr: string | null;
  isFeatured: boolean;
  sortOrder: number;
  hero: MediaView | null;
  gallery: Array<{ media: MediaView; captionEn: string | null; captionAr: string | null }>;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const venueSummary = (v: Venue): VenueSummary => ({ id: v.id, slug: v.slug, nameEn: v.nameEn, nameAr: v.nameAr, isActive: v.isActive });

export const eventView = (e: EventRow): EventView => ({
  id: e.id, slug: e.slug, status: e.status as EventStatusValue, titleEn: e.titleEn, titleAr: e.titleAr,
  shortDescriptionEn: e.shortDescriptionEn, shortDescriptionAr: e.shortDescriptionAr, descriptionEn: e.descriptionEn, descriptionAr: e.descriptionAr,
  ...(({ date, startTime, endTime, crossesMidnight }) => ({ eventDate: date, startTime, endTime, crossesMidnight }))(describeEventTimes(e.startsAt, e.endsAt)),
  startsAt: e.startsAt, endsAt: e.endsAt, venue: e.venue && !e.venue.deletedAt ? venueSummary(e.venue) : null,
  locationNameEn: e.locationNameEn, locationNameAr: e.locationNameAr, dateLabelEn: e.dateLabelEn, dateLabelAr: e.dateLabelAr,
  timeLabelEn: e.timeLabelEn, timeLabelAr: e.timeLabelAr, isFeatured: e.isFeatured, sortOrder: e.sortOrder,
  hero: e.heroMedia && !e.heroMedia.deletedAt ? mediaView(e.heroMedia) : null,
  gallery: e.gallery.filter((g) => !g.media.deletedAt).map((g) => ({ media: mediaView(g.media), captionEn: g.captionEn, captionAr: g.captionAr })),
  publishedAt: e.publishedAt, createdAt: e.createdAt, updatedAt: e.updatedAt,
});

/** What a visitor may see: no ids, no status history, no editor identities. */
export interface PublicEvent {
  slug: string;
  status: 'COMING_SOON' | 'PUBLISHED';
  titleEn: string;
  titleAr: string;
  shortDescriptionEn: string;
  shortDescriptionAr: string;
  descriptionEn: string;
  descriptionAr: string;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  crossesMidnight: boolean;
  /** ISO instants, for calendar entries */
  startsAt: string;
  endsAt: string | null;
  dateLabelEn: string | null;
  dateLabelAr: string | null;
  timeLabelEn: string | null;
  timeLabelAr: string | null;
  venue: { slug: string; nameEn: string; nameAr: string; addressEn: string | null; addressAr: string | null } | null;
  locationNameEn: string | null;
  locationNameAr: string | null;
  isFeatured: boolean;
  hero: Pick<MediaView, 'url' | 'width' | 'height' | 'altEn' | 'altAr'> | null;
  gallery: Array<{ url: string; width: number | null; height: number | null; altEn: string | null; altAr: string | null; captionEn: string | null; captionAr: string | null }>;
}

const pickMedia = (m: MediaView) => ({ url: m.url, width: m.width, height: m.height, altEn: m.altEn, altAr: m.altAr });

function toPublic(e: EventRow): PublicEvent {
  const v = eventView(e);
  return {
    slug: v.slug, status: v.status as 'COMING_SOON' | 'PUBLISHED', titleEn: v.titleEn, titleAr: v.titleAr, shortDescriptionEn: v.shortDescriptionEn,
    shortDescriptionAr: v.shortDescriptionAr, descriptionEn: v.descriptionEn, descriptionAr: v.descriptionAr, eventDate: v.eventDate,
    startTime: v.startTime, endTime: v.endTime, crossesMidnight: v.crossesMidnight, startsAt: v.startsAt.toISOString(), endsAt: v.endsAt ? v.endsAt.toISOString() : null,
    dateLabelEn: v.dateLabelEn, dateLabelAr: v.dateLabelAr, timeLabelEn: v.timeLabelEn, timeLabelAr: v.timeLabelAr,
    venue: e.venue && !e.venue.deletedAt ? { slug: e.venue.slug, nameEn: e.venue.nameEn, nameAr: e.venue.nameAr, addressEn: e.venue.addressEn, addressAr: e.venue.addressAr } : null,
    locationNameEn: v.locationNameEn, locationNameAr: v.locationNameAr, isFeatured: v.isFeatured,
    hero: v.hero ? pickMedia(v.hero) : null, gallery: v.gallery.map((g) => ({ ...pickMedia(g.media), captionEn: g.captionEn, captionAr: g.captionAr })),
  };
}

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly media: MediaService,
  ) {}

  // ───────────────────────────── portal ─────────────────────────────

  async list(query: { page: number; limit: number; search?: string; status?: EventStatusValue }): Promise<PageResult<EventView>> {
    const where: Prisma.EventWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? { OR: [{ titleEn: { contains: query.search, mode: 'insensitive' } }, { titleAr: { contains: query.search } }, { slug: { contains: query.search.toLowerCase() } }] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.event.findMany({ where, include, orderBy: ORDER, ...toSkipTake(query) }),
      this.prisma.event.count({ where }),
    ]);
    return new PageResult(rows.map(eventView), buildMeta(query, total));
  }

  async get(id: string): Promise<EventView> {
    return eventView(await this.load(id));
  }

  /** A new event is always a DRAFT: making it public is a separate, permission-checked step. */
  async create(dto: CreateEventDto, actor: AuthenticatedUser, ctx: RequestContext): Promise<EventView> {
    if (await this.prisma.event.findUnique({ where: { slug: dto.slug }, select: { id: true } })) {
      throw new AppException('SLUG_TAKEN', `The address "${dto.slug}" is already used by another event.`, 409);
    }
    const times = this.times(dto);
    await this.assertVenue(dto.venueId, null);
    await this.media.requireImage(dto.heroMediaId);
    const last = await this.prisma.event.aggregate({ where: { deletedAt: null }, _max: { sortOrder: true } });
    const created = await this.prisma.event.create({
      data: { ...this.data(dto, times), slug: dto.slug, status: 'DRAFT', sortOrder: (last._max.sortOrder ?? 0) + 1, createdById: actor.id },
      include,
    });
    const view = eventView(created);
    await this.audit.record({ userId: actor.id, action: 'event.created', entity: 'event', entityId: created.id, newValue: this.auditShape(view) }, ctx);
    return view;
  }

  async update(id: string, dto: UpdateEventDto, actor: AuthenticatedUser, ctx: RequestContext): Promise<EventView> {
    const existing = await this.load(id);
    const before = eventView(existing);

    if (dto.slug && dto.slug !== existing.slug) {
      if (existing.publishedAt) throw new AppException('SLUG_LOCKED', 'This event has been public, so its address cannot change (links to it would break).', 409);
      if (await this.prisma.event.findUnique({ where: { slug: dto.slug }, select: { id: true } })) {
        throw new AppException('SLUG_TAKEN', `The address "${dto.slug}" is already used by another event.`, 409);
      }
    }
    const times = this.times(dto);
    await this.assertVenue(dto.venueId, existing.venueId);
    await this.media.requireImage(dto.heroMediaId);

    const updated = await this.prisma.event.update({
      where: { id },
      data: { ...this.data(dto, times), ...(dto.slug ? { slug: dto.slug } : {}) },
      include,
    });
    const after = eventView(updated);
    await this.audit.record(
      { userId: actor.id, action: 'event.updated', entity: 'event', entityId: id, oldValue: this.auditShape(before), newValue: this.auditShape(after) },
      ctx,
    );
    if ((before.venue?.id ?? null) !== (after.venue?.id ?? null)) {
      await this.audit.record(
        { userId: actor.id, action: 'event.venue_changed', entity: 'event', entityId: id, oldValue: { venueId: before.venue?.id ?? null }, newValue: { venueId: after.venue?.id ?? null } },
        ctx,
      );
    }
    if ((before.hero?.id ?? null) !== (after.hero?.id ?? null)) {
      await this.audit.record(
        { userId: actor.id, action: 'event.hero_changed', entity: 'event', entityId: id, oldValue: { heroMediaId: before.hero?.id ?? null }, newValue: { heroMediaId: after.hero?.id ?? null } },
        ctx,
      );
    }
    return after;
  }

  async setStatus(id: string, to: EventStatusValue, actor: AuthenticatedUser, ctx: RequestContext): Promise<EventView> {
    const existing = await this.load(id);
    const from = existing.status as EventStatusValue;
    if (!canTransition(from, to)) {
      throw new AppException('INVALID_STATUS_CHANGE', `An event that is ${label(from)} cannot become ${label(to)}.`, 409, { from, to });
    }
    const updated = await this.prisma.event.update({
      where: { id },
      data: { status: to, ...(to === 'PUBLISHED' || to === 'COMING_SOON' ? { publishedAt: existing.publishedAt ?? new Date() } : {}) },
      include,
    });
    await this.audit.record(
      { userId: actor.id, action: auditActionFor(from, to), entity: 'event', entityId: id, oldValue: { status: from }, newValue: { status: to } },
      ctx,
    );
    return eventView(updated);
  }

  async setOrder(ids: string[], actor: AuthenticatedUser, ctx: RequestContext): Promise<EventView[]> {
    const existing = await this.prisma.event.findMany({ where: { deletedAt: null }, select: { id: true } });
    if (existing.length !== ids.length || !existing.every((e) => ids.includes(e.id))) {
      throw new AppException('ORDER_MISMATCH', 'The new order must list every event exactly once.', 422);
    }
    await this.prisma.$transaction(ids.map((id, i) => this.prisma.event.update({ where: { id }, data: { sortOrder: i + 1 } })));
    await this.audit.record({ userId: actor.id, action: 'event.reordered', entity: 'event', newValue: { ids } }, ctx);
    return (await this.prisma.event.findMany({ where: { deletedAt: null }, include, orderBy: ORDER })).map(eventView);
  }

  async setGallery(
    id: string,
    items: Array<{ mediaId: string; captionEn: string | null; captionAr: string | null }>,
    actor: AuthenticatedUser,
    ctx: RequestContext,
  ): Promise<EventView> {
    const before = await this.load(id);
    for (const item of items) await this.media.requireImage(item.mediaId);
    await this.prisma.$transaction([
      this.prisma.eventMedia.deleteMany({ where: { eventId: id } }),
      this.prisma.eventMedia.createMany({ data: items.map((it, i) => ({ eventId: id, mediaId: it.mediaId, sortOrder: i, captionEn: it.captionEn, captionAr: it.captionAr })) }),
    ]);
    await this.audit.record(
      {
        userId: actor.id, action: 'event.gallery_updated', entity: 'event', entityId: id,
        oldValue: { media: before.gallery.map((g) => g.mediaId) }, newValue: { media: items.map((i) => i.mediaId) },
      },
      ctx,
    );
    return this.get(id);
  }

  // ───────────────────────────── public ─────────────────────────────

  /** Published events. By default only the ones that have not finished yet. */
  async listPublished(when: 'upcoming' | 'past' | 'all'): Promise<PublicEvent[]> {
    const startOfToday = parkDayStart(parkDateOf(new Date()));
    const notFinished: Prisma.EventWhereInput = { OR: [{ endsAt: { gte: new Date() } }, { endsAt: null, startsAt: { gte: startOfToday } }] };
    const rows = await this.prisma.event.findMany({
      where: { deletedAt: null, status: 'PUBLISHED', ...(when === 'upcoming' ? notFinished : when === 'past' ? { NOT: notFinished } : {}) },
      include,
      orderBy: ORDER,
    });
    return rows.map(toPublic);
  }

  async listComingSoon(): Promise<PublicEvent[]> {
    const rows = await this.prisma.event.findMany({ where: { deletedAt: null, status: 'COMING_SOON' }, include, orderBy: ORDER });
    return rows.map(toPublic);
  }

  /** By address; only COMING_SOON and PUBLISHED events exist as far as a visitor is concerned. */
  async getPublic(slug: string): Promise<PublicEvent> {
    const row = await this.prisma.event.findFirst({ where: { slug, deletedAt: null, status: { in: [...PUBLIC_STATUSES] } }, include });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Event not found.', 404);
    return toPublic(row);
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private async load(id: string): Promise<EventRow> {
    const row = await this.prisma.event.findFirst({ where: { id, deletedAt: null }, include });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Event not found.', 404);
    return row;
  }

  private times(dto: { eventDate: string; startTime?: string | null; endTime?: string | null }) {
    try {
      return resolveEventTimes({ date: dto.eventDate, startTime: dto.startTime, endTime: dto.endTime });
    } catch (e) {
      if (e instanceof EventTimeError) {
        throw new AppException('INVALID_EVENT_TIMES', e.message, 422, [{ path: e.problem === 'TIMES_TOGETHER' ? 'endTime' : 'startTime', message: e.message }]);
      }
      throw e;
    }
  }

  private data(dto: CreateEventDto | UpdateEventDto, t: ReturnType<typeof resolveEventTimes>) {
    return {
      titleEn: dto.titleEn, titleAr: dto.titleAr, shortDescriptionEn: dto.shortDescriptionEn, shortDescriptionAr: dto.shortDescriptionAr,
      descriptionEn: dto.descriptionEn, descriptionAr: dto.descriptionAr, startsAt: t.startsAt, endsAt: t.endsAt,
      venueId: dto.venueId, heroMediaId: dto.heroMediaId, locationNameEn: dto.locationNameEn, locationNameAr: dto.locationNameAr,
      dateLabelEn: dto.dateLabelEn, dateLabelAr: dto.dateLabelAr, timeLabelEn: dto.timeLabelEn, timeLabelAr: dto.timeLabelAr, isFeatured: dto.isFeatured,
    };
  }

  /** The venue must exist and be active — unless it is the one the event already has. */
  private async assertVenue(venueId: string | null | undefined, current: string | null): Promise<void> {
    if (!venueId) return;
    const v = await this.prisma.venue.findFirst({ where: { id: venueId, deletedAt: null }, select: { isActive: true } });
    if (!v) throw new AppException('VENUE_NOT_FOUND', 'That venue does not exist.', 422, [{ path: 'venueId', message: 'that venue does not exist' }]);
    if (!v.isActive && venueId !== current) {
      throw new AppException('VENUE_INACTIVE', 'That venue is switched off. Choose an active venue.', 422, [{ path: 'venueId', message: 'that venue is switched off' }]);
    }
  }

  private auditShape(v: EventView): Prisma.InputJsonValue {
    const { createdAt: _c, updatedAt: _u, hero, gallery, venue, startsAt, endsAt, ...rest } = v;
    return { ...rest, startsAt: startsAt.toISOString(), endsAt: endsAt ? endsAt.toISOString() : null, venueId: venue?.id ?? null, heroMediaId: hero?.id ?? null, galleryMediaIds: gallery.map((g) => g.media.id) } as unknown as Prisma.InputJsonValue;
  }
}

const label = (s: EventStatusValue) => s.toLowerCase().replace('_', ' ');
