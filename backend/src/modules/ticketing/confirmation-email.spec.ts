import { buildConfirmationEmail } from './confirmation-email';
import { safeError } from './ticket-delivery.service';

const data = { locale: 'en' as const, customerName: 'Mona Hassan', orderNumber: 'AZP-2026-000123', visitDate: '2026-10-09', totalMinor: 13500, currency: 'EGP', ticketCount: 3, link: 'https://www.azharpark.test/orders/AZP-2026-000123#k=abc_DEF-123' };

describe('ticket confirmation e-mail', () => {
  it('has the order summary, the private link and the rules, in English', () => {
    const m = buildConfirmationEmail('mona@example.com', data);
    expect(m.to).toBe('mona@example.com');
    expect(m.subject).toBe('Your Al-Azhar Park tickets — order AZP-2026-000123');
    for (const part of ['AZP-2026-000123', 'Friday, October 9, 2026', '135 EGP', data.link, 'non-refundable', 'Children under 2']) expect(m.text).toContain(part);
    expect(m.html).toContain(`href="${data.link}"`);
    expect(m.html).toContain('dir="ltr"');
  });

  it('is right to left and uses Arabic digits in Arabic', () => {
    const m = buildConfirmationEmail('mona@example.com', { ...data, locale: 'ar' });
    expect(m.html).toContain('dir="rtl"');
    expect(m.subject).toContain('تذاكرك');
    expect(m.text).toContain('١٣٥ جنيه');
    expect(m.text).toContain('غير قابلة للاسترداد');
    expect(m.text).toContain(data.link);
  });

  it('never contains a QR code, a signature or a ticket reference: only the link leads to the tickets', () => {
    const m = buildConfirmationEmail('mona@example.com', data);
    expect(`${m.text}${m.html}`).not.toMatch(/AZP1\.|TKT-|data:image/);
  });

  it('escapes the customer\'s name so it cannot inject markup', () => {
    const m = buildConfirmationEmail('x@example.com', { ...data, customerName: '<script>alert(1)</script> & "co"' });
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;');
    expect(m.html).toContain('&amp;');
  });
});

describe('delivery error text', () => {
  it('never keeps an address that carries credentials, and stays short', () => {
    expect(safeError(new Error('connect failed smtps://user:secret@smtp.example.com:465 timed out'))).toBe('connect failed [url] timed out');
    expect(safeError('x'.repeat(1000)).length).toBe(300);
    expect(safeError(new Error('line one\nline two'))).toBe('line one line two');
  });
});
