import { Module } from '@nestjs/common';
import { EligibilityModule } from '../eligibility/eligibility.module';
import { ElectionsController } from './elections.controller';
import { ElectionsService } from './elections.service';

@Module({ imports: [EligibilityModule], controllers: [ElectionsController], providers: [ElectionsService], exports: [ElectionsService] })
export class ElectionsModule {}
