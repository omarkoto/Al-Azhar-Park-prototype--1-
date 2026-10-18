import { Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { DisabledEmailProvider, EmailProvider, LogEmailProvider, SmtpEmailProvider } from '../email/email-provider';
import { ContactMessageService } from './contact-message.service';
import { HoursService } from './hours.service';
import { ParkController, PublicSiteController } from './park.controller';
import { ParkService } from './park.service';
import { SiteService } from './site.service';

@Module({
  controllers: [ParkController, PublicSiteController],
  providers: [
    ParkService,
    HoursService,
    SiteService,
    ContactMessageService,
    {
      provide: EmailProvider,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): EmailProvider => {
        const kind = config.emailProvider;
        return kind === 'smtp' ? new SmtpEmailProvider(config) : kind === 'log' ? new LogEmailProvider() : new DisabledEmailProvider();
      },
    },
  ],
  exports: [ParkService, HoursService, SiteService],
})
export class ParkModule {}
