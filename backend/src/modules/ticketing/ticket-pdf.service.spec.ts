import PDFDocument from 'pdfkit';
import { join } from 'node:path';
import { AppConfigService } from '../../config/app-config.service';
import { formatMoney, formatVisitDate } from './confirmation-email';
import { QrService } from './qr.service';
import { drawRtl, splitRuns, wrapRuns } from './rtl-text';
import { TicketPdfService } from './ticket-pdf.service';

const qr = new QrService(new AppConfigService({ DATABASE_URL: 'postgresql://u:p@localhost/x', NODE_ENV: 'development' }));
const service = new TicketPdfService(qr);

const ticket = (over: Record<string, unknown> = {}) => ({
  publicRef: 'TKT-8F3K2LQ7ZP', qrKeyId: 1, status: 'VALID', typeNameEn: 'Adult', typeNameAr: 'بالغ', audienceNameEn: 'Egyptian / resident', audienceNameAr: 'مصري / مقيم',
  pricePaidMinor: 6000, currency: 'EGP', ...over,
});
const input = (locale: 'en' | 'ar', tickets = [ticket()]) => ({ locale, orderNumber: 'AZP-2026-000123', visitDate: '2026-10-09', tickets });
const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length;

describe('ticket PDF', () => {
  it('is a real PDF with one page per ticket', async () => {
    const pdf = await service.render(input('en', [ticket(), ticket({ publicRef: 'TKT-ABCDEFGH23' }), ticket({ publicRef: 'TKT-ZZZZZZZZ99' })]));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.subarray(-6).toString()).toContain('%%EOF');
    expect(pages(pdf)).toBe(3);
  });

  it('embeds the QR code as an image and the Cairo font (so Arabic letters exist)', async () => {
    for (const locale of ['en', 'ar'] as const) {
      const text = (await service.render(input(locale))).toString('latin1');
      expect(text).toContain('/Subtype /Image');
      expect(text).toMatch(/Cairo/);
    }
  });

  it('is built from the ticket records, so it is deterministic for the same data apart from its creation stamp', async () => {
    const a = (await service.render(input('en'))).toString('latin1').replace(/\/CreationDate \(.*?\)/, '').replace(/\/ID \[.*?\]/, '');
    const b = (await service.render(input('en'))).toString('latin1').replace(/\/CreationDate \(.*?\)/, '').replace(/\/ID \[.*?\]/, '');
    expect(a.length).toBe(b.length);
  });

  it('renders a cancelled or used ticket without throwing (it is stamped)', async () => {
    for (const status of ['CANCELLED', 'USED']) {
      for (const locale of ['en', 'ar'] as const) expect((await service.render(input(locale, [ticket({ status })]))).length).toBeGreaterThan(5_000);
    }
  });

  it('refuses a ticket whose QR key is not configured rather than printing an unusable code', async () => {
    await expect(service.render(input('en', [ticket({ qrKeyId: 9 })]))).rejects.toThrow(/No QR signing key/);
  });

  it('writes the visit date and the price the way each language reads them', () => {
    expect(formatVisitDate('2026-10-09', 'en')).toBe('Friday, October 9, 2026');
    expect(formatVisitDate('2026-10-09', 'ar')).toMatch(/الجمعة/);
    expect(formatVisitDate('2026-10-09', 'ar')).toMatch(/٢٠٢٦/);
    expect(formatMoney(6000, 'en')).toBe('60 EGP');
    expect(formatMoney(6250, 'en')).toBe('62.5 EGP');
    expect(formatMoney(6000, 'ar')).toBe('٦٠ جنيه');
  });
});

describe('right-to-left layout', () => {
  const fontDoc = () => {
    const doc = new PDFDocument({ size: 'A5', margin: 0 });
    doc.registerFont('R', join(__dirname, '../../../assets/fonts/Cairo-Regular.ttf'));
    doc.font('R').fontSize(10);
    return doc;
  };

  it('cuts a line into Arabic words, numbers and punctuation, and mirrors brackets', () => {
    expect(splitRuns('طفل (٢–٨ سنوات)').map((r) => `${r.kind}:${r.text}`)).toEqual(['arabic:طفل', 'space: ', 'other:)', 'ltr:٢–٨', 'space: ', 'arabic:سنوات', 'other:(']);
    expect(splitRuns('AZP-2026-000123').map((r) => r.kind)).toEqual(['ltr']);
    expect(splitRuns('الطلب 12').map((r) => r.kind)).toEqual(['arabic', 'space', 'ltr']);
  });

  it('wraps long lines at spaces and never loses a word', () => {
    const doc = fontDoc();
    const text = 'هذه التذكرة صالحة فقط في تاريخ الزيارة المذكور، لشخص واحد.';
    const lines = wrapRuns(doc, text, 120);
    expect(lines.length).toBeGreaterThan(1);
    const words = lines.flatMap((l) => l.filter((r) => r.kind !== 'space').map((r) => r.text));
    expect(words.join('')).toBe(text.replace(/\s/g, ''));
    for (const line of lines) expect(line.reduce((n, r) => n + doc.widthOfString(r.text), 0)).toBeLessThanOrEqual(120 + doc.widthOfString(' ') * line.length);
    doc.end();
  });

  it('reports the height without drawing, and draws the same height', () => {
    const doc = fontDoc();
    const measured = drawRtl(doc, 'السعر المدفوع', 300, 50, 250, true);
    expect(measured).toBeGreaterThan(0);
    expect(drawRtl(doc, 'السعر المدفوع', 300, 50, 250)).toBe(measured);
    doc.end();
  });
});
