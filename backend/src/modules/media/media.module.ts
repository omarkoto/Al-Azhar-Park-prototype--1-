import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { LocalMediaStorage, MediaStorage } from './media-storage';

/** Rebind MediaStorage here to store files in S3 / R2 / Cloudinary instead of on disk. */
@Module({
  controllers: [MediaController],
  providers: [MediaService, { provide: MediaStorage, useClass: LocalMediaStorage }],
  exports: [MediaService],
})
export class MediaModule {}
