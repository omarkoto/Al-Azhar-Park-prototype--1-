import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface RequestContext {
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

export interface AuditEntry {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  oldValue?: Prisma.InputJsonValue;
  newValue?: Prisma.InputJsonValue;
}

/** Event names, in one place so searches and dashboards can rely on them. */
export const AuditAction = {
  LOGIN_SUCCESS: 'auth.login.success',
  LOGIN_FAILED: 'auth.login.failed',
  LOGIN_LOCKED: 'auth.login.locked',
  LOGIN_BLOCKED: 'auth.login.blocked',
  LOGOUT: 'auth.logout',
  LOGOUT_ALL: 'auth.logout_all',
  TOKEN_REFRESHED: 'auth.token.refreshed',
  SESSION_EXPIRED: 'auth.session.expired',
  TOKEN_REUSE_DETECTED: 'auth.token.reuse_detected',
  PASSWORD_CHANGED: 'auth.password.changed',
  PASSWORD_RESET_REQUESTED: 'auth.password.reset_requested',
  PASSWORD_RESET_COMPLETED: 'auth.password.reset_completed',
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_ACTIVATED: 'user.activated',
  USER_DEACTIVATED: 'user.deactivated',
  USER_ROLES_CHANGED: 'user.roles_changed',
  USER_RESET_SENT: 'user.password_reset_sent',
} as const;

/**
 * Writes the append-only audit trail (the table itself refuses UPDATE and DELETE).
 * Never put secrets, passwords or tokens in `oldValue` / `newValue`.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(entry: AuditEntry, ctx: RequestContext = {}, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    return db.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        oldValue: entry.oldValue,
        newValue: entry.newValue,
        ip: ctx.ip,
        userAgent: ctx.userAgent?.slice(0, 300),
        requestId: ctx.requestId,
      },
    });
  }
}
