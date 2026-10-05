export const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000/api/v1').replace(/\/+$/, '')

export interface PageMeta {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface FieldIssue {
  path: string
  message: string
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: FieldIssue[],
  ) {
    super(message)
  }
}

/** { 'days.1.closes': 'must close after it opens' } — for showing a message next to the field. */
export function fieldErrors(error: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (error instanceof ApiError && Array.isArray(error.details)) {
    for (const issue of error.details) if (issue.path && !(issue.path in out)) out[issue.path] = issue.message
  }
  return out
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'VALIDATION_FAILED') return 'Please fix the highlighted fields.'
    if (error.status === 403) return 'You do not have permission to do this.'
    if (error.status === 429) return 'Too many attempts. Please wait a moment and try again.'
    return error.message
  }
  return 'Could not reach the server. Check your connection and try again.'
}

type Fetch = typeof fetch

/**
 * One place that talks to the API.
 *  - The access token lives only in memory (never localStorage), so a script cannot read it from storage.
 *  - The refresh token is an httpOnly cookie the browser sends by itself.
 *  - On a 401 the call is retried ONCE after a refresh. Refresh tokens rotate and are single-use, so every
 *    concurrent caller must share the same in-flight refresh; two parallel refreshes would look like token theft
 *    to the server and end the session.
 */
export class ApiClient {
  private accessToken: string | null = null
  private refreshing: Promise<boolean> | null = null
  /** called when the session cannot be renewed (signed out elsewhere, 30-day limit, deactivated …) */
  onSessionLost: () => void = () => undefined
  /** called with the seconds until the new access token expires, after each refresh */
  onTokenRenewed: (expiresInSeconds: number) => void = () => undefined

  constructor(
    private readonly baseUrl: string = API_URL,
    private readonly doFetch: Fetch = (...args) => fetch(...args),
  ) {}

  setAccessToken(token: string | null) {
    this.accessToken = token
  }

  get hasToken() {
    return this.accessToken !== null
  }

  async get<T>(path: string): Promise<T> {
    return (await this.send<T>('GET', path)).data as T
  }
  /** A list endpoint: the items and the paging details ({ page, limit, total, totalPages }). */
  async getPage<T>(path: string): Promise<{ items: T[]; meta: PageMeta }> {
    const r = await this.send<T[]>('GET', path)
    return { items: r.data ?? [], meta: r.meta ?? { page: 1, limit: 20, total: 0, totalPages: 1 } }
  }
  /** Uploads a file (multipart). The browser sets the multipart boundary itself, so no Content-Type is given. */
  async upload<T>(path: string, form: FormData): Promise<T> {
    return (await this.send<T>('POST', path, undefined, false, form)).data as T
  }
  async post<T>(path: string, body?: unknown): Promise<T> {
    return (await this.send<T>('POST', path, body)).data as T
  }
  async put<T>(path: string, body?: unknown): Promise<T> {
    return (await this.send<T>('PUT', path, body)).data as T
  }
  async patch<T>(path: string, body?: unknown): Promise<T> {
    return (await this.send<T>('PATCH', path, body)).data as T
  }
  async delete<T>(path: string): Promise<T> {
    return (await this.send<T>('DELETE', path)).data as T
  }

  /** Exchanges the refresh cookie for a new access token. Safe to call from several places at once. */
  refresh(): Promise<boolean> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  private async doRefresh(): Promise<boolean> {
    try {
      const res = await this.doFetch(`${this.baseUrl}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: '{}',
      })
      if (!res.ok) {
        this.accessToken = null
        return false
      }
      const { data } = (await res.json()) as { data: { accessToken: string; expiresIn: number } }
      this.accessToken = data.accessToken
      this.onTokenRenewed(data.expiresIn)
      return true
    } catch {
      return false // network trouble: keep the current token, the next call will tell
    }
  }

  private async send<T>(method: string, path: string, body?: unknown, retried = false, form?: FormData): Promise<{ data?: T; meta?: PageMeta }> {
    const res = await this.doFetch(`${this.baseUrl}${path}`, {
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && !form ? { 'Content-Type': 'application/json' } : {}),
        ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
      },
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    })

    if (res.status === 401 && !retried && !path.startsWith('/auth/login')) {
      if (await this.refresh()) return this.send<T>(method, path, body, true, form)
      this.onSessionLost()
    }

    const text = await res.text()
    const json = text ? (JSON.parse(text) as { data?: T; meta?: PageMeta; error?: { code: string; message: string; details?: FieldIssue[] } }) : {}
    if (!res.ok) {
      const e = json.error
      throw new ApiError(res.status, e?.code ?? 'ERROR', e?.message ?? `Request failed (${res.status})`, e?.details)
    }
    return { data: json.data, meta: json.meta }
  }
}

export const api = new ApiClient()

/** Uploaded files are site-relative paths from the API; show them from the API's own address. */
export function assetUrl(path: string): string {
  return path.startsWith('/') ? `${new URL(API_URL).origin}${path}` : path
}
