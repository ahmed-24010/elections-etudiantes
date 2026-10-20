import { Role } from '@prisma/client';
import { randomBytes } from 'crypto';
import { FakePrisma } from '../../test/fake-prisma';
import { AuditService } from '../audit/audit.service';
import { assertDemoSeedAllowed, DEMO_COMMITTEE, DEMO_STUDENTS, runDemoSeed } from './seed-demo';
import { SeedRefusedError } from './seed';

const env = {
  NODE_ENV: 'development',
  SEED_DEMO_PASSWORD: 'mot-de-passe-de-demo',
  SEED_DEMO_TOTP_SECRET: 'JBSWY3DPEHPK3PXP',
  TWO_FACTOR_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
};

const make = () => {
  const prisma = new FakePrisma();
  const audit = new AuditService(prisma as any, { getOrThrow: () => 'sel-de-test-sel-de-test' } as any);
  return { prisma, deps: { prisma: prisma as any, audit, hashPassword: async (p: string) => `hash(${p})` } };
};

describe('seed de démonstration', () => {
  it('refuse la production, un mot de passe court, une clé 2FA absente ou invalide', () => {
    expect(() => assertDemoSeedAllowed({ ...env, NODE_ENV: 'production' })).toThrow(SeedRefusedError);
    expect(() => assertDemoSeedAllowed({ ...env, SEED_DEMO_PASSWORD: 'court' })).toThrow(/SEED_DEMO_PASSWORD/);
    expect(() => assertDemoSeedAllowed({ ...env, SEED_DEMO_TOTP_SECRET: undefined })).toThrow(/SEED_DEMO_TOTP_SECRET/);
    expect(() => assertDemoSeedAllowed({ ...env, SEED_DEMO_TOTP_SECRET: 'pas base 32 !' })).toThrow(/SEED_DEMO_TOTP_SECRET/);
    expect(() => assertDemoSeedAllowed({ ...env, TWO_FACTOR_ENCRYPTION_KEY: undefined })).toThrow(/TWO_FACTOR_ENCRYPTION_KEY/);
    expect(assertDemoSeedAllowed(env).password).toBe(env.SEED_DEMO_PASSWORD);
  });

  it('crée comptes, comité de 3 et élection CANDIDACY_OPEN autour de maintenant, sans le secret 2FA en clair', async () => {
    const { prisma, deps } = make();
    const now = new Date('2026-10-14T10:00:00Z');
    const res = await runDemoSeed(deps, env, now);

    const election = prisma.elections[0];
    expect(election.status).toBe('CANDIDACY_OPEN');
    expect(election.candidacyStartsAt.getTime()).toBeLessThan(now.getTime());
    expect(election.candidacyEndsAt.getTime()).toBeGreaterThan(now.getTime());

    const committee = prisma.roleAssignments.filter((r) => r.role === Role.ELECTION_COMMITTEE && r.electionId === election.id);
    expect(committee).toHaveLength(DEMO_COMMITTEE.length);

    for (const s of DEMO_STUDENTS) expect(res.accounts.map((a) => a.email)).toContain(s.email);
    const comite = prisma.users.find((u) => u.email === DEMO_COMMITTEE[0])!;
    expect(comite.twoFactorEnabled).toBe(true);
    expect(comite.twoFactorSecretEnc).toMatch(/^v1\./);
    expect(comite.twoFactorSecretEnc).not.toContain(env.SEED_DEMO_TOTP_SECRET);
    expect(prisma.users.find((u) => u.email === 'aicha@example.test')!.twoFactorEnabled).toBeFalsy();
  });

  it('Mariam et Yacoub sont éligibles comme Aïcha et Omar : même filière, même niveau, même groupe, inscriptions vérifiées', async () => {
    const { prisma, deps } = make();
    const res = await runDemoSeed(deps, env);
    const eligible = DEMO_STUDENTS.filter((s) => s.program === 'DPU' && s.group === 'A').map((s) => s.email);
    expect(eligible).toEqual(['aicha@example.test', 'omar@example.test', 'mariam@example.test', 'yacoub@example.test']);
    for (const email of ['mariam@example.test', 'yacoub@example.test']) expect(res.accounts.map((a) => a.email)).toContain(email);
    const placements = prisma.studentEnrollment.rows.filter((e) => e.status === 'VERIFIED');
    expect(new Set(placements.map((e) => `${e.programId}|${e.levelId}|${e.groupId}`)).size).toBeLessThanOrEqual(2); // DPU/A (4) et DP/A (Sara)
    expect(placements).toHaveLength(DEMO_STUDENTS.length);
  });

  it('est idempotent', async () => {
    const { prisma, deps } = make();
    await runDemoSeed(deps, env);
    const counts = () => [prisma.users.length, prisma.roleAssignments.length];
    const before = counts();
    await runDemoSeed(deps, env);
    expect(counts()).toEqual(before);
  });
});
