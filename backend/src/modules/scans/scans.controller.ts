import { Body, Controller, Get, Header, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequestContext } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser, RequestCtx, RequirePermissions } from '../auth/decorators';
import { ScanRoute } from './scan-route';
import { ScanDto } from './scans.dto';
import { ScansService } from './scans.service';

@ApiTags('scans')
@ApiBearerAuth()
@Controller('scans')
export class ScansController {
  constructor(private readonly scans: ScansService) {}

  @Get('gates')
  @RequirePermissions('scans:create')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'The active gates a scanner can work at' })
  gates() {
    return this.scans.activeGates();
  }

  /**
   * Validates a ticket at a gate and, if it is good, uses it up. A refused ticket is a normal answer (200 with
   * `granted: false` and a result code), not an error; an unknown or switched-off gate is an error.
   */
  @Post()
  @HttpCode(200)
  @ScanRoute()
  @RequirePermissions('scans:create')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Scan a ticket QR code at a gate: ACCESS_GRANTED, or the reason it was refused' })
  scan(@Body() dto: ScanDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.scans.scan(dto, actor, ctx);
  }
}
