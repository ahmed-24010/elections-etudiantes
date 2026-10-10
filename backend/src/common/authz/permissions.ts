import { Role } from '@prisma/client';

/**
 * Seule source de la correspondance rôle → permissions (03 §5 et §7.1).
 * Les rôles et leur portée sont en base (role_assignments) ; ceci est dans le code
 * pour passer par une revue. Toute modification doit suivre la matrice de 03 §5.
 *
 * Les permissions « 👤 » (propres données) figurent ici ; le contrôle « c'est bien lui »
 * est fait par le service concerné. `participation:read:list` et `ballot:read` n'existent
 * volontairement pour aucun rôle (03 §5.6) ; `audit:write/update/delete` non plus (03 §5.8).
 */
export const PERMISSIONS = [
  // 5.1 Plateforme et institutions
  'institution:create', 'institution:update', 'institution:deactivate', 'institution:read',
  'academic:manage', 'academic:read',
  // 5.2 Utilisateurs et rôles
  'role:assign:INSTITUTION_ADMIN', 'role:assign:VERIFICATION_OFFICER', 'role:assign:ELECTION_COMMITTEE',
  'role:revoke', 'user:read', 'user:suspend', 'user:update:self',
  // 5.3 Étudiants et vérification
  'student:register', 'student:read', 'student:read:minimal', 'enrollment:create', 'document:upload',
  'document:read', 'enrollment:review', 'enrollment:expire', 'student:import',
  // 5.4 Élections
  'election:create', 'election:update', 'election:rules:manage', 'election:candidacy:open',
  'election:candidacy:close', 'election:voting:open', 'election:voting:close', 'election:cancel',
  'election:read', 'election:list:mine', 'voter_roll:add', 'voter_roll:read:count', 'turnout:read',
  // 5.5 Candidatures
  'candidate:apply', 'candidate:withdraw', 'candidate:update', 'candidate:review', 'candidate:add',
  'candidate:read:approved', 'candidate:read:all',
  // 5.6 Vote
  'ballot:cast', 'participation:read:self',
  // 5.7 Résultats
  'results:compute', 'results:read', 'results:publish', 'results:read:published',
  'report:generate', 'report:revoke',
  // 5.8 Audit
  'audit:read', 'audit:read:election', 'audit:read:platform', 'audit:verify_chain',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: [
    'institution:create', 'institution:update', 'institution:deactivate', 'institution:read', 'academic:read',
    'role:assign:INSTITUTION_ADMIN', 'role:revoke', 'user:read', 'user:suspend', 'user:update:self',
    'election:read', 'voter_roll:read:count',
    'candidate:read:approved', 'results:read:published',
    'audit:read:platform', 'audit:verify_chain',
  ],
  INSTITUTION_ADMIN: [
    'institution:update', 'institution:read', 'academic:manage', 'academic:read',
    'role:assign:VERIFICATION_OFFICER', 'role:assign:ELECTION_COMMITTEE', 'role:revoke',
    'user:read', 'user:suspend', 'user:update:self',
    'student:read', 'student:read:minimal', 'enrollment:expire', 'student:import',
    'election:create', 'election:update', 'election:rules:manage', 'election:candidacy:open',
    'election:candidacy:close', 'election:voting:open', 'election:voting:close', 'election:cancel',
    'election:read', 'voter_roll:read:count', 'turnout:read',
    'candidate:read:approved', 'candidate:read:all',
    'results:read', 'results:publish', 'results:read:published', 'report:generate', 'report:revoke',
    'audit:read', 'audit:read:election', 'audit:verify_chain',
  ],
  VERIFICATION_OFFICER: [
    'institution:read', 'academic:read', 'user:update:self',
    'student:read', 'student:read:minimal', 'document:read', 'enrollment:review',
    'candidate:read:approved', 'results:read:published',
  ],
  ELECTION_COMMITTEE: [
    'institution:read', 'academic:read', 'user:update:self',
    'student:read:minimal',
    'election:update', 'election:rules:manage', 'election:candidacy:open', 'election:candidacy:close',
    'election:voting:open', 'election:voting:close', 'election:read', 'voter_roll:add',
    'voter_roll:read:count', 'turnout:read',
    'candidate:review', 'candidate:add', 'candidate:read:approved', 'candidate:read:all',
    'results:compute', 'results:read', 'results:publish', 'results:read:published', 'report:generate',
    'audit:read:election',
  ],
  STUDENT: [
    'institution:read', 'academic:read', 'user:update:self',
    'student:register', 'student:read', 'enrollment:create', 'document:upload', 'document:read',
    'election:read', 'election:list:mine', 'voter_roll:read:count',
    'candidate:apply', 'candidate:withdraw', 'candidate:update', 'candidate:read:approved', 'candidate:read:all',
    'ballot:cast', 'participation:read:self', 'results:read:published',
  ],
};

/** Actions 🔐 : 2FA de moins de 10 minutes (StepUpGuard) et audit. */
export const SENSITIVE: ReadonlySet<Permission> = new Set<Permission>([
  'institution:create', 'institution:update', 'institution:deactivate',
  'role:assign:INSTITUTION_ADMIN', 'role:assign:VERIFICATION_OFFICER', 'role:assign:ELECTION_COMMITTEE',
  'role:revoke', 'user:suspend',
  'enrollment:review', 'enrollment:expire', 'student:import',
  'election:voting:open', 'election:voting:close', 'election:cancel', 'voter_roll:add',
  'candidate:review', 'candidate:add',
  'results:compute', 'results:publish', 'report:generate', 'report:revoke',
]);

/** Rôles administratifs : 2FA obligatoire (D-10). STUDENT : optionnelle. */
export const ADMIN_ROLES: readonly Role[] = [
  Role.SUPER_ADMIN, Role.INSTITUTION_ADMIN, Role.VERIFICATION_OFFICER, Role.ELECTION_COMMITTEE,
];

/** Durée de validité d'une 2FA pour une action sensible (03 §7.3). */
export const STEP_UP_MAX_AGE_MS = 10 * 60 * 1000;
