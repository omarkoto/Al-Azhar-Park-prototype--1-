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
import { AnyAuthenticated, Public, RequirePermissions } from '../../src/modules/auth/decorators';
import { PasswordLinkMessage, PasswordLinkNotifier } from '../../src/modules/auth/password-link-notifier';

class PaginationDto extends createZodDto(paginationQuerySchema) {}
class EchoDto extends createZodDto(z.object({ name: z.string().min(2), age: z.number().int().min(18) })) {}

/** Throwaway endpoints used ONLY by the tests, to exercise the shared HTTP behaviour without any real feature. */
@Public()
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

/** Protected throwaway routes: prove the guards, including that an un-annotated route is refused (fail closed). */
@Controller('__guarded')
class GuardedProbeController {
  @Get('unannotated')
  unannotated() {
    return { reached: true };
  }
  @Get('any')
  @AnyAuthenticated()
  any() {
    return { reached: true };
  }
  @Get('needs-two')
  @RequirePermissions('users:read', 'pricing:write')
  needsTwo() {
    return { reached: true };
  }
}

/** Replaces the e-mail delivery so tests can read the one-time tokens a real person would receive. */
export class CapturingNotifier extends PasswordLinkNotifier {
  readonly messages: PasswordLinkMessage[] = [];
  async send(message: PasswordLinkMessage): Promise<void> {
    this.messages.push(message);
  }
  last(email: string): PasswordLinkMessage | undefined {
    return [...this.messages].reverse().find((m) => m.email.toLowerCase() === email.toLowerCase());
  }
}

@Module({ controllers: [ProbeController, GuardedProbeController] })
class ProbeModule {}

/**
 * Builds the real application (same configureApp as production) plus the probe routes.
 * `env` overrides apply for this app instance only.
 */
export async function createTestApp(env: Record<string, string> = {}, notifier?: PasswordLinkNotifier): Promise<NestExpressApplication> {
  const previous: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    previous[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    const builder = Test.createTestingModule({ imports: [AppModule, ProbeModule] });
    if (notifier) builder.overrideProvider(PasswordLinkNotifier).useValue(notifier);
    const moduleRef = await builder.compile();
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
