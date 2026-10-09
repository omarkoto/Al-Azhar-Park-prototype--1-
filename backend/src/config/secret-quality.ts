/**
 * The labelled development fallbacks used when a secret is not configured outside production. They are in the repository,
 * so they are public: production must refuse them (see envSchema).
 */
export const DEV_JWT_ACCESS_SECRET = 'dev-only-access-secret-do-not-deploy-0123456789';
export const DEV_TOKEN_HASH_SECRET = 'dev-only-refresh-secret-do-not-deploy-9876543210';
export const DEV_TICKET_PEPPER = 'dev-only-ticket-pepper-do-not-deploy-0123456789abcdef';

const PLACEHOLDER = /dev-only|do-not-deploy|change[-_ ]?me|replace[-_ ]?me|placeholder|your[-_ ]?(own[-_ ]?)?(secret|key)|example|dummy|password|secret/i;

/** Bits of information per character (Shannon entropy of the character frequencies). */
function entropyPerChar(value: string): number {
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/**
 * Why a production secret is not acceptable, or null when it is fine. The text never contains the secret itself.
 * A secret made with `randomBytes(48).toString('base64url')` (what .env.example recommends) passes with a wide margin.
 */
export function secretProblem(value: string): string | null {
  if (PLACEHOLDER.test(value)) return 'looks like a development value or a placeholder (it contains words such as dev-only, change-me, example, password or secret)';
  if (new Set(value).size < 10) return 'uses too few different characters to be a real secret';
  if (/^(.{1,16}?)\1+$/.test(value)) return 'is a short pattern repeated, not a random secret';
  if (entropyPerChar(value) < 3) return 'is too predictable (low entropy); generate it with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"';
  return null;
}
