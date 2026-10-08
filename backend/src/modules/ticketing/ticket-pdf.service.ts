import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { formatMoney, formatVisitDate } from './confirmation-email';
import { QrService } from './qr.service';
import { drawRtl } from './rtl-text';

export interface TicketPdfInput {
  locale: 'en' | 'ar';
  orderNumber: string;
  /** YYYY-MM-DD */
  visitDate: string;
  tickets: Array<{
    publicRef: string;
    qrKeyId: number;
    status: string;
    typeNameEn: string;
    typeNameAr: string;
    audienceNameEn: string;
    audienceNameAr: string;
    pricePaidMinor: number;
    currency: string;
  }>;
}

/** assets/fonts holds Cairo (SIL Open Font License), which has both Latin and Arabic letters. */
function fontsDir(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, 'assets', 'fonts');
    if (existsSync(join(candidate, 'Cairo-Regular.ttf'))) return candidate;
    dir = dirname(dir);
  }
  throw new Error('The ticket fonts (assets/fonts) were not found');
}

const COPY = {
  en: {
    park: 'Al-Azhar Park',
    title: 'Admission ticket',
    order: 'Order',
    ticket: 'Ticket',
    visit: 'Visit date',
    type: 'Ticket type',
    price: 'Price paid',
    of: (n: number, total: number) => `${n} of ${total}`,
    instructionsTitle: 'Before you visit',
    instructions: [
      'This ticket is valid only on the visit date shown, for one person.',
      'Show the QR code at the entrance, on your phone or printed.',
      'Keep the ticket to yourself: anyone holding the code can use it.',
      'Children under 2 enter free and do not need a ticket.',
    ],
    noRefund: 'Tickets are non-refundable.',
    cancelled: 'CANCELLED',
    used: 'USED',
    footer: 'Salah Salem Street, Cairo',
  },
  ar: {
    park: 'حديقة الأزهر',
    title: 'تذكرة دخول',
    order: 'الطلب',
    ticket: 'التذكرة',
    visit: 'تاريخ الزيارة',
    type: 'نوع التذكرة',
    price: 'السعر المدفوع',
    of: (n: number, total: number) => `${n.toLocaleString('ar-EG')} من ${total.toLocaleString('ar-EG')}`,
    instructionsTitle: 'قبل زيارتك',
    instructions: [
      'هذه التذكرة صالحة فقط في تاريخ الزيارة المذكور، لشخص واحد.',
      'اعرض رمز QR عند المدخل، على هاتفك أو مطبوعًا.',
      'احتفظ بالتذكرة لنفسك: يمكن لأي شخص يحمل الرمز استخدامها.',
      'يدخل الأطفال دون سن ٢ مجانًا ولا يحتاجون إلى تذكرة.',
    ],
    noRefund: 'التذاكر غير قابلة للاسترداد.',
    cancelled: 'ملغاة',
    used: 'مستخدمة',
    footer: 'شارع صلاح سالم، القاهرة',
  },
} as const;

const TEAL = '#0b5d52';
const GOLD = '#b8893a';
const INK = '#1f1b16';
const MUTED = '#6b655c';

/**
 * The ticket PDF: one A5 page per ticket, drawn from the server's own records. Nothing in the request can change a
 * price, a date or a ticket type. The QR image is 600 px wide, shown at about 6 cm, so it scans from a phone screen
 * or a print. English and Arabic (right to left) share one font that has both scripts.
 */
@Injectable()
export class TicketPdfService {
  constructor(private readonly qr: QrService) {}

