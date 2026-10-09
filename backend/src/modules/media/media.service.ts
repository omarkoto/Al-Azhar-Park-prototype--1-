import { Injectable, Logger } from '@nestjs/common';
import { Media, Prisma } from '@prisma/client';
import { buildMeta, toSkipTake } from '../../common/dto/pagination';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { PageResult } from '../../common/http/envelope';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, RequestContext } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { declaredTypeMatches, MAX_DIMENSION, pdfRiskyFeature, safeFileName, sniffFile } from './media-sniff';
import { MediaStorage, newStorageKey, STORAGE_KEY } from './media-storage';
import { fileTooLarge, mediaByteLimits } from './upload-limits';

export interface MediaView {
  id: string;
  /** site-relative; the client puts the API origin in front */
  url: string;
  kind: 'image' | 'pdf';
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  altEn: string | null;
  altAr: string | null;
  createdAt: Date;
}

export const mediaView = (m: Media): MediaView => ({
  id: m.id, url: m.url, kind: m.mimeType === 'application/pdf' ? 'pdf' : 'image', fileName: m.fileName, mimeType: m.mimeType,
  sizeBytes: m.sizeBytes, width: m.width, height: m.height, altEn: m.altEn, altAr: m.altAr, createdAt: m.createdAt,
});

export const FILE_ROUTE = '/api/v1/media/file';

export interface UploadInput {
  buffer: Buffer;
  originalName?: string;
  declaredType?: string;
  altEn?: string | null;
  altAr?: string | null;
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MediaStorage,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  get maxBytes() {
    return mediaByteLimits(this.config);
  }

  async upload(input: UploadInput, actor: AuthenticatedUser, ctx: RequestContext): Promise<MediaView> {
    if (!input.buffer || input.buffer.length === 0) throw new AppException('FILE_REQUIRED', 'Choose a file to upload.', 400);

    const sniffed = sniffFile(input.buffer);
    if (!sniffed) throw new AppException('UNSUPPORTED_FILE_TYPE', 'Only JPEG, PNG and WebP images and PDF files can be uploaded.', 415);
    if (!declaredTypeMatches(input.declaredType, sniffed)) {
      throw new AppException('FILE_TYPE_MISMATCH', 'The file does not match its declared type.', 415);
    }
    const limit = this.maxBytes[sniffed.kind];
    if (input.buffer.length > limit) {
      throw fileTooLarge(sniffed.kind, limit);
    }
    if (sniffed.kind === 'image' && (!sniffed.width || !sniffed.height || sniffed.width > MAX_DIMENSION || sniffed.height > MAX_DIMENSION)) {
      throw new AppException('IMAGE_DIMENSIONS', `Images must be at most ${MAX_DIMENSION} pixels on each side.`, 422);
    }
    if (sniffed.kind === 'pdf') {
      const risky = pdfRiskyFeature(input.buffer);
      if (risky) throw new AppException('UNSAFE_PDF', `This PDF contains active content (${risky}) and cannot be uploaded. Export a plain PDF.`, 422);
    }

    const key = newStorageKey(sniffed.ext);
    await this.storage.put(key, input.buffer);
    try {
      const row = await this.prisma.media.create({
        data: {
          provider: 'local', storageKey: key, url: `${FILE_ROUTE}/${key}`, fileName: safeFileName(input.originalName),
          mimeType: sniffed.mime, sizeBytes: input.buffer.length, width: sniffed.width ?? null, height: sniffed.height ?? null,
          altEn: input.altEn || null, altAr: input.altAr || null, uploadedById: actor.id,
        },
      });
      await this.audit.record(
        { userId: actor.id, action: 'media.uploaded', entity: 'media', entityId: row.id, newValue: { fileName: row.fileName, mimeType: row.mimeType, sizeBytes: row.sizeBytes } },
        ctx,
      );
      return mediaView(row);
    } catch (error) {
      await this.storage.remove(key).catch(() => undefined); // never leave an orphan file behind
      throw error;
    }
  }

