/**
 * Where the backend lives. Unset = the site runs entirely on its built-in content (no network calls),
 * which is how the site worked before the backend existed and is still the fallback if the API is down.
 * Example: VITE_API_URL=https://api.alazharpark.com/api/v1
 */
export const API_URL: string | undefined = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') || undefined

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (!API_URL) throw new Error('VITE_API_URL is not configured')
  const res = await fetch(`${API_URL}${path}`, { headers: { Accept: 'application/json' }, signal })
  if (!res.ok) throw new Error(`GET ${path} failed with ${res.status}`)
  const body = (await res.json()) as { data: T }
  return body.data
}

export async function apiPost(path: string, body: unknown): Promise<void> {
  if (!API_URL) throw new Error('VITE_API_URL is not configured')
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${path} failed with ${res.status}`)
}

/** Uploaded files come back as site-relative paths ("/api/v1/media/file/..."); put the API's own address in front. */
export function assetUrl(path: string): string {
  if (!API_URL || !path.startsWith('/')) return path
  return `${new URL(API_URL).origin}${path}`
}
