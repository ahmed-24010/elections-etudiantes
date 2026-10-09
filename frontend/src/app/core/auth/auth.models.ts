export type Role = 'SUPER_ADMIN' | 'INSTITUTION_ADMIN' | 'VERIFICATION_OFFICER' | 'ELECTION_COMMITTEE' | 'STUDENT';

/** Rôles administratifs : 2FA obligatoire (D-10). */
export const ADMIN_ROLES: readonly Role[] = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'VERIFICATION_OFFICER', 'ELECTION_COMMITTEE'];

export interface RoleGrant {
  role: Role;
  institutionId: string | null;
  electionId: string | null;
}

export interface CurrentUser {
  id: string;
  email: string | null;
  phone: string | null;
  twoFactorEnabled: boolean;
  roles: RoleGrant[];
}

export interface InstitutionOption {
  code: string;
  name: string;
}

export type LoginOutcome = 'authenticated' | 'two_factor_required' | 'two_factor_setup_required';

export interface TwoFactorSetup {
  secret: string;
  otpauthUri: string;
}
