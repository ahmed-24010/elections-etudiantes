import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthUser } from '../common/authz/auth-user';
import { CurrentUser, RequirePermission, ScopeFrom } from '../common/authz/decorators';
import { requestInfo } from '../common/http/request-info';
import { RejectEnrollmentDto } from './verification.dto';
import { VerificationService } from './verification.service';

@ApiTags('verification')
@Controller()
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  /** File d'attente du vérificateur. `document:read` ouvre la route ; le service exige le rôle de vérificateur. */
  @Get('institutions/:institutionId/verification/queue')
  @RequirePermission('document:read')
  @ScopeFrom('institution', 'institutionId')
  queue(@CurrentUser() user: AuthUser, @Param('institutionId') institutionId: string) {
    return this.verification.queue(user, institutionId);
  }

  @Get('enrollments/:id/review')
  @RequirePermission('document:read')
  @ScopeFrom('enrollment', 'id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.verification.detail(user, id);
  }

  /** 🔐 Valide l'inscription : 2FA de moins de 10 minutes, audit, notification de l'étudiant. */
  @Post('enrollments/:id/approve')
  @HttpCode(204)
  @RequirePermission('enrollment:review')
  @ScopeFrom('enrollment', 'id')
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.verification.approve(user, id, requestInfo(req));
  }

  /** 🔐 Rejette avec un code et un motif obligatoire. */
  @Post('enrollments/:id/reject')
  @HttpCode(204)
  @RequirePermission('enrollment:review')
  @ScopeFrom('enrollment', 'id')
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RejectEnrollmentDto, @Req() req: Request) {
    return this.verification.reject(user, id, dto.code, dto.reason, requestInfo(req));
  }
}
