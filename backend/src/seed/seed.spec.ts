import { Role } from '@prisma/client';
import { FakePrisma } from '../../test/fake-prisma';
import { AuditService } from '../audit/audit.service';
import { assertSeedAllowed, runSeed, SeedRefusedError } from './seed';

const env = {
  NODE_ENV: 'development',
  SEED_ADMIN_PASSWORD: 'un-mot-de-passe-de-seed',
  SEED_OFFICER_PASSWORD: 'mot-de-passe-verificateur',
  SEED_INSTITUTION_ADMIN_PASSWORD: 'mot-de-passe-admin-inst',
};

const make = () => {
  const prisma = new FakePrisma();
  const audit = new AuditService(prisma as any, { getOrThrow: () => 'sel-de-test-sel-de-test' } as any);
  const hashPassword = jest.fn(async (p: string) => `hash(${p})`);
  return { prisma, audit, hashPassword, deps: { prisma: prisma as any, audit, hashPassword } };
};

describe('seed (développement)', () => {
  it('refuse de tourner en production', () => {
    expect(() => assertSeedAllowed({ ...env, NODE_ENV: 'production' })).toThrow(SeedRefusedError);
  });

  it('refuse sans SEED_ADMIN_PASSWORD ou avec un mot de passe trop court (admin, vérificateur, admin d’institution)', () => {
    expect(() => assertSeedAllowed({ NODE_ENV: 'development' })).toThrow(/SEED_ADMIN_PASSWORD/);
    expect(() => assertSeedAllowed({ ...env, SEED_ADMIN_PASSWORD: 'court' })).toThrow(/SEED_ADMIN_PASSWORD/);
    expect(() => assertSeedAllowed({ ...env, SEED_OFFICER_PASSWORD: 'court' })).toThrow(/SEED_OFFICER_PASSWORD/);
    expect(() => assertSeedAllowed({ ...env, SEED_INSTITUTION_ADMIN_PASSWORD: 'court' })).toThrow(/SEED_INSTITUTION_ADMIN_PASSWORD/);
    expect(assertSeedAllowed(env).email).toBe('admin@example.test');
    expect(assertSeedAllowed({ ...env, SEED_ADMIN_EMAIL: ' Chef@Example.test ' }).email).toBe('chef@example.test');
  });

  it('les comptes vérificateur et admin d’institution ne sont créés que si leur mot de passe est fourni', async () => {
    const { prisma, deps } = make();
    const res = await runSeed(deps, { NODE_ENV: 'development', SEED_ADMIN_PASSWORD: env.SEED_ADMIN_PASSWORD });
    expect(res).toEqual(expect.objectContaining({ officerCreated: false, institutionAdminCreated: false }));
    expect(prisma.users).toHaveLength(1);
  });

  it('crée la structure de démonstration FSJP : 2 filières, niveaux L1 à M2, année 2026-2027 courante, groupes A et B', async () => {
    const { prisma, deps } = make();
    await runSeed(deps, env);
    const inst = prisma.institutions[0];
    expect(inst).toEqual(expect.objectContaining({ code: 'FSJP', name: 'Faculté des Sciences Juridiques et Politiques' }));
    expect(prisma.faculty.rows).toHaveLength(1);
    expect(prisma.program.rows.map((p) => p.name).sort()).toEqual(['Droit privé', 'Droit public']);
    expect(prisma.level.rows.map((l) => l.code)).toEqual(['L1', 'L2', 'L3', 'M1', 'M2']);
    expect(prisma.academicYear.rows).toEqual([expect.objectContaining({ label: '2026-2027', isCurrent: true, institutionId: inst.id })]);
    expect(prisma.group.rows).toHaveLength(2 * 5 * 2);
    expect([...new Set(prisma.group.rows.map((g) => g.name))].sort()).toEqual(['A', 'B']);
    // Tout est rattaché à la même institution, noms arabes compris.
    for (const rows of [prisma.faculty.rows, prisma.program.rows, prisma.level.rows, prisma.group.rows]) expect(rows.every((r) => r.institutionId === inst.id)).toBe(true);
    expect(prisma.program.rows.every((p) => !!p.nameAr)).toBe(true);
  });

  it('crée un SUPER_ADMIN, un VERIFICATION_OFFICER et un INSTITUTION_ADMIN de test, aux bonnes portées', async () => {
    const { prisma, deps } = make();
    await runSeed(deps, env);
    const grant = (email: string) => prisma.roleAssignments.filter((r) => r.userId === prisma.users.find((u) => u.email === email)!.id);
    expect(grant('admin@example.test')).toEqual([expect.objectContaining({ role: Role.SUPER_ADMIN, institutionId: null })]);
    expect(grant('verificateur@example.test')).toEqual([expect.objectContaining({ role: Role.VERIFICATION_OFFICER, institutionId: prisma.institutions[0].id })]);
    expect(grant('admin-institution@example.test')).toEqual([expect.objectContaining({ role: Role.INSTITUTION_ADMIN, institutionId: prisma.institutions[0].id })]);
    // 2FA à configurer à la première connexion (D-15) : aucun compte de seed n'a de 2FA ni de secret.
    expect(prisma.users.every((u) => u.twoFactorEnabled === false && u.twoFactorSecretEnc === null)).toBe(true);
  });

  it('est idempotent : relancé, ne crée rien de plus et ne change aucun mot de passe', async () => {
    const { prisma, audit, hashPassword, deps } = make();
    const first = await runSeed(deps, env);
    expect(first).toEqual({ institutionCreated: true, adminCreated: true, roleCreated: true, structureCreated: 1 + 2 + 5 + 1 + 20, officerCreated: true, institutionAdminCreated: true });
    const counts = () => [prisma.institutions.length, prisma.users.length, prisma.roleAssignments.length, prisma.faculty.rows.length, prisma.program.rows.length, prisma.level.rows.length, prisma.academicYear.rows.length, prisma.group.rows.length];
    const before = counts();

    const second = await runSeed(deps, { ...env, SEED_ADMIN_PASSWORD: 'un-autre-mot-de-passe', SEED_OFFICER_PASSWORD: 'autre-mot-de-passe-vf' });
    expect(second).toEqual({ institutionCreated: false, adminCreated: false, roleCreated: false, structureCreated: 0, officerCreated: false, institutionAdminCreated: false });
    expect(counts()).toEqual(before);
    expect(prisma.users.find((u) => u.email === 'admin@example.test')!.passwordHash).toBe('hash(un-mot-de-passe-de-seed)');
    expect(hashPassword).toHaveBeenCalledTimes(3);
    expect(prisma.auditLogs).toHaveLength(1); // seule la première exécution est auditée
    expect(await audit.verifyChain()).toEqual({ valid: true, checked: 1 });
  });

  it('ne retire pas l’année courante choisie par l’administrateur d’institution', async () => {
    const { prisma, deps } = make();
    await runSeed(deps, env);
    await prisma.academicYear.create({ data: { institutionId: prisma.institutions[0].id, label: '2027-2028', startsOn: new Date('2027-09-01'), endsOn: new Date('2028-07-01'), isCurrent: false } });
    prisma.academicYear.rows.find((y) => y.label === '2026-2027')!.isCurrent = false;
    prisma.academicYear.rows.find((y) => y.label === '2027-2028')!.isCurrent = true;
    await runSeed(deps, env);
    expect(prisma.academicYear.rows.filter((y) => y.isCurrent).map((y) => y.label)).toEqual(['2027-2028']);
  });

  it('répare un SUPER_ADMIN dont le rôle a été retiré, sans recréer le compte', async () => {
    const { prisma, deps } = make();
    await runSeed(deps, env);
    prisma.roleAssignments.find((r) => r.role === Role.SUPER_ADMIN)!.revokedAt = new Date();
    expect(await runSeed(deps, env)).toEqual(expect.objectContaining({ adminCreated: false, roleCreated: true }));
    expect(prisma.users.filter((u) => u.email === 'admin@example.test')).toHaveLength(1);
  });
});
