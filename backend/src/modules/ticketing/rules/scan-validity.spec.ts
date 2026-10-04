import { cairoInstant } from '../../../../test/helpers/cairo';
import { evaluateScan } from './scan-validity';

const ticket = (over: Partial<Parameters<typeof evaluateScan>[0]> = {}) =>
  ({ status: 'VALID', visitDate: '2026-10-10', ...over }) as Parameters<typeof evaluateScan>[0];

describe('a ticket is valid only on its visit date', () => {
  it('admits a 10 October ticket on 10 October', () => {
    expect(evaluateScan(ticket(), cairoInstant('2026-10-10', '09:00'))).toBe('OK');
    expect(evaluateScan(ticket(), cairoInstant('2026-10-10', '00:00:00'))).toBe('OK');
    expect(evaluateScan(ticket(), cairoInstant('2026-10-10', '23:59:59'))).toBe('OK');
  });

  it('refuses a 10 October ticket scanned on 11 October — even one second after midnight', () => {
    expect(evaluateScan(ticket(), cairoInstant('2026-10-11', '00:00:01'))).toBe('WRONG_DATE');
    expect(evaluateScan(ticket(), cairoInstant('2026-10-11', '12:00'))).toBe('WRONG_DATE');
  });

  it('refuses it the day before as well', () => {
    expect(evaluateScan(ticket(), cairoInstant('2026-10-09', '23:59:59'))).toBe('WRONG_DATE');
  });

  it('decides by the Cairo calendar day, not UTC', () => {
    // 21:30 UTC on 9 Oct is already 00:30 on 10 Oct in Cairo → admitted
    expect(evaluateScan(ticket(), new Date('2026-10-09T21:30:00Z'))).toBe('OK');
    // 21:30 UTC on 10 Oct is already 00:30 on 11 Oct in Cairo → refused
    expect(evaluateScan(ticket(), new Date('2026-10-10T21:30:00Z'))).toBe('WRONG_DATE');
  });

  it('applies the same rule in winter time', () => {
    const t = ticket({ visitDate: '2026-12-10' });
    expect(evaluateScan(t, new Date('2026-12-09T22:30:00Z'))).toBe('OK'); // 00:30 on 10 Dec (UTC+2)
    expect(evaluateScan(t, new Date('2026-12-10T22:30:00Z'))).toBe('WRONG_DATE'); // 00:30 on 11 Dec
  });

  it.each([
    ['USED', 'ALREADY_USED'],
    ['CANCELLED', 'CANCELLED'],
    ['EXPIRED', 'EXPIRED'],
    ['PENDING', 'NOT_PAID'],
  ] as const)('refuses a %s ticket even on the right day (%s)', (status, verdict) => {
    expect(evaluateScan(ticket({ status }), cairoInstant('2026-10-10', '12:00'))).toBe(verdict);
  });
});
