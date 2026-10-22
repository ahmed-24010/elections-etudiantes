import { AuditResult, ElectionStatus, EnrollmentStatus, Role } from '@prisma/client';
import { SecretCipher } from '../common/crypto/secret-cipher';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import { assertSeedAllowed, runSeed, SEED_ELECTION, SEED_INSTITUTION, SEED_PASSWORD_MIN, SeedRefusedError } from './seed';

/**
 * Seed de DÉMONSTRATION (`npm run seed:demo`) : de quoi dérouler tout le Sprint 4 sans rien saisir.
 * Jamais en production. Mot de passe et clé 2FA viennent de l'environnement, jamais du code.
 */
const DOMAIN = 'example.test';
/** Le seed de base a créé ces lignes juste avant : leur absence est une anomalie. */
function must<T>(row: T | null, what: string): T {
  if (!row) throw new Error(`Seed de démonstration : ${what} introuvable (le seed de base a-t-il échoué ?).`);
  return row;
}
const DAY = 24 * 60 * 60 * 1000;

interface DemoStudent {
  email: string;
  firstName: string;
  lastName: string;
  fullNameAr: string;
  studentNumber: string;
  program: string; // code de filière
  group: string;
}
export const DEMO_STUDENTS: DemoStudent[] = [
  { email: `aicha@${DOMAIN}`, firstName: 'Aïcha', lastName: 'Démo', fullNameAr: 'عائشة', studentNumber: 'DEMO-0001', program: 'DPU', group: 'A' },
  { email: `omar@${DOMAIN}`, firstName: 'Omar', lastName: 'Démo', fullNameAr: 'عمر', studentNumber: 'DEMO-0002', program: 'DPU', group: 'A' },
  // Mariam et Yacoub : éligibles à l'élection de démo (même filière, même niveau, même groupe que Aïcha et Omar). À quatre électeurs,
  // le scénario « égalité → second tour » est possible (2 voix contre 2) et le détail des voix est publié (3 votants au moins, D-32).
  { email: `mariam@${DOMAIN}`, firstName: 'Mariam', lastName: 'Démo', fullNameAr: 'مريم', studentNumber: 'DEMO-0004', program: 'DPU', group: 'A' },
  { email: `yacoub@${DOMAIN}`, firstName: 'Yacoub', lastName: 'Démo', fullNameAr: 'يعقوب', studentNumber: 'DEMO-0005', program: 'DPU', group: 'A' },
  { email: `sara@${DOMAIN}`, firstName: 'Sara', lastName: 'Démo', fullNameAr: 'سارة', studentNumber: 'DEMO-0003', program: 'DP', group: 'A' },
];
export const DEMO_COMMITTEE = [1, 2, 3].map((n) => `comite${n}@${DOMAIN}`);
const DEMO_LEVEL = 'L3';
const BASE32 = /^[A-Z2-7]{16,}$/;

export interface DemoAccount {
  email: string;
  role: string;
  twoFactor: boolean;
}

export interface DemoSeedResult {
  accounts: DemoAccount[];
  electionStatus: ElectionStatus;
}

export function assertDemoSeedAllowed(env: Record<string, string | undefined>): { password: string; totpSecret: string; encryptionKey: string } {
  if (env.NODE_ENV === 'production') throw new SeedRefusedError('Seed de démonstration refusé : NODE_ENV=production.');
  const password = env.SEED_DEMO_PASSWORD;
  if (!password || password.length < SEED_PASSWORD_MIN) {
    throw new SeedRefusedError(`Seed de démonstration refusé : SEED_DEMO_PASSWORD (${SEED_PASSWORD_MIN} caractères minimum) est requis.`);
  }
  const totpSecret = (env.SEED_DEMO_TOTP_SECRET ?? '').replace(/\s+/g, '').toUpperCase();
  if (!BASE32.test(totpSecret)) {
    throw new SeedRefusedError('Seed de démonstration refusé : SEED_DEMO_TOTP_SECRET (clé de dev en base32 : lettres A-Z et chiffres 2-7, 16 caractères minimum) est requis.');
  }
  const encryptionKey = env.TWO_FACTOR_ENCRYPTION_KEY;
  if (!encryptionKey) throw new SeedRefusedError('Seed de démonstration refusé : TWO_FACTOR_ENCRYPTION_KEY est requis (chiffrement du secret 2FA).');
  return { password, totpSecret, encryptionKey };
}

