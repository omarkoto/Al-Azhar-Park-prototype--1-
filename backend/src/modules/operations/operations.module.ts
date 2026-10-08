import { Module } from '@nestjs/common';
import { TicketingModule } from '../ticketing/ticketing.module';
import { DashboardService } from './dashboard.service';
import { GatesService } from './gates.service';
import { OperationsController } from './operations.controller';
import { ScansHistoryService } from './scans-history.service';
import { TicketsOpsService } from './tickets-ops.service';

@Module({ imports: [TicketingModule], controllers: [OperationsController], providers: [DashboardService, GatesService, ScansHistoryService, TicketsOpsService] })
export class OperationsModule {}
