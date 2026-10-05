import type { Request, Response } from 'express';
import { clearRefreshCookie, readRefreshCookie, refreshCookieName, setRefreshCookie } from './refresh-cookie';

describe('refresh cookie', () => {
  it('uses the __Secure- prefix only in production', () => {
    expect(refreshCookieName(true)).toBe('__Secure-azp_refresh');
    expect(refreshCookieName(false)).toBe('azp_refresh');
  });

  it('is httpOnly, SameSite=Strict and limited to the auth path; Secure in production', () => {
    const calls: unknown[][] = [];
    const res = { cookie: (...a: unknown[]) => calls.push(a), clearCookie: (...a: unknown[]) => calls.push(a) } as unknown as Response;
    setRefreshCookie(res, 'tok', true, 1000);
    clearRefreshCookie(res, true);
    expect(calls).toHaveLength(2);
    const [set, clear] = calls as Array<[string, ...unknown[]]>;
    expect(set[0]).toBe('__Secure-azp_refresh');
    expect(clear[0]).toBe('__Secure-azp_refresh');
    for (const opts of [set[2], clear[1]] as Array<Record<string, unknown>>) {
      expect(opts).toMatchObject({ httpOnly: true, secure: true, sameSite: 'strict', path: '/api/v1/auth' });
      expect(opts.domain).toBeUndefined(); // host-only: only the API host ever gets it
    }
  });

  it('reads only the cookie of the right name', () => {
    const req = (cookie: string) => ({ headers: { cookie } }) as unknown as Request;
    expect(readRefreshCookie(req('a=1; azp_refresh=abc; b=2'), false)).toBe('abc');
    expect(readRefreshCookie(req('azp_refresh=abc'), true)).toBeUndefined(); // the unprefixed name is ignored in production
    expect(readRefreshCookie(req('__Secure-azp_refresh=xyz'), true)).toBe('xyz');
    expect(readRefreshCookie(req('azp_refresh=%E0%A4%A'), false)).toBeUndefined(); // malformed escape does not throw
    expect(readRefreshCookie({ headers: {} } as unknown as Request, false)).toBeUndefined();
  });
});
