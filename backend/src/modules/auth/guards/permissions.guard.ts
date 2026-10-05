import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException, ErrorCode } from '../../../common/errors/app-exception';
import { AuthRequest } from '../auth.types';
import { ANY_AUTHENTICATED, IS_PUBLIC, PERMISSIONS } from '../decorators';

/**
 * Global guard, runs after JwtAuthGuard. It FAILS CLOSED: a route that is neither @Public(), nor
 * @AnyAuthenticated(), nor annotated with @RequirePermissions(...) is refused, so forgetting an annotation on a
 * new endpoint can never expose it.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger('Authorization');

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<AuthRequest>();
    const user = req.user;
    if (!user) throw new AppException(ErrorCode.UNAUTHENTICATED, 'Authentication is required.', 401);

    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS, targets);
    if (!required || required.length === 0) {
      if (this.reflector.getAllAndOverride<boolean>(ANY_AUTHENTICATED, targets)) return true;
      this.logger.error(`Route ${req.method} ${req.path} has no permission annotation: refusing (fail closed).`);
      throw new AppException(ErrorCode.FORBIDDEN, 'You do not have permission to do this.', 403);
    }

    const missing = required.filter((p) => !user.permissions.has(p));
    if (missing.length > 0) {
      this.logger.warn(`User ${user.id} denied ${req.method} ${req.path}: missing ${missing.join(', ')}`);
      throw new AppException(ErrorCode.FORBIDDEN, 'You do not have permission to do this.', 403);
    }
    return true;
  }
}
