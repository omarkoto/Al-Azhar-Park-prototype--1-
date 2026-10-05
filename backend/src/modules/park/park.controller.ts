import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequestContext } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser, Public, RequestCtx, RequirePermissions } from '../auth/decorators';
import { HoursService } from './hours.service';
import { ListSpecialHoursQueryDto, SpecialHoursDto, UpdateContactDto, UpdateParkDto, UpdateWeeklyHoursDto } from './park.dto';
import { ParkService } from './park.service';
import { SiteService } from './site.service';

/** What the public website calls. No login; short cache so edits appear within a minute. */
@ApiTags('public')
@Controller('public')
export class PublicSiteController {
  constructor(private readonly site: SiteService) {}

  @Public()
  @Get('site')
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  @ApiOperation({ summary: 'Park information, contact details, opening hours and today\'s status' })
  snapshot() {
    return this.site.snapshot();
  }
}

@ApiTags('park')
@ApiBearerAuth()
@Controller()
export class ParkController {
  constructor(
    private readonly park: ParkService,
    private readonly hours: HoursService,
  ) {}

  @Get('park')
  @RequirePermissions('park:read')
  getPark() {
    return this.park.getPark();
  }

  @Put('park')
  @RequirePermissions('park:write')
  @ApiOperation({ summary: 'Replace the park information (name, tagline, description, statistics) in English and Arabic' })
  updatePark(@Body() dto: UpdateParkDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.park.updatePark(dto, actor, ctx);
  }

  @Get('contact')
  @RequirePermissions('contact:read')
  getContact() {
    return this.park.getContact();
  }

  @Put('contact')
  @RequirePermissions('contact:write')
  @ApiOperation({ summary: 'Replace the contact details: address, phones, e-mail, map link and coordinates' })
  updateContact(@Body() dto: UpdateContactDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.park.updateContact(dto, actor, ctx);
  }

  @Get('opening-hours')
  @RequirePermissions('hours:read')
  @ApiOperation({ summary: 'The regular weekly hours (0 = Sunday … 6 = Saturday)' })
  async weekly() {
    return { days: await this.hours.getWeekly() };
  }

  @Put('opening-hours')
  @RequirePermissions('hours:write')
  @ApiOperation({ summary: 'Replace the weekly hours. Also controls when same-day ticket sales stop.' })
  async setWeekly(@Body() dto: UpdateWeeklyHoursDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return { days: await this.hours.setWeekly(dto, actor, ctx) };
  }

  @Get('special-hours')
  @RequirePermissions('hours:read')
  special(@Query() query: ListSpecialHoursQueryDto) {
    return this.hours.listSpecial(query.when);
  }

  @Post('special-hours')
  @RequirePermissions('hours:write')
  @ApiOperation({ summary: 'Add a holiday, Ramadan period, special hours or temporary closure' })
  createSpecial(@Body() dto: SpecialHoursDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.hours.createSpecial(dto, actor, ctx);
  }

  @Put('special-hours/:id')
  @RequirePermissions('hours:write')
  updateSpecial(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SpecialHoursDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.hours.updateSpecial(id, dto, actor, ctx);
  }

  @Delete('special-hours/:id')
  @HttpCode(200)
  @RequirePermissions('hours:write')
  async deleteSpecial(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    await this.hours.deleteSpecial(id, actor, ctx);
    return { deleted: true };
  }
}
