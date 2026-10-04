import { randomBytes } from 'node:crypto';

// Crockford base32: digits and letters without I, L, O, U — easy to read aloud and hard to mis-type.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Length of the random part of a ticket reference: 10 characters × 5 bits = 50 bits of entropy. */
export const TICKET_REF_LENGTH = 10;

/**
 * "TKT-8F3K2LQ7ZP". Uses the operating system's CSPRNG. Mapping a byte to the 32-symbol alphabet with `% 32`
 * is exactly uniform because 256 is a multiple of 32 (no modulo bias).
 */
export function generateTicketRef(length: number = TICKET_REF_LENGTH): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % 32];
  return `TKT-${out}`;
}

/** "AZP-2026-000123": the year plus a gap-free yearly sequence (see reference_counters). */
export function formatOrderNumber(year: number, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999_999) throw new Error('order sequence out of range');
  return `AZP-${year}-${String(sequence).padStart(6, '0')}`;
}
