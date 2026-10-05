import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../../common/errors/app-exception';
import { hashPassword, verifyPassword } from '../../common/security/password';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditAction, AuditService, RequestContext } from '../audit/audit.service';
import { passwordProblem } from './password-policy';
import { PasswordLinkNotifier } from './password-link-notifier';
import { TokenService } from './token.service';

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

export interface SessionTokens {
  accessToken: string;
  /** seconds until the access token expires */
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface Profile {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  permissions: string[];
}

const INVALID_CREDENTIALS = () =>
  new AppException('INVALID_CREDENTIALS', 'The email or password is incorrect, or the account is unavailable.', 401);
const INVALID_REFRESH = () => new AppException('INVALID_REFRESH_TOKEN', 'Your session has expired. Please sign in again.', 401);
const INVALID_RESET = () => new AppException('INVALID_OR_EXPIRED_TOKEN', 'This link is invalid or has expired.', 400);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  /** a real argon2id hash, verified when the account does not exist, so "unknown email" costs the same time */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly notifier: PasswordLinkNotifier,
    private readonly config: AppConfigService,
  ) {}

  // ───────────────────────────── login ─────────────────────────────

  async login(emailRaw: string, password: string, ctx: RequestContext): Promise<{ tokens: SessionTokens; profile: Profile }> {
    const email = emailRaw.trim();
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true, passwordHash: true, isActive: true, lockedUntil: true } });

    if (!user) {
      await verifyPassword(await this.dummy(), password);
      await this.audit.record(
        { action: AuditAction.LOGIN_FAILED, entity: 'user', newValue: { reason: 'unknown_account', emailAttempted: this.loggableEmail(email) } },
        ctx,
      );
      throw INVALID_CREDENTIALS();
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      // do not even check the password: a locked account stays locked, and the answer is the generic one
      await verifyPassword(await this.dummy(), password);
      await this.audit.record({ userId: user.id, action: AuditAction.LOGIN_BLOCKED, entity: 'user', entityId: user.id, newValue: { reason: 'locked' } }, ctx);
      throw INVALID_CREDENTIALS();
    }

    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      await this.registerFailure(user.id, ctx);
      throw INVALID_CREDENTIALS();
    }
    if (!user.isActive) {
      await this.audit.record({ userId: user.id, action: AuditAction.LOGIN_BLOCKED, entity: 'user', entityId: user.id, newValue: { reason: 'inactive' } }, ctx);
      throw INVALID_CREDENTIALS();
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
    const tokens = await this.startSession(user.id, randomUUID(), ctx);
    await this.audit.record({ userId: user.id, action: AuditAction.LOGIN_SUCCESS, entity: 'user', entityId: user.id }, ctx);
    return { tokens, profile: await this.profile(user.id) };
  }

  private async registerFailure(userId: string, ctx: RequestContext): Promise<void> {
    const { failedLoginCount } = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    if (failedLoginCount >= this.config.get('LOGIN_MAX_FAILURES')) {
      const until = new Date(Date.now() + this.config.get('LOGIN_LOCKOUT_MINUTES') * MINUTE_MS);
      await this.prisma.user.update({ where: { id: userId }, data: { lockedUntil: until, failedLoginCount: 0 } });
      await this.audit.record(
        { userId, action: AuditAction.LOGIN_LOCKED, entity: 'user', entityId: userId, newValue: { lockedUntil: until.toISOString() } },
        ctx,
      );
      return;
    }
    await this.audit.record({ userId, action: AuditAction.LOGIN_FAILED, entity: 'user', entityId: userId, newValue: { reason: 'wrong_password' } }, ctx);
  }

  /** Only keep what looks like an e-mail: people sometimes paste a password into the e-mail box. */
  private loggableEmail(value: string): string | null {
    return value.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(value) ? value.toLowerCase() : null;
  }

  private dummy(): Promise<string> {
    this.dummyHash ??= hashPassword(randomUUID());
    return this.dummyHash;
  }

  // ───────────────────────────── sessions & refresh rotation ─────────────────────────────

  /** Creates a new login session (a refresh-token family) and its first tokens. */
  private async startSession(userId: string, familyId: string, ctx: RequestContext, db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<SessionTokens> {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { tokenVersion: true } });
    const refreshToken = this.tokens.newOpaqueToken();
    const sessionStartedAt = new Date();
    const refreshExpiresAt = this.refreshExpiry(sessionStartedAt, sessionStartedAt);
    await db.refreshToken.create({
      data: {
        userId, familyId, sessionStartedAt, tokenHash: this.tokens.hashOpaqueToken(refreshToken), expiresAt: refreshExpiresAt,
        ip: ctx.ip, userAgent: ctx.userAgent?.slice(0, 300),
      },
    });
    const accessToken = await this.tokens.signAccessToken({ sub: userId, tv: user.tokenVersion, sid: familyId });
    return { accessToken, expiresIn: this.tokens.accessTtlSeconds, refreshToken, refreshExpiresAt };
  }

  /**
   * Rotating refresh tokens with reuse detection. Each refresh token works once: using it revokes it and issues
   * its successor in the same family. Presenting an already-rotated token means a copy leaked, so the whole
   * family (the session, and the access token tied to it) is revoked.
   */
  async refresh(presented: string | undefined, ctx: RequestContext): Promise<SessionTokens> {
    if (!presented || presented.length > 200) throw INVALID_REFRESH();
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: this.tokens.hashOpaqueToken(presented) } });
    if (!row) throw INVALID_REFRESH();

    if (row.revokedAt) {
      if (row.replacedById) await this.handleReuse(row.userId, row.familyId, ctx);
      throw INVALID_REFRESH(); // plain logout / admin revoke: nothing more to do
    }
    if (row.expiresAt <= new Date()) throw INVALID_REFRESH();
    if (this.sessionEnd(row.sessionStartedAt) <= new Date()) {
      // absolute maximum session age: rotation can never keep a login alive forever
      await this.revokeFamily(row.familyId);
      await this.audit.record({ userId: row.userId, action: AuditAction.SESSION_EXPIRED, entity: 'session', entityId: row.familyId }, ctx);
      throw INVALID_REFRESH();
    }

    const user = await this.prisma.user.findUnique({ where: { id: row.userId }, select: { isActive: true, tokenVersion: true } });
    if (!user || !user.isActive) {
      await this.revokeFamily(row.familyId);
      throw INVALID_REFRESH();
    }

    const nextToken = this.tokens.newOpaqueToken();
    const nextId = randomUUID();
    const expiresAt = this.refreshExpiry(new Date(), row.sessionStartedAt);

    const rotated = await this.prisma.$transaction(async (tx) => {
      // atomic single-use: only one concurrent request can flip revoked_at from NULL
      const claimed = await tx.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
      if (claimed.count !== 1) return false;
      await tx.refreshToken.create({
        data: {
          id: nextId, userId: row.userId, familyId: row.familyId, sessionStartedAt: row.sessionStartedAt, tokenHash: this.tokens.hashOpaqueToken(nextToken), expiresAt,
          ip: ctx.ip, userAgent: ctx.userAgent?.slice(0, 300),
        },
      });
      await tx.refreshToken.update({ where: { id: row.id }, data: { replacedById: nextId } });
      return true;
    });

    if (!rotated) {
      await this.handleReuse(row.userId, row.familyId, ctx); // lost the race: the same token was used twice
      throw INVALID_REFRESH();
    }

    const accessToken = await this.tokens.signAccessToken({ sub: row.userId, tv: user.tokenVersion, sid: row.familyId });
    await this.audit.record({ userId: row.userId, action: AuditAction.TOKEN_REFRESHED, entity: 'session', entityId: row.familyId }, ctx);
    return { accessToken, expiresIn: this.tokens.accessTtlSeconds, refreshToken: nextToken, refreshExpiresAt: expiresAt };
  }

  private sessionEnd(startedAt: Date): Date {
    return new Date(startedAt.getTime() + this.config.get('SESSION_MAX_DAYS') * DAY_MS);
  }

  /** A refresh token lives REFRESH_TOKEN_TTL_DAYS, but never beyond the session's absolute end. */
  private refreshExpiry(now: Date, sessionStartedAt: Date): Date {
    const sliding = now.getTime() + this.config.get('REFRESH_TOKEN_TTL_DAYS') * DAY_MS;
    return new Date(Math.min(sliding, this.sessionEnd(sessionStartedAt).getTime()));
  }

  private async handleReuse(userId: string, familyId: string, ctx: RequestContext): Promise<void> {
    await this.revokeFamily(familyId);
    this.logger.warn(`Refresh-token reuse detected for user ${userId}; session ${familyId} revoked.`);
    await this.audit.record({ userId, action: AuditAction.TOKEN_REUSE_DETECTED, entity: 'session', entityId: familyId }, ctx);
  }

  private revokeFamily(familyId: string) {
    return this.prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** Ends the session the presented refresh token belongs to. Idempotent: an unknown token is simply ignored. */
  async logout(presented: string | undefined, ctx: RequestContext): Promise<void> {
    if (!presented || presented.length > 200) return;
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: this.tokens.hashOpaqueToken(presented) } });
    if (!row) return;
    await this.revokeFamily(row.familyId);
    await this.audit.record({ userId: row.userId, action: AuditAction.LOGOUT, entity: 'session', entityId: row.familyId }, ctx);
  }

  /** Signs the user out everywhere: every session ends and every outstanding access token stops working. */
  async revokeAllSessions(userId: string, db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<void> {
    await db.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
    await db.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async logoutAll(userId: string, ctx: RequestContext): Promise<void> {
    await this.prisma.$transaction((tx) => this.revokeAllSessions(userId, tx));
    await this.audit.record({ userId, action: AuditAction.LOGOUT_ALL, entity: 'user', entityId: userId }, ctx);
  }

  // ───────────────────────────── profile ─────────────────────────────

  async profile(userId: string): Promise<Profile> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true, email: true, fullName: true,
        roles: { select: { role: { select: { code: true, permissions: { select: { permission: { select: { code: true } } } } } } } },
      },
    });
    const permissions = new Set<string>();
    for (const { role } of user.roles) for (const rp of role.permissions) permissions.add(rp.permission.code);
    return { id: user.id, email: user.email, fullName: user.fullName, roles: user.roles.map((r) => r.role.code).sort(), permissions: [...permissions].sort() };
  }

  // ───────────────────────────── passwords ─────────────────────────────

  async changePassword(userId: string, currentPassword: string, newPassword: string, ctx: RequestContext): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, fullName: true, passwordHash: true } });
    if (!(await verifyPassword(user.passwordHash, currentPassword))) {
      throw new AppException('INVALID_CURRENT_PASSWORD', 'The current password is incorrect.', 400);
    }
    this.assertAcceptable(newPassword, user);
    if (await verifyPassword(user.passwordHash, newPassword)) {
      throw new AppException('PASSWORD_UNCHANGED', 'The new password must be different from the current one.', 400);
    }
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null } });
      await this.revokeAllSessions(userId, tx);
    });
    await this.audit.record({ userId, action: AuditAction.PASSWORD_CHANGED, entity: 'user', entityId: userId }, ctx);
  }

  /**
   * Starts a reset. The caller must give the SAME answer whether or not the account exists, so this never
   * reveals it. Inactive accounts get no link. At most one link per account per minute.
   */
  async requestPasswordReset(emailRaw: string, ctx: RequestContext): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: emailRaw.trim() }, select: { id: true, email: true, fullName: true, isActive: true } });
    if (!user || !user.isActive) return;
    const recent = await this.prisma.passwordResetToken.count({ where: { userId: user.id, createdAt: { gt: new Date(Date.now() - MINUTE_MS) } } });
    if (recent > 0) return;
    await this.issuePasswordLink(user, 'reset');
    await this.audit.record({ userId: user.id, action: AuditAction.PASSWORD_RESET_REQUESTED, entity: 'user', entityId: user.id }, ctx);
  }

  /** Creates a single-use token (replacing any unused one) and hands it to the notifier. Shared with user invitations. */
  async issuePasswordLink(user: { id: string; email: string; fullName: string }, purpose: 'reset' | 'invite'): Promise<void> {
    const token = this.tokens.newOpaqueToken();
    const expiresAt = new Date(Date.now() + this.config.get('PASSWORD_RESET_TTL_MINUTES') * MINUTE_MS);
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: this.tokens.hashOpaqueToken(token), expiresAt } }),
    ]);
    try {
      await this.notifier.send({ email: user.email, fullName: user.fullName, token, expiresAt, purpose });
    } catch (error) {
      this.logger.error(`Could not deliver a ${purpose} link: ${(error as Error).message}`);
    }
  }

  async resetPassword(token: string, newPassword: string, ctx: RequestContext): Promise<void> {
    const row = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.tokens.hashOpaqueToken(token) },
      include: { user: { select: { id: true, email: true, fullName: true, isActive: true } } },
    });
    if (!row || row.usedAt || row.expiresAt <= new Date() || !row.user.isActive) throw INVALID_RESET();
    this.assertAcceptable(newPassword, row.user);

    const passwordHash = await hashPassword(newPassword);
    const done = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
      if (claimed.count !== 1) return false; // someone used it a moment ago
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null } });
      await this.revokeAllSessions(row.userId, tx);
      await tx.passwordResetToken.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: new Date() } });
      return true;
    });
    if (!done) throw INVALID_RESET();
    await this.audit.record({ userId: row.userId, action: AuditAction.PASSWORD_RESET_COMPLETED, entity: 'user', entityId: row.userId }, ctx);
  }

  private assertAcceptable(password: string, who: { email: string; fullName: string }): void {
    const problem = passwordProblem(password, who);
    if (problem) throw new AppException('WEAK_PASSWORD', problem, 422, { reason: problem });
  }
}
