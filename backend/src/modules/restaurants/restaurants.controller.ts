import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequestContext } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser, Public, RequestCtx, RequirePermissions } from '../auth/decorators';
import { CreateRestaurantDto, MenuDto, OrderDto, SetGalleryDto, UpdateRestaurantDto } from './restaurants.dto';
import { RestaurantsService } from './restaurants.service';

/** What the public website calls: no login, short cache. */
@ApiTags('public')
@Controller('public/restaurants')
export class PublicRestaurantsController {
  constructor(private readonly restaurants: RestaurantsService) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  @ApiOperation({ summary: 'Active restaurants in display order, with photos and menus' })
  list() {
    return this.restaurants.listPublic();
  }

  @Public()
  @Get(':slug')
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  one(@Param('slug') slug: string) {
    return this.restaurants.getPublic(slug);
  }
}

@ApiTags('restaurants')
@ApiBearerAuth()
@Controller()
export class RestaurantsController {
  constructor(private readonly restaurants: RestaurantsService) {}

  @Get('restaurants')
  @RequirePermissions('restaurants:read')
  list() {
    return this.restaurants.list();
  }

  @Put('restaurants/order')
  @RequirePermissions('restaurants:write')
  @ApiOperation({ summary: 'Set the display order: list every restaurant id once, in the new order' })
  order(@Body() dto: OrderDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.restaurants.setOrder(dto.ids, actor, ctx);
  }

  @Get('restaurants/:id')
  @RequirePermissions('restaurants:read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.restaurants.get(id);
  }

  @Post('restaurants')
  @RequirePermissions('restaurants:write')
  @ApiOperation({ summary: 'Create a restaurant. The address (slug) cannot be changed later.' })
  create(@Body() dto: CreateRestaurantDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.restaurants.create(dto, actor, ctx);
  }

  @Put('restaurants/:id')
  @RequirePermissions('restaurants:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRestaurantDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.restaurants.update(id, dto, actor, ctx);
  }

  @Delete('restaurants/:id')
  @HttpCode(200)
  @RequirePermissions('restaurants:write')
  @ApiOperation({ summary: 'Remove a restaurant from the website and the portal (the record is kept)' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    await this.restaurants.remove(id, actor, ctx);
    return { deleted: true };
  }

  @Put('restaurants/:id/gallery')
  @RequirePermissions('restaurants:write', 'media:read')
  @ApiOperation({ summary: 'Replace the photo gallery (ordered list of media ids with captions)' })
  gallery(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetGalleryDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.restaurants.setGallery(id, dto.items, actor, ctx);
  }

  // ── menus ──

  @Post('restaurants/:id/menus')
  @RequirePermissions('menus:write')
  @ApiOperation({ summary: 'Add a menu: an external https link or an uploaded PDF' })
  createMenu(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MenuDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.restaurants.createMenu(id, dto, actor, ctx);
  }

  @Put('restaurants/:id/menus/order')
  @RequirePermissions('menus:write')
  menuOrder(@Param('id', ParseUUIDPipe) id: string, @Body() dto: OrderDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.restaurants.setMenuOrder(id, dto.ids, actor, ctx);
  }

  @Put('menus/:id')
  @RequirePermissions('menus:write')
  updateMenu(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MenuDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.restaurants.updateMenu(id, dto, actor, ctx);
  }

  @Delete('menus/:id')
  @HttpCode(200)
  @RequirePermissions('menus:write')
  async deleteMenu(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    await this.restaurants.deleteMenu(id, actor, ctx);
    return { deleted: true };
  }
}
