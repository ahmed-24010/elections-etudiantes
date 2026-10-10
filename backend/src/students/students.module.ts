import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { FilesController, StudentsController } from './students.controller';
import { StudentsService } from './students.service';

@Module({ controllers: [StudentsController, FilesController], providers: [StudentsService, DocumentsService], exports: [DocumentsService] })
export class StudentsModule {}
