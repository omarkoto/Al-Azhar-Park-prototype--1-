import { Readable } from 'node:stream';
import type { ExecutionContext } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception';
import { AppConfigService } from '../../config/app-config.service';
import { kindFromSignature, LimitedMemoryStorage, mediaByteLimits, MediaUploadInterceptor, MULTIPART_OVERHEAD_BYTES } from './upload-limits';

const config = (image: string, pdf: string) =>
  new AppConfigService({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://u:p@localhost:5432/db', MEDIA_MAX_IMAGE_MB: image, MEDIA_MAX_PDF_MB: pdf });

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);
const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n');
const TEXT = Buffer.from('this is not an image or a pdf, it is just some text');

const CHUNK = 64 * 1024;
const withHead = (head: Buffer, total: number) => Buffer.concat([head, Buffer.alloc(Math.max(0, total - head.length), 7)]);

/** A stream that hands out `data` in 64 KB pieces and counts how many bytes have been pulled from it. */
function source(data: Buffer) {
  const state = { pulled: 0 };
  const stream = new Readable({
    read() {
      if (state.pulled >= data.length) return this.push(null);
      const piece = data.subarray(state.pulled, state.pulled + CHUNK);
      state.pulled += piece.length;
      this.push(piece);
    },
  });
  return { stream, state };
}

async function receive(storage: LimitedMemoryStorage, data: Buffer) {
  const { stream, state } = source(data);
  return new Promise<{ error?: unknown; size?: number; pulledWhenDecided: number }>((resolve) => {
    storage._handleFile({} as never, { stream } as never, (error, info) => resolve({ error, size: info?.size, pulledWhenDecided: state.pulled }));
  });
}

const limits = mediaByteLimits(config('0.2', '0.5')); // images 209715 bytes, PDFs 524288 bytes

describe('the configured media limits', () => {
  it('are the MEDIA_MAX_* settings in bytes', () => {
    expect(limits).toEqual({ image: 209_715, pdf: 524_288 });
    expect(mediaByteLimits(config('8', '15'))).toEqual({ image: 8 * 1048576, pdf: 15 * 1048576 });
  });
});

describe('which limit a file falls under, from its first bytes', () => {
  it('knows PDF, JPEG, PNG and WebP, and nothing else', () => {
    expect(kindFromSignature(PDF)).toBe('pdf');
    for (const head of [PNG, JPEG, WEBP]) expect(kindFromSignature(head)).toBe('image');
    expect(kindFromSignature(TEXT)).toBeNull();
    expect(kindFromSignature(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(kindFromSignature(PNG.subarray(0, 11))).toBeNull(); // not enough bytes to tell yet
  });
});

describe('LimitedMemoryStorage: the limit is applied while the file arrives', () => {
  const storage = new LimitedMemoryStorage(limits);

  it('keeps an image up to its limit, exactly, and refuses one more byte', async () => {
    const ok = await receive(storage, withHead(PNG, limits.image));
    expect(ok.error).toBeNull();
    expect(ok.size).toBe(limits.image);
    const over = await receive(storage, withHead(PNG, limits.image + 1));
    expect(over.error).toBeInstanceOf(AppException);
    expect((over.error as AppException).getStatus()).toBe(413);
    expect((over.error as AppException).code).toBe('FILE_TOO_LARGE');
  });

  it.each([
    ['JPEG', JPEG],
    ['WebP', WEBP],
  ])('holds a %s to the image limit too', async (_name, head) => {
    expect((await receive(storage, withHead(head, limits.image))).error).toBeNull();
    expect(((await receive(storage, withHead(head, limits.image + 1))).error as AppException).code).toBe('FILE_TOO_LARGE');
  });

  it('keeps a PDF up to ITS limit (which is larger than the image limit), and refuses one more byte', async () => {
    const between = await receive(storage, withHead(PDF, limits.image + 1000));
    expect(between.error).toBeNull();
    expect((await receive(storage, withHead(PDF, limits.pdf))).error).toBeNull();
    const over = await receive(storage, withHead(PDF, limits.pdf + 1));
    expect((over.error as AppException).code).toBe('FILE_TOO_LARGE');
    expect((over.error as AppException).message).toContain('PDF files');
  });

  it('refuses a huge file as soon as it passes the limit, without collecting the rest', async () => {
    const huge = withHead(PNG, 40 * 1024 * 1024);
    const result = await receive(storage, huge);
    expect((result.error as AppException).code).toBe('FILE_TOO_LARGE');
    // the decision came after a few 64 KB pieces, not after 40 MB
    expect(result.pulledWhenDecided).toBeLessThanOrEqual(limits.image + 2 * CHUNK);
  });

  it('holds a file of an unknown type to the smaller limit, so garbage cannot be larger than a photo', async () => {
    const result = await receive(storage, withHead(TEXT, limits.image + 5000));
    expect((result.error as AppException).code).toBe('FILE_TOO_LARGE');
    expect((await receive(storage, withHead(TEXT, 10_000))).error).toBeNull(); // small: MediaService then refuses the type
  });

  it('passes a very small file through (MediaService refuses what it is)', async () => {
    const tiny = await receive(storage, Buffer.from('abc'));
    expect(tiny.error).toBeNull();
    expect(tiny.size).toBe(3);
  });

  it('follows the configuration: bigger limits let the same file through', async () => {
    const roomy = new LimitedMemoryStorage(mediaByteLimits(config('1', '2')));
    expect((await receive(roomy, withHead(PNG, limits.image + 1))).error).toBeNull();
    expect((await receive(roomy, withHead(PNG, 1_048_576 + 1))).error).toBeInstanceOf(AppException);
  });

  it('reports a broken upload as an error', async () => {
    const stream = new Readable({ read() {} });
    const outcome = new Promise<unknown>((resolve) => storage._handleFile({} as never, { stream } as never, (error) => resolve(error)));
    stream.push(PNG);
    stream.destroy(new Error('connection lost'));
    expect(((await outcome) as Error).message).toBe('connection lost');
  });
});

describe('MediaUploadInterceptor: a request that declares too much is refused before anything is collected', () => {
  const interceptor = new MediaUploadInterceptor(config('0.2', '0.5'));
  const ceiling = limits.pdf; // the larger limit

  function contextFor(contentLength: string | undefined) {
    const req = {
      headers: contentLength === undefined ? {} : { 'content-length': contentLength },
      resume: jest.fn(),
      destroy: jest.fn(),
      complete: true,
      once: jest.fn((event: string, callback: () => void) => {
        if (event === 'end') callback(); // the (discarded) body has been read to its end
      }),
      // anything that would collect the body
      on: jest.fn(),
      pipe: jest.fn(),
      read: jest.fn(),
      setEncoding: jest.fn(),
    };
    const res = {};
    const context = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) } as unknown as ExecutionContext;
    return { context, req };
  }

  it('answers 413 FILE_TOO_LARGE for a declared size over the larger limit plus the multipart envelope', async () => {
    for (const size of [ceiling + MULTIPART_OVERHEAD_BYTES + 1, 101 * 1024 * 1024, 5 * 1024 * 1024 * 1024]) {
      const { context, req } = contextFor(String(size));
      const error = await interceptor.intercept(context, { handle: () => { throw new Error('should not be reached'); } } as never).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).getStatus()).toBe(413);
      expect((error as AppException).code).toBe('FILE_TOO_LARGE');
      expect((error as AppException).message).toMatch(/limit is 0 MB for images and 1 MB for PDF files/);
      // nothing was collected: the body is only discarded (and the connection is cut if the sender never stops)
      expect(req.on).not.toHaveBeenCalled();
      expect(req.pipe).not.toHaveBeenCalled();
      expect(req.read).not.toHaveBeenCalled();
      expect(req.setEncoding).not.toHaveBeenCalled();
      expect(req.resume).toHaveBeenCalledTimes(1);
    }
  });
});
