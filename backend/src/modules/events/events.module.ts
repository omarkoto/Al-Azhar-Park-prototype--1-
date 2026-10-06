import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { EventsController, PublicEventsController } from './events.controller';
import { EventsService } from './events.service';
import { VenuesService } from './venues.service';

@Module({ imports: [MediaModule], controllers: [EventsController, PublicEventsController], providers: [EventsService, VenuesService] })
export class EventsModule {}
