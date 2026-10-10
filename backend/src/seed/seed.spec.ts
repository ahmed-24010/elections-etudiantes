import { Role } from '@prisma/client';
import { FakePrisma } from '../../test/fake-prisma';
import { AuditService } from '../audit/audit.service';
import { assertSeedAllowed, runSeed, SeedRefusedError } from './seed';

const env = { NODE_ENV: 'development', SEED_ADMIN_PASSWORD: 'un-mot-de-passe-de-seed' };

describe('seed', () => {
  it('refuse de tourner en production', () => {
    expect(() => assertSeedAllowed({ ...env, NODE_ENV: 'production' })).toThrow(SeedRefusedError);
  });

  it('refuse sans SEED_ADMIN_PASSWORD ou avec un mot de passe trop court', () => {
    expect(() => assertSeedAllowed({ NODE_ENV: 'development' })).toThrow(/SEED_ADMIN_PASSWORD/);
    expect(() => assertSeedAllowed({ ...env, SEED_ADMIN_PASSWORD: 'court' })).toThrow(/SEED_ADMIN_PASSWORD/);
    expect(assertSeedAllowed(env).email).toBe('admin@example.test');
    expect(assertSeedAllowed({ ...env, SEED_ADMIN_EMAIL: ' Chef@Example.test ' }).email).toBe('chef@example.test');
  });

  it('est idempotent : relancé, ne crée rien de plus et ne change pas le mot de passe', async () => {
    const prisma = new FakePrisma();
    const audit = new AuditService(prisma as any, { getOrThrow: () => 'sel-de-test-sel-de-test' } as any);
    const hashPassword = jest.fn(async (p: string) => `hash(${p})`);
    const deps = { prisma: prisma as any, audit, hashPassword };

    expect(await runSeed(deps, env)).toEqual({ institutionCreated: true, adminCreated: true, roleCreated: true });
    expect(await runSeed(deps, { ...env, SEED_ADMIN_PASSWORD: 'un-autre-mot-de-passe' })).toEqual({
      institutionCreated: false, adminCreated: false, roleCreated: false,
    });

    expect(prisma.institutions).toHaveLength(1);
    expect(prisma.users).toHaveLength(1);
    expect(prisma.roleAssignments.filter((r) => r.role === Role.SUPER_ADMIN)).toHaveLength(1);
    expect(prisma.users[0].passwordHash).toBe('hash(un-mot-de-passe-de-seed)');
    expect(hashPassword).toHaveBeenCalledTimes(1);
    expect(prisma.auditLogs).toHaveLength(1); // seule la première exécution est auditée
    expect(await audit.verifyChain()).toEqual({ valid: true, checked: 1 });
  });

  it('répare un SUPER_ADMIN dont le rôle a été retiré, sans recréer le compte', async () => {
    const prisma = new FakePrisma();
    const audit = new AuditService(prisma as any, { getOrThrow: () => 'sel-de-test-sel-de-test' } as any);
    const deps = { prisma: prisma as any, audit, hashPassword: async (p: string) => p };
    await runSeed(deps, env);
    prisma.roleAssignments[0].revokedAt = new Date();
    expect(await runSeed(deps, env)).toEqual({ institutionCreated: false, adminCreated: false, roleCreated: true });
    expect(prisma.users).toHaveLength(1);
  });
});
