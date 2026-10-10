import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditResult } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import type { ResourceScope } from './auth-user';
import { AuthzService } from './authz.service';
import { IS_PUBLIC, PERMISSIONS_KEY, SCOPE_KEY, ScopeSpec } from './decorators';
import { Permission, SENSITIVE } from './permissions';
import { AuthedRequest, singleInstitution } from './request-context';
import { ScopeResolver } from './scope-resolver.service';

/**
 * Séquence de 03 §4 : authentifié (401) → ressource (404) → rôle + portée (404 si aucun lien avec l'institution,
 * sinon 403). Refus par défaut : une route sans @RequirePermission ni @Public est refusée.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authz: AuthzService,
    private readonly scopes: ScopeResolver,
    private readonly audit: AuditService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const user = req.user;
    if (!user) throw new UnauthorizedException();

    const permissions = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, targets);
    if (!permissions?.length) throw new ForbiddenException();

    const spec = this.reflector.getAllAndOverride<ScopeSpec | undefined>(SCOPE_KEY, targets);
    let scope: ResourceScope | undefined;
    let resourceId: string | undefined;
    if (spec) {
      resourceId = req.params?.[spec.param] as string | undefined;
      const resolved = await this.scopes.resolve(spec.kind, resourceId);
      // Ressource absente OU sans aucun lien avec l'utilisateur : même réponse, pour ne pas révéler son existence.
      if (!resolved || !this.authz.canSee(user, resolved)) throw new NotFoundException();
      scope = resolved;
    }

    for (const permission of permissions) {
      const grant = this.authz.grantFor(user, permission, scope);
      if (grant) {
        req.authz = {
          permission,
          role: grant.role,
          sensitive: SENSITIVE.has(permission),
          scope,
          resourceType: spec?.kind ?? 'platform',
          resourceId,
        };
        return true;
      }
    }

    if (permissions.some((p) => SENSITIVE.has(p))) {
      await this.audit.record({
        actorId: user.id,
        institutionId: singleInstitution(scope),
        action: permissions[0],
        resourceType: spec?.kind ?? 'platform',
        resourceId,
        result: AuditResult.DENIED,
        ip: req.ip,
        requestId: String(req.id ?? ''),
        metadata: { reason: 'forbidden' },
      });
    }
    throw new ForbiddenException();
  }
}
