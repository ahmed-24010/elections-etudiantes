import { Role } from '@prisma/client';
import { ADMIN_ROLES, PERMISSIONS, Permission, ROLE_PERMISSIONS, SENSITIVE } from './permissions';

const can = (role: Role, p: Permission) => ROLE_PERMISSIONS[role].includes(p);

describe('permissions.ts (03 §5)', () => {
  it('chaque permission attribuée ou sensible est déclarée, sans doublon', () => {
    for (const list of Object.values(ROLE_PERMISSIONS)) {
      expect(new Set(list).size).toBe(list.length);
      for (const p of list) expect(PERMISSIONS).toContain(p);
    }
    for (const p of SENSITIVE) expect(PERMISSIONS).toContain(p);
  });

  it('les permissions interdites à tous (03 §5.6, §5.8) n’existent pour aucun rôle', () => {
    const all = Object.values(ROLE_PERMISSIONS).flat() as string[];
    for (const forbidden of ['participation:read:list', 'ballot:read', 'audit:write', 'audit:update', 'audit:delete']) {
      expect(all).not.toContain(forbidden);
      expect(PERMISSIONS as readonly string[]).not.toContain(forbidden);
    }
  });

  it('aucune permission de modifier des résultats n’existe (03 §5.7)', () => {
    expect((PERMISSIONS as readonly string[]).filter((p) => /results:(update|edit|modify)/.test(p))).toEqual([]);
  });

  it('SUPER_ADMIN ne gère ni structure académique, ni élections, ni vérification, ni vote', () => {
    const forbidden: Permission[] = ['academic:manage', 'election:create', 'election:voting:open', 'enrollment:review', 'ballot:cast', 'results:publish'];
    for (const p of forbidden) expect(can(Role.SUPER_ADMIN, p)).toBe(false);
    expect(can(Role.SUPER_ADMIN, 'institution:create')).toBe(true);
    expect(can(Role.SUPER_ADMIN, 'role:assign:INSTITUTION_ADMIN')).toBe(true);
    expect(can(Role.SUPER_ADMIN, 'role:assign:VERIFICATION_OFFICER')).toBe(false);
  });

  it('INSTITUTION_ADMIN ne valide pas les inscriptions et ne lit pas les attestations (03 §5.3)', () => {
    expect(can(Role.INSTITUTION_ADMIN, 'enrollment:review')).toBe(false);
    expect(can(Role.INSTITUTION_ADMIN, 'document:read')).toBe(false);
    expect(can(Role.VERIFICATION_OFFICER, 'enrollment:review')).toBe(true);
    expect(can(Role.VERIFICATION_OFFICER, 'document:read')).toBe(true);
  });

  it('seul INSTITUTION_ADMIN annule une élection ; le comité ne peut pas annuler la sienne (03 §5.4)', () => {
    expect(can(Role.INSTITUTION_ADMIN, 'election:cancel')).toBe(true);
    for (const r of [Role.ELECTION_COMMITTEE, Role.SUPER_ADMIN, Role.VERIFICATION_OFFICER, Role.STUDENT]) {
      expect(can(r, 'election:cancel')).toBe(false);
    }
  });

  it('seul STUDENT vote, et lui seul voit sa participation', () => {
    for (const r of Object.values(Role)) {
      expect(can(r, 'ballot:cast')).toBe(r === Role.STUDENT);
      expect(can(r, 'participation:read:self')).toBe(r === Role.STUDENT);
    }
  });

  it('le comité calcule les résultats, pas l’administrateur d’institution', () => {
    expect(can(Role.ELECTION_COMMITTEE, 'results:compute')).toBe(true);
    expect(can(Role.INSTITUTION_ADMIN, 'results:compute')).toBe(false);
  });

  it('les actions 🔐 de 03 sont exactement les actions sensibles, chacune détenue par au moins un rôle', () => {
    const expected: Permission[] = [
      'institution:create', 'institution:update', 'institution:deactivate', 'role:assign:INSTITUTION_ADMIN',
      'role:assign:VERIFICATION_OFFICER', 'role:assign:ELECTION_COMMITTEE', 'role:revoke', 'user:suspend',
      'enrollment:review', 'enrollment:expire', 'student:import', 'election:voting:open', 'election:voting:close',
      'election:cancel', 'voter_roll:add', 'candidate:review', 'candidate:add', 'results:compute', 'results:publish',
      'report:generate', 'report:revoke',
    ];
    for (const p of expected) {
      expect(SENSITIVE.has(p)).toBe(true);
      expect(Object.values(ROLE_PERMISSIONS).some((l) => l.includes(p))).toBe(true);
    }
    expect(SENSITIVE.size).toBe(expected.length);
    expect(SENSITIVE.has('ballot:cast')).toBe(false);
    expect(SENSITIVE.has('user:update:self')).toBe(false);
  });

  it('2FA obligatoire pour tous les rôles administratifs, pas pour STUDENT (D-10)', () => {
    expect([...ADMIN_ROLES].sort()).toEqual([Role.ELECTION_COMMITTEE, Role.INSTITUTION_ADMIN, Role.SUPER_ADMIN, Role.VERIFICATION_OFFICER].sort());
    expect(ADMIN_ROLES).not.toContain(Role.STUDENT);
  });

  it('tout le monde peut gérer son propre compte', () => {
    for (const r of Object.values(Role)) expect(can(r, 'user:update:self')).toBe(true);
  });
});
