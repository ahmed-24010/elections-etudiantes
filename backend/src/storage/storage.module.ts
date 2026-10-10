import { Global, Module } from '@nestjs/common';
import { SignedUrlService } from './signed-url.service';
import { S3StorageService, StorageService } from './storage.service';

@Global()
@Module({
  providers: [{ provide: StorageService, useClass: S3StorageService }, SignedUrlService],
  exports: [StorageService, SignedUrlService],
})
export class StorageModule {}
