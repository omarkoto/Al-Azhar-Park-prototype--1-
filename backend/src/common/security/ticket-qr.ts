import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Ticket QR payload:   AZP1.<ticket reference>.<key id>.<signature>
 *
 *   • <ticket reference>  public, random, unguessable ("TKT-8F3K2LQ7ZP") — also printed on the ticket
 *   • <key id>            which signing key was used (lets keys be rotated without invalidating old tickets)
 *   • <signature>         first 128 bits of HMAC-SHA256(key, "AZP1|<key id>|<ticket reference>"), base64url
 *
 * The payload contains NO personal data. Nothing secret is stored in the database: the QR can always be
 * re-derived from the reference, and a QR cannot be forged without the server's signing key.
 * The signature only proves "this server issued a code for this reference"; whether the ticket may enter
 * today is decided by the database (exists, VALID, today's date, not already used).
 */

export const QR_VERSION = 'AZP1';
const SIGNATURE_BYTES = 16; // 128 bits
const SIGNATURE_CHARS = 22; // base64url length of 16 bytes
const MAX_PAYLOAD_LENGTH = 64;
const PAYLOAD_PATTERN = new RegExp(`^${QR_VERSION}\\.(TKT-[0-9A-Z]{8,16})\\.([0-9]{1,3})\\.([A-Za-z0-9_-]{${SIGNATURE_CHARS}})$`);

/** key id → secret. Keep old keys here as long as tickets signed with them can still be scanned. */
export type QrKeyRing = Readonly<Record<number, string>>;

export type QrVerification =
  | { ok: true; ticketRef: string; keyId: number }
  | { ok: false; reason: 'MALFORMED' | 'UNKNOWN_KEY' | 'BAD_SIGNATURE' };

const MIN_SECRET_LENGTH = 32;

function sign(secret: string, keyId: number, ticketRef: string): Buffer {
  return createHmac('sha256', secret).update(`${QR_VERSION}|${keyId}|${ticketRef}`).digest().subarray(0, SIGNATURE_BYTES);
}

export function createQrPayload(ticketRef: string, keyId: number, secret: string): string {
  if (secret.length < MIN_SECRET_LENGTH) throw new Error(`QR signing secret must be at least ${MIN_SECRET_LENGTH} characters`);
  if (!/^TKT-[0-9A-Z]{8,16}$/.test(ticketRef)) throw new Error('Invalid ticket reference');
  if (!Number.isInteger(keyId) || keyId < 0 || keyId > 999) throw new Error('Invalid key id');
  return `${QR_VERSION}.${ticketRef}.${keyId}.${sign(secret, keyId, ticketRef).toString('base64url')}`;
}

/**
 * Checks a scanned string. Strict by design:
 *  1. size and shape are checked first, so garbage never reaches the crypto or the database;
 *  2. the key is chosen by id from the ring (unknown id → rejected);
 *  3. the signature is compared in constant time.
 */
export function verifyQrPayload(payload: string, keys: QrKeyRing): QrVerification {
  if (typeof payload !== 'string' || payload.length > MAX_PAYLOAD_LENGTH) return { ok: false, reason: 'MALFORMED' };
  const match = PAYLOAD_PATTERN.exec(payload);
  if (!match) return { ok: false, reason: 'MALFORMED' };

  const [, ticketRef, keyIdText, signature] = match;
  const keyId = Number(keyIdText);
  const secret = Object.prototype.hasOwnProperty.call(keys, keyId) ? keys[keyId] : undefined;
  if (!secret) return { ok: false, reason: 'UNKNOWN_KEY' };

  const expected = sign(secret, keyId, ticketRef);
  const given = Buffer.from(signature, 'base64url');
  // 22 base64url characters hold 132 bits for a 128-bit value, so several spellings decode to the same bytes.
  // Insist on the one canonical spelling: a code then has exactly one valid form (no malleability).
  if (given.toString('base64url') !== signature) return { ok: false, reason: 'BAD_SIGNATURE' };
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'BAD_SIGNATURE' };
  return { ok: true, ticketRef, keyId };
}

/** Short, non-reversible tag for logs and scan records, so attempts can be correlated without storing the code. */
export function qrFingerprint(payload: string): string {
  return createHash('sha256').update(payload).digest('hex').slice(0, 12);
}
