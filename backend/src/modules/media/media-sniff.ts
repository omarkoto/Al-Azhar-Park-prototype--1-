export type MediaKind = 'image' | 'pdf';

export interface SniffedFile {
  mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
  ext: 'jpg' | 'png' | 'webp' | 'pdf';
  kind: MediaKind;
  width?: number;
  height?: number;
}

export const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
/** Pixel limit per side: far beyond any real photo, and stops absurd "decompression bomb" headers. */
export const MAX_DIMENSION = 12_000;

const startsWith = (b: Buffer, bytes: number[], at = 0) => bytes.every((v, i) => b[at + i] === v);

/**
 * Decides what a file really is from its first bytes. The browser's Content-Type and the file name are NEVER
 * trusted (they are chosen by the sender). Only JPEG, PNG, WebP and PDF are recognised; SVG (which can carry
 * script), HTML, GIF and everything else return null.
 */
export function sniffFile(b: Buffer): SniffedFile | null {
  if (b.length < 12) return null;

  if (startsWith(b, [0xff, 0xd8, 0xff])) {
    const size = jpegSize(b);
    return size ? { mime: 'image/jpeg', ext: 'jpg', kind: 'image', ...size } : null;
  }
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    // the first chunk must be IHDR: width and height are big-endian 32-bit numbers right after its name
    if (b.length < 24 || b.toString('ascii', 12, 16) !== 'IHDR') return null;
    return { mime: 'image/png', ext: 'png', kind: 'image', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const size = webpSize(b);
    return size ? { mime: 'image/webp', ext: 'webp', kind: 'image', ...size } : null;
  }
  if (b.toString('ascii', 0, 5) === '%PDF-') return { mime: 'application/pdf', ext: 'pdf', kind: 'pdf' };
  return null;
}

function jpegSize(b: Buffer): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // markers without a length
      continue;
    }
    const length = b.readUInt16BE(i + 2);
    // start-of-frame markers carry the size (C4, C8 and CC are not frames)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    if (length < 2) return null;
    i += 2 + length;
  }
  return null;
}

function webpSize(b: Buffer): { width: number; height: number } | null {
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8X' && b.length >= 30) {
    return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  }
  if (chunk === 'VP8L' && b.length >= 25 && b[20] === 0x2f) {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8 ' && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

/**
 * A PDF is a program-like container. We cannot scan it fully, but we refuse the features that make a PDF run
 * code or launch things when opened: JavaScript, Launch actions and embedded files. This is a best-effort check of the file as
 * written: features hidden inside a compressed object stream are not visible to it. Uploaded files are therefore also always
 * served with `nosniff` and a sandboxing Content-Security-Policy (see MediaController), and only staff with media:write can upload.
 */
export function pdfRiskyFeature(b: Buffer): string | null {
  const raw = b.toString('latin1');
  // A PDF name may spell any character as #xx (/J#61vaScript IS /JavaScript to every PDF reader), so the names are looked for as
  // written AND with those escapes resolved.
  const resolved = raw.replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  for (const token of ['/JavaScript', '/JS', '/Launch', '/EmbeddedFile', '/RichMedia']) {
    if (raw.includes(token) || resolved.includes(token)) return token.slice(1);
  }
  return null;
}

/** A display-only file name: no path, no control characters, bounded length. Never used to store the file. */
export function safeFileName(original: string | undefined): string {
  const base = (original ?? 'file').split(/[\\/]/).pop() ?? 'file';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/^\.+/, '').trim();
  return (cleaned || 'file').slice(0, 120);
}

/** The declared Content-Type must agree with what the bytes are (image/jpg is a common alias for JPEG). */
export function declaredTypeMatches(declared: string | undefined, sniffed: SniffedFile): boolean {
  const d = (declared ?? '').toLowerCase().split(';')[0].trim();
  if (d === 'image/jpg' || d === 'image/pjpeg') return sniffed.mime === 'image/jpeg';
  return d === sniffed.mime;
}
