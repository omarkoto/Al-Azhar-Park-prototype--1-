import { Injectable } from '@nestjs/common';
import { Menu, Media, Prisma, Restaurant, RestaurantMedia } from '@prisma/client';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, RequestContext } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { mediaView, MediaView } from '../media/media.service';
import { hhmmToMinutes, timeToHhmm } from '../ticketing/rules/calendar';
import { CreateRestaurantDto, MenuDto, UpdateRestaurantDto } from './restaurants.dto';

const time = (hhmm: string | null) => (hhmm ? new Date(`1970-01-01T${hhmm}:00Z`) : null);

type RestaurantRow = Restaurant & {
  heroMedia: Media | null;
  gallery: Array<RestaurantMedia & { media: Media }>;
  menus: Array<Menu & { pdfMedia: Media | null }>;
};

const include = {
  heroMedia: true,
  gallery: { include: { media: true }, orderBy: { sortOrder: 'asc' } },
  menus: { where: { deletedAt: null }, include: { pdfMedia: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
} satisfies Prisma.RestaurantInclude;

export interface MenuView {
  id: string;
  nameEn: string;
  nameAr: string;
  kind: 'link' | 'pdf';
  externalUrl: string | null;
  pdf: MediaView | null;
  /** where a visitor goes: the external link or the stored PDF (site-relative) */
  url: string;
  isActive: boolean;
  sortOrder: number;
}

export interface RestaurantView {
  id: string;
  slug: string;
  nameEn: string;
  nameAr: string;
  brandEn: string | null;
  brandAr: string | null;
  taglineEn: string | null;
  taglineAr: string | null;
  shortDescriptionEn: string | null;
  shortDescriptionAr: string | null;
  descriptionEn: string;
  descriptionAr: string;
  atmosphereEn: string | null;
  atmosphereAr: string | null;
  locationEn: string | null;
  locationAr: string | null;
  opensAt: string | null;
  closesAt: string | null;
  /** the restaurant closes after midnight (for example 12:00 – 00:00 or 18:00 – 01:00) */
  closesAfterMidnight: boolean;
  phones: string[];
  reservationUrl: string | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  hero: MediaView | null;
  gallery: Array<{ media: MediaView; captionEn: string | null; captionAr: string | null }>;
  menus: MenuView[];
  isActive: boolean;
  sortOrder: number;
  updatedAt: Date;
}

const menuView = (m: Menu & { pdfMedia: Media | null }): MenuView => ({
  id: m.id, nameEn: m.nameEn, nameAr: m.nameAr, kind: m.pdfMedia ? 'pdf' : 'link', externalUrl: m.externalUrl,
  pdf: m.pdfMedia ? mediaView(m.pdfMedia) : null, url: m.pdfMedia ? m.pdfMedia.url : (m.externalUrl as string), isActive: m.isActive, sortOrder: m.sortOrder,
});

export const restaurantView = (r: RestaurantRow): RestaurantView => {
  const opensAt = r.opensAt ? timeToHhmm(r.opensAt) : null;
  const closesAt = r.closesAt ? timeToHhmm(r.closesAt) : null;
  return {
    id: r.id, slug: r.slug, nameEn: r.nameEn, nameAr: r.nameAr, brandEn: r.brandEn, brandAr: r.brandAr, taglineEn: r.taglineEn, taglineAr: r.taglineAr,
    shortDescriptionEn: r.shortDescriptionEn, shortDescriptionAr: r.shortDescriptionAr, descriptionEn: r.descriptionEn, descriptionAr: r.descriptionAr,
    atmosphereEn: r.atmosphereEn, atmosphereAr: r.atmosphereAr, locationEn: r.locationEn, locationAr: r.locationAr, opensAt, closesAt,
    closesAfterMidnight: !!opensAt && !!closesAt && hhmmToMinutes(closesAt) <= hhmmToMinutes(opensAt),
    phones: r.phones, reservationUrl: r.reservationUrl, websiteUrl: r.websiteUrl, instagramUrl: r.instagramUrl,
    hero: r.heroMedia && !r.heroMedia.deletedAt ? mediaView(r.heroMedia) : null,
    gallery: r.gallery.filter((g) => !g.media.deletedAt).map((g) => ({ media: mediaView(g.media), captionEn: g.captionEn, captionAr: g.captionAr })),
    menus: r.menus.map(menuView), isActive: r.isActive, sortOrder: r.sortOrder, updatedAt: r.updatedAt,
  };
};

@Injectable()
export class RestaurantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────────── restaurants ─────────────────────────────

  async list(): Promise<RestaurantView[]> {
    const rows = await this.prisma.restaurant.findMany({ where: { deletedAt: null }, include, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    return rows.map(restaurantView);
  }

  async get(id: string): Promise<RestaurantView> {
    return restaurantView(await this.load(id));
  }

  async create(dto: CreateRestaurantDto, actor: AuthenticatedUser, ctx: RequestContext): Promise<RestaurantView> {
    if (await this.prisma.restaurant.findUnique({ where: { slug: dto.slug }, select: { id: true } })) {
      throw new AppException('SLUG_TAKEN', `The address "${dto.slug}" is already used by a restaurant (possibly a deleted one). Choose another.`, 409);
    }
    await this.assertImage(dto.heroMediaId);
    const last = await this.prisma.restaurant.aggregate({ where: { deletedAt: null }, _max: { sortOrder: true } });
    const { opensAt, closesAt, slug, ...rest } = dto;
    const created = await this.prisma.restaurant.create({
      data: { ...rest, slug, opensAt: time(opensAt ?? null), closesAt: time(closesAt ?? null), sortOrder: (last._max.sortOrder ?? 0) + 1 },
      include,
    });
    const view = restaurantView(created);
    await this.audit.record({ userId: actor.id, action: 'restaurant.created', entity: 'restaurant', entityId: created.id, newValue: this.auditShape(view) }, ctx);
    return view;
  }

  async update(id: string, dto: UpdateRestaurantDto, actor: AuthenticatedUser, ctx: RequestContext): Promise<RestaurantView> {
    const before = restaurantView(await this.load(id));
    await this.assertImage(dto.heroMediaId);
    const { opensAt, closesAt, ...rest } = dto;
    const updated = await this.prisma.restaurant.update({
      where: { id },
      data: { ...rest, opensAt: time(opensAt ?? null), closesAt: time(closesAt ?? null) },
      include,
    });
    const view = restaurantView(updated);
    await this.audit.record(
      { userId: actor.id, action: 'restaurant.updated', entity: 'restaurant', entityId: id, oldValue: this.auditShape(before), newValue: this.auditShape(view) },
      ctx,
    );
    return view;
  }

  /** Hidden from the website and the portal list; the record (and its address) is kept. */
  async remove(id: string, actor: AuthenticatedUser, ctx: RequestContext): Promise<void> {
    const before = restaurantView(await this.load(id));
    await this.prisma.$transaction([
      this.prisma.restaurant.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } }),
      this.prisma.menu.updateMany({ where: { restaurantId: id, deletedAt: null }, data: { deletedAt: new Date() } }),
    ]);
    await this.audit.record({ userId: actor.id, action: 'restaurant.deleted', entity: 'restaurant', entityId: id, oldValue: this.auditShape(before) }, ctx);
  }

  async setOrder(ids: string[], actor: AuthenticatedUser, ctx: RequestContext): Promise<RestaurantView[]> {
    const existing = await this.prisma.restaurant.findMany({ where: { deletedAt: null }, select: { id: true } });
    if (existing.length !== ids.length || !existing.every((r) => ids.includes(r.id))) {
      throw new AppException('ORDER_MISMATCH', 'The new order must list every restaurant exactly once.', 422);
    }
    await this.prisma.$transaction(ids.map((id, i) => this.prisma.restaurant.update({ where: { id }, data: { sortOrder: i + 1 } })));
    await this.audit.record({ userId: actor.id, action: 'restaurant.reordered', entity: 'restaurant', newValue: { ids } }, ctx);
    return this.list();
  }

  async setGallery(
    id: string,
    items: Array<{ mediaId: string; captionEn: string | null; captionAr: string | null }>,
    actor: AuthenticatedUser,
    ctx: RequestContext,
  ): Promise<RestaurantView> {
    const before = await this.load(id);
    for (const item of items) await this.assertImage(item.mediaId, true);
    await this.prisma.$transaction([
      this.prisma.restaurantMedia.deleteMany({ where: { restaurantId: id } }),
      this.prisma.restaurantMedia.createMany({ data: items.map((it, i) => ({ restaurantId: id, mediaId: it.mediaId, sortOrder: i, captionEn: it.captionEn, captionAr: it.captionAr })) }),
    ]);
    await this.audit.record(
      {
        userId: actor.id, action: 'restaurant.gallery_updated', entity: 'restaurant', entityId: id,
        oldValue: { media: before.gallery.map((g) => g.mediaId) }, newValue: { media: items.map((i) => i.mediaId) },
      },
      ctx,
    );
    return this.get(id);
  }

  // ───────────────────────────── menus ─────────────────────────────

  async createMenu(restaurantId: string, dto: MenuDto, actor: AuthenticatedUser, ctx: RequestContext): Promise<MenuView> {
    await this.load(restaurantId);
    await this.assertPdf(dto.pdfMediaId);
    const last = await this.prisma.menu.aggregate({ where: { restaurantId, deletedAt: null }, _max: { sortOrder: true } });
    const created = await this.prisma.menu.create({
      data: { restaurantId, nameEn: dto.nameEn, nameAr: dto.nameAr, externalUrl: dto.externalUrl, pdfMediaId: dto.pdfMediaId, isActive: dto.isActive, sortOrder: (last._max.sortOrder ?? 0) + 1 },
      include: { pdfMedia: true },
    });
    await this.audit.record({ userId: actor.id, action: 'menu.created', entity: 'menu', entityId: created.id, newValue: { restaurantId, nameEn: dto.nameEn, externalUrl: dto.externalUrl, pdfMediaId: dto.pdfMediaId } }, ctx);
    return menuView(created);
  }

  async updateMenu(id: string, dto: MenuDto, actor: AuthenticatedUser, ctx: RequestContext): Promise<MenuView> {
    const before = await this.findMenu(id);
    await this.assertPdf(dto.pdfMediaId);
    const updated = await this.prisma.menu.update({
      where: { id },
      data: { nameEn: dto.nameEn, nameAr: dto.nameAr, externalUrl: dto.externalUrl, pdfMediaId: dto.pdfMediaId, isActive: dto.isActive },
      include: { pdfMedia: true },
    });
    await this.audit.record(
      {
        userId: actor.id, action: 'menu.updated', entity: 'menu', entityId: id,
        oldValue: { nameEn: before.nameEn, externalUrl: before.externalUrl, pdfMediaId: before.pdfMediaId, isActive: before.isActive },
        newValue: { nameEn: dto.nameEn, externalUrl: dto.externalUrl, pdfMediaId: dto.pdfMediaId, isActive: dto.isActive },
      },
      ctx,
    );
    return menuView(updated);
  }

  async deleteMenu(id: string, actor: AuthenticatedUser, ctx: RequestContext): Promise<void> {
    const before = await this.findMenu(id);
    await this.prisma.menu.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({ userId: actor.id, action: 'menu.deleted', entity: 'menu', entityId: id, oldValue: { restaurantId: before.restaurantId, nameEn: before.nameEn } }, ctx);
  }

  async setMenuOrder(restaurantId: string, ids: string[], actor: AuthenticatedUser, ctx: RequestContext): Promise<MenuView[]> {
    await this.load(restaurantId);
    const existing = await this.prisma.menu.findMany({ where: { restaurantId, deletedAt: null }, select: { id: true } });
    if (existing.length !== ids.length || !existing.every((m) => ids.includes(m.id))) {
      throw new AppException('ORDER_MISMATCH', 'The new order must list every menu of this restaurant exactly once.', 422);
    }
    await this.prisma.$transaction(ids.map((mid, i) => this.prisma.menu.update({ where: { id: mid }, data: { sortOrder: i + 1 } })));
    await this.audit.record({ userId: actor.id, action: 'menu.reordered', entity: 'restaurant', entityId: restaurantId, newValue: { ids } }, ctx);
    return (await this.get(restaurantId)).menus;
  }

  // ───────────────────────────── public ─────────────────────────────

  /** What the website shows: active restaurants, in order, with active menus only. */
  async listPublic(): Promise<PublicRestaurant[]> {
    const rows = await this.prisma.restaurant.findMany({ where: { deletedAt: null, isActive: true }, include, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    return rows.map((r) => toPublic(restaurantView(r)));
  }

  async getPublic(slug: string): Promise<PublicRestaurant> {
    const row = await this.prisma.restaurant.findFirst({ where: { slug, deletedAt: null, isActive: true }, include });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Restaurant not found.', 404);
    return toPublic(restaurantView(row));
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private async load(id: string): Promise<RestaurantRow> {
    const row = await this.prisma.restaurant.findFirst({ where: { id, deletedAt: null }, include });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Restaurant not found.', 404);
    return row;
  }

  private async findMenu(id: string) {
    const row = await this.prisma.menu.findFirst({ where: { id, deletedAt: null, restaurant: { deletedAt: null } } });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Menu not found.', 404);
    return row;
  }

  private async assertImage(mediaId: string | null | undefined, gallery = false): Promise<void> {
    if (!mediaId) return;
    const m = await this.prisma.media.findFirst({ where: { id: mediaId, deletedAt: null }, select: { mimeType: true } });
    if (!m) throw new AppException('MEDIA_NOT_FOUND', 'That photo does not exist (it may have been deleted).', 422, { field: gallery ? 'items' : 'heroMediaId' });
    if (!m.mimeType.startsWith('image/')) throw new AppException('MEDIA_NOT_IMAGE', 'That file is not an image.', 422);
  }

  private async assertPdf(mediaId: string | null | undefined): Promise<void> {
    if (!mediaId) return;
    const m = await this.prisma.media.findFirst({ where: { id: mediaId, deletedAt: null }, select: { mimeType: true } });
    if (!m) throw new AppException('MEDIA_NOT_FOUND', 'That PDF does not exist (it may have been deleted).', 422);
    if (m.mimeType !== 'application/pdf') throw new AppException('MEDIA_NOT_PDF', 'A menu file must be a PDF.', 422);
  }

  private auditShape(v: RestaurantView): Prisma.InputJsonValue {
    const { updatedAt: _u, hero, gallery, menus, ...rest } = v;
    return { ...rest, heroMediaId: hero?.id ?? null, galleryMediaIds: gallery.map((g) => g.media.id), menuIds: menus.map((m) => m.id) } as unknown as Prisma.InputJsonValue;
  }
}

export interface PublicRestaurant {
  slug: string;
  nameEn: string;
  nameAr: string;
  brandEn: string | null;
  brandAr: string | null;
  taglineEn: string | null;
  taglineAr: string | null;
  shortDescriptionEn: string | null;
  shortDescriptionAr: string | null;
  descriptionEn: string;
  descriptionAr: string;
  atmosphereEn: string | null;
  atmosphereAr: string | null;
  locationEn: string | null;
  locationAr: string | null;
  opensAt: string | null;
  closesAt: string | null;
  closesAfterMidnight: boolean;
  phones: string[];
  reservationUrl: string | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  hero: Pick<MediaView, 'url' | 'width' | 'height' | 'altEn' | 'altAr'> | null;
  gallery: Array<{ url: string; width: number | null; height: number | null; altEn: string | null; altAr: string | null; captionEn: string | null; captionAr: string | null }>;
  menus: Array<{ nameEn: string; nameAr: string; kind: 'link' | 'pdf'; url: string }>;
}

const pickMedia = (m: MediaView) => ({ url: m.url, width: m.width, height: m.height, altEn: m.altEn, altAr: m.altAr });

function toPublic(v: RestaurantView): PublicRestaurant {
  return {
    slug: v.slug, nameEn: v.nameEn, nameAr: v.nameAr, brandEn: v.brandEn, brandAr: v.brandAr, taglineEn: v.taglineEn, taglineAr: v.taglineAr,
    shortDescriptionEn: v.shortDescriptionEn, shortDescriptionAr: v.shortDescriptionAr, descriptionEn: v.descriptionEn, descriptionAr: v.descriptionAr,
    atmosphereEn: v.atmosphereEn, atmosphereAr: v.atmosphereAr, locationEn: v.locationEn, locationAr: v.locationAr, opensAt: v.opensAt, closesAt: v.closesAt,
    closesAfterMidnight: v.closesAfterMidnight, phones: v.phones, reservationUrl: v.reservationUrl, websiteUrl: v.websiteUrl, instagramUrl: v.instagramUrl,
    hero: v.hero ? pickMedia(v.hero) : null,
    gallery: v.gallery.map((g) => ({ ...pickMedia(g.media), captionEn: g.captionEn, captionAr: g.captionAr })),
    menus: v.menus.filter((m) => m.isActive).map((m) => ({ nameEn: m.nameEn, nameAr: m.nameAr, kind: m.kind, url: m.url })),
  };
}
