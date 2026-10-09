import type { Request } from 'express';
import type { Readable } from 'node:stream';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import multer, { MulterError, type StorageEngine } from 'multer';
import { Observable } from 'rxjs';
import { AppException } from '../../common/errors/app-exception';
import { AppConfigService } from '../../config/app-config.service';
import type { MediaKind } from './media-sniff';

export interface MediaByteLimits {
  image: number;
  pdf: number;
}

/** The size limits, in bytes, from MEDIA_MAX_IMAGE_MB and MEDIA_MAX_PDF_MB. The one place they are turned into numbers. */
export function mediaByteLimits(config: AppConfigService): MediaByteLimits {
  return {
    image: Math.round(config.get('MEDIA_MAX_IMAGE_MB') * 1024 * 1024),
    pdf: Math.round(config.get('MEDIA_MAX_PDF_MB') * 1024 * 1024),
  };
}

export function fileTooLarge(kind: MediaKind, limitBytes: number): AppException {
  return new AppException('FILE_TOO_LARGE', `The file is too large (the limit for ${kind === 'pdf' ? 'PDF files' : 'images'} is ${Math.round(limitBytes / 1048576)} MB).`, 413);
}

/** Room for the multipart envelope (boundaries, the two description fields) around the largest file. */
export const MULTIPART_OVERHEAD_BYTES = 256 * 1024;

/** After refusing an upload up front, the rest of it is thrown away unread for at most this long, then the connection is cut. */
export const DISCARD_GRACE_MS = 10_000;

/** Bytes needed to tell, from its signature, which limit applies (WebP is the longest: RIFF, a size, WEBP). */
const SIGNATURE_BYTES = 12;

/**
 * Which limit a file falls under, from its first bytes only: a PDF, or a JPEG / PNG / WebP image. Anything else is null. This only
 * chooses the size limit while the file arrives; MediaService still checks the type and the contents properly.
 */
export function kindFromSignature(head: Buffer): MediaKind | null {
  if (head.length < SIGNATURE_BYTES) return null;
  if (head.toString('ascii', 0, 5) === '%PDF-') return 'pdf';
  const starts = (bytes: number[]) => bytes.every((v, i) => head[i] === v);
  if (starts([0xff, 0xd8, 0xff]) || starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image';
  if (head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP') return 'image';
  return null;
}

/**
 * Where an uploaded file waits in memory, with the size limit applied WHILE it arrives. Once the first bytes show what the
 * file is (image or PDF), its own limit applies, and the moment more bytes than that have come in the upload is stopped:
 * a 100 MB file is never collected only to be refused at the end. A file whose type cannot be told is held to the smaller of
 * the two limits (it will be refused as an unsupported type anyway). The type and size are checked again by MediaService.
 */
export class LimitedMemoryStorage implements StorageEngine {
  constructor(private readonly limits: MediaByteLimits) {}

  _handleFile(_req: Request, file: Express.Multer.File & { stream: Readable }, callback: (error?: unknown, info?: Partial<Express.Multer.File>) => void): void {
    const chunks: Buffer[] = [];
    let received = 0;
    let limit: { kind: MediaKind; bytes: number } | null = null;
    let finished = false;
    const stream = file.stream;

    const stop = (error: unknown) => {
      if (finished) return;
      finished = true;
      chunks.length = 0; // release what was collected
      stream.removeAllListeners('data');
      stream.resume(); // let the rest of this file go by without keeping it (multer then drains the request)
      callback(error);
    };

    stream.on('data', (chunk: Buffer) => {
      if (finished) return;
      chunks.push(chunk);
      received += chunk.length;
      if (!limit && received >= SIGNATURE_BYTES) {
        const kind = kindFromSignature(Buffer.concat(chunks));
        limit = kind ? { kind, bytes: this.limits[kind] } : { kind: 'image', bytes: Math.min(this.limits.image, this.limits.pdf) };
      }
      if (limit && received > limit.bytes) stop(fileTooLarge(limit.kind, limit.bytes));
    });
    stream.on('error', (error) => stop(error));
    stream.on('end', () => {
      if (finished) return;
      finished = true;
      const buffer = Buffer.concat(chunks);
      callback(null, { buffer, size: buffer.length });
    });
  }

  _removeFile(_req: Request, file: Express.Multer.File, callback: (error: Error | null) => void): void {
    delete (file as { buffer?: Buffer }).buffer;
    callback(null);
  }
}

/**
 * Reads the one uploaded file of POST /media, with the configured limits. Replaces the fixed 101 MB buffer: the ceiling is the
 * larger configured limit, a request that already DECLARES (Content-Length) more than that is refused before a byte of it is
 * read, and the rest is limited per type while it streams (see LimitedMemoryStorage).
 */
@Injectable()
export class MediaUploadInterceptor implements NestInterceptor {
  private readonly ceiling: number;
  private readonly limits: MediaByteLimits;
  private readonly receive: ReturnType<ReturnType<typeof multer>['single']>;

  constructor(config: AppConfigService) {
    const limits = mediaByteLimits(config);
    this.limits = limits;
    this.ceiling = Math.max(limits.image, limits.pdf);
    this.receive = multer({
      storage: new LimitedMemoryStorage(limits),
      limits: { fileSize: this.ceiling, files: 1, fields: 5, parts: 7 },
    }).single('file');
  }

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > this.ceiling + MULTIPART_OVERHEAD_BYTES) {
      // Refuse, and keep nothing. First the rest of the upload is read and thrown away (`resume()` collects nothing), for at most
      // DISCARD_GRACE_MS: answering while the sender is still sending, then closing, would reset the connection and the sender would
      // never see this message. A sender that is still going after the grace period gets the answer anyway and is cut off.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, DISCARD_GRACE_MS);
        timer.unref();
        const done = () => {
          clearTimeout(timer);
          resolve();
        };
        req.once('end', done);
        req.once('close', done);
        req.once('error', done);
        req.resume();
      });
      if (!req.complete) setImmediate(() => req.destroy());
      const mb = (bytes: number) => Math.round(bytes / 1048576);
      throw new AppException('FILE_TOO_LARGE', `The upload is too large (the limit is ${mb(this.limits.image)} MB for images and ${mb(this.limits.pdf)} MB for PDF files).`, 413);
    }
    await new Promise<void>((resolve, reject) => {
      this.receive(req, http.getResponse(), (error: unknown) => {
        if (!error) return resolve();
        if (error instanceof AppException) return reject(error);
        if (error instanceof MulterError) {
          return reject(
            error.code === 'LIMIT_FILE_SIZE'
              ? new AppException('FILE_TOO_LARGE', 'The file is too large.', 413)
              : new AppException('BAD_UPLOAD', 'The upload could not be read. Send one file in the form field "file".', 400),
          );
        }
        reject(error);
      });
    });
    return next.handle();
  }
}
