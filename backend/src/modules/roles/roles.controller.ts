import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestContext } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser, RequestCtx, RequirePermissions } from '../auth/decorators';
import { CreateRoleDto, SetRolePermissionsDto, UpdateRoleDto } from './roles.dto';
import { RolesService } from './roles.service';

@ApiTags('roles')
@ApiBearerAuth()
@Controller()
export class RolesController {
  constructor(
    private readonly roles: RolesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('roles')
  @RequirePermissions('roles:read')
  @ApiOperation({ summary: 'Roles with their permissions and how many users hold each' })
  list() {
    return this.roles.list();
  }

  @Get('roles/:id')
  @RequirePermissions('roles:read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.roles.get(id);
  }

  @Post('roles')
  @RequirePermissions('roles:write')
  @ApiOperation({ summary: 'Create a role. You can only grant permissions you hold.' })
  create(@Body() dto: CreateRoleDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.roles.create(dto, actor, ctx);
  }

  @Patch('roles/:id')
  @RequirePermissions('roles:write')
  @ApiOperation({ summary: 'Rename a role or change its description (the code never changes)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.roles.update(id, dto, actor, ctx);
  }

  @Put('roles/:id/permissions')
  @RequirePermissions('roles:write')
  @ApiOperation({ summary: 'Replace the permissions of a role. Takes effect on the holders\' next request.' })
  setPermissions(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetRolePermissionsDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.roles.setPermissions(id, dto.permissionCodes, actor, ctx);
  }

  @Delete('roles/:id')
  @HttpCode(200)
  @RequirePermissions('roles:write')
  @ApiOperation({ summary: 'Delete a custom role that nobody holds. Built-in roles cannot be deleted.' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    await this.roles.remove(id, actor, ctx);
    return { deleted: true };
  }

  @Get('permissions')
  @RequirePermissions('permissions:read')
  @ApiOperation({ summary: 'The permission catalogue (resource:action). The portal builds its role editor from this.' })
  permissions() {
    return this.prisma.permission.findMany({ orderBy: { code: 'asc' }, select: { code: true, description: true } });
  }
}
