import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { SkipEnvelope } from '../../common/http/envelope';
import { RequestContext } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { AnyAuthenticated, CurrentUser, RequestCtx, RequirePermissions } from '../auth/decorators';
import { DashboardService } from './dashboard.service';
import { GatesService } from './gates.service';
import { CreateGateDto, ListScansQueryDto, ListTicketsQueryDto, SetGateActiveDto, UpdateGateDto } from './operations.dto';
import { ScansHistoryService } from './scans-history.service';
import { TicketsOpsService } from './tickets-ops.service';

@ApiTags('operations')
@ApiBearerAuth()
@Controller()
export class OperationsController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly tickets: TicketsOpsService,
    private readonly scans: ScansHistoryService,
    private readonly gates: GatesService,
  ) {}

  // ── dashboard ──

  @Get('dashboard')
  @AnyAuthenticated()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: "Today's operations. Each section is present only if the caller holds the permission that protects its data." })
  today(@CurrentUser() actor: AuthenticatedUser) {
    return this.dashboard.today(actor);
  }

  // ── tickets ──

  @Get('tickets')
  @RequirePermissions('tickets:read')
  @ApiOperation({ summary: 'Tickets (filter: search by ticket or order number, status, visit date, ticket type, audience)' })
  listTickets(@Query() query: ListTicketsQueryDto) {
    return this.tickets.list(query);
  }

  @Get('tickets/:id')
  @RequirePermissions('tickets:read')
  getTicket(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.tickets.get(id, actor);
  }

  @Get('tickets/:id/pdf')
  @RequirePermissions('tickets:read', 'tickets:resend')
  @SkipEnvelope()
  @ApiOperation({ summary: 'The ticket as a PDF, for staff who re-deliver tickets (audited)' })
  async ticketPdf(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext, @Res({ passthrough: true }) res: Response) {
    const pdf = await this.tickets.pdfOf(id, actor, ctx);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${pdf.filename}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    return new StreamableFile(pdf.data);
  }

  // ── scans ──

  @Get('scans')
  @AnyAuthenticated() // the service requires scans:read (everyone's scans) or scans:read_own (your own)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Gate scans: all of them with scans:read, only your own with scans:read_own' })
  listScans(@Query() query: ListScansQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.scans.list(query, actor);
  }

  // ── gates ──

  @Get('gates')
  @RequirePermissions('gates:read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Every gate, active or not; usage figures for people who may read scans' })
  listGates(@CurrentUser() actor: AuthenticatedUser) {
    return this.gates.list(actor);
  }

  @Post('gates')
  @RequirePermissions('gates:write')
  createGate(@Body() dto: CreateGateDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.gates.create(dto, actor, ctx);
  }

  @Put('gates/:id')
  @RequirePermissions('gates:write')
  updateGate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGateDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.gates.update(id, dto, actor, ctx);
  }

  @Put('gates/:id/active')
  @HttpCode(200)
  @RequirePermissions('gates:write')
  @ApiOperation({ summary: 'Switch a gate on or off. A switched-off gate cannot be used for new scans; its history stays.' })
  setGateActive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetGateActiveDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.gates.setActive(id, dto.isActive, actor, ctx);
  }
}
