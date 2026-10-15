import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ElectionsModule } from '../elections/elections.module';
import { ResultsModule } from '../results/results.module';
import { ElectionSchedulerService } from './election-scheduler.service';
import { VotingController } from './voting.controller';
import { VotingLifecycleService } from './voting-lifecycle.service';
import { VotingService } from './voting.service';

@Module({
  imports: [AuthModule, ElectionsModule, ResultsModule],
  controllers: [VotingController],
  providers: [VotingService, VotingLifecycleService, ElectionSchedulerService],
})
export class VotingModule {}
