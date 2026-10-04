import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { EnvelopeInterceptor } from './common/interceptors/envelope.interceptor';
import { buildLoggerParams } from './common/logging/logger.config';
import { AppConfigService } from './config/app-config.service';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({ inject: [AppConfigService], useFactory: buildLoggerParams }),
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        throttlers: [{ ttl: config.get('RATE_LIMIT_TTL_SECONDS') * 1000, limit: config.get('RATE_LIMIT_MAX') }],
      }),
    }),
    PrismaModule,
    HealthModule,
    // Phase 2+: AuthModule, UsersModule, RolesModule, ParkModule, RestaurantsModule, EventsModule,
    //           TicketingModule, ScansModule, AnalyticsModule, AuditModule, MediaModule …
  ],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
