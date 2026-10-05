import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';
import { RequirePermissions } from '../auth/decorators';

@ApiTags('roles')
@ApiBearerAuth()
@Controller()
export class RolesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('roles')
  @RequirePermissions('roles:read')
  @ApiOperation({ summary: 'Roles with their permissions and how many users hold each' })
  async roles() {
    const roles = await this.prisma.role.findMany({
      orderBy: { code: 'asc' },
      select: {
        id: true, code: true, name: true, description: true, isSystem: true,
        permissions: { select: { permission: { select: { code: true } } } },
        _count: { select: { users: true } },
      },
    });
    return roles.map((r) => ({
      id: r.id, code: r.code, name: r.name, description: r.description, isSystem: r.isSystem,
      permissions: r.permissions.map((p) => p.permission.code).sort(),
      userCount: r._count.users,
    }));
  }

  @Get('permissions')
  @RequirePermissions('permissions:read')
  @ApiOperation({ summary: 'The permission catalogue (resource:action)' })
  permissions() {
    return this.prisma.permission.findMany({ orderBy: { code: 'asc' }, select: { code: true, description: true } });
  }
}
