import { AuditResult, Role } from '@prisma/client';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Données de DÉVELOPPEMENT. Jamais en production : le seed crée des comptes privilégiés à partir de mots de passe
 * fournis par l'environnement, et refuse de tourner si NODE_ENV=production.
 */
export const SEED_INSTITUTION = { code: 'FSJP', name: 'Faculté des Sciences Juridiques et Politiques', nameAr: 'كلية العلوم القانونية والسياسية' };
export const SEED_FACULTY = { code: 'FSJP', name: SEED_INSTITUTION.name, nameAr: SEED_INSTITUTION.nameAr };
export const SEED_PROGRAMS = [
  { code: 'DP', name: 'Droit privé', nameAr: 'القانون الخاص' },
  { code: 'DPU', name: 'Droit public', nameAr: 'القانون العام' },
];
export const SEED_LEVELS = [
  { code: 'L1', name: 'Licence 1', nameAr: 'السنة الأولى ليسانس', rank: 1 },
  { code: 'L2', name: 'Licence 2', nameAr: 'السنة الثانية ليسانس', rank: 2 },
  { code: 'L3', name: 'Licence 3', nameAr: 'السنة الثالثة ليسانس', rank: 3 },
  { code: 'M1', name: 'Master 1', nameAr: 'السنة الأولى ماستر', rank: 4 },
  { code: 'M2', name: 'Master 2', nameAr: 'السنة الثانية ماستر', rank: 5 },
];
export const SEED_YEAR = { label: '2026-2027', startsOn: new Date('2026-09-01'), endsOn: new Date('2027-07-15') };
export const SEED_GROUPS = ['A', 'B'];
export const SEED_PASSWORD_MIN = 10;

export class SeedRefusedError extends Error {}

export interface SeedAccount {
  email: string;
  password: string;
}

export interface SeedConfig {
  admin: SeedAccount;
  /** Créés seulement si leur mot de passe est fourni. */
  officer?: SeedAccount;
  institutionAdmin?: SeedAccount;
}

function account(env: Record<string, string | undefined>, emailKey: string, passwordKey: string, defaultEmail: string): SeedAccount | undefined {
  const password = env[passwordKey];
  if (!password) return undefined;
  if (password.length < SEED_PASSWORD_MIN) throw new SeedRefusedError(`Seed refusé : ${passwordKey} (${SEED_PASSWORD_MIN} caractères minimum).`);
  return { email: (env[emailKey] ?? defaultEmail).trim().toLowerCase(), password };
}

/** Le seed refuse de tourner en production, ou sans mot de passe fourni pour le SUPER_ADMIN. */
export function assertSeedAllowed(env: Record<string, string | undefined>): SeedConfig & { email: string; password: string } {
  if (env.NODE_ENV === 'production') throw new SeedRefusedError('Seed refusé : NODE_ENV=production.');
  const admin = account(env, 'SEED_ADMIN_EMAIL', 'SEED_ADMIN_PASSWORD', 'admin@example.test');
  if (!admin) throw new SeedRefusedError(`Seed refusé : SEED_ADMIN_PASSWORD (${SEED_PASSWORD_MIN} caractères minimum) est requis.`);
  return {
    admin,
    officer: account(env, 'SEED_OFFICER_EMAIL', 'SEED_OFFICER_PASSWORD', 'verificateur@example.test'),
    institutionAdmin: account(env, 'SEED_INSTITUTION_ADMIN_EMAIL', 'SEED_INSTITUTION_ADMIN_PASSWORD', 'admin-institution@example.test'),
    ...admin,
  };
}

export interface SeedResult {
  institutionCreated: boolean;
  adminCreated: boolean;
  roleCreated: boolean;
  structureCreated: number;
  officerCreated: boolean;
  institutionAdminCreated: boolean;
}

