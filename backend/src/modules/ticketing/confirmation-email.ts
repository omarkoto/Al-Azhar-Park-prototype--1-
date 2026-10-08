import type { EmailMessage } from '../email/email-provider';

export interface ConfirmationData {
  locale: 'en' | 'ar';
  customerName: string;
  orderNumber: string;
  /** YYYY-MM-DD */
  visitDate: string;
  totalMinor: number;
  currency: string;
  ticketCount: number;
  /** the private link to the order page (carries the customer's access key) */
  link: string;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function formatVisitDate(iso: string, locale: 'en' | 'ar'): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
}

export function formatMoney(minor: number, locale: 'en' | 'ar'): string {
  const n = minor / 100;
  return locale === 'ar' ? `${n.toLocaleString('ar-EG')} جنيه` : `${n.toLocaleString('en-US')} EGP`;
}

const COPY = {
  en: {
    subject: (n: string) => `Your Al-Azhar Park tickets — order ${n}`,
    hello: (name: string) => `Hello ${name},`,
    intro: 'Thank you. Your payment was received and your tickets are ready.',
    visit: 'Visit date',
    tickets: 'Tickets',
    total: 'Total paid',
    order: 'Order number',
    open: 'Open your tickets (QR codes and PDF download):',
    rules: ['Each ticket is valid only on the visit date above, for one person.', 'Show the QR code at the entrance, on your phone or printed.', 'Children under 2 enter free and do not need a ticket.', 'Tickets are non-refundable.'],
    keep: 'Keep this e-mail: the link above is private to you. Do not share it.',
    signoff: 'Al-Azhar Park',
  },
  ar: {
    subject: (n: string) => `تذاكرك لحديقة الأزهر — الطلب ${n}`,
    hello: (name: string) => `مرحبًا ${name}،`,
    intro: 'شكرًا لك. تم استلام الدفع وتذاكرك جاهزة.',
    visit: 'تاريخ الزيارة',
    tickets: 'عدد التذاكر',
    total: 'المبلغ المدفوع',
    order: 'رقم الطلب',
    open: 'افتح تذاكرك (رموز QR وتنزيل ملف PDF):',
    rules: ['كل تذكرة صالحة فقط في تاريخ الزيارة أعلاه، لشخص واحد.', 'اعرض رمز QR عند المدخل، على هاتفك أو مطبوعًا.', 'يدخل الأطفال دون سن ٢ مجانًا ولا يحتاجون إلى تذكرة.', 'التذاكر غير قابلة للاسترداد.'],
    keep: 'احتفظ بهذه الرسالة: الرابط أعلاه خاص بك. لا تشاركه.',
    signoff: 'حديقة الأزهر',
  },
} as const;

/** The ticket confirmation e-mail. It carries the order summary and the private link; it never carries a QR or a signature. */
export function buildConfirmationEmail(to: string, d: ConfirmationData): EmailMessage {
  const c = COPY[d.locale];
  const date = formatVisitDate(d.visitDate, d.locale);
  const total = formatMoney(d.totalMinor, d.locale);
  const count = d.locale === 'ar' ? d.ticketCount.toLocaleString('ar-EG') : String(d.ticketCount);
  const text = [
    c.hello(d.customerName), '', c.intro, '',
    `${c.order}: ${d.orderNumber}`, `${c.visit}: ${date}`, `${c.tickets}: ${count}`, `${c.total}: ${total}`, '',
    c.open, d.link, '', ...c.rules.map((r) => `- ${r}`), '', c.keep, '', c.signoff,
  ].join('\n');
  const html = `<!doctype html><html lang="${d.locale}" dir="${d.locale === 'ar' ? 'rtl' : 'ltr'}"><body style="font-family:Arial,Helvetica,sans-serif;color:#222;line-height:1.55;max-width:560px;margin:0 auto;padding:24px">
<h1 style="font-size:20px;color:#0b5d52;margin:0 0 16px">${escapeHtml(c.signoff)}</h1>
<p>${escapeHtml(c.hello(d.customerName))}</p><p>${escapeHtml(c.intro)}</p>
<table style="border-collapse:collapse;margin:16px 0"><tbody>
<tr><td style="padding:4px 16px 4px 0;color:#666">${escapeHtml(c.order)}</td><td><strong>${escapeHtml(d.orderNumber)}</strong></td></tr>
<tr><td style="padding:4px 16px 4px 0;color:#666">${escapeHtml(c.visit)}</td><td><strong>${escapeHtml(date)}</strong></td></tr>
<tr><td style="padding:4px 16px 4px 0;color:#666">${escapeHtml(c.tickets)}</td><td><strong>${escapeHtml(count)}</strong></td></tr>
<tr><td style="padding:4px 16px 4px 0;color:#666">${escapeHtml(c.total)}</td><td><strong>${escapeHtml(total)}</strong></td></tr></tbody></table>
<p>${escapeHtml(c.open)}</p>
<p><a href="${escapeHtml(d.link)}" style="display:inline-block;background:#0b6b5e;color:#fff;text-decoration:none;padding:12px 22px;border-radius:24px;font-weight:bold">${escapeHtml(c.signoff)} — ${escapeHtml(d.orderNumber)}</a></p>
<ul style="color:#444;padding-inline-start:18px">${c.rules.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
<p style="color:#777;font-size:13px">${escapeHtml(c.keep)}</p></body></html>`;
  return { to, subject: c.subject(d.orderNumber), text, html };
}
