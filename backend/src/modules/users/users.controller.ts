import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequestContext } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser, RequestCtx, RequirePermissions } from '../auth/decorators';
import { CreateUserDto, ListUsersQueryDto, SetRolesDto, UpdateUserDto } from './users.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('users:read')
  @ApiOperation({ summary: 'List portal users' })
  list(@Query() query: ListUsersQueryDto) {
    return this.users.list(query);
  }

  @Get(':id')
  @RequirePermissions('users:read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(id);
  }

  @Post()
  @RequirePermissions('users:write')
  @ApiOperation({ summary: 'Invite a user. They receive a one-time link to choose their own password.' })
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.users.create(dto, actor, ctx);
  }

  @Patch(':id')
  @RequirePermissions('users:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.users.update(id, dto, actor, ctx);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermissions('users:write')
  activate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.users.setActive(id, true, actor, ctx);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermissions('users:write')
  @ApiOperation({ summary: 'Deactivate a user: signed out everywhere immediately and unable to sign in' })
  deactivate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.users.setActive(id, false, actor, ctx);
  }

  @Put(':id/roles')
  @RequirePermissions('users:write')
  @ApiOperation({ summary: 'Replace a user\'s roles. You can only grant roles whose permissions you hold.' })
  setRoles(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetRolesDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.users.setRoles(id, dto.roleCodes, actor, ctx);
  }

  @Post(':id/send-password-reset')
  @HttpCode(200)
  @RequirePermissions('users:write')
  async sendReset(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    await this.users.sendPasswordReset(id, actor, ctx);
    return { sent: true };
  }
}
