import { declaredTypeMatches, pdfRiskyFeature, safeFileName, sniffFile } from './media-sniff';
import { STORAGE_KEY } from './media-storage';

import { samples } from '../../../test/helpers/files';

describe('file sniffing', () => {
  it('recognises JPEG, PNG, WebP and PDF by their bytes and reads image sizes', () => {
    expect(sniffFile(samples.png(640, 480))).toMatchObject({ mime: 'image/png', ext: 'png', kind: 'image', width: 640, height: 480 });
    expect(sniffFile(samples.jpeg(800, 600))).toMatchObject({ mime: 'image/jpeg', ext: 'jpg', width: 800, height: 600 });
    expect(sniffFile(samples.webpLossy(1024, 768))).toMatchObject({ mime: 'image/webp', width: 1024, height: 768 });
    expect(sniffFile(samples.webpExtended(2000, 1500))).toMatchObject({ mime: 'image/webp', width: 2000, height: 1500 });
    expect(sniffFile(samples.pdf())).toMatchObject({ mime: 'application/pdf', ext: 'pdf', kind: 'pdf' });
  });

  it('refuses everything else, whatever it claims to be', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
    const html = Buffer.from('<!doctype html><script>alert(1)</script>');
    const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(20)]);
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(40)]);
    for (const b of [svg, html, gif, exe, Buffer.alloc(0), Buffer.from('short')]) expect(sniffFile(b)).toBeNull();
  });

  it('refuses a truncated or malformed image header', () => {
    expect(sniffFile(samples.png().subarray(0, 20))).toBeNull();
    const badPng = samples.png();
    badPng.write('XXXX', 12, 'ascii'); // not an IHDR chunk
    expect(sniffFile(badPng)).toBeNull();
    expect(sniffFile(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(30)]))).toBeNull(); // no frame header
  });

  it('is not fooled by a script with an image extension or a PDF wrapper around HTML', () => {
    expect(sniffFile(Buffer.from('<html><body>not a png</body></html>'.padEnd(40)))).toBeNull();
  });
});

describe('PDF safety', () => {
  it('passes a plain PDF and flags JavaScript, Launch and embedded files', () => {
    expect(pdfRiskyFeature(samples.pdf())).toBeNull();
    expect(pdfRiskyFeature(samples.pdf('<< /S /JavaScript /JS (app.alert(1)) >>'))).toBe('JavaScript');
    expect(pdfRiskyFeature(samples.pdf('<< /S /Launch /F (cmd.exe) >>'))).toBe('Launch');
    expect(pdfRiskyFeature(samples.pdf('/EmbeddedFile'))).toBe('EmbeddedFile');
  });
});

describe('PDF safety: names spelled with #xx escapes', () => {
  // a PDF reader resolves /J#61vaScript to /JavaScript, so the scan must too
  it.each([
    ['/J#61vaScript', 'JavaScript'],
    ['/#4AavaScript', 'JavaScript'],
    ['/#4A#61#76#61#53#63#72#69#70#74', 'JavaScript'],
    ['/J#53', 'JS'],
    ['/#4AS', 'JS'],
    ['/L#61unch', 'Launch'],
    ['/Embedd#65dFile', 'EmbeddedFile'],
    ['/RichM#65dia', 'RichMedia'],
    ['/J#61vaScr#69pt', 'JavaScript'],
    ['/J#61v#61Script', 'JavaScript'],
  ])('flags %s', (spelling, feature) => {
    expect(pdfRiskyFeature(samples.pdf(`<< /S ${spelling} >>`))).toBe(feature);
  });

  it('resolves escapes written with upper- or lower-case hex digits, and only real feature names are flagged', () => {
    expect(pdfRiskyFeature(samples.pdf('<< /S /J#6Fvascript >>'))).toBeNull(); // J + o + vascript is not JavaScript
    expect(pdfRiskyFeature(samples.pdf('<< /S /Launc#68 /T /Launc#6a >>'))).toBe('Launch');
    expect(pdfRiskyFeature(samples.pdf('<< /S /Launc#68 >>'))).toBe('Launch');
    expect(pdfRiskyFeature(samples.pdf('<< /S /Embedded#46ile >>'))).toBe('EmbeddedFile');
  });

  it('does not mistake ordinary escapes and text for active content', () => {
    expect(pdfRiskyFeature(samples.pdf('/Name /Menu#20Page#201 /Title (Price #41 and #5B#5D) /Color #FF00AA'))).toBeNull();
    expect(pdfRiskyFeature(samples.pdf('/A#2FB (a slash escaped) /X #2F#4A (not a name start)'))).toBeNull();
    expect(pdfRiskyFeature(samples.pdf('/Javaure /Laun /Embedded'))).toBeNull();
    expect(pdfRiskyFeature(samples.pdf('/#23J#2361vaScript'))).toBeNull(); // the name is literally "#J#61vaScript"
  });

  it('still flags the plain spellings', () => {
    expect(pdfRiskyFeature(samples.pdf('/JavaScript'))).toBe('JavaScript');
    expect(pdfRiskyFeature(samples.pdf('/JS'))).toBe('JS');
  });
});

describe('declared type and file names', () => {
  it('requires the declared Content-Type to agree with the bytes', () => {
    const png = sniffFile(samples.png())!;
    expect(declaredTypeMatches('image/png', png)).toBe(true);
    expect(declaredTypeMatches('image/png; charset=binary', png)).toBe(true);
    expect(declaredTypeMatches('image/jpeg', png)).toBe(false);
    expect(declaredTypeMatches('text/html', png)).toBe(false);
    expect(declaredTypeMatches('image/jpg', sniffFile(samples.jpeg())!)).toBe(true);
    expect(declaredTypeMatches(undefined, png)).toBe(false);
  });

  it('cleans display names: no paths, no control characters, bounded', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('C:\\Users\\me\\photo.png')).toBe('photo.png');
    expect(safeFileName('a<b>"c|?.png')).toBe('abc.png');
    expect(safeFileName('..hidden')).toBe('hidden');
    expect(safeFileName('x'.repeat(500))).toHaveLength(120);
    expect(safeFileName('')).toBe('file');
    expect(safeFileName(undefined)).toBe('file');
    expect(safeFileName('ملف جميل.webp')).toBe('ملف جميل.webp');
  });
});

describe('storage keys', () => {
  it('accept only generated keys, never anything that could escape the folder', () => {
    expect(STORAGE_KEY.test('0b9c7a52-6a8e-4b8a-9d27-4f7e1c0d9a11.jpg')).toBe(true);
    for (const bad of ['../secret.jpg', '0b9c7a52-6a8e-4b8a-9d27-4f7e1c0d9a11.exe', 'a/b.png', '0b9c7a52-6a8e-4b8a-9d27-4f7e1c0d9a11.jpg/', '..', '', 'file.png']) {
      expect(STORAGE_KEY.test(bad)).toBe(false);
    }
  });
});
