export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/** A short list of the passwords attackers try first; the length rule already blocks most of them. */
const COMMON = new Set([
  'password1234', 'password12345', 'passw0rd1234', 'qwertyuiop12', 'qwerty123456', '123456789012', '1234567890123',
  'administrator', 'welcome12345', 'letmein12345', 'iloveyou1234', 'azharpark1234', 'alazharpark', 'alazharpark123',
  'changeme1234', 'changeme12345',
]);

/** Returns a human-readable reason if the password is not acceptable, otherwise null. */
export function passwordProblem(password: string, context: { email?: string; fullName?: string } = {}): string | null {
  if (password.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Password must be at most ${PASSWORD_MAX} characters.`;
  if (/^\s|\s$/.test(password)) return 'Password must not start or end with a space.';
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'This password is too common.';
  if (new Set(lower).size < 5) return 'Password is too repetitive.';
  const local = context.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return 'Password must not contain your email name.';
  for (const part of (context.fullName ?? '').toLowerCase().split(/\s+/)) {
    if (part.length >= 4 && lower.includes(part)) return 'Password must not contain your name.';
  }
  return null;
}
