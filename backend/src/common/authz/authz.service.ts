import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthUser, ResourceScope, RoleGrant } from './auth-user';
import { Permission, ROLE_PERMISSIONS } from './permissions';

@Injectable()
export class AuthzService {
  /** La portée du rôle couvre-t-elle la ressource ? (SUPER_ADMIN : toute la plateforme.) */
  grantCoversScope(grant: RoleGrant, scope?: ResourceScope): boolean {
    if (grant.role === Role.SUPER_ADMIN || !scope) return true;
    if (scope.electionId && grant.role === Role.ELECTION_COMMITTEE) return grant.electionId === scope.electionId;
    return grant.institutionId !== null && scope.institutionIds.includes(grant.institutionId);
  }

  /** Le rôle a-t-il un lien quelconque avec la ressource ? Sinon la ressource est invisible (404). */
  grantSeesScope(grant: RoleGrant, scope?: ResourceScope): boolean {
    if (grant.role === Role.SUPER_ADMIN || !scope) return true;
    return grant.institutionId !== null && scope.institutionIds.includes(grant.institutionId);
  }

  canSee(user: AuthUser, scope?: ResourceScope): boolean {
    return user.roles.some((g) => this.grantSeesScope(g, scope));
  }

  /** Premier rôle de l'utilisateur qui accorde la permission dans cette portée, sinon null. */
  grantFor(user: AuthUser, permission: Permission, scope?: ResourceScope): RoleGrant | null {
    return (
      user.roles.find((g) => this.grantCoversScope(g, scope) && ROLE_PERMISSIONS[g.role].includes(permission)) ?? null
    );
  }

  can(user: AuthUser, permission: Permission, scope?: ResourceScope): boolean {
    return this.grantFor(user, permission, scope) !== null;
  }
}
