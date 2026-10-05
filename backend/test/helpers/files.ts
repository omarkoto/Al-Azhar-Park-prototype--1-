/** Smallest plausible headers for each format, built by hand (no image library needed). */
export const samples = {
  png: (w = 640, h = 480) => {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(13, 8);
    b.write('IHDR', 12, 'ascii');
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    return b;
  },
  jpeg: (w = 800, h = 600) => {
    // SOI, APP0 (16 bytes), SOF0 with the size, then padding
    const b = Buffer.alloc(40);
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).copy(b, 0);
    b.write('JFIF\0', 6, 'ascii');
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]).copy(b, 20);
    b.writeUInt16BE(h, 25);
    b.writeUInt16BE(w, 27);
    return b;
  },
  webpLossy: (w = 1024, h = 768) => {
    const b = Buffer.alloc(40);
    b.write('RIFF', 0, 'ascii');
    b.writeUInt32LE(32, 4);
    b.write('WEBPVP8 ', 8, 'ascii');
    Buffer.from([0x9d, 0x01, 0x2a]).copy(b, 23);
    b.writeUInt16LE(w, 26);
    b.writeUInt16LE(h, 28);
    return b;
  },
  webpExtended: (w = 2000, h = 1500) => {
    const b = Buffer.alloc(40);
    b.write('RIFF', 0, 'ascii');
    b.write('WEBPVP8X', 8, 'ascii');
    b.writeUIntLE(w - 1, 24, 3);
    b.writeUIntLE(h - 1, 27, 3);
    return b;
  },
  pdf: (extra = '') => Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n${extra}\n%%EOF\n`),
};


/** A valid-looking PNG of exactly `bytes` bytes (header + padding), for size-limit tests. */
export const pngOfSize = (bytes: number) => Buffer.concat([samples.png(), Buffer.alloc(Math.max(0, bytes - 33))]);
