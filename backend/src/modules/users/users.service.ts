import { passwordProblem } from '../auth/password-policy';
import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildMeta, safeSortField, toSkipTake } from '../../common/dto/pagination';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { PageResult } from '../../common/http/envelope';
import { hashPassword } from '../../common/security/password';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditAction, AuditService, RequestContext } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { AuthService } from '../auth/auth.service';
import { canGrantOrManage } from './privilege';
import { ListUsersQueryDto } from './users.dto';

/** The permission that lets someone change who can do what; at least one active person must always hold it. */
const ADMIN_PERMISSION = 'roles:write';

const userSelect = {
  id: true, email: true, fullName: true, isActive: true, lastLoginAt: true, lockedUntil: true, createdAt: true,
  roles: { select: { role: { select: { code: true, name: true, permissions: { select: { permission: { select: { code: true } } } } } } } },
} satisfies Prisma.UserSelect;
type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

export interface UserView {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  /** too many wrong passwords: temporarily unable to sign in (a password reset clears it) */
  isLocked: boolean;
  createdAt: Date;
  roles: Array<{ code: string; name: string }>;
}

const view = (u: UserRow): UserView => ({
  id: u.id, email: u.email, fullName: u.fullName, isActive: u.isActive, lastLoginAt: u.lastLoginAt, isLocked: !!u.lockedUntil && u.lockedUntil > new Date(), createdAt: u.createdAt,
  roles: u.roles.map((r) => ({ code: r.role.code, name: r.role.name })).sort((a, b) => a.code.localeCompare(b.code)),
});

