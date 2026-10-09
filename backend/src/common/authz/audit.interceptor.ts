import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { AuditResult } from '@prisma/client';
import { Observable, catchError, from, mergeMap, throwError } from 'rxjs';
import { AuditService } from '../../audit/audit.service';
import { AuthedRequest, singleInstitution } from './request-context';

/**
 * Trace toute action sensible (🔐) qui a passé les guards, en succès comme en échec.
 * Les refus des guards sont tracés par les guards eux-mêmes. Le corps de la requête n'est jamais lu ici.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const authz = req.authz;
    if (!authz?.sensitive) return next.handle();

    const write = (result: AuditResult, status: number) =>
      this.audit.record({
        actorId: req.user?.id,
        actorRole: authz.role,
        institutionId: singleInstitution(authz.scope),
        action: authz.permission,
        resourceType: authz.resourceType,
        resourceId: authz.resourceId,
        result,
        ip: req.ip,
        requestId: String(req.id ?? ''),
        metadata: { status },
      });

    return next.handle().pipe(
      mergeMap(async (value) => {
        await write(AuditResult.SUCCESS, ctx.switchToHttp().getResponse().statusCode);
        return value;
      }),
      catchError((err) => {
        const status = err instanceof HttpException ? err.getStatus() : 500;
        // L'échec d'écriture d'audit ne doit pas masquer l'erreur d'origine.
        return from(write(AuditResult.FAILURE, status).catch(() => undefined)).pipe(mergeMap(() => throwError(() => err)));
      }),
    );
  }
}
