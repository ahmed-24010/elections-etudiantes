import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { CHROMIUM_PATH, PvPdfService } from './pv-pdf';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [StorageModule],
  controllers: [ReportsController],
  providers: [ReportsService, PvPdfService, { provide: CHROMIUM_PATH, useFactory: () => process.env.CHROMIUM_PATH }],
  exports: [ReportsService],
})
export class ReportsModule {}
