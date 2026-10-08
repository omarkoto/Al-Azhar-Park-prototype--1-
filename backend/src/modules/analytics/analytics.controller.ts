import { Readable } from 'node:stream';
import { Controller, Get, Header, Param, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { SkipEnvelope } from '../../common/http/envelope';
import { RequestContext } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { AnyAuthenticated, CurrentUser, RequestCtx } from '../auth/decorators';
import { AnalyticsExportService } from './analytics-export.service';
import { AnalyticsQueryDto, ExportParamDto } from './analytics.dto';
import { accessOf, AnalyticsService } from './analytics.service';

/**
 * Reports. Each route is open to anyone signed in and then checks the existing analytics permissions itself, because
 * several permissions can open the same report (analytics:read covers everything):
 *   sales and money ................. analytics:read
 *   entry, scans, gates, ticket states analytics:operations (or analytics:read)
 *   events (content statistics) ..... analytics:content (or analytics:read)
 */
@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
@AnyAuthenticated()
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly exports: AnalyticsExportService,
  ) {}

  @Get('overview')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Headline figures of every report you may see, for one period' })
  overview(@Query() q: AnalyticsQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.analytics.overview(q, accessOf(actor));
  }

  @Get('sales')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Paid sales and revenue by sale date or visit date (analytics:read)' })
  sales(@Query() q: AnalyticsQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.analytics.sales(q, accessOf(actor));
  }

  @Get('attendance')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Entries, refused scans, gates and scan results (analytics:operations)' })
  attendance(@Query() q: AnalyticsQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.analytics.attendance(q, accessOf(actor));
  }

  @Get('tickets')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'What the tickets are now: valid, used, cancelled ... (analytics:operations)' })
  tickets(@Query() q: AnalyticsQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.analytics.tickets(q, accessOf(actor));
  }

  @Get('events')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Event statistics (analytics:content)' })
  events(@Query() q: AnalyticsQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.analytics.events(q, accessOf(actor));
  }

  @Get('export/:report')
  @SkipEnvelope()
  @ApiOperation({ summary: 'A report as a CSV file (sales, attendance, tickets, gates, scans, events)' })
  async export(
    @Param() params: ExportParamDto,
    @Query() q: AnalyticsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
    @RequestCtx() ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.exports.build(params.report, q, accessOf(actor), actor, ctx);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${file.filename}"`, 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff', 'X-Row-Count': String(file.rows),
    });
    return new StreamableFile(Readable.from(file.lines));
  }
}
