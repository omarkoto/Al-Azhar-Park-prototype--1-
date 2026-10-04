// Wallet passes (Apple Wallet .pkpass / Google Wallet "Save" JWT) must be signed
// server-side with the park's certificates, so they can't be generated in the browser.
// Point VITE_WALLET_API_URL at the backend that issues them; it is called as
//   {URL}/apple?ref=AZP-XXXXXX   → returns a .pkpass
//   {URL}/google?ref=AZP-XXXXXX  → redirects to the Google Wallet save link
const base = (import.meta.env.VITE_WALLET_API_URL as string | undefined)?.replace(/\/$/, '')

export const walletConfigured = Boolean(base)

export function walletUrl(kind: 'apple' | 'google', ref: string) {
  return `${base}/${kind}?ref=${encodeURIComponent(ref)}`
}
