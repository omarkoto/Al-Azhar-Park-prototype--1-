import { deflateSync } from 'node:zlib';
import { Injectable } from '@nestjs/common';
import QRCode from 'qrcode';
import { createQrPayload, QrVerification, verifyQrPayload } from '../../common/security/ticket-qr';
import { AppConfigService } from '../../config/app-config.service';

/**
 * Makes and checks the ticket QR credential. It reuses the signing scheme designed in Phase 1
 * (`common/security/ticket-qr.ts`): the code holds only the ticket reference, the key id and an HMAC signature, no
 * personal data. This service adds the key ring (so keys can be rotated) and the image.
 *
 * Phase 7 only issues codes. Checking one at the gate and marking a ticket used is Phase 8, which will call `verify`.
 */
@Injectable()
export class QrService {
  constructor(private readonly config: AppConfigService) {}

  /** The text inside a ticket's QR code, signed with the key the ticket names (see tickets.qr_key_id). */
  payloadFor(ticket: { publicRef: string; qrKeyId: number }): string {
    const secret = this.config.qrKeyRing[ticket.qrKeyId];
    if (!secret) throw new Error(`No QR signing key with id ${ticket.qrKeyId} is configured`);
    return createQrPayload(ticket.publicRef, ticket.qrKeyId, secret);
  }

  /** Checks a presented code against the key ring (constant-time; malformed codes are rejected first). */
  verify(payload: string): QrVerification {
    return verifyQrPayload(payload, this.config.qrKeyRing);
  }

  /**
   * A PNG of the code: error correction level Q (about a quarter of the code may be damaged), a 4-module quiet zone,
   * and every module an exact whole number of pixels, so the squares stay crisp at any size. At least `widthPx` wide.
   */
  png(payload: string, widthPx = 600): Promise<Buffer> {
    const qr = QRCode.create(payload, { errorCorrectionLevel: 'Q' });
    const size = qr.modules.size;
    const margin = 4;
    const scale = Math.max(1, Math.ceil(widthPx / (size + 2 * margin)));
    const side = (size + 2 * margin) * scale;
    const raw = Buffer.alloc((side + 1) * side, 255); // each row: a filter byte (0) then one grey byte per pixel
    for (let y = 0; y < side; y += 1) {
      raw[y * (side + 1)] = 0;
      const row = Math.floor(y / scale) - margin;
      if (row < 0 || row >= size) continue;
      for (let x = 0; x < side; x += 1) {
        const col = Math.floor(x / scale) - margin;
        if (col >= 0 && col < size && qr.modules.get(row, col)) raw[y * (side + 1) + 1 + x] = 0;
      }
    }
    return Promise.resolve(encodeGreyPng(raw, side, side));
  }

  /** The same image as a `data:` URL, for showing on the website without a second request. */
  async dataUrl(payload: string, widthPx = 360): Promise<string> {
    return `data:image/png;base64,${(await this.png(payload, widthPx)).toString('base64')}`;
  }
}

// ── a minimal PNG writer (8-bit grey), so no image library has to be loaded just to draw squares ──

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function encodeGreyPng(raw: Buffer, width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // colour type: grey
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
