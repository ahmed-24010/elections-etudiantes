import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuditResult } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { STEP_UP_MAX_AGE_MS } from './permissions';
import { AuthedRequest, singleInstitution } from './request-context';

/** Les permissions sensibles (🔐) exigent une 2FA de moins de 10 minutes dans la session (03 §7.3, D-10). */
@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(private readonly audit: AuditService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const authz = req.authz;
    if (!authz?.sensitive) return true;

    const verifiedAt = req.user?.twoFactorVerifiedAt;
    if (verifiedAt && Date.now() - verifiedAt.getTime() <= STEP_UP_MAX_AGE_MS) return true;

    await this.audit.record({
      actorId: req.user?.id,
      actorRole: authz.role,
      institutionId: singleInstitution(authz.scope),
      action: authz.permission,
      resourceType: authz.resourceType,
      resourceId: authz.resourceId,
      result: AuditResult.DENIED,
      ip: req.ip,
      requestId: String(req.id ?? ''),
      metadata: { reason: 'step_up_required' },
    });
    // Le client réagit à ce message en demandant le code 2FA (POST /auth/step-up) puis en rejouant l'action.
    throw new UnauthorizedException('step_up_required');
  }
}
