import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, RequestContext } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { canGrantOrManage } from '../users/privilege';

const ADMIN_PERMISSION = 'roles:write';

const roleSelect = {
  id: true, code: true, name: true, description: true, isSystem: true,
  permissions: { select: { permission: { select: { code: true } } } },
  _count: { select: { users: true } },
} satisfies Prisma.RoleSelect;
type RoleRow = Prisma.RoleGetPayload<{ select: typeof roleSelect }>;

export interface RoleView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  userCount: number;
}

const view = (r: RoleRow): RoleView => ({
  id: r.id, code: r.code, name: r.name, description: r.description, isSystem: r.isSystem,
  permissions: r.permissions.map((p) => p.permission.code).sort(), userCount: r._count.users,
});

/**
 * Roles are data. Editing a role's permissions changes what every holder of that role may do on their very next
 * request (the guards read permissions from the database each time).
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<RoleView[]> {
    return (await this.prisma.role.findMany({ orderBy: { code: 'asc' }, select: roleSelect })).map(view);
  }

  async get(id: string): Promise<RoleView> {
    return view(await this.load(id));
  }

  async create(dto: { code: string; name: string; description: string | null; permissionCodes: string[] }, actor: AuthenticatedUser, ctx: RequestContext): Promise<RoleView> {
    if (await this.prisma.role.findUnique({ where: { code: dto.code }, select: { id: true } })) {
      throw new AppException('ROLE_CODE_TAKEN', `A role with the code ${dto.code} already exists.`, 409);
    }
    const permissions = await this.permissionsFor(dto.permissionCodes, actor);
    const created = await this.prisma.role.create({
      data: {
        code: dto.code, name: dto.name, description: dto.description, isSystem: false,
        permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
      },
      select: roleSelect,
    });
    await this.audit.record(
      { userId: actor.id, action: 'role.created', entity: 'role', entityId: created.id, newValue: { code: dto.code, name: dto.name, permissions: dto.permissionCodes.slice().sort() } },
      ctx,
    );
    return view(created);
  }

  async update(id: string, dto: { name: string; description: string | null }, actor: AuthenticatedUser, ctx: RequestContext): Promise<RoleView> {
    const before = await this.load(id);
    const updated = await this.prisma.role.update({ where: { id }, data: { name: dto.name, description: dto.description }, select: roleSelect });
    await this.audit.record(
      { userId: actor.id, action: 'role.updated', entity: 'role', entityId: id, oldValue: { name: before.name, description: before.description }, newValue: { name: dto.name, description: dto.description } },
      ctx,
    );
    return view(updated);
  }

  async setPermissions(id: string, codes: string[], actor: AuthenticatedUser, ctx: RequestContext): Promise<RoleView> {
    const before = await this.load(id);
    const current = before.permissions.map((p) => p.permission.code);
    // you may not edit a role that has permissions you do not hold yourself
    if (!canGrantOrManage(actor.permissions, current)) {
      throw new AppException(ErrorCode.FORBIDDEN, 'You cannot edit a role that has permissions you do not have.', 403);
    }
    const permissions = await this.permissionsFor(codes, actor);
    if (current.includes(ADMIN_PERMISSION) && !codes.includes(ADMIN_PERMISSION)) await this.assertAdministratorRemains(id);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.rolePermission.createMany({ data: permissions.map((p) => ({ roleId: id, permissionId: p.id })) });
      return tx.role.findUniqueOrThrow({ where: { id }, select: roleSelect });
    });
    const before_ = new Set(current);
    const after_ = new Set(codes);
    await this.audit.record(
      {
        userId: actor.id, action: 'role.permissions_changed', entity: 'role', entityId: id,
        oldValue: { permissions: [...before_].sort() },
        newValue: { permissions: [...after_].sort(), added: [...after_].filter((c) => !before_.has(c)).sort(), removed: [...before_].filter((c) => !after_.has(c)).sort() },
      },
      ctx,
    );
    return view(updated);
  }

  async remove(id: string, actor: AuthenticatedUser, ctx: RequestContext): Promise<void> {
    const role = await this.load(id);
    if (role.isSystem) throw new AppException('SYSTEM_ROLE', 'The built-in roles cannot be deleted.', 409);
    if (role._count.users > 0) throw new AppException('ROLE_IN_USE', `${role._count.users} user(s) still hold this role. Reassign them first.`, 409);
    await this.prisma.role.delete({ where: { id } });
    await this.audit.record(
      { userId: actor.id, action: 'role.deleted', entity: 'role', entityId: id, oldValue: { code: role.code, name: role.name, permissions: role.permissions.map((p) => p.permission.code).sort() } },
      ctx,
    );
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private async load(id: string): Promise<RoleRow> {
    const role = await this.prisma.role.findUnique({ where: { id }, select: roleSelect });
    if (!role) throw new AppException(ErrorCode.NOT_FOUND, 'Role not found.', 404);
    return role;
  }

  /** Looks up the permissions; unknown codes are an error, and you may only grant permissions you hold. */
  private async permissionsFor(codes: string[], actor: AuthenticatedUser) {
    const unique = [...new Set(codes)];
    const permissions = await this.prisma.permission.findMany({ where: { code: { in: unique } }, select: { id: true, code: true } });
    const known = new Set(permissions.map((p) => p.code));
    const unknown = unique.filter((c) => !known.has(c));
    if (unknown.length > 0) throw new AppException('UNKNOWN_PERMISSION', `Unknown permission: ${unknown.join(', ')}`, 422);
    const notHeld = unique.filter((c) => !actor.permissions.has(c));
    if (notHeld.length > 0) throw new AppException('PERMISSION_NOT_GRANTABLE', `You cannot grant permissions you do not have: ${notHeld.join(', ')}`, 403);
    return permissions;
  }

  /** Someone active must always be able to manage roles, otherwise nobody could ever fix a mistake. */
  private async assertAdministratorRemains(roleId: string): Promise<void> {
    const others = await this.prisma.user.count({
      where: {
        isActive: true,
        roles: { some: { role: { id: { not: roleId }, permissions: { some: { permission: { code: ADMIN_PERMISSION } } } } } },
      },
    });
    if (others === 0) {
      throw new AppException('LAST_ADMINISTRATOR', `This is the only role that grants ${ADMIN_PERMISSION}; removing it would leave nobody able to manage roles.`, 409);
    }
  }
}
