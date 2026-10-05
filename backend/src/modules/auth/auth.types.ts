import type { Request } from 'express';
import type { RequestContext } from '../audit/audit.service';

/** What the guards put on the request after a successful authentication. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  /** informational only: authorization is decided from `permissions`, never from role names */
  roles: string[];
  permissions: ReadonlySet<string>;
  /** the refresh-token family (login session) this access token belongs to */
  sessionId: string;
}

export type AuthRequest = Request & { user?: AuthenticatedUser; id?: string };

export function contextOf(req: AuthRequest): RequestContext {
  return { ip: req.ip, userAgent: req.headers['user-agent'], requestId: typeof req.id === 'string' ? req.id : undefined };
}
