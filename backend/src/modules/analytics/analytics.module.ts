import { Module } from '@nestjs/common';
import { TicketingModule } from '../ticketing/ticketing.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsExportService } from './analytics-export.service';
import { AnalyticsService } from './analytics.service';

@Module({ imports: [TicketingModule], controllers: [AnalyticsController], providers: [AnalyticsService, AnalyticsExportService] })
export class AnalyticsModule {}
