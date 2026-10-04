/**
 * Children under 2 do not need a ticket. They are never part of an order: there is no "infant" ticket type,
 * no 0 EGP ticket, and the database refuses a ticket type that starts below this age or a price of 0.
 * The portal's counter-sale screen and the website show only ticketed visitor types.
 */
export const MIN_TICKETED_AGE = 2;

export function requiresTicket(ageInYears: number): boolean {
  if (!Number.isFinite(ageInYears) || ageInYears < 0) throw new Error('age must be a non-negative number');
  return ageInYears >= MIN_TICKETED_AGE;
}
