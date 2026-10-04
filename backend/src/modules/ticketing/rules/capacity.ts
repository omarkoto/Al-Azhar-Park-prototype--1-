/**
 * Daily capacity. The park has NO limit today (setting `capacity.dailyLimit` = null).
 * Turning a limit on later is a settings change — no schema change and no new code path:
 * the same check runs on every sale and simply starts rejecting once a number is configured.
 */

/** Tickets in these statuses occupy capacity. Cancelled and expired tickets free it again. */
export const CAPACITY_COUNTED_STATUSES = ['PENDING', 'VALID', 'USED'] as const;

/** Reads the `capacity.dailyLimit` setting: null/absent = unlimited, otherwise a positive whole number. */
export function parseCapacityLimit(setting: unknown): number | null {
  if (setting === null || setting === undefined) return null;
  if (typeof setting === 'number' && Number.isInteger(setting) && setting > 0) return setting;
  throw new Error(`Invalid capacity.dailyLimit setting: expected null or a positive whole number, got ${JSON.stringify(setting)}`);
}

export type CapacityDecision =
  | { ok: true; remaining: number | null } // remaining = null → unlimited
  | { ok: false; remaining: number };

export function checkCapacity(input: { limit: number | null; alreadyTicketed: number; requested: number }): CapacityDecision {
  const { limit, alreadyTicketed, requested } = input;
  if (!Number.isInteger(requested) || requested < 1) throw new Error('requested must be a positive whole number');
  if (limit === null) return { ok: true, remaining: null };

  const remaining = Math.max(0, limit - alreadyTicketed);
  return requested <= remaining ? { ok: true, remaining: remaining - requested } : { ok: false, remaining };
}
