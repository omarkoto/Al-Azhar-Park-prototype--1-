import { Controller, Get, Module, Post, Body, Query } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.factory';
import { AppException } from '../../src/common/errors/app-exception';
import { paginationQuerySchema, buildMeta } from '../../src/common/dto/pagination';
import { PageResult } from '../../src/common/http/envelope';

class PaginationDto extends createZodDto(paginationQuerySchema) {}
class EchoDto extends createZodDto(z.object({ name: z.string().min(2), age: z.number().int().min(18) })) {}

/** Throwaway endpoints used ONLY by the tests, to exercise the shared HTTP behaviour without any real feature. */
@Controller('__probe')
class ProbeController {
  @Get('page')
  page(@Query() q: PaginationDto) {
    return new PageResult([{ n: 1 }, { n: 2 }], buildMeta(q, 2));
  }
  @Post('echo')
  echo(@Body() body: EchoDto) {
    return { received: body };
  }
  @Get('boom')
  boom(): never {
    throw new Error('database password is hunter2');
  }
  @Get('business-error')
  businessError(): never {
    throw new AppException('TICKET_ALREADY_USED', 'This ticket has already been used.', 409, { gate: 'MAIN' });
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

/**
 * Builds the real application (same configureApp as production) plus the probe routes.
 * `env` overrides apply for this app instance only.
 */
export async function createTestApp(env: Record<string, string> = {}): Promise<NestExpressApplication> {
  const previous: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    previous[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, ProbeModule] }).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();
    return app;
  } finally {
    // the config object was built during compile(); restore the shared environment for other tests
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
