import { Module } from '@nestjs/common';
import { InstitutionsController } from './institutions.controller';

@Module({ controllers: [InstitutionsController] })
export class InstitutionsModule {}
