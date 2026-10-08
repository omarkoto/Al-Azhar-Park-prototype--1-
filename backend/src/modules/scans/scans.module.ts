import { Module } from '@nestjs/common';
import { TicketingModule } from '../ticketing/ticketing.module';
import { ScansController } from './scans.controller';
import { ScansService } from './scans.service';

@Module({ imports: [TicketingModule], controllers: [ScansController], providers: [ScansService] })
export class ScansModule {}
