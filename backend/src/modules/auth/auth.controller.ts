import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AppException } from '../../common/errors/app-exception';
import { AppConfigService } from '../../config/app-config.service';
import { RequestContext } from '../audit/audit.service';
import { AuthenticatedUser } from './auth.types';
import { ChangePasswordDto, ForgotPasswordDto, LoginDto, RefreshDto, ResetPasswordDto } from './auth.dto';
import { AuthService, SessionTokens } from './auth.service';
import { AnyAuthenticated, CurrentUser, Public, RequestCtx } from './decorators';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './refresh-cookie';

const MINUTE = 60_000;
/** Header a non-browser client sends to receive the refresh token in the JSON body instead of an httpOnly cookie. */
const DELIVERY_HEADER = 'x-token-delivery';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfigService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: MINUTE } })
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in to the portal with e-mail and password' })
  async login(@Body() dto: LoginDto, @RequestCtx() ctx: RequestContext, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { tokens, profile } = await this.auth.login(dto.email, dto.password, ctx);
    return { ...this.deliver(req, res, tokens), user: profile };
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: MINUTE } })
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange the refresh token (cookie or body) for a new access token; the refresh token rotates' })
  async refresh(@Body() dto: RefreshDto, @RequestCtx() ctx: RequestContext, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.auth.refresh(this.presentedToken(dto, req), ctx);
    return this.deliver(req, res, tokens);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: MINUTE } })
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'End this session (revokes the refresh token family). Safe to call repeatedly.' })
  async logout(@Body() dto: RefreshDto, @RequestCtx() ctx: RequestContext, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(this.presentedToken(dto, req), ctx);
    clearRefreshCookie(res, this.config.isProduction);
    return { loggedOut: true };
  }

  @AnyAuthenticated()
  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign out everywhere: ends every session and invalidates every access token' })
  async logoutAll(@CurrentUser() user: AuthenticatedUser, @RequestCtx() ctx: RequestContext, @Res({ passthrough: true }) res: Response) {
    await this.auth.logoutAll(user.id, ctx);
    clearRefreshCookie(res, this.config.isProduction);
    return { loggedOut: true };
  }

  @AnyAuthenticated()
  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'The signed-in user, their roles and effective permissions' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.profile(user.id);
  }

  @AnyAuthenticated()
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: MINUTE } })
  @Post('change-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Change your own password. Every session is ended; sign in again.' })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @RequestCtx() ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword, ctx);
    clearRefreshCookie(res, this.config.isProduction);
    return { changed: true };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: MINUTE } })
  @Post('forgot-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Request a password-reset link. The answer is always the same, so accounts cannot be probed.' })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @RequestCtx() ctx: RequestContext) {
    await this.auth.requestPasswordReset(dto.email, ctx);
    return { message: 'If an account exists for that e-mail, a reset link has been sent.' };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: MINUTE } })
  @Post('reset-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Set a new password with a reset (or invitation) token. Every session is ended.' })
  async resetPassword(@Body() dto: ResetPasswordDto, @RequestCtx() ctx: RequestContext) {
    await this.auth.resetPassword(dto.token, dto.newPassword, ctx);
    return { reset: true };
  }

  /**
   * The refresh token from the body (scripts/native clients) or from the cookie (browsers). When it comes from the
   * cookie, the browser's Origin must be one of ours: with SameSite=Strict this is a second line of defence against
   * cross-site request forgery. Requests without an Origin header are not browser form posts and are allowed.
   */
  private presentedToken(dto: RefreshDto, req: Request): string | undefined {
    if (dto.refreshToken) return dto.refreshToken;
    const token = readRefreshCookie(req, this.config.isProduction);
    const origin = req.headers.origin;
    if (token && origin && !this.config.get('CORS_ORIGINS').includes(origin)) {
      throw new AppException('ORIGIN_NOT_ALLOWED', 'This request did not come from an allowed origin.', 403);
    }
    return token;
  }

  /** Browser clients get the refresh token as an httpOnly cookie; scripts/native clients can ask for it in the body. */
  private deliver(req: Request, res: Response, tokens: SessionTokens) {
    const inBody = req.headers[DELIVERY_HEADER] === 'body';
    if (!inBody) {
      setRefreshCookie(res, tokens.refreshToken, this.config.isProduction, tokens.refreshExpiresAt.getTime() - Date.now());
    }
    return {
      accessToken: tokens.accessToken,
      tokenType: 'Bearer' as const,
      expiresIn: tokens.expiresIn,
      ...(inBody ? { refreshToken: tokens.refreshToken } : {}),
    };
  }
}
