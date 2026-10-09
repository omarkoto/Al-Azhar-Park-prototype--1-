import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseInterceptors, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { paginationQuerySchema } from '../../common/dto/pagination';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { SkipEnvelope } from '../../common/http/envelope';
import { RequestContext } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser, Public, RequestCtx, RequirePermissions } from '../auth/decorators';
import { MediaService } from './media.service';
import { MediaUploadInterceptor } from './upload-limits';

/** multer hands over multipart file names as latin1; browsers send UTF-8 (Arabic and accented names) */
function utf8Name(name: string): string {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('�') ? name : decoded;
}

const alt = z.union([z.string().trim().max(300), z.null()]).optional().transform((v) => (v ? v : null));
class UploadFieldsDto extends createZodDto(z.object({ altEn: alt, altAr: alt })) {}
class UpdateAltDto extends createZodDto(z.object({ altEn: alt, altAr: alt })) {}
class ListMediaQueryDto extends createZodDto(paginationQuerySchema.extend({ kind: z.enum(['image', 'pdf']).optional() })) {}

@ApiTags('media')
@ApiBearerAuth()
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post()
  @RequirePermissions('media:write')
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  @ApiOperation({ summary: 'Upload an image (JPEG, PNG, WebP) or a PDF. The type is decided from the file\'s bytes, never from its name.' })
  @ApiConsumes('multipart/form-data')
  // the size limits come from MEDIA_MAX_IMAGE_MB / MEDIA_MAX_PDF_MB and are applied while the file arrives (see upload-limits.ts)
  @UseInterceptors(MediaUploadInterceptor)
  upload(@UploadedFile() file: Express.Multer.File | undefined, @Body() body: UploadFieldsDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    if (!file) throw new AppException('FILE_REQUIRED', 'Choose a file to upload (form field "file").', 400);
    return this.media.upload({ buffer: file.buffer, originalName: utf8Name(file.originalname), declaredType: file.mimetype, altEn: body.altEn, altAr: body.altAr }, actor, ctx);
  }

  @Get()
  @RequirePermissions('media:read')
  list(@Query() query: ListMediaQueryDto) {
    return this.media.list(query);
  }

  @Get('file/:key')
  @Public()
  @SkipEnvelope()
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  // an uploaded file can never run anything even if opened directly
  @Header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
  @ApiOperation({ summary: 'Download a stored file. Public: the website embeds these.' })
  async file(@Param('key') key: string, @Res({ passthrough: true }) res: Response) {
    const row = await this.media.findForServing(key);
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'File not found.', 404);
    res.setHeader('Content-Type', row.mimeType);
    res.setHeader('Content-Length', String(row.sizeBytes));
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(row.fileName)}`);
    try {
      return new StreamableFile(await this.media.open(row.storageKey));
    } catch {
      throw new AppException(ErrorCode.NOT_FOUND, 'File not found.', 404);
    }
  }

  @Get(':id')
  @RequirePermissions('media:read')
  @ApiOperation({ summary: 'File details and where it is used' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.media.get(id);
  }

  @Patch(':id')
  @RequirePermissions('media:write')
  @ApiOperation({ summary: 'Change the description (alt text) in English and Arabic' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAltDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.media.updateAlt(id, dto, actor, ctx);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('media:write')
  @ApiOperation({ summary: 'Delete a file that is not used anywhere' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    await this.media.remove(id, actor, ctx);
    return { deleted: true };
  }
}
