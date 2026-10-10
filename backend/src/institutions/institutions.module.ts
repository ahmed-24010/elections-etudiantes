import { Module } from '@nestjs/common';
import { AcademicController } from './academic/academic.controller';
import { AcademicService } from './academic/academic.service';
import { InstitutionsController } from './institutions.controller';

@Module({ controllers: [InstitutionsController, AcademicController], providers: [AcademicService] })
export class InstitutionsModule {}