  async render(input: TicketPdfInput): Promise<Buffer> {
    const c = COPY[input.locale];
    const rtl = input.locale === 'ar';
    const fonts = fontsDir();
    const qrImages = await Promise.all(input.tickets.map((t) => this.qr.png(this.qr.payloadFor(t), 600)));

    const doc = new PDFDocument({
      size: 'A5', margin: 0, autoFirstPage: false, compress: true,
      info: { Title: `${c.park} — ${input.orderNumber}`, Author: c.park, Subject: c.title },
    });
    doc.registerFont('Regular', join(fonts, 'Cairo-Regular.ttf'));
    doc.registerFont('Bold', join(fonts, 'Cairo-Bold.ttf'));
    const chunks: Buffer[] = [];
    doc.on('data', (b: Buffer) => chunks.push(b));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    const W = 419.53;
    const H = 595.28;
    const M = 30;
    // one text helper for both languages: Arabic goes through the right-to-left layout, English through PDFKit
    const put = (text: string, y: number, measureOnly = false): number => {
      if (rtl) return drawRtl(doc, text, W - M, y, W - 2 * M, measureOnly);
      const opts = { width: W - 2 * M, align: 'left' as const };
      if (!measureOnly) doc.text(text, M, y, opts);
      return doc.heightOfString(text, opts);
    };

    input.tickets.forEach((t, i) => {
      doc.addPage();
      // header
      doc.rect(0, 0, W, 92).fill(TEAL);
      doc.rect(0, 92, W, 3).fill(GOLD);
      doc.fillColor('#ffffff').font('Bold').fontSize(24);
      put(c.park, 22);
      doc.fillColor('#e8dcc0').font('Regular').fontSize(12);
      put(`${c.title} — ${c.of(i + 1, input.tickets.length)}`, 56);

      // facts: label above value, so Arabic and Latin runs are never mixed in one line
      let y = 112;
      const fact = (label: string, value: string) => {
        doc.fillColor(MUTED).font('Regular').fontSize(9);
        put(label, y);
        doc.fillColor(INK).font('Bold').fontSize(13);
        put(value, y + 12);
        y += 34;
      };
      fact(c.order, input.orderNumber);
      fact(c.ticket, t.publicRef);
      fact(c.visit, formatVisitDate(input.visitDate, input.locale));
      fact(c.type, `${rtl ? t.typeNameAr : t.typeNameEn} — ${rtl ? t.audienceNameAr : t.audienceNameEn}`);
      fact(c.price, formatMoney(t.pricePaidMinor, input.locale));

      // QR code, centred, with the position of the ticket in the order
      const qrSize = 130;
      const qrX = (W - qrSize) / 2;
      const qrY = y + 6;
      doc.rect(qrX - 8, qrY - 8, qrSize + 16, qrSize + 16).lineWidth(1).strokeColor('#d9d2c4').stroke();
      doc.image(qrImages[i], qrX, qrY, { width: qrSize, height: qrSize });

      // instructions and the no-refund notice
      let iy = qrY + qrSize + 24;
      doc.fillColor(TEAL).font('Bold').fontSize(10);
      iy += put(c.instructionsTitle, iy) + 2;
      doc.fillColor(INK).font('Regular').fontSize(8);
      for (const line of c.instructions) iy += put(rtl ? line : `• ${line}`, iy) + 2;
      doc.fillColor('#8a2d2d').font('Bold').fontSize(9);
      put(c.noRefund, iy + 3);

      if (t.status !== 'VALID') {
        const label = t.status === 'CANCELLED' ? c.cancelled : c.used;
        doc.save().rotate(-20, { origin: [W / 2, H / 2] }).fillColor('#b00020').opacity(0.35).font('Bold').fontSize(56);
        if (rtl) drawRtl(doc, label, W / 2 + doc.widthOfString(label) / 2, H / 2 - 30, W);
        else doc.text(label, 0, H / 2 - 30, { width: W, align: 'center' });
        doc.restore();
      }
      doc.fillColor(MUTED).opacity(1).font('Regular').fontSize(8);
      if (rtl) drawRtl(doc, c.footer, W / 2 + doc.widthOfString(c.footer) / 2, H - 20, W);
      else doc.text(c.footer, 0, H - 20, { width: W, align: 'center' });
    });

    doc.end();
    return done;
  }
}