/** Idempotent : relancé, il remet seulement les dates autour d'aujourd'hui (tant que l'élection n'a pas dépassé les candidatures). */
export async function runDemoSeed(
  deps: { prisma: PrismaService; audit: AuditService; hashPassword: (p: string) => Promise<string> },
  env: Record<string, string | undefined>,
  now: Date = new Date(),
): Promise<DemoSeedResult> {
  const { password, totpSecret, encryptionKey } = assertDemoSeedAllowed(env);
  const { prisma, audit } = deps;
  const secretEnc = new SecretCipher(encryptionKey).encrypt(totpSecret);

  // Même mot de passe pour tous : les comptes du seed de base (admin, vérificateur, admin d'institution) le reprennent s'ils n'en ont pas.
  const base = assertSeedAllowed({
    ...env,
    SEED_ADMIN_PASSWORD: env.SEED_ADMIN_PASSWORD || password,
    SEED_OFFICER_PASSWORD: env.SEED_OFFICER_PASSWORD || password,
    SEED_INSTITUTION_ADMIN_PASSWORD: env.SEED_INSTITUTION_ADMIN_PASSWORD || password,
  });
  const baseEnv = { ...env, SEED_ADMIN_PASSWORD: base.admin.password, SEED_OFFICER_PASSWORD: base.officer?.password, SEED_INSTITUTION_ADMIN_PASSWORD: base.institutionAdmin?.password };
  await runSeed(deps, baseEnv);

  const institution = must(await prisma.institution.findUnique({ where: { code: SEED_INSTITUTION.code }, select: { id: true } }), 'institution');
  const institutionId = institution.id;
  const year = must(await prisma.academicYear.findFirst({ where: { institutionId, isCurrent: true } }), 'year');
  const faculty = must(await prisma.faculty.findFirst({ where: { institutionId } }), 'faculty');
  const level = must(await prisma.level.findFirst({ where: { institutionId, code: DEMO_LEVEL } }), 'level');

  const accounts: DemoAccount[] = [];
  // 2FA pré-configurée sur les comptes de gestion (étudiants : pas de 2FA).
  const ensureUser = async (email: string, withTwoFactor: boolean): Promise<string> => {
    const twoFactor = withTwoFactor ? { twoFactorEnabled: true, twoFactorSecretEnc: secretEnc } : {};
    const found = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (found) {
      if (withTwoFactor) await prisma.user.update({ where: { id: found.id }, data: twoFactor });
      return found.id;
    }
    const user = await prisma.user.create({ data: { email, passwordHash: await deps.hashPassword(password), ...twoFactor }, select: { id: true } });
    return user.id;
  };
  const ensureRole = async (userId: string, role: Role, electionId: string | null) => {
    const grant = await prisma.roleAssignment.findFirst({ where: { userId, role, institutionId, electionId, revokedAt: null }, select: { id: true } });
    if (!grant) await prisma.roleAssignment.create({ data: { userId, role, institutionId, electionId } });
  };

  // ---- comptes de gestion du seed de base : on leur pose la 2FA -----------------------------------------
  const staff: [string | undefined, string][] = [
    [base.admin.email, 'SUPER_ADMIN'],
    [base.officer?.email, 'VERIFICATION_OFFICER'],
    [base.institutionAdmin?.email, 'INSTITUTION_ADMIN'],
  ];
  for (const [email, role] of staff) {
    if (!email) continue;
    await ensureUser(email, true);
    accounts.push({ email, role, twoFactor: true });
  }

  // ---- élection de démo : candidatures ouvertes, dates autour d'aujourd'hui -------------------------------
  const election = must(await prisma.election.findFirst({ where: { institutionId, title: SEED_ELECTION.title } }), 'election');
  const at = (days: number) => new Date(now.getTime() + days * DAY);
  const adjustable = election.status === ElectionStatus.DRAFT || election.status === ElectionStatus.CANDIDACY_OPEN;
  if (adjustable) {
    await prisma.election.update({
      where: { id: election.id },
      data: {
        status: ElectionStatus.CANDIDACY_OPEN,
        candidacyStartsAt: at(-1),
        candidacyEndsAt: at(7),
        votingStartsAt: at(9),
        votingEndsAt: at(11),
      },
    });
  }

  // ---- comité ---------------------------------------------------------------------------------------
  for (const email of DEMO_COMMITTEE) {
    const id = await ensureUser(email, true);
    await ensureRole(id, Role.ELECTION_COMMITTEE, election.id);
    accounts.push({ email, role: 'ELECTION_COMMITTEE', twoFactor: true });
  }

  // ---- étudiants, inscriptions déjà VERIFIED -----------------------------------------------------------
  for (const s of DEMO_STUDENTS) {
    const userId = await ensureUser(s.email, false);
    await ensureRole(userId, Role.STUDENT, null);
    const program = must(await prisma.program.findFirst({ where: { institutionId, code: s.program } }), 'program');
    const group = must(await prisma.group.findFirst({ where: { programId: program.id, levelId: level.id, academicYearId: year.id, name: s.group } }), 'group');
    let student = await prisma.student.findUnique({ where: { userId }, select: { id: true } });
    if (!student) {
      student = await prisma.student.create({
        data: { userId, institutionId, studentNumber: s.studentNumber, numberClaimedAt: now, firstName: s.firstName, lastName: s.lastName, fullNameAr: s.fullNameAr },
        select: { id: true },
      });
    }
    const enrollment = await prisma.studentEnrollment.findFirst({ where: { studentId: student.id, academicYearId: year.id }, select: { id: true } });
    const placement = { institutionId, facultyId: faculty.id, programId: program.id, levelId: level.id, groupId: group.id };
    if (!enrollment) {
      await prisma.studentEnrollment.create({ data: { studentId: student.id, academicYearId: year.id, ...placement, status: EnrollmentStatus.VERIFIED, reviewedAt: now } });
    } else {
      await prisma.studentEnrollment.update({ where: { id: enrollment.id }, data: { ...placement, status: EnrollmentStatus.VERIFIED } });
    }
    accounts.push({ email: s.email, role: `STUDENT (${s.program} ${DEMO_LEVEL} groupe ${s.group})`, twoFactor: false });
  }

  await audit.record({ actorId: null, action: 'SEED_DEMO', resourceType: 'platform', result: AuditResult.SUCCESS, metadata: { institutionCode: SEED_INSTITUTION.code, accounts: accounts.length } });
  return { accounts, electionStatus: adjustable ? ElectionStatus.CANDIDACY_OPEN : (election.status as ElectionStatus) };
}
