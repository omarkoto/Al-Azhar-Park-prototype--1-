import { checkCapacity, parseCapacityLimit } from './capacity';

describe('daily capacity', () => {
  describe('no limit today (unlimited)', () => {
    it('reads a null setting as unlimited', () => {
      expect(parseCapacityLimit(null)).toBeNull();
      expect(parseCapacityLimit(undefined)).toBeNull();
    });

    it('accepts any number of tickets, however many are already sold', () => {
      expect(checkCapacity({ limit: null, alreadyTicketed: 0, requested: 1 })).toEqual({ ok: true, remaining: null });
      expect(checkCapacity({ limit: null, alreadyTicketed: 250_000, requested: 5_000 })).toEqual({ ok: true, remaining: null });
    });
  });

  describe('a limit can be switched on later without any redesign', () => {
    it('reads a positive whole number as the limit', () => {
      expect(parseCapacityLimit(4000)).toBe(4000);
    });

    it.each([0, -5, 3.5, '100', NaN, true, {}])('rejects the invalid setting %j', (bad) => {
      expect(() => parseCapacityLimit(bad)).toThrow(/capacity\.dailyLimit/);
    });

    it('admits sales up to the limit and refuses the first ticket beyond it', () => {
      expect(checkCapacity({ limit: 100, alreadyTicketed: 90, requested: 10 })).toEqual({ ok: true, remaining: 0 });
      expect(checkCapacity({ limit: 100, alreadyTicketed: 100, requested: 1 })).toEqual({ ok: false, remaining: 0 });
      expect(checkCapacity({ limit: 100, alreadyTicketed: 98, requested: 3 })).toEqual({ ok: false, remaining: 2 });
    });

    it('never reports negative remaining capacity if the limit was lowered below what is sold', () => {
      expect(checkCapacity({ limit: 50, alreadyTicketed: 80, requested: 1 })).toEqual({ ok: false, remaining: 0 });
    });
  });

  it('rejects a nonsensical request size', () => {
    expect(() => checkCapacity({ limit: null, alreadyTicketed: 0, requested: 0 })).toThrow();
    expect(() => checkCapacity({ limit: null, alreadyTicketed: 0, requested: 1.5 })).toThrow();
  });
});
