import { Role } from '@prisma/client';
import type { AuthUser, RoleGrant } from './auth-user';
import { AuthzService } from './authz.service';

const A = 'inst-a';
const B = 'inst-b';
const grant = (role: Role, institutionId: string | null = null, electionId: string | null = null): RoleGrant => ({
  id: `${role}-${institutionId}-${electionId}`, role, institutionId, electionId,
});
const user = (...roles: RoleGrant[]): AuthUser => ({
  id: 'u', twoFactorEnabled: true, sessionId: 's', twoFactorVerifiedAt: new Date(), setupOnly: false, roles,
});

describe('AuthzService : rôle + portée (03 §4)', () => {
  const authz = new AuthzService();

  it('INSTITUTION_ADMIN de A : accès à A, ni accès ni visibilité sur B', () => {
    const u = user(grant(Role.INSTITUTION_ADMIN, A));
    expect(authz.can(u, 'election:create', { institutionIds: [A] })).toBe(true);
    expect(authz.can(u, 'election:create', { institutionIds: [B] })).toBe(false);
    expect(authz.canSee(u, { institutionIds: [A] })).toBe(true);
    expect(authz.canSee(u, { institutionIds: [B] })).toBe(false);
  });

  it('un rôle sans permission est visible mais refusé (403, pas 404) dans sa propre institution', () => {
    const u = user(grant(Role.STUDENT, A));
    expect(authz.canSee(u, { institutionIds: [A] })).toBe(true);
    expect(authz.can(u, 'election:create', { institutionIds: [A] })).toBe(false);
  });

  it('ELECTION_COMMITTEE de X : permission sur X seulement, Y de la même institution est visible mais refusée', () => {
    const u = user(grant(Role.ELECTION_COMMITTEE, A, 'X'));
    expect(authz.can(u, 'election:voting:open', { institutionIds: [A], electionId: 'X' })).toBe(true);
    expect(authz.can(u, 'election:voting:open', { institutionIds: [A], electionId: 'Y' })).toBe(false);
    expect(authz.canSee(u, { institutionIds: [A], electionId: 'Y' })).toBe(true);
    expect(authz.canSee(u, { institutionIds: [B], electionId: 'Z' })).toBe(false);
  });

  it('les permissions s’additionnent entre rôles (STUDENT + ELECTION_COMMITTEE)', () => {
    const u = user(grant(Role.STUDENT, A), grant(Role.ELECTION_COMMITTEE, A, 'X'));
    expect(authz.can(u, 'ballot:cast', { institutionIds: [A] })).toBe(true);
    expect(authz.can(u, 'candidate:review', { institutionIds: [A], electionId: 'X' })).toBe(true);
    expect(authz.can(u, 'candidate:review', { institutionIds: [A], electionId: 'Y' })).toBe(false);
  });

  it('SUPER_ADMIN voit tout mais n’a que ses permissions (pas de vote, pas d’élection)', () => {
    const u = user(grant(Role.SUPER_ADMIN));
    expect(authz.canSee(u, { institutionIds: [B] })).toBe(true);
    expect(authz.can(u, 'institution:update', { institutionIds: [B] })).toBe(true);
    expect(authz.can(u, 'election:voting:open', { institutionIds: [B], electionId: 'Z' })).toBe(false);
  });

  it('sans portée de ressource (routes « propres données »), toute permission détenue suffit', () => {
    expect(authz.can(user(grant(Role.STUDENT, A)), 'user:update:self')).toBe(true);
    expect(authz.can(user(), 'user:update:self')).toBe(false);
  });

  it('un utilisateur ciblé sans rattachement d’institution n’est visible que pour SUPER_ADMIN', () => {
    expect(authz.canSee(user(grant(Role.INSTITUTION_ADMIN, A)), { institutionIds: [] })).toBe(false);
    expect(authz.canSee(user(grant(Role.SUPER_ADMIN)), { institutionIds: [] })).toBe(true);
  });
});
