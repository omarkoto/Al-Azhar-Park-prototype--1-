import { describe, expect, it, vi } from 'vitest'
import { ApiClient, ApiError } from './api'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const pdf = () => new Response('%PDF-1.7 fake', { status: 200, headers: { 'Content-Type': 'application/pdf' } })

describe('ApiClient downloads', () => {
  it('fetches a file with the token, and retries once after a refresh', async () => {
    const seen: Array<string | null> = []
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get('Authorization')
      if (String(url).endsWith('/auth/refresh')) return json(200, { data: { accessToken: 'good', expiresIn: 900 } })
      seen.push(auth)
      return auth === 'Bearer good' ? pdf() : json(401, { error: { code: 'UNAUTHENTICATED', message: 'no' } })
    })
    const api = new ApiClient('http://api', fetchFn as unknown as typeof fetch)
    api.setAccessToken('stale')
    const blob = await api.download('/tickets/1/pdf')
    expect(await blob.text()).toBe('%PDF-1.7 fake')
    expect(seen).toEqual(['Bearer stale', 'Bearer good'])
  })

  it("turns a refusal into an error with the server's code", async () => {
    const fetchFn = vi.fn(async () => json(403, { error: { code: 'FORBIDDEN', message: 'You do not have permission to do this.' } }))
    const api = new ApiClient('http://api', fetchFn as unknown as typeof fetch)
    api.setAccessToken('good')
    await expect(api.download('/tickets/1/pdf')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' })
  })

  it('ends the session when it cannot be renewed', async () => {
    const lost = vi.fn()
    const api = new ApiClient('http://api', (async () => json(401, {})) as unknown as typeof fetch)
    api.onSessionLost = lost
    await expect(api.download('/tickets/1/pdf')).rejects.toBeInstanceOf(ApiError)
    expect(lost).toHaveBeenCalled()
  })
})
