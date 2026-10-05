import { Module } from '@nestjs/common';
import { HoursService } from './hours.service';
import { ParkController, PublicSiteController } from './park.controller';
import { ParkService } from './park.service';
import { SiteService } from './site.service';

@Module({
  controllers: [ParkController, PublicSiteController],
  providers: [ParkService, HoursService, SiteService],
  exports: [ParkService, HoursService, SiteService],
})
export class ParkModule {}
