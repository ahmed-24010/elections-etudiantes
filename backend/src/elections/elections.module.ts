import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { EligibilityModule } from '../eligibility/eligibility.module';
import { ElectionsController } from './elections.controller';
import { ElectionsService } from './elections.service';
import { SecondRoundService } from './second-round.service';

@Module({ imports: [EligibilityModule, StorageModule], controllers: [ElectionsController], providers: [ElectionsService, SecondRoundService], exports: [ElectionsService] })
export class ElectionsModule {}
