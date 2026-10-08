import { evaluateScan } from '../ticketing/rules/scan-validity';
import { CODE_OF_VERDICT, MESSAGE_OF, REASON_OF, SCAN_RESULTS } from './scan-results';

describe('scan results', () => {
  it('has a message and a stored reason for every code, and only a granted scan is recorded as valid', () => {
    for (const code of SCAN_RESULTS) {
      expect(MESSAGE_OF[code].length).toBeGreaterThan(5);
      expect(REASON_OF[code]).toBeDefined();
      // the table's CHECK: VALID goes with OK, INVALID never does
      expect(code === 'ACCESS_GRANTED' ? REASON_OF[code] === 'OK' : REASON_OF[code] !== 'OK').toBe(true);
    }
  });

  it('never explains how a code is checked', () => {
    for (const code of SCAN_RESULTS) expect(MESSAGE_OF[code].toLowerCase()).not.toMatch(/hmac|sha|secret|key|signature|database|sql/);
    expect(MESSAGE_OF.INVALID_QR).toBe(MESSAGE_OF.INVALID_SIGNATURE); // a forger learns nothing from the difference
  });

  it('turns every lifecycle verdict into a scanner result', () => {
    const today = new Date('2026-10-07T10:00:00Z');
    const cases: Array<[Parameters<typeof evaluateScan>[0], string]> = [
      [{ status: 'USED', visitDate: '2026-10-07' }, 'ALREADY_USED'],
      [{ status: 'CANCELLED', visitDate: '2026-10-07' }, 'CANCELLED'],
      [{ status: 'EXPIRED', visitDate: '2026-10-07' }, 'EXPIRED'],
      [{ status: 'PENDING', visitDate: '2026-10-07' }, 'TICKET_NOT_VALID'],
      [{ status: 'VALID', visitDate: '2026-10-08' }, 'WRONG_DATE'],
      [{ status: 'VALID', visitDate: '2026-10-06' }, 'WRONG_DATE'],
    ];
    for (const [ticket, expected] of cases) {
      const verdict = evaluateScan(ticket, today);
      expect(verdict).not.toBe('OK');
      expect(CODE_OF_VERDICT[verdict as Exclude<typeof verdict, 'OK'>]).toBe(expected);
    }
    expect(evaluateScan({ status: 'VALID', visitDate: '2026-10-07' }, today)).toBe('OK');
  });
});
