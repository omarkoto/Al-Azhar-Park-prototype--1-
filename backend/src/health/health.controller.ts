import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { SkipEnvelope } from '../common/http/envelope';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../modules/auth/decorators';

@ApiTags('health')
@Public()
@Controller('health')
@SkipThrottle()
@SkipEnvelope()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: the process is up. Does not touch dependencies, so it never flaps because of the database. */
  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  live() {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  /** Readiness: the app can serve traffic — i.e. the database answers. Returns 503 otherwise. */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe (checks the database)' })
  async ready(@Res({ passthrough: true }) res: Response) {
    const database = (await this.prisma.ping()) ? 'up' : 'down';
    if (database === 'down') res.status(503);
    return { status: database === 'up' ? 'ok' : 'unavailable', checks: { database } };
  }
}
