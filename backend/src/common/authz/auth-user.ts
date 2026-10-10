import type { Role } from '@prisma/client';

export interface RoleGrant {
  id: string;
  role: Role;
  institutionId: string | null;
  electionId: string | null;
}

/** Utilisateur authentifié, relu en base à chaque requête (03 §7.4). */
export interface AuthUser {
  id: string;
  twoFactorEnabled: boolean;
  /** Famille de refresh tokens = session. */
  sessionId: string;
  twoFactorVerifiedAt: Date | null;
  /** true si la requête est faite avec le jeton de configuration 2FA (D-15). */
  setupOnly: boolean;
  roles: RoleGrant[];
}

/** Portée d'une ressource, lue en base. */
export interface ResourceScope {
  institutionIds: string[];
  electionId?: string;
}
