import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import type { AuthUser } from '../common/authz/auth-user';
import { CurrentUser, Public, RequirePermission, ScopeFrom } from '../common/authz/decorators';
import { requestInfo } from '../common/http/request-info';
import { MAX_UPLOAD_BYTES } from '../storage/file-validator';
import { DocumentsService } from './documents.service';
import { DeclareEnrollmentDto } from './students.dto';
import { StudentsService } from './students.service';

@ApiTags('students')
@Controller()
export class StudentsController {
  constructor(
    private readonly students: StudentsService,
    private readonly documents: DocumentsService,
  ) {}

  /** Mon profil, mon inscription de l'année courante et l'état de mon attestation. */
  @Get('students/me')
  @RequirePermission('student:read')
  me(@CurrentUser() user: AuthUser) {
    return this.students.getMe(user);
  }

  /** Déclare (ou corrige, tant qu'elle n'est pas vérifiée ni en cours d'examen) l'inscription de l'année courante. */
  @Put('students/me/enrollment')
  @RequirePermission('enrollment:create')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  declare(@CurrentUser() user: AuthUser, @Body() dto: DeclareEnrollmentDto, @Req() req: Request) {
    return this.students.declare(user, dto, requestInfo(req));
  }

  /** Dépôt de l'attestation : 5 Mo maximum, type réel contrôlé (PDF, JPEG, PNG). */
  @Post('students/me/enrollment/document')
  @RequirePermission('document:upload')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 0 } }))
  upload(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request) {
    return this.students.uploadDocument(user, file, requestInfo(req));
  }

  /**
   * URL signée de 5 minutes vers l'attestation d'une inscription. Le propriétaire et le vérificateur de l'institution
   * seulement : l'INSTITUTION_ADMIN reçoit 403 (03 §5.3). La portée est lue en base depuis l'inscription.
   */
  @Post('enrollments/:id/document-access')
  @HttpCode(200)
  @RequirePermission('document:read')
  @ScopeFrom('enrollment', 'id')
  documentAccess(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.documents.issueUrl(user, id);
  }
}

@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(private readonly documents: DocumentsService) {}

  /**
   * Sert une attestation. Route publique au sens des guards : l'authentification est la SIGNATURE de l'URL (un `<img>` ou un
   * `<iframe>` ne peut pas envoyer d'en-tête Authorization), vérifiée avec l'utilisateur et ses droits actuels.
   */
  @Public()
  @Get(':fileId')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async serve(
    @Param('fileId') fileId: string,
    @Query('uid') uid: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const file = await this.documents.serve(fileId, String(uid), Number(exp), String(sig), requestInfo(req));
    res
      .status(200)
      .set({
        'Content-Type': file.mimeType,
        'Content-Length': String(file.body.length),
        'Content-Disposition': `inline; filename="${file.filename}"`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      })
      .end(file.body);
  }
}
