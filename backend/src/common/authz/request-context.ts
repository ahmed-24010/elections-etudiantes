import type { Request } from 'express';
import type { Role } from '@prisma/client';
import type { AuthUser, ResourceScope } from './auth-user';
import type { Permission } from './permissions';

/** Posé par PermissionGuard pour StepUpGuard et AuditInterceptor. */
export interface AuthzResult {
  permission: Permission;
  role: Role;
  sensitive: boolean;
  scope?: ResourceScope;
  resourceType: string;
  resourceId?: string;
}

export type AuthedRequest = Request & { user?: AuthUser; authz?: AuthzResult; id?: unknown };

/** Institution unique visée par la requête (pour audit_logs.institutionId), sinon null. */
export function singleInstitution(scope?: ResourceScope): string | null {
  return scope?.institutionIds.length === 1 ? scope.institutionIds[0] : null;
}
