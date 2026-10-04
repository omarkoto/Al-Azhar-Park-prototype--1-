import { MIN_TICKETED_AGE, requiresTicket } from './visitors';

describe('children under 2 do not need a ticket', () => {
  it('sets the ticketed age at 2', () => {
    expect(MIN_TICKETED_AGE).toBe(2);
  });

  it.each([0, 0.5, 1, 1.99])('needs no ticket at age %s', (age) => {
    expect(requiresTicket(age)).toBe(false);
  });

  it.each([2, 5, 8, 9, 40, 90])('needs a ticket at age %s', (age) => {
    expect(requiresTicket(age)).toBe(true);
  });

  it.each([-1, NaN, Infinity])('rejects the impossible age %s', (age) => {
    expect(() => requiresTicket(age)).toThrow();
  });
});
