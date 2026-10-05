import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException, ErrorCode } from '../../../common/errors/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthenticatedUser, AuthRequest } from '../auth.types';
import { IS_PUBLIC } from '../decorators';
import { TokenService } from '../token.service';

const unauthenticated = () => new AppException(ErrorCode.UNAUTHENTICATED, 'Authentication is required.', 401);

/**
 * Global guard: every route needs a valid access token unless it is marked @Public().
 * The token only identifies the session; the user, their active flag and their CURRENT permissions are read
 * from the database on every request, so deactivating a user or changing a role takes effect immediately.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;

    const req = context.switchToHttp().getRequest<AuthRequest>();
    const header = req.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer ([A-Za-z0-9._-]{20,4096})$/.exec(header) : null;
    if (!match) throw unauthenticated();

    const claims = await this.tokens.verifyAccessToken(match[1]);
    if (!claims) throw unauthenticated();

    const [user, sessionAlive] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: claims.sub },
        select: {
          id: true, email: true, fullName: true, isActive: true, tokenVersion: true,
          roles: { select: { role: { select: { code: true, permissions: { select: { permission: { select: { code: true } } } } } } } },
        },
      }),
      this.prisma.refreshToken.count({
        where: { familyId: claims.sid, userId: claims.sub, revokedAt: null, expiresAt: { gt: new Date() } },
      }),
    ]);
    if (!user || !user.isActive || user.tokenVersion !== claims.tv || sessionAlive === 0) throw unauthenticated();

    const permissions = new Set<string>();
    for (const { role } of user.roles) for (const rp of role.permissions) permissions.add(rp.permission.code);

    const authenticated: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      roles: user.roles.map((r) => r.role.code),
      permissions,
      sessionId: claims.sid,
    };
    req.user = authenticated;
    return true;
  }
}
