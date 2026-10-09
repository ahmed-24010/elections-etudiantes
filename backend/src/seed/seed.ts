import { AuditResult, Role } from '@prisma/client';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';

export const SEED_INSTITUTION = { code: 'DEMO', name: 'Institution de test' };
export const SEED_PASSWORD_MIN = 10;

export class SeedRefusedError extends Error {}

/** Le seed crée un SUPER_ADMIN : il ne doit jamais tourner en production, ni sans mot de passe fourni. */
export function assertSeedAllowed(env: Record<string, string | undefined>): { email: string; password: string } {
  if (env.NODE_ENV === 'production') throw new SeedRefusedError('Seed refusé : NODE_ENV=production.');
  const password = env.SEED_ADMIN_PASSWORD;
  if (!password || password.length < SEED_PASSWORD_MIN) {
    throw new SeedRefusedError(`Seed refusé : SEED_ADMIN_PASSWORD (${SEED_PASSWORD_MIN} caractères minimum) est requis.`);
  }
  return { email: (env.SEED_ADMIN_EMAIL ?? 'admin@example.test').trim().toLowerCase(), password };
}

/** Idempotent : relancé, il ne crée rien de plus et ne change jamais un mot de passe existant. */
export async function runSeed(
  deps: { prisma: PrismaService; audit: AuditService; hashPassword: (p: string) => Promise<string> },
  env: Record<string, string | undefined>,
): Promise<{ institutionCreated: boolean; adminCreated: boolean; roleCreated: boolean }> {
  const { email, password } = assertSeedAllowed(env);
  const { prisma, audit } = deps;

  const existingInstitution = await prisma.institution.findUnique({ where: { code: SEED_INSTITUTION.code }, select: { id: true } });
  if (!existingInstitution) await prisma.institution.create({ data: SEED_INSTITUTION });

  let admin = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  const adminCreated = !admin;
  if (!admin) {
    admin = await prisma.user.create({ data: { email, passwordHash: await deps.hashPassword(password) }, select: { id: true } });
  }
  const grant = await prisma.roleAssignment.findFirst({
    where: { userId: admin.id, role: Role.SUPER_ADMIN, revokedAt: null },
    select: { id: true },
  });
  const roleCreated = !grant;
  if (!grant) await prisma.roleAssignment.create({ data: { userId: admin.id, role: Role.SUPER_ADMIN } });

  if (adminCreated || roleCreated || !existingInstitution) {
    await audit.record({
      actorId: null,
      action: 'SEED',
      resourceType: 'platform',
      result: AuditResult.SUCCESS,
      metadata: { institutionCode: SEED_INSTITUTION.code, adminCreated, roleCreated, institutionCreated: !existingInstitution },
    });
  }
  return { institutionCreated: !existingInstitution, adminCreated, roleCreated };
}
