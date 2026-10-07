import { DOW_EVERY_DAY, DOW_WEEKDAY, DOW_WEEKEND, dayTypeOf, dowBit, PriceRow, selectPrice } from './price-selection';

const row = (over: Partial<PriceRow> = {}): PriceRow => ({
  id: 'p1', ticketTypeId: 'adult', audienceId: 'resident', kind: 'STANDARD', amountMinor: 5000, currency: 'EGP', priority: 0, dowMask: DOW_WEEKDAY,
  specialDates: [], validFrom: '2026-01-01', validTo: null, isActive: true, createdAt: 1, ...over,
});
const q = (date: string, over: Partial<{ ticketTypeId: string; audienceId: string }> = {}) => ({ ticketTypeId: 'adult', audienceId: 'resident', date, ...over });

// 2026-10-04 is a Sunday
describe('weekdays and weekends', () => {
  it('uses Sunday–Thursday as weekdays and Friday–Saturday as the weekend', () => {
    const days = ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'];
    expect(days.map(dayTypeOf)).toEqual(['WEEKDAY', 'WEEKDAY', 'WEEKDAY', 'WEEKDAY', 'WEEKDAY', 'WEEKEND', 'WEEKEND']);
    expect(days.map(dowBit)).toEqual([1, 2, 4, 8, 16, 32, 64]);
    expect(DOW_WEEKDAY | DOW_WEEKEND).toBe(DOW_EVERY_DAY);
  });
});

describe('price selection', () => {
  const matrix = [row({ id: 'wd', dowMask: DOW_WEEKDAY, amountMinor: 5000 }), row({ id: 'we', dowMask: DOW_WEEKEND, amountMinor: 6000 })];

  it('picks the weekday price Sunday–Thursday and the weekend price Friday–Saturday', () => {
    expect(selectPrice(matrix, q('2026-10-04'))?.amountMinor).toBe(5000); // Sunday
    expect(selectPrice(matrix, q('2026-10-08'))?.amountMinor).toBe(5000); // Thursday
    expect(selectPrice(matrix, q('2026-10-09'))?.amountMinor).toBe(6000); // Friday
    expect(selectPrice(matrix, q('2026-10-10'))?.amountMinor).toBe(6000); // Saturday
  });

  it('keeps ticket types and audiences apart', () => {
    const rows = [...matrix, row({ id: 'vis', audienceId: 'visitor', amountMinor: 15000 }), row({ id: 'child', ticketTypeId: 'child', amountMinor: 3500 })];
    expect(selectPrice(rows, q('2026-10-04', { audienceId: 'visitor' }))?.amountMinor).toBe(15000);
    expect(selectPrice(rows, q('2026-10-04', { ticketTypeId: 'child' }))?.amountMinor).toBe(3500);
    expect(selectPrice(rows, q('2026-10-04', { ticketTypeId: 'senior' }))).toBeNull();
  });

  it('returns nothing — never zero — when no price is configured', () => {
    expect(selectPrice([], q('2026-10-04'))).toBeNull();
    expect(selectPrice([row({ isActive: false })], q('2026-10-04'))).toBeNull();
  });

  it('respects the validity dates, inclusive at both ends', () => {
    const rows = [row({ validFrom: '2026-11-01', validTo: '2026-11-30' })];
    expect(selectPrice(rows, q('2026-10-31'))).toBeNull();
    expect(selectPrice(rows, q('2026-11-01'))?.id).toBe('p1'); // Sunday, first day
    expect(selectPrice(rows, q('2026-11-29'))?.id).toBe('p1');
    expect(selectPrice(rows, q('2026-12-01'))).toBeNull();
  });

  it('switches to the new price exactly on its first day and keeps the old one before', () => {
    const rows = [row({ id: 'old', amountMinor: 5000, validTo: '2026-12-31' }), row({ id: 'new', amountMinor: 5500, validFrom: '2027-01-01' })];
    expect(selectPrice(rows, q('2026-12-27'))?.id).toBe('old'); // Sunday
    expect(selectPrice(rows, q('2027-01-03'))?.id).toBe('new'); // Sunday
  });

  it('lets a holiday price win on its dates only, and a higher priority win over a lower one', () => {
    const rows = [row({ id: 'std' }), row({ id: 'eid', kind: 'SPECIAL', priority: 10, dowMask: DOW_EVERY_DAY, specialDates: ['2026-10-05'], amountMinor: 8000 })];
    expect(selectPrice(rows, q('2026-10-05'))?.id).toBe('eid');
    expect(selectPrice(rows, q('2026-10-06'))?.id).toBe('std');
  });

  it('never applies a promotional price to an ordinary purchase', () => {
    expect(selectPrice([row({ kind: 'PROMOTIONAL', priority: 20, promoCode: 'X' } as Partial<PriceRow>)], q('2026-10-04'))).toBeNull();
  });

  it('breaks ties the same way every time: priority, latest start, newest, id', () => {
    const a = row({ id: 'a', validFrom: '2026-01-01', createdAt: 1 });
    const b = row({ id: 'b', validFrom: '2026-06-01', createdAt: 1 });
    const c = row({ id: 'c', validFrom: '2026-06-01', createdAt: 2 });
    expect(selectPrice([a, b, c], q('2026-10-04'))?.id).toBe('c');
    expect(selectPrice([c, b, a], q('2026-10-04'))?.id).toBe('c');
    const d = row({ id: 'd', validFrom: '2026-06-01', createdAt: 2 });
    expect(selectPrice([d, c], q('2026-10-04'))?.id).toBe('c'); // identical but for the id
  });
});
