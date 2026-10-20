import { Module } from '@nestjs/common';
import { ReportsModule } from '../reports/reports.module';
import { ResultsController } from './results.controller';
import { ResultsService } from './results.service';

@Module({ imports: [ReportsModule], controllers: [ResultsController], providers: [ResultsService], exports: [ResultsService] })
export class ResultsModule {}
