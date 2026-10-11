import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';

/** Règles de conflit d'intérêts et d'intégrité de 03 §5.2 et §6 : elles l'emportent sur tout cumul de rôles. */
@Injectable()
export class ConflictPolicy {
  /** Personne ne s'attribue un rôle à lui-même (03 §6). */
  assertNotSelfAssignment(actorId: string, targetId: string): void {
    if (actorId === targetId) throw new ForbiddenException('cannot_assign_role_to_self');
  }

  /** Personne ne révoque son propre rôle d'admin s'il est le dernier de l'institution (03 §5.2). */
  assertNotLastOwnAdminRevocation(actorId: string, grantUserId: string, otherActiveAdmins: number): void {
    if (actorId === grantUserId && otherActiveAdmins === 0) throw new ConflictException('last_institution_admin');
  }

  /** Un vérificateur ne valide pas sa propre inscription, ni un fichier qu'il a lui-même déposé (03 §6). */
  assertNotOwnRequest(actorId: string, studentUserId: string, uploaderId: string | null): void {
    if (actorId === studentUserId || actorId === uploaderId) throw new ForbiddenException('cannot_review_own_enrollment');
  }

  assertNotSelfSuspension(actorId: string, targetId: string): void {
    if (actorId === targetId) throw new ConflictException('cannot_suspend_self');
  }

  /** SUPER_ADMIN ne peut pas suspendre le dernier SUPER_ADMIN (03 §5.2). */
  assertNotLastSuperAdmin(otherActiveSuperAdmins: number): void {
    if (otherActiveSuperAdmins === 0) throw new ConflictException('last_super_admin');
  }
}