/** Idempotent : relancé, il ne crée rien de plus et ne change jamais un mot de passe existant. */
export async function runSeed(
  deps: { prisma: PrismaService; audit: AuditService; hashPassword: (p: string) => Promise<string> },
  env: Record<string, string | undefined>,
): Promise<SeedResult> {
  const config = assertSeedAllowed(env);
  const { prisma, audit } = deps;

  // ---- institution et structure académique de démonstration (FSJP) ----------------------------------
  let created = 0;
  const ensure = async <T extends { id: string }>(find: () => Promise<T | null>, create: () => Promise<T>): Promise<T> => {
    const found = await find();
    if (found) return found;
    created++;
    return create();
  };

  const existingInstitution = await prisma.institution.findUnique({ where: { code: SEED_INSTITUTION.code }, select: { id: true } });
  const institution = existingInstitution ?? (await prisma.institution.create({ data: SEED_INSTITUTION, select: { id: true } }));
  const institutionId = institution.id;

  const faculty = await ensure(
    () => prisma.faculty.findFirst({ where: { institutionId, code: SEED_FACULTY.code } }),
    () => prisma.faculty.create({ data: { ...SEED_FACULTY, institutionId } }),
  );
  const programs = [];
  for (const p of SEED_PROGRAMS) {
    programs.push(
      await ensure(
        () => prisma.program.findFirst({ where: { institutionId, code: p.code } }),
        () => prisma.program.create({ data: { ...p, institutionId, facultyId: faculty.id } }),
      ),
    );
  }
  const levels = [];
  for (const l of SEED_LEVELS) {
    levels.push(
      await ensure(
        () => prisma.level.findFirst({ where: { institutionId, code: l.code } }),
        () => prisma.level.create({ data: { ...l, institutionId } }),
      ),
    );
  }
  const hasCurrent = await prisma.academicYear.findFirst({ where: { institutionId, isCurrent: true } });
  const year = await ensure(
    () => prisma.academicYear.findFirst({ where: { institutionId, label: SEED_YEAR.label } }),
    () => prisma.academicYear.create({ data: { ...SEED_YEAR, institutionId, isCurrent: !hasCurrent } }), // ne retire jamais l'année courante choisie ailleurs
  );
  for (const program of programs) {
    for (const level of levels) {
      for (const name of SEED_GROUPS) {
        await ensure(
          () => prisma.group.findFirst({ where: { programId: program.id, levelId: level.id, academicYearId: year.id, name } }),
          () => prisma.group.create({ data: { institutionId, programId: program.id, levelId: level.id, academicYearId: year.id, name } }),
        );
      }
    }
  }

  // ---- comptes ------------------------------------------------------------------------------------
  const ensureUser = async (acc: SeedAccount): Promise<{ id: string; created: boolean }> => {
    const found = await prisma.user.findUnique({ where: { email: acc.email }, select: { id: true } });
    if (found) return { id: found.id, created: false };
    const user = await prisma.user.create({ data: { email: acc.email, passwordHash: await deps.hashPassword(acc.password) }, select: { id: true } });
    return { id: user.id, created: true };
  };
  const ensureRole = async (userId: string, role: Role, roleInstitutionId: string | null): Promise<boolean> => {
    const grant = await prisma.roleAssignment.findFirst({ where: { userId, role, institutionId: roleInstitutionId, revokedAt: null }, select: { id: true } });
    if (grant) return false;
    await prisma.roleAssignment.create({ data: { userId, role, institutionId: roleInstitutionId } });
    return true;
  };

  const admin = await ensureUser(config.admin);
  const roleCreated = await ensureRole(admin.id, Role.SUPER_ADMIN, null);
  let officerCreated = false;
  let institutionAdminCreated = false;
  if (config.officer) {
    const officer = await ensureUser(config.officer);
    officerCreated = officer.created;
    officerCreated = (await ensureRole(officer.id, Role.VERIFICATION_OFFICER, institutionId)) || officerCreated;
  }
  if (config.institutionAdmin) {
    const ia = await ensureUser(config.institutionAdmin);
    institutionAdminCreated = ia.created;
    institutionAdminCreated = (await ensureRole(ia.id, Role.INSTITUTION_ADMIN, institutionId)) || institutionAdminCreated;
  }

  const result: SeedResult = {
    institutionCreated: !existingInstitution,
    adminCreated: admin.created,
    roleCreated,
    structureCreated: created,
    officerCreated,
    institutionAdminCreated,
  };
  if (result.institutionCreated || result.adminCreated || result.roleCreated || created > 0 || officerCreated || institutionAdminCreated) {
    await audit.record({
      actorId: null,
      action: 'SEED',
      resourceType: 'platform',
      result: AuditResult.SUCCESS,
      metadata: { ...result, institutionCode: SEED_INSTITUTION.code },
    });
  }
  return result;
}
