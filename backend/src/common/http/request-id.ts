import { randomUUID } from 'node:crypto';

const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Correlation id for one request. A caller-supplied `X-Request-Id` is honoured only if it is short and
 * plain (so it cannot be used to inject log lines); otherwise a fresh UUID is generated.
 */
export function resolveRequestId(incoming: string | string[] | undefined): string {
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  return candidate && SAFE_ID.test(candidate) ? candidate : randomUUID();
}
