import { describe, expect, it, vi } from 'vitest'
import { ApiClient, ApiError, errorMessage, fieldErrors } from './api'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** A fake server: `/park` needs the token "good"; `/auth/refresh` hands out "good" (once per rotation) or fails. */
function fakeServer(opts: { refreshOk?: boolean; goodToken?: string } = {}) {
  const calls: Array<{ url: string; auth: string | null }> = []
  let refreshes = 0
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    const auth = new Headers(init?.headers).get('Authorization')
    calls.push({ url: u, auth })
    if (u.endsWith('/auth/refresh')) {
      refreshes++
      await new Promise((r) => setTimeout(r, 10)) // slow enough for callers to overlap
      return opts.refreshOk === false ? json(401, { error: { code: 'INVALID_REFRESH_TOKEN', message: 'expired' } }) : json(200, { data: { accessToken: opts.goodToken ?? 'good', expiresIn: 900 } })
    }
    if (auth === `Bearer ${opts.goodToken ?? 'good'}`) return json(200, { data: { ok: true } })
    return json(401, { error: { code: 'UNAUTHENTICATED', message: 'no' } })
  })
  return { fetchFn: fetchFn as unknown as typeof fetch, calls, refreshes: () => refreshes }
}

describe('ApiClient', () => {
  it('sends the in-memory token, with cookies, as a Bearer header', async () => {
    const s = fakeServer()
    const api = new ApiClient('http://api', s.fetchFn)
    api.setAccessToken('good')
    expect(await api.get('/park')).toEqual({ ok: true })
    expect(s.calls[0].auth).toBe('Bearer good')
    expect((s.fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({ credentials: 'include' })
  })

  it('refreshes once on a 401 and retries the original call', async () => {
    const s = fakeServer()
    const api = new ApiClient('http://api', s.fetchFn)
    api.setAccessToken('expired')
    expect(await api.get('/park')).toEqual({ ok: true })
    expect(s.refreshes()).toBe(1)
    expect(s.calls.map((c) => c.url.replace('http://api', ''))).toEqual(['/park', '/auth/refresh', '/park'])
  })

  it('shares ONE refresh between simultaneous calls (a second refresh would look like token theft)', async () => {
    const s = fakeServer()
    const api = new ApiClient('http://api', s.fetchFn)
    api.setAccessToken('expired')
    const results = await Promise.all([api.get('/park'), api.get('/park'), api.get('/park'), api.get('/park')])
    expect(results).toHaveLength(4)
    expect(s.refreshes()).toBe(1)
  })

  it('shares one refresh between an explicit refresh() and a 401-triggered one (React StrictMode double mount)', async () => {
    const s = fakeServer()
    const api = new ApiClient('http://api', s.fetchFn)
    await Promise.all([api.refresh(), api.refresh()])
    expect(s.refreshes()).toBe(1)
    await api.refresh() // a later one is a new refresh
    expect(s.refreshes()).toBe(2)
  })

  it('does not retry forever: a second 401 after a refresh is an error', async () => {
    const s = fakeServer({ goodToken: 'never-matches-what-refresh-returns' })
    const api = new ApiClient('http://api', s.fetchFn)
    // refresh succeeds but returns a token the server still rejects
    const lost = vi.fn()
    api.onSessionLost = lost
    ;(s.fetchFn as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) =>
      String(url).endsWith('/auth/refresh') ? json(200, { data: { accessToken: 'bad', expiresIn: 900 } }) : json(401, { error: { code: 'UNAUTHENTICATED', message: 'no' } }),
    )
    await expect(api.get('/park')).rejects.toMatchObject({ status: 401 })
    expect((s.fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).endsWith('/park'))).toHaveLength(2)
  })

  it('reports a lost session when the refresh fails, and clears the token', async () => {
    const s = fakeServer({ refreshOk: false })
    const api = new ApiClient('http://api', s.fetchFn)
    const lost = vi.fn()
    api.onSessionLost = lost
    api.setAccessToken('expired')
    await expect(api.get('/park')).rejects.toBeInstanceOf(ApiError)
    expect(lost).toHaveBeenCalledTimes(1)
    expect(api.hasToken).toBe(false)
  })

  it('never tries to refresh around a failed login', async () => {
    const s = fakeServer()
    const api = new ApiClient('http://api', s.fetchFn)
    await expect(api.post('/auth/login', { email: 'a', password: 'b' })).rejects.toMatchObject({ status: 401 })
    expect(s.refreshes()).toBe(0)
  })

  it('tells the caller when a renewed token will expire', async () => {
    const s = fakeServer()
    const api = new ApiClient('http://api', s.fetchFn)
    const renewed = vi.fn()
    api.onTokenRenewed = renewed
    await api.refresh()
    expect(renewed).toHaveBeenCalledWith(900)
  })

  it('turns API errors into ApiError with code and field details', async () => {
    const fetchFn = vi.fn(async () =>
      json(400, { error: { code: 'VALIDATION_FAILED', message: 'invalid', details: [{ path: 'days.1.closes', message: 'must close after it opens' }] } }),
    ) as unknown as typeof fetch
    const api = new ApiClient('http://api', fetchFn)
    api.setAccessToken('good')
    const error = await api.put('/opening-hours', {}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(fieldErrors(error)).toEqual({ 'days.1.closes': 'must close after it opens' })
    expect(errorMessage(error)).toBe('Please fix the highlighted fields.')
  })
})

describe('error helpers', () => {
  it('gives friendly messages', () => {
    expect(errorMessage(new ApiError(403, 'FORBIDDEN', 'x'))).toMatch(/permission/)
    expect(errorMessage(new ApiError(429, 'RATE_LIMITED', 'x'))).toMatch(/Too many/)
    expect(errorMessage(new ApiError(409, 'SPECIAL_HOURS_OVERLAP', 'Another period overlaps'))).toBe('Another period overlaps')
    expect(errorMessage(new TypeError('Failed to fetch'))).toMatch(/Could not reach/)
  })
  it('returns no field errors for other errors', () => {
    expect(fieldErrors(new Error('x'))).toEqual({})
    expect(fieldErrors(new ApiError(500, 'X', 'y'))).toEqual({})
  })
})
