import { Body, Controller, Get, HttpCode, NotFoundException, Param, Patch, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { memoryStorage } from 'multer';
import type { AuthUser } from '../common/authz/auth-user';
import { CurrentUser, RequirePermission, ScopeFrom } from '../common/authz/decorators';
import { requestInfo } from '../common/http/request-info';
import { MAX_UPLOAD_BYTES } from '../storage/file-validator';
import { ApplyDto, RejectDto, UpdateCandidacyDto } from './candidates.dto';
import { CandidatesService, FileKind } from './candidates.service';

const kindOf = (kind: string): FileKind => {
  if (kind !== 'photo' && kind !== 'program') throw new NotFoundException();
  return kind;
};
const upload = () => FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 0 } });

/** Candidatures (03 §5.5). La portée est celle de l'élection, relue en base ; l'éligibilité est contrôlée par le service. */
@ApiTags('candidates')
@Controller('elections/:id/candidates')
export class CandidatesController {
  constructor(private readonly candidates: CandidatesService) {}

  @Post()
  @RequirePermission('candidate:apply')
  @ScopeFrom('election', 'id')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  apply(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ApplyDto, @Req() req: Request) {
    return this.candidates.apply(u, id, dto, requestInfo(req));
  }

  /** Ma candidature à cette élection. */
  @Get('me')
  @RequirePermission('candidate:update')
  @ScopeFrom('election', 'id')
  mine(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.candidates.mine(u, id);
  }

  @Patch('me')
  @RequirePermission('candidate:update')
  @ScopeFrom('election', 'id')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateCandidacyDto, @Req() req: Request) {
    return this.candidates.update(u, id, dto, requestInfo(req));
  }

  /** Redépôt d'une candidature rejetée, après correction (candidatures encore ouvertes). */
  @Post('me/resubmit')
  @HttpCode(200)
  @RequirePermission('candidate:update')
  @ScopeFrom('election', 'id')
  resubmit(@CurrentUser() u: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.candidates.resubmit(u, id, requestInfo(req));
  }

  @Post('me/withdraw')
  @HttpCode(200)
  @RequirePermission('candidate:withdraw')
  @ScopeFrom('election', 'id')
  withdraw(@CurrentUser() u: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.candidates.withdraw(u, id, requestInfo(req));
  }

  /** Photo (JPEG ou PNG) ou programme (PDF, JPEG ou PNG) : 5 Mo, type réel contrôlé. */
  @Post('me/files/:kind')
  @RequirePermission('candidate:update')
  @ScopeFrom('election', 'id')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(upload())
  uploadFile(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('kind') kind: string, @UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request) {
    return this.candidates.uploadFile(u, id, kindOf(kind), file, requestInfo(req));
  }

  /** Candidats validés (liste publique pour ceux qui peuvent voir l'élection). */
  @Get()
  @RequirePermission('candidate:read:approved')
  @ScopeFrom('election', 'id')
  listApproved(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.candidates.listApproved(u, id);
  }

  /** Toutes les candidatures, motifs de rejet compris, pour le personnel ; la sienne seulement pour un étudiant. */
  @Get('all')
  @RequirePermission('candidate:read:all')
  @ScopeFrom('election', 'id')
  listAll(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.candidates.listAll(u, id);
  }

  /** 🔐 Comité de l'élection. */
  @Post(':candidateId/approve')
  @HttpCode(200)
  @RequirePermission('candidate:review')
  @ScopeFrom('election', 'id')
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('candidateId') candidateId: string, @Req() req: Request) {
    return this.candidates.review(u, id, candidateId, 'APPROVED', null, requestInfo(req));
  }

  /** 🔐 Motif obligatoire, lu par le candidat. */
  @Post(':candidateId/reject')
  @HttpCode(200)
  @RequirePermission('candidate:review')
  @ScopeFrom('election', 'id')
  reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('candidateId') candidateId: string, @Body() dto: RejectDto, @Req() req: Request) {
    return this.candidates.review(u, id, candidateId, 'REJECTED', dto.reason, requestInfo(req));
  }

  /** URL signée de 5 minutes vers la photo ou le programme d'un candidat. */
  @Post(':candidateId/files/:kind/access')
  @HttpCode(200)
  @RequirePermission('candidate:read:approved')
  @ScopeFrom('election', 'id')
  fileAccess(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('candidateId') candidateId: string, @Param('kind') kind: string) {
    return this.candidates.issueFileUrl(u, id, candidateId, kindOf(kind));
  }
}
