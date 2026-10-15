import { Module } from '@nestjs/common';
import { EligibilityService } from './eligibility.service';

@Module({ providers: [EligibilityService], exports: [EligibilityService] })
export class EligibilityModule {}
