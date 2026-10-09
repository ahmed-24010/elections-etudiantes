import { AuditResult, Prisma, Role } from '@prisma/client';
import { FakePrisma } from '../../test/fake-prisma';
import { AuditService, canonicalJson, computeAuditHash, GENESIS_HASH } from './audit.service';

const make = () => {
  const prisma = new FakePrisma();
  const service = new AuditService(prisma as any, { getOrThrow: () => 'sel-secret-de-test' } as any);
  return { prisma, service };
};

const entry = (n: number) => ({
  actorId: `user-${n}`,
  actorRole: Role.INSTITUTION_ADMIN,
  institutionId: 'inst-1',
  action: 'ROLE_ASSIGNED',
  resourceType: 'role_assignment',
  resourceId: `r-${n}`,
  result: AuditResult.SUCCESS,
  ip: '203.0.113.7',
  requestId: `req-${n}`,
  metadata: { role: 'VERIFICATION_OFFICER', n },
});

describe('AuditService — chaîne de hachage (02 §9)', () => {
  it('canonicalJson trie les clés récursivement (MySQL réordonne les clés JSON)', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } })).toBe(canonicalJson({ a: { c: null, d: [3, { x: 2, y: 1 }] }, b: 1 }));
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it('chaque ligne contient hash = SHA-256(prevHash + contenu), la première part de 64 zéros', async () => {
    const { prisma, service } = make();
    await service.record(entry(1));
    await service.record(entry(2));
    const [a, b] = prisma.auditLogs;
    expect(a.prevHash).toBe(GENESIS_HASH);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(b.prevHash).toBe(a.hash);
    expect(b.hash).not.toBe(a.hash);
  });

  it('verifyChain : chaîne intacte, y compris sur plusieurs lots', async () => {
    const { service } = make();
    for (let i = 0; i < 12; i++) await service.record(entry(i));
    expect(await service.verifyChain(5)).toEqual({ valid: true, checked: 12 });
    expect(await new AuditService(new FakePrisma() as any, { getOrThrow: () => 's' } as any).verifyChain()).toEqual({ valid: true, checked: 0 });
  });

  it('verifyChain détecte une ligne MODIFIÉE', async () => {
    const { prisma, service } = make();
    for (let i = 0; i < 6; i++) await service.record(entry(i));
    prisma.auditLogs[3].action = 'ELECTION_OPENED';
    const res = await service.verifyChain();
    expect(res).toEqual({ valid: false, checked: 3, brokenAtId: String(prisma.auditLogs[3].id) });
  });

  it('verifyChain détecte une métadonnée modifiée, un résultat modifié et un acteur modifié', async () => {
    for (const mutate of [
      (r: any) => (r.metadata = { role: 'INSTITUTION_ADMIN', n: 2 }),
      (r: any) => (r.result = AuditResult.FAILURE),
      (r: any) => (r.actorId = 'someone-else'),
      (r: any) => (r.createdAt = new Date(r.createdAt.getTime() + 1)),
    ]) {
      const { prisma, service } = make();
      for (let i = 0; i < 4; i++) await service.record(entry(i));
      mutate(prisma.auditLogs[2]);
      expect((await service.verifyChain()).valid).toBe(false);
    }
  });

  it('verifyChain détecte une ligne SUPPRIMÉE au milieu, et une insertion forgée', async () => {
    const { prisma, service } = make();
    for (let i = 0; i < 6; i++) await service.record(entry(i));
    const removed = prisma.auditLogs.splice(2, 1)[0];
    const res = await service.verifyChain();
    expect(res.valid).toBe(false);
    expect(res.brokenAtId).toBe(String(prisma.auditLogs[2].id));
    expect(removed).toBeDefined();

    const { prisma: p2, service: s2 } = make();
    for (let i = 0; i < 3; i++) await s2.record(entry(i));
    const forged = { ...p2.auditLogs[1], id: 99n, action: 'FORGED' };
    p2.auditLogs.splice(2, 0, forged);
    expect((await s2.verifyChain()).valid).toBe(false);
  });

  it('survit aux clés JSON réordonnées par la base', async () => {
    const { prisma, service } = make();
    await service.record(entry(1));
    const row = prisma.auditLogs[0];
    row.metadata = Object.fromEntries(Object.entries(row.metadata).reverse());
    expect((await service.verifyChain()).valid).toBe(true);
  });

  it('écritures concurrentes : la collision sur prevHash est réessayée, la chaîne reste linéaire', async () => {
    const { prisma, service } = make();
    await Promise.all(Array.from({ length: 25 }, (_, i) => service.record(entry(i))));
    expect(prisma.auditLogs).toHaveLength(25);
    expect(new Set(prisma.auditLogs.map((r) => r.prevHash)).size).toBe(25); // aucune bifurcation
    expect(await service.verifyChain(4)).toEqual({ valid: true, checked: 25 });
  });

  it('une erreur autre qu’une collision est propagée telle quelle', async () => {
    const { prisma, service } = make();
    prisma.auditLog.create = async () => {
      throw new Error('base indisponible');
    };
    await expect(service.record(entry(1))).rejects.toThrow('base indisponible');
  });

  it('abandonne après trop de collisions au lieu de boucler', async () => {
    const { prisma, service } = make();
    prisma.auditLog.create = async () => {
      throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
    };
    await expect(service.record(entry(1))).rejects.toThrow();
  }, 30_000);

  it('l’IP est hachée avec un sel (HMAC), jamais stockée en clair, et reste comparable', async () => {
    const { prisma, service } = make();
    await service.record(entry(1));
    await service.record(entry(2));
    const [a, b] = prisma.auditLogs;
    expect(a.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.ipHash).toBe(b.ipHash);
    expect(JSON.stringify(prisma.auditLogs.map((r) => ({ ...r, id: String(r.id) })))).not.toContain('203.0.113.7');
    expect(a.ipHash).not.toBe(computeAuditHash('', {} as any)); // sanity
    const other = new AuditService(new FakePrisma() as any, { getOrThrow: () => 'autre-sel-de-test-xx' } as any);
    expect(other.hashIp('203.0.113.7')).not.toBe(a.ipHash);
    expect(service.hashIp(null)).toBeNull();
  });
});
