import { ConfigService } from '@nestjs/config';
import { AuditResult, Prisma, PrismaClient } from '@prisma/client';
import { AuditService } from '../../src/audit/audit.service';
import type { PrismaService } from '../../src/prisma/prisma.service';

// La chaîne d'audit sous vraie concurrence MySQL : c'est ce test (sur une vraie base) qui a révélé qu'un verrou GET_LOCK
// relâché avant le commit faisait bifurquer la chaîne (D-19).
describe('Chaîne d’audit sur la vraie base', () => {
  const prisma = new PrismaClient();
  const audit = new AuditService(prisma as unknown as PrismaService, new ConfigService({ AUDIT_IP_SALT: 'sel-de-test-sel-de-test' }));
  afterAll(() => prisma.$disconnect());

  const entry = (n: number) => ({
    action: 'DB_TEST',
    resourceType: 'test',
    resourceId: `r-${n}`,
    result: AuditResult.SUCCESS,
    ip: '203.0.113.9',
    metadata: { n, b: 'x', a: { z: 1, y: [1, 2] } },
  });

  it('40 écritures simultanées : aucune bifurcation, chaîne intègre, clés JSON réordonnées par MySQL sans effet', async () => {
    const before = await prisma.auditLog.count();
    await Promise.all(Array.from({ length: 40 }, (_, i) => audit.record(entry(i))));
    expect(await prisma.auditLog.count()).toBe(before + 40);

    const rows = await prisma.auditLog.findMany({ select: { prevHash: true } });
    expect(new Set(rows.map((r) => r.prevHash)).size).toBe(rows.length); // prevHash tous distincts
    expect(rows.every((r) => typeof r.prevHash === 'string' && r.prevHash.length === 64)).toBe(true); // jamais NULL

    const result = await audit.verifyChain(25);
    expect(result.valid).toBe(true);
    expect(result.checked).toBe(before + 40);
  });

  it('l’index unique sur prevHash refuse une seconde ligne au même emplacement', async () => {
    const last = await prisma.auditLog.findFirstOrThrow({ orderBy: { id: 'desc' } });
    const dup = prisma.auditLog.create({
      data: { action: 'FORK', resourceType: 'test', result: AuditResult.SUCCESS, prevHash: last.prevHash, hash: 'f'.repeat(64) },
    });
    await expect(dup).rejects.toMatchObject({ code: 'P2002' } satisfies Partial<Prisma.PrismaClientKnownRequestError>);
  });

  it('app_runtime ne peut ni modifier ni supprimer une ligne du journal', async () => {
    const first = await prisma.auditLog.findFirstOrThrow({ orderBy: { id: 'asc' } });
    await expect(prisma.$executeRaw`UPDATE audit_logs SET action = 'X' WHERE id = ${first.id}`).rejects.toThrow(/denied/i);
    await expect(prisma.$executeRaw`DELETE FROM audit_logs WHERE id = ${first.id}`).rejects.toThrow(/denied/i);
  });
});
