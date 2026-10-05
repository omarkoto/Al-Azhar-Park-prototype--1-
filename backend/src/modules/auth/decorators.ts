import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { AuthenticatedUser, AuthRequest, contextOf } from './auth.types';

export const IS_PUBLIC = 'auth:public';
export const PERMISSIONS = 'auth:permissions';
export const ANY_AUTHENTICATED = 'auth:any-authenticated';

/** No login needed (login, refresh, password reset, health, public website API). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Requires ALL of the listed permissions (e.g. 'users:write'). Authorization is permission-based:
 * never compare role names in application code.
 */
export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS, permissions);

/** Any signed-in user (own profile, change own password). The route must not expose anything privileged. */
export const AnyAuthenticated = () => SetMetadata(ANY_AUTHENTICATED, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthenticatedUser => {
  const req = ctx.switchToHttp().getRequest<AuthRequest>();
  if (!req.user) throw new Error('CurrentUser used on a route without authentication');
  return req.user;
});

export const RequestCtx = createParamDecorator((_: unknown, ctx: ExecutionContext) =>
  contextOf(ctx.switchToHttp().getRequest<AuthRequest>()),
);