  async list(query: { page: number; limit: number; search?: string; kind?: 'image' | 'pdf' }): Promise<PageResult<MediaView>> {
    const where: Prisma.MediaWhereInput = {
      deletedAt: null,
      ...(query.kind === 'pdf' ? { mimeType: 'application/pdf' } : query.kind === 'image' ? { mimeType: { startsWith: 'image/' } } : {}),
      ...(query.search ? { OR: [{ fileName: { contains: query.search, mode: 'insensitive' } }, { altEn: { contains: query.search, mode: 'insensitive' } }, { altAr: { contains: query.search } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.media.findMany({ where, orderBy: { createdAt: 'desc' }, ...toSkipTake(query) }),
      this.prisma.media.count({ where }),
    ]);
    return new PageResult(rows.map(mediaView), buildMeta(query, total));
  }

  async get(id: string): Promise<MediaView & { usage: string[] }> {
    const row = await this.find(id);
    return { ...mediaView(row), usage: await this.usage(id) };
  }

  async updateAlt(id: string, dto: { altEn: string | null; altAr: string | null }, actor: AuthenticatedUser, ctx: RequestContext): Promise<MediaView> {
    const before = await this.find(id);
    const row = await this.prisma.media.update({ where: { id }, data: { altEn: dto.altEn, altAr: dto.altAr } });
    await this.audit.record(
      { userId: actor.id, action: 'media.updated', entity: 'media', entityId: id, oldValue: { altEn: before.altEn, altAr: before.altAr }, newValue: { altEn: dto.altEn, altAr: dto.altAr } },
      ctx,
    );
    return mediaView(row);
  }

  /** A file still shown somewhere cannot be deleted: that would leave a broken image on the website. */
  async remove(id: string, actor: AuthenticatedUser, ctx: RequestContext): Promise<void> {
    const row = await this.find(id);
    const usage = await this.usage(id);
    if (usage.length > 0) throw new AppException('MEDIA_IN_USE', `This file is still used by: ${usage.join('; ')}. Remove it there first.`, 409, { usage });
    await this.prisma.media.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.storage.remove(row.storageKey).catch((e: Error) => this.logger.warn(`Could not remove file ${row.storageKey}: ${e.message}`));
    await this.audit.record({ userId: actor.id, action: 'media.deleted', entity: 'media', entityId: id, oldValue: { fileName: row.fileName } }, ctx);
  }

  /** For other modules: the media must exist (not deleted) and be a photo — throws a 422 the editor can read. */
  async requireImage(id: string | null | undefined): Promise<void> {
    if (!id) return;
    const m = await this.prisma.media.findFirst({ where: { id, deletedAt: null }, select: { mimeType: true } });
    if (!m) throw new AppException('MEDIA_NOT_FOUND', 'That photo does not exist (it may have been deleted).', 422);
    if (!m.mimeType.startsWith('image/')) throw new AppException('MEDIA_NOT_IMAGE', 'That file is not an image.', 422);
  }

  /** Looks up a file for serving. Only generated keys are accepted and deleted files are gone. */
  async findForServing(key: string): Promise<Media | null> {
    if (!STORAGE_KEY.test(key)) return null;
    return this.prisma.media.findFirst({ where: { storageKey: key, deletedAt: null } });
  }

  open(key: string) {
    return this.storage.open(key);
  }

  /** Where the file is used, in words an editor understands. */
  async usage(id: string): Promise<string[]> {
    const [heroes, gallery, menus, eventHeroes, eventGallery, items] = await Promise.all([
      this.prisma.restaurant.findMany({ where: { heroMediaId: id, deletedAt: null }, select: { nameEn: true } }),
      this.prisma.restaurantMedia.findMany({ where: { mediaId: id, restaurant: { deletedAt: null } }, select: { restaurant: { select: { nameEn: true } } } }),
      this.prisma.menu.findMany({ where: { pdfMediaId: id, deletedAt: null }, select: { nameEn: true, restaurant: { select: { nameEn: true } } } }),
      this.prisma.event.findMany({ where: { heroMediaId: id, deletedAt: null }, select: { titleEn: true } }),
      this.prisma.eventMedia.count({ where: { mediaId: id } }),
      this.prisma.menuItem.count({ where: { mediaId: id, deletedAt: null } }),
    ]);
    return [
      ...heroes.map((r) => `main photo of ${r.nameEn}`),
      ...gallery.map((g) => `gallery of ${g.restaurant.nameEn}`),
      ...menus.map((m) => `menu “${m.nameEn}” of ${m.restaurant.nameEn}`),
      ...eventHeroes.map((e) => `main photo of event ${e.titleEn}`),
      ...(eventGallery > 0 ? [`${eventGallery} event gallery place(s)`] : []),
      ...(items > 0 ? [`${items} menu item(s)`] : []),
    ];
  }

  private async find(id: string): Promise<Media> {
    const row = await this.prisma.media.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'File not found.', 404);
    return row;
  }
}
