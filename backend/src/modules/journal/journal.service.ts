import { Injectable } from '@nestjs/common';
import { JournalArticle, JournalArticleMedia, Media, Prisma } from '@prisma/client';
import { buildMeta, toSkipTake } from '../../common/dto/pagination';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { PageResult } from '../../common/http/envelope';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, RequestContext } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { MediaService, mediaView, MediaView } from '../media/media.service';
import { canTransitionJournal, JournalStatusValue, journalAuditActionFor, PUBLIC_JOURNAL_STATUSES } from './journal-status';
import { CreateJournalDto, UpdateJournalDto } from './journal.dto';

type ArticleRow = JournalArticle & {
  coverMedia: Media | null;
  gallery: Array<JournalArticleMedia & { media: Media }>;
};

const include = {
  coverMedia: true,
  gallery: { include: { media: true }, orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.JournalArticleInclude;

/** Newest first: the editors publish a story and it leads the Journal. Ties are broken the same way everywhere. */
const ORDER: Prisma.JournalArticleOrderByWithRelationInput[] = [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }, { id: 'asc' }];

export interface JournalArticleView {
  id: string;
  slug: string;
  status: JournalStatusValue;
  titleEn: string;
  titleAr: string;
  tagEn: string;
  tagAr: string;
  shortDescriptionEn: string;
  shortDescriptionAr: string;
  bodyEn: string;
  bodyAr: string;
  dateLabelEn: string | null;
  dateLabelAr: string | null;
  isFeatured: boolean;
  cover: MediaView | null;
  gallery: Array<{ media: MediaView; captionEn: string | null; captionAr: string | null }>;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const journalView = (a: ArticleRow): JournalArticleView => ({
  id: a.id, slug: a.slug, status: a.status as JournalStatusValue, titleEn: a.titleEn, titleAr: a.titleAr, tagEn: a.tagEn, tagAr: a.tagAr,
  shortDescriptionEn: a.shortDescriptionEn, shortDescriptionAr: a.shortDescriptionAr, bodyEn: a.bodyEn, bodyAr: a.bodyAr,
  dateLabelEn: a.dateLabelEn, dateLabelAr: a.dateLabelAr, isFeatured: a.isFeatured,
  cover: a.coverMedia && !a.coverMedia.deletedAt ? mediaView(a.coverMedia) : null,
  gallery: a.gallery.filter((g) => !g.media.deletedAt).map((g) => ({ media: mediaView(g.media), captionEn: g.captionEn, captionAr: g.captionAr })),
  publishedAt: a.publishedAt, createdAt: a.createdAt, updatedAt: a.updatedAt,
});

/** What a visitor may see: no ids, no status, no editor identities. */
export interface PublicJournalArticle {
  slug: string;
  titleEn: string;
  titleAr: string;
  tagEn: string;
  tagAr: string;
  shortDescriptionEn: string;
  shortDescriptionAr: string;
  bodyEn: string;
  bodyAr: string;
  dateLabelEn: string | null;
  dateLabelAr: string | null;
  isFeatured: boolean;
  /** when it first went public, as an ISO instant */
  publishedAt: string | null;
  cover: Pick<MediaView, 'url' | 'width' | 'height' | 'altEn' | 'altAr'> | null;
  gallery: Array<{ url: string; width: number | null; height: number | null; altEn: string | null; altAr: string | null; captionEn: string | null; captionAr: string | null }>;
}

const pickMedia = (m: MediaView) => ({ url: m.url, width: m.width, height: m.height, altEn: m.altEn, altAr: m.altAr });

function toPublic(a: ArticleRow): PublicJournalArticle {
  const v = journalView(a);
  return {
    slug: v.slug, titleEn: v.titleEn, titleAr: v.titleAr, tagEn: v.tagEn, tagAr: v.tagAr, shortDescriptionEn: v.shortDescriptionEn,
    shortDescriptionAr: v.shortDescriptionAr, bodyEn: v.bodyEn, bodyAr: v.bodyAr, dateLabelEn: v.dateLabelEn, dateLabelAr: v.dateLabelAr,
    isFeatured: v.isFeatured, publishedAt: v.publishedAt ? v.publishedAt.toISOString() : null,
    cover: v.cover ? pickMedia(v.cover) : null,
    gallery: v.gallery.map((g) => ({ ...pickMedia(g.media), captionEn: g.captionEn, captionAr: g.captionAr })),
  };
}

@Injectable()
export class JournalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly media: MediaService,
  ) {}

  // ───────────────────────────── portal ─────────────────────────────

  async list(query: { page: number; limit: number; search?: string; status?: JournalStatusValue }): Promise<PageResult<JournalArticleView>> {
    const where: Prisma.JournalArticleWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { titleEn: { contains: query.search, mode: 'insensitive' } },
              { titleAr: { contains: query.search } },
              { tagEn: { contains: query.search, mode: 'insensitive' } },
              { tagAr: { contains: query.search } },
              { slug: { contains: query.search.toLowerCase() } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.journalArticle.findMany({ where, include, orderBy: ORDER, ...toSkipTake(query) }),
      this.prisma.journalArticle.count({ where }),
    ]);
    return new PageResult(rows.map(journalView), buildMeta(query, total));
  }

  async get(id: string): Promise<JournalArticleView> {
    return journalView(await this.load(id));
  }

  /** A new article is always a DRAFT: making it public is a separate, permission-checked step. */
  async create(dto: CreateJournalDto, actor: AuthenticatedUser, ctx: RequestContext): Promise<JournalArticleView> {
    if (await this.prisma.journalArticle.findUnique({ where: { slug: dto.slug }, select: { id: true } })) {
      throw new AppException('SLUG_TAKEN', `The address "${dto.slug}" is already used by another article.`, 409);
    }
    await this.media.requireImage(dto.coverMediaId);
    const created = await this.prisma.journalArticle.create({
      data: { ...this.data(dto), slug: dto.slug, status: 'DRAFT', createdById: actor.id },
      include,
    });
    const view = journalView(created);
    await this.audit.record({ userId: actor.id, action: 'journal.created', entity: 'journal_article', entityId: created.id, newValue: this.auditShape(view) }, ctx);
    return view;
  }

  async update(id: string, dto: UpdateJournalDto, actor: AuthenticatedUser, ctx: RequestContext): Promise<JournalArticleView> {
    const existing = await this.load(id);
    const before = journalView(existing);
    if (dto.slug && dto.slug !== existing.slug) {
      if (existing.publishedAt) throw new AppException('SLUG_LOCKED', 'This article has been public, so its address cannot change (links to it would break).', 409);
      if (await this.prisma.journalArticle.findUnique({ where: { slug: dto.slug }, select: { id: true } })) {
        throw new AppException('SLUG_TAKEN', `The address "${dto.slug}" is already used by another article.`, 409);
      }
    }
    await this.media.requireImage(dto.coverMediaId);
    const updated = await this.prisma.journalArticle.update({
      where: { id },
      data: { ...this.data(dto), ...(dto.slug ? { slug: dto.slug } : {}) },
      include,
    });
    const after = journalView(updated);
    await this.audit.record(
      { userId: actor.id, action: 'journal.updated', entity: 'journal_article', entityId: id, oldValue: this.auditShape(before), newValue: this.auditShape(after) },
      ctx,
    );
    if ((before.cover?.id ?? null) !== (after.cover?.id ?? null)) {
      await this.audit.record(
        { userId: actor.id, action: 'journal.cover_changed', entity: 'journal_article', entityId: id, oldValue: { coverMediaId: before.cover?.id ?? null }, newValue: { coverMediaId: after.cover?.id ?? null } },
        ctx,
      );
    }
    return after;
  }

  async setStatus(id: string, to: JournalStatusValue, actor: AuthenticatedUser, ctx: RequestContext): Promise<JournalArticleView> {
    const existing = await this.load(id);
    const from = existing.status as JournalStatusValue;
    if (!canTransitionJournal(from, to)) {
      throw new AppException('INVALID_STATUS_CHANGE', `An article that is ${from.toLowerCase()} cannot become ${to.toLowerCase()}.`, 409, { from, to });
    }
    const updated = await this.prisma.journalArticle.update({
      where: { id },
      data: { status: to, ...(to === 'PUBLISHED' ? { publishedAt: existing.publishedAt ?? new Date() } : {}) },
      include,
    });
    await this.audit.record(
      { userId: actor.id, action: journalAuditActionFor(from, to), entity: 'journal_article', entityId: id, oldValue: { status: from }, newValue: { status: to } },
      ctx,
    );
    return journalView(updated);
  }

  async setGallery(
    id: string,
    items: Array<{ mediaId: string; captionEn: string | null; captionAr: string | null }>,
    actor: AuthenticatedUser,
    ctx: RequestContext,
  ): Promise<JournalArticleView> {
    const before = await this.load(id);
    for (const item of items) await this.media.requireImage(item.mediaId);
    await this.prisma.$transaction([
      this.prisma.journalArticleMedia.deleteMany({ where: { articleId: id } }),
      this.prisma.journalArticleMedia.createMany({ data: items.map((it, i) => ({ articleId: id, mediaId: it.mediaId, sortOrder: i, captionEn: it.captionEn, captionAr: it.captionAr })) }),
    ]);
    await this.audit.record(
      {
        userId: actor.id, action: 'journal.gallery_updated', entity: 'journal_article', entityId: id,
        oldValue: { media: before.gallery.map((g) => g.mediaId) }, newValue: { media: items.map((i) => i.mediaId) },
      },
      ctx,
    );
    return this.get(id);
  }

  // ───────────────────────────── public ─────────────────────────────

  /** Published articles, newest first. Nothing else is ever returned here. */
  async listPublished(): Promise<PublicJournalArticle[]> {
    const rows = await this.prisma.journalArticle.findMany({ where: { deletedAt: null, status: { in: [...PUBLIC_JOURNAL_STATUSES] } }, include, orderBy: ORDER });
    return rows.map(toPublic);
  }

  /** By address; only published articles exist as far as a visitor is concerned. */
  async getPublic(slug: string): Promise<PublicJournalArticle> {
    const row = await this.prisma.journalArticle.findFirst({ where: { slug, deletedAt: null, status: { in: [...PUBLIC_JOURNAL_STATUSES] } }, include });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Article not found.', 404);
    return toPublic(row);
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private async load(id: string): Promise<ArticleRow> {
    const row = await this.prisma.journalArticle.findFirst({ where: { id, deletedAt: null }, include });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Article not found.', 404);
    return row;
  }

  private data(dto: CreateJournalDto | UpdateJournalDto) {
    return {
      titleEn: dto.titleEn, titleAr: dto.titleAr, tagEn: dto.tagEn, tagAr: dto.tagAr,
      shortDescriptionEn: dto.shortDescriptionEn, shortDescriptionAr: dto.shortDescriptionAr, bodyEn: dto.bodyEn, bodyAr: dto.bodyAr,
      dateLabelEn: dto.dateLabelEn, dateLabelAr: dto.dateLabelAr, isFeatured: dto.isFeatured, coverMediaId: dto.coverMediaId,
    };
  }

  /** What an audit entry keeps: who changed which article and how it looked, without the long texts. */
  private auditShape(v: JournalArticleView): Prisma.InputJsonValue {
    return {
      slug: v.slug, status: v.status, titleEn: v.titleEn, titleAr: v.titleAr, tagEn: v.tagEn, tagAr: v.tagAr,
      isFeatured: v.isFeatured, coverMediaId: v.cover?.id ?? null, photos: v.gallery.length,
    };
  }
}
