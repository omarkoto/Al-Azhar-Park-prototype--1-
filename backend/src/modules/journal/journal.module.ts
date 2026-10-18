import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { JournalController, PublicJournalController } from './journal.controller';
import { JournalService } from './journal.service';

@Module({ imports: [MediaModule], controllers: [JournalController, PublicJournalController], providers: [JournalService] })
export class JournalModule {}
