import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequestContext } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser, Public, RequestCtx, RequirePermissions } from '../auth/decorators';
import {
  CreateEventDto, CreateVenueDto, EventOrderDto, ListEventsQueryDto, PublicEventsQueryDto, SetEventGalleryDto, SetEventStatusDto, UpdateEventDto, UpdateVenueDto,
} from './events.dto';
import { EventsService } from './events.service';
import { VenuesService } from './venues.service';

/** What the public website calls: no login, short cache. Only COMING_SOON and PUBLISHED events exist here. */
@ApiTags('public')
@Controller('public/events')
export class PublicEventsController {
  constructor(private readonly events: EventsService) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  @ApiOperation({ summary: 'Published events (by default the ones that have not finished yet)' })
  list(@Query() query: PublicEventsQueryDto) {
    return this.events.listPublished(query.when);
  }

  // declared before ':slug' so "coming-soon" is not read as an event address
  @Public()
  @Get('coming-soon')
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  @ApiOperation({ summary: 'Events announced as coming soon' })
  comingSoon() {
    return this.events.listComingSoon();
  }

  @Public()
  @Get(':slug')
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  @ApiOperation({ summary: 'One coming-soon or published event by its address' })
  one(@Param('slug') slug: string) {
    return this.events.getPublic(slug);
  }
}

@ApiTags('events')
@ApiBearerAuth()
@Controller()
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly venues: VenuesService,
  ) {}

  // ── events ──

  @Get('events')
  @RequirePermissions('events:read')
  @ApiOperation({ summary: 'All events, every status, in display order (filter: ?status=&search=)' })
  list(@Query() query: ListEventsQueryDto) {
    return this.events.list(query);
  }

  @Put('events/order')
  @RequirePermissions('events:write')
  @ApiOperation({ summary: 'Set the display order: list every event id once, in the new order' })
  order(@Body() dto: EventOrderDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.events.setOrder(dto.ids, actor, ctx);
  }

  @Get('events/:id')
  @RequirePermissions('events:read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.events.get(id);
  }

  @Post('events')
  @RequirePermissions('events:write')
  @ApiOperation({ summary: 'Create an event. It starts as a draft; publishing is a separate step.' })
  create(@Body() dto: CreateEventDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.events.create(dto, actor, ctx);
  }

  @Put('events/:id')
  @RequirePermissions('events:write')
  @ApiOperation({ summary: 'Replace the content of an event (not its status)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEventDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.events.update(id, dto, actor, ctx);
  }

  @Put('events/:id/status')
  @RequirePermissions('events:publish')
  @ApiOperation({ summary: 'Change the status: draft, coming soon, published, cancelled, archived (only the allowed changes)' })
  status(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetEventStatusDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.events.setStatus(id, dto.status, actor, ctx);
  }

  @Put('events/:id/gallery')
  @RequirePermissions('events:write', 'media:read')
  @ApiOperation({ summary: 'Replace the photo gallery (ordered list of media ids with captions)' })
  gallery(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetEventGalleryDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.events.setGallery(id, dto.items, actor, ctx);
  }

  // ── venues ──

  @Get('venues')
  @RequirePermissions('venues:read')
  listVenues() {
    return this.venues.list();
  }

  @Put('venues/order')
  @RequirePermissions('venues:write')
  venueOrder(@Body() dto: EventOrderDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.venues.setOrder(dto.ids, actor, ctx);
  }

  @Get('venues/:id')
  @RequirePermissions('venues:read')
  getVenue(@Param('id', ParseUUIDPipe) id: string) {
    return this.venues.get(id);
  }

  @Post('venues')
  @RequirePermissions('venues:write')
  createVenue(@Body() dto: CreateVenueDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.venues.create(dto, actor, ctx);
  }

  @Put('venues/:id')
  @RequirePermissions('venues:write')
  @ApiOperation({ summary: 'Edit a venue, including switching it on or off' })
  updateVenue(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVenueDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.venues.update(id, dto, actor, ctx);
  }

  @Delete('venues/:id')
  @HttpCode(200)
  @RequirePermissions('venues:write')
  @ApiOperation({ summary: 'Delete a venue that no event uses (otherwise switch it off)' })
  async removeVenue(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    await this.venues.remove(id, actor, ctx);
    return { deleted: true };
  }
}
