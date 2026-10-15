import { Module } from '@nestjs/common';
import { ElectionsModule } from '../elections/elections.module';
import { EligibilityModule } from '../eligibility/eligibility.module';
import { CandidatesController } from './candidates.controller';
import { CandidatesService } from './candidates.service';

@Module({ imports: [ElectionsModule, EligibilityModule], controllers: [CandidatesController], providers: [CandidatesService] })
export class CandidatesModule {}
