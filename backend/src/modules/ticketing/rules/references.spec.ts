import { formatOrderNumber, generateTicketRef, TICKET_REF_LENGTH } from './references';

describe('ticket references', () => {
  it('look like TKT- followed by 10 unambiguous characters (no I, L, O, U)', () => {
    for (let i = 0; i < 500; i++) expect(generateTicketRef()).toMatch(/^TKT-[0-9A-HJKMNP-TV-Z]{10}$/);
  });

  it('carry 50 bits of randomness (10 characters × 5 bits)', () => {
    expect(TICKET_REF_LENGTH * Math.log2(32)).toBe(50);
  });

  it('do not collide in 200,000 draws', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200_000; i++) seen.add(generateTicketRef());
    expect(seen.size).toBe(200_000);
  });

  it('use every symbol equally often (no modulo bias)', () => {
    const counts = new Map<string, number>();
    const draws = 40_000;
    for (let i = 0; i < draws; i++) for (const ch of generateTicketRef().slice(4)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    const expected = (draws * TICKET_REF_LENGTH) / 32;
    expect(counts.size).toBe(32);
    for (const n of counts.values()) expect(Math.abs(n - expected) / expected).toBeLessThan(0.05);
  });
});

describe('order numbers', () => {
  it('format as AZP-YYYY-NNNNNN', () => {
    expect(formatOrderNumber(2026, 123)).toBe('AZP-2026-000123');
    expect(formatOrderNumber(2027, 1)).toBe('AZP-2027-000001');
  });

  it('refuse a sequence outside 1–999999', () => {
    expect(() => formatOrderNumber(2026, 0)).toThrow();
    expect(() => formatOrderNumber(2026, 1_000_000)).toThrow();
    expect(() => formatOrderNumber(2026, 1.5)).toThrow();
  });
});
