import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { MemoryStorageService } from '../../src/storage/memory-storage.service';
import { StorageService } from '../../src/storage/storage.service';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

// Sprint 4 contre la VRAIE base : requête d'éligibilité (OU / ET) réellement exécutée par MySQL, unicité
// (electionId, studentId) sous concurrence (D-05), niveaux autorisés par filière (D-24), droits sur les nouvelles tables.
describe('Élections, éligibilité et candidatures sur la vraie base MySQL', () => {
  const run = Math.random().toString(36).slice(2, 8);
  const prisma = new PrismaClient();
  let app: NestExpressApplication;
  let jwt: JwtService;
  let n = 0;
  let instId: string;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const studentIds: Record<string, string> = {};
  let facultyId: string;
  let dp: string;
  let dpu: string;
  let l1: string;
  let l3: string;
  let yearId: string;
  let group1: string;
  let electionId: string;
  let positionId: string;

  const api = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, token?: string) => {
    const r = request(app.getHttpServer())[method](`/api/v1${path}`).set('x-forwarded-for', `10.9.${Math.floor(++n / 250)}.${n % 250}`).set('x-requested-with', 'XMLHttpRequest');
    return token ? r.set('authorization', `Bearer ${token}`) : r;
  };

  async function makeUser(name: string, role: Role, extra: { eligible?: { program: string; level: string; group?: string } } = {}) {
    const admin = role !== Role.STUDENT;
    const user = await prisma.user.create({
      data: { email: `${name}-${run}@example.test`, passwordHash: await argon2.hash('Un-mot-de-passe-solide-1'), twoFactorEnabled: admin, roles: { create: { role, institutionId: instId } } },
    });
    const familyId = randomUUID();
    await prisma.refreshToken.create({
      data: { userId: user.id, familyId, tokenHash: createHash('sha256').update(randomBytes(16)).digest('hex'), expiresAt: new Date(Date.now() + 86_400_000), twoFactorVerifiedAt: admin ? new Date() : null },
    });
    ids[name] = user.id;
    tokens[name] = jwt.sign({ sub: user.id, sid: familyId, typ: 'access' }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '15m' });
    if (extra.eligible) {
      const student = await prisma.student.create({ data: { userId: user.id, institutionId: instId, studentNumber: `${name}-${run}`, firstName: name, lastName: 'Test' } });
      studentIds[name] = student.id;
      await prisma.studentEnrollment.create({
        data: { studentId: student.id, institutionId: instId, academicYearId: yearId, facultyId, programId: extra.eligible.program, levelId: extra.eligible.level, groupId: extra.eligible.group ?? null, status: 'VERIFIED' },
      });
    }
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(StorageService).useClass(MemoryStorageService).compile();
    app = mod.createNestApplication<NestExpressApplication>();
    configureApp(app, { trustProxy: 1 });
    await app.init();
    jwt = app.get(JwtService);
    instId = (await prisma.institution.create({ data: { code: `E${run}`.toUpperCase(), name: `Institution E ${run}` } })).id;
    await makeUser('ia', Role.INSTITUTION_ADMIN);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('niveaux autorisés par filière (D-24) : la table program_levels existe et filtre les groupes', async () => {
    const base = `/institutions/${instId}/academic`;
    facultyId = (await api('post', `${base}/faculties`, tokens.ia).send({ code: 'FSJP', name: 'FSJP' }).expect(201)).body.id;
    l1 = (await api('post', `${base}/levels`, tokens.ia).send({ code: 'L1', name: 'L1', rank: 1 }).expect(201)).body.id;
    l3 = (await api('post', `${base}/levels`, tokens.ia).send({ code: 'L3', name: 'L3', rank: 3 }).expect(201)).body.id;
    dp = (await api('post', `${base}/programs`, tokens.ia).send({ facultyId, code: 'DP', name: 'Droit privé', levelIds: [l3] }).expect(201)).body.id;
    dpu = (await api('post', `${base}/programs`, tokens.ia).send({ facultyId, code: 'DPU', name: 'Droit public', levelIds: [l3] }).expect(201)).body.id;
    yearId = (await api('post', `${base}/years`, tokens.ia).send({ label: '2026-2027', startsOn: '2026-09-01', endsOn: '2027-07-15' }).expect(201)).body.id;
    await api('post', `${base}/groups`, tokens.ia).send({ programId: dp, levelId: l1, academicYearId: yearId, name: '1' }).expect(400); // Droit privé n'existe pas en L1
    group1 = (await api('post', `${base}/groups`, tokens.ia).send({ programId: dp, levelId: l3, academicYearId: yearId, name: '1' }).expect(201)).body.id;
    const overview = (await api('get', base, tokens.ia).expect(200)).body;
    expect(overview.programs.find((p: { id: string }) => p.id === dp).levelIds).toEqual([l3]);
    await api('patch', `${base}/programs/${dp}`, tokens.ia).send({ levelIds: [] }).expect(409); // un groupe existe en L3
  });

  it('éligibilité réelle : ET dans une règle, OU entre règles, VERIFIED seulement, nombre sans liste', async () => {
    await makeUser('s1', Role.STUDENT, { eligible: { program: dp, level: l3, group: group1 } });
    await makeUser('s2', Role.STUDENT, { eligible: { program: dp, level: l3 } });
    await makeUser('s3', Role.STUDENT, { eligible: { program: dpu, level: l3 } });
    await makeUser('c1', Role.STUDENT, { eligible: { program: dp, level: l3 } });
    await makeUser('c2', Role.STUDENT, { eligible: { program: dp, level: l3 } });
    await makeUser('c3', Role.STUDENT, { eligible: { program: dp, level: l3 } });
    await prisma.studentEnrollment.update({ where: { studentId_academicYearId: { studentId: studentIds.s2, academicYearId: yearId } }, data: { status: 'PENDING' } });

    electionId = (
      await api('post', `/institutions/${instId}/elections`, tokens.ia)
        .send({ title: `Bureau ${run}`, academicYearId: yearId, candidacyStartsAt: iso(-HOUR), candidacyEndsAt: iso(7 * DAY), votingStartsAt: iso(14 * DAY), votingEndsAt: iso(15 * DAY) })
        .expect(201)
    ).body.id;
    const count = async () => (await api('get', `/elections/${electionId}/eligible-count`, tokens.ia).expect(200)).body;
    expect(await count()).toEqual({ count: 0 }); // aucune règle = personne
    await api('put', `/elections/${electionId}/rules`, tokens.ia).send({ rules: [{ programId: dp, levelId: l3, groupId: group1 }] }).expect(200);
    expect(await count()).toEqual({ count: 1 }); // s1 seulement
    await api('put', `/elections/${electionId}/rules`, tokens.ia).send({ rules: [{ programId: dp, levelId: l3 }, { programId: dpu, levelId: l3 }] }).expect(200);
    expect(await count()).toEqual({ count: 5 }); // s1, s3, c1, c2, c3 (s2 est PENDING)
    await api('put', `/elections/${electionId}/rules`, tokens.ia).send({ rules: [], wholeInstitution: true }).expect(200);
    expect(await count()).toEqual({ count: 5 });
    await api('put', `/elections/${electionId}/rules`, tokens.ia).send({ rules: [{ programId: dp, levelId: l3 }] }).expect(200);
    expect(await count()).toEqual({ count: 4 }); // s1, c1, c2, c3
  });

  it('comité de 3 membres, ouverture des candidatures, « mes élections » filtré par la base', async () => {
    positionId = (await api('post', `/elections/${electionId}/positions`, tokens.ia).send({ title: 'Président' }).expect(201)).body.id;
    for (const c of ['c1', 'c2', 'c3']) {
      // le compte du comité doit être admin (2FA) pour garder son rôle : on le simule comme les autres tests
      await prisma.user.update({ where: { id: ids[c] }, data: { twoFactorEnabled: true } });
      await api('post', `/institutions/${instId}/roles`, tokens.ia).send({ email: `${c}-${run}@example.test`, role: 'ELECTION_COMMITTEE', electionId }).expect(201);
    }
    expect((await api('post', `/elections/${electionId}/candidacy/open`, tokens.ia).expect(200)).body.status).toBe('CANDIDACY_OPEN');
    expect((await api('get', '/elections/mine', tokens.s1).expect(200)).body.map((e: { id: string }) => e.id)).toEqual([electionId]);
    expect((await api('get', '/elections/mine', tokens.s3).expect(200)).body).toEqual([]); // Droit public : non concerné
    await api('get', `/elections/${electionId}`, tokens.s3).expect(404);
  });

  it('D-05 : 10 dépôts simultanés du même étudiant → une seule candidature (index unique réel)', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => api('post', `/elections/${electionId}/candidates`, tokens.s1).send({ positionId })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(9);
    expect(await prisma.candidate.count({ where: { electionId, studentId: studentIds.s1 } })).toBe(1);
    // un membre du comité ne peut pas candidater
    await api('post', `/elections/${electionId}/candidates`, tokens.c1).send({ positionId }).expect(409);
  });

  it('droits MySQL : app_runtime lit et écrit les nouvelles tables (program_levels)', async () => {
    await expect(prisma.programLevel.count()).resolves.toEqual(expect.any(Number));
    await expect(prisma.candidate.count()).resolves.toEqual(expect.any(Number));
  });
});
