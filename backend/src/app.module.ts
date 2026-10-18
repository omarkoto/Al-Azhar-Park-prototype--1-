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
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from './modules/auth/guards/permissions.guard';
import { MediaModule } from './modules/media/media.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { OperationsModule } from './modules/operations/operations.module';
import { ScansModule } from './modules/scans/scans.module';
import { isScanRoute } from './modules/scans/scan-route';
import { TicketingModule } from './modules/ticketing/ticketing.module';
import { EventsModule } from './modules/events/events.module';
import { JournalModule } from './modules/journal/journal.module';
import { RestaurantsModule } from './modules/restaurants/restaurants.module';
import { ParkModule } from './modules/park/park.module';
import { RolesModule } from './modules/roles/roles.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({ inject: [AppConfigService], useFactory: buildLoggerParams }),
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        throttlers: [
          // the general limit counts every route except the gate scanner ...
          { name: 'default', ttl: config.get('RATE_LIMIT_TTL_SECONDS') * 1000, limit: config.get('RATE_LIMIT_MAX'), skipIf: isScanRoute },
          // ... which has its own, higher limit, set for a real gate (SCAN_RATE_LIMIT_PER_MINUTE) and counted only there
          { name: 'scan', ttl: 60_000, limit: config.get('SCAN_RATE_LIMIT_PER_MINUTE'), skipIf: (context) => !isScanRoute(context) },
        ],
      }),
    }),
    PrismaModule,
    HealthModule,
    AuditModule,
    AuthModule,
    UsersModule,
    RolesModule,
    ParkModule,
    MediaModule,
    RestaurantsModule,
    EventsModule,
    JournalModule,
    TicketingModule,
    ScansModule,
    OperationsModule,
    AnalyticsModule,
    //
    //           AnalyticsModule …
  ],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    // Guard order matters: throttle first (so floods of bad tokens are limited too), then authenticate, then authorize.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
