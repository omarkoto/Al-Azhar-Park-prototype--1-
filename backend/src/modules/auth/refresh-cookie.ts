import type { CookieOptions, Request, Response } from 'express';

/** The cookie is only ever sent to the auth endpoints. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/**
 * In production the cookie gets the `__Secure-` prefix, so a browser refuses to store it unless it is set over
 * HTTPS with the Secure flag. (`__Host-` would be stricter but requires Path=/, which would expose the cookie to
 * every API route.) The cookie is host-only (no Domain attribute): only the API host ever receives it.
 */
export const refreshCookieName = (secure: boolean) => (secure ? '__Secure-azp_refresh' : 'azp_refresh');

function options(secure: boolean, maxAgeMs: number): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'strict', path: REFRESH_COOKIE_PATH, maxAge: maxAgeMs };
}

export function setRefreshCookie(res: Response, token: string, secure: boolean, maxAgeMs: number): void {
  res.cookie(refreshCookieName(secure), token, options(secure, maxAgeMs));
}

export function clearRefreshCookie(res: Response, secure: boolean): void {
  res.clearCookie(refreshCookieName(secure), { httpOnly: true, secure, sameSite: 'strict', path: REFRESH_COOKIE_PATH });
}

/** Reads the refresh cookie from the Cookie header (no cookie-parser dependency needed for one cookie). */
export function readRefreshCookie(req: Request, secure: boolean): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  const name = refreshCookieName(secure);
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