const permissionsOf = (u: UserRow): Set<string> =>
  new Set(u.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.code)));

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  async list(query: ListUsersQueryDto): Promise<PageResult<UserView>> {
    const where: Prisma.UserWhereInput = {
      ...(query.isActive ? { isActive: query.isActive === 'true' } : {}),
      ...(query.role ? { roles: { some: { role: { code: query.role } } } } : {}),
      ...(query.search
        ? { OR: [{ email: { contains: query.search, mode: 'insensitive' } }, { fullName: { contains: query.search, mode: 'insensitive' } }] }
        : {}),
    };
    const sortBy = safeSortField(query.sortBy, ['createdAt', 'email', 'fullName', 'lastLoginAt'] as const, 'createdAt');
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({ where, select: userSelect, orderBy: { [sortBy]: query.sortOrder }, ...toSkipTake(query) }),
      this.prisma.user.count({ where }),
    ]);
    return new PageResult(rows.map(view), buildMeta(query, total));
  }

  async get(id: string): Promise<UserView> {
    return view(await this.load(id));
  }

  /**
   * Creates an account. With a password the administrator sets it (it must pass the password policy and is only
   * ever stored as an Argon2id hash); without one the account starts with a random password nobody knows and a
   * one-time link lets the person choose their own.
   */
  async create(dto: { email: string; fullName: string; roleCodes: string[]; password?: string }, actor: AuthenticatedUser, ctx: RequestContext): Promise<UserView> {
    const roles = await this.rolesFor(dto.roleCodes, actor);
    if (await this.prisma.user.findUnique({ where: { email: dto.email }, select: { id: true } })) {
      throw new AppException('EMAIL_ALREADY_USED', 'A user with this e-mail already exists.', 409);
    }
    if (dto.password !== undefined) {
      const problem = passwordProblem(dto.password, { email: dto.email, fullName: dto.fullName });
      if (problem) throw new AppException('WEAK_PASSWORD', problem, 422);
    }
    const passwordHash = await hashPassword(dto.password ?? randomBytes(32).toString('base64url'));
    const created = await this.prisma.user.create({
      data: {
        email: dto.email, fullName: dto.fullName, passwordHash,
        roles: { create: roles.map((r) => ({ roleId: r.id })) },
      },
      select: userSelect,
    });
    await this.audit.record(
      { userId: actor.id, action: AuditAction.USER_CREATED, entity: 'user', entityId: created.id, newValue: { email: created.email, roles: dto.roleCodes } },
      ctx,
    );
    if (dto.password === undefined) await this.auth.issuePasswordLink(created, 'invite');
    return view(created);
  }

  async update(id: string, dto: { fullName: string }, actor: AuthenticatedUser, ctx: RequestContext): Promise<UserView> {
    const target = await this.manageable(id, actor);
    const updated = await this.prisma.user.update({ where: { id }, data: { fullName: dto.fullName }, select: userSelect });
    await this.audit.record(
      { userId: actor.id, action: AuditAction.USER_UPDATED, entity: 'user', entityId: id, oldValue: { fullName: target.fullName }, newValue: { fullName: dto.fullName } },
      ctx,
    );
    return view(updated);
  }

  async setActive(id: string, active: boolean, actor: AuthenticatedUser, ctx: RequestContext): Promise<UserView> {
    if (id === actor.id) throw new AppException('CANNOT_CHANGE_SELF', 'You cannot activate or deactivate your own account.', 409);
    const target = await this.manageable(id, actor);
    if (target.isActive === active) return view(target);

    if (!active) await this.assertNotLastAdmin(id, permissionsOf(target));

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.user.update({ where: { id }, data: { isActive: active }, select: userSelect });
      if (!active) await this.auth.revokeAllSessions(id, tx); // signed out everywhere, immediately
      return row;
    });
    await this.audit.record(
      { userId: actor.id, action: active ? AuditAction.USER_ACTIVATED : AuditAction.USER_DEACTIVATED, entity: 'user', entityId: id },
      ctx,
    );
    return view(updated);
  }

  async setRoles(id: string, roleCodes: string[], actor: AuthenticatedUser, ctx: RequestContext): Promise<UserView> {
    if (id === actor.id) throw new AppException('CANNOT_CHANGE_SELF', 'You cannot change your own roles.', 409);
    const target = await this.manageable(id, actor);
    const roles = await this.rolesFor(roleCodes, actor);

    const after = new Set<string>();
    for (const r of roles) for (const p of r.permissions) after.add(p.permission.code);
    if (permissionsOf(target).has(ADMIN_PERMISSION) && !after.has(ADMIN_PERMISSION)) await this.assertNotLastAdmin(id, permissionsOf(target));

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.createMany({ data: roles.map((r) => ({ userId: id, roleId: r.id })) });
      // permissions are read live, but ending the sessions also forces a fresh sign-in under the new roles
      await this.auth.revokeAllSessions(id, tx);
      return tx.user.findUniqueOrThrow({ where: { id }, select: userSelect });
    });
    await this.audit.record(
      {
        userId: actor.id, action: AuditAction.USER_ROLES_CHANGED, entity: 'user', entityId: id,
        oldValue: { roles: target.roles.map((r) => r.role.code).sort() }, newValue: { roles: roleCodes.slice().sort() },
      },
      ctx,
    );
    return view(updated);
  }

  /** Admin-triggered reset link (e.g. someone is locked out). The person still chooses the new password. */
  async sendPasswordReset(id: string, actor: AuthenticatedUser, ctx: RequestContext): Promise<void> {
    const target = await this.manageable(id, actor);
    if (!target.isActive) throw new AppException('USER_INACTIVE', 'This account is deactivated.', 409);
    await this.auth.issuePasswordLink(target, 'reset');
    await this.audit.record({ userId: actor.id, action: AuditAction.USER_RESET_SENT, entity: 'user', entityId: id }, ctx);
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private async load(id: string): Promise<UserRow> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: userSelect });
    if (!user) throw new AppException(ErrorCode.NOT_FOUND, 'User not found.', 404);
    return user;
  }

  /** Loads a user the actor is allowed to manage: their permissions must be covered by the actor's. */
  private async manageable(id: string, actor: AuthenticatedUser): Promise<UserRow> {
    const target = await this.load(id);
    if (id !== actor.id && !canGrantOrManage(actor.permissions, permissionsOf(target))) {
      throw new AppException(ErrorCode.FORBIDDEN, 'You cannot manage a user who has more access than you.', 403);
    }
    return target;
  }

  private async rolesFor(codes: string[], actor: AuthenticatedUser) {
    const unique = [...new Set(codes)];
    const roles = await this.prisma.role.findMany({
      where: { code: { in: unique } },
      select: { id: true, code: true, permissions: { select: { permission: { select: { code: true } } } } },
    });
    const known = new Set(roles.map((r) => r.code));
    const unknown = unique.filter((c) => !known.has(c));
    if (unknown.length > 0) throw new AppException('UNKNOWN_ROLE', `Unknown role: ${unknown.join(', ')}`, 422);
    for (const role of roles) {
      if (!canGrantOrManage(actor.permissions, role.permissions.map((p) => p.permission.code))) {
        throw new AppException('ROLE_NOT_GRANTABLE', `You cannot grant the role ${role.code}: it has permissions you do not have.`, 403);
      }
    }
    return roles;
  }

  /** Refuses to remove the last active person who can change roles, which would lock everyone out of administration. */
  private async assertNotLastAdmin(userId: string, currentPermissions: Set<string>): Promise<void> {
    if (!currentPermissions.has(ADMIN_PERMISSION)) return;
    const others = await this.prisma.user.count({
      where: {
        id: { not: userId }, isActive: true,
        roles: { some: { role: { permissions: { some: { permission: { code: ADMIN_PERMISSION } } } } } },
      },
    });
    if (others === 0) throw new AppException('LAST_ADMINISTRATOR', 'This is the last active administrator who can manage roles; it cannot be removed.', 409);
  }
}
