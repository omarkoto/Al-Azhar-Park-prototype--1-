import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequestContext } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser, Public, RequestCtx, RequirePermissions } from '../auth/decorators';
import { CreateJournalDto, ListJournalQueryDto, SetJournalGalleryDto, SetJournalStatusDto, UpdateJournalDto } from './journal.dto';
import { JournalService } from './journal.service';

/** What the public website calls: no login, short cache. Only PUBLISHED articles exist here. */
@ApiTags('public')
@Controller('public/journal')
export class PublicJournalController {
  constructor(private readonly journal: JournalService) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  @ApiOperation({ summary: 'Published Journal articles, newest first' })
  list() {
    return this.journal.listPublished();
  }

  @Public()
  @Get(':slug')
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  @ApiOperation({ summary: 'One published Journal article by its address' })
  one(@Param('slug') slug: string) {
    return this.journal.getPublic(slug);
  }
}

@ApiTags('journal')
@ApiBearerAuth()
@Controller('journal')
export class JournalController {
  constructor(private readonly journal: JournalService) {}

  @Get()
  @RequirePermissions('journal:read')
  @ApiOperation({ summary: 'All Journal articles, every status, newest first (filter: ?status=&search=)' })
  list(@Query() query: ListJournalQueryDto) {
    return this.journal.list(query);
  }

  @Get(':id')
  @RequirePermissions('journal:read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.journal.get(id);
  }

  @Post()
  @RequirePermissions('journal:write')
  @ApiOperation({ summary: 'Create an article. It starts as a draft; publishing is a separate step.' })
  create(@Body() dto: CreateJournalDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.journal.create(dto, actor, ctx);
  }

  @Put(':id')
  @RequirePermissions('journal:write')
  @ApiOperation({ summary: 'Replace the content of an article (not its status)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateJournalDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.journal.update(id, dto, actor, ctx);
  }

  @Put(':id/status')
  @RequirePermissions('journal:publish')
  @ApiOperation({ summary: 'Change the status: draft, published, archived (only the allowed changes)' })
  status(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetJournalStatusDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.journal.setStatus(id, dto.status, actor, ctx);
  }

  @Put(':id/gallery')
  @RequirePermissions('journal:write', 'media:read')
  @ApiOperation({ summary: 'Replace the photo gallery (ordered list of media ids with captions)' })
  gallery(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetJournalGalleryDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.journal.setGallery(id, dto.items, actor, ctx);
  }
}
