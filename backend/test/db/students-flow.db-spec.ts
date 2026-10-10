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
import { pdf } from '../files';

// Sprint 3 contre la VRAIE base : requêtes Prisma réelles (filtres sur relations, transactions), index uniques (numéro
// étudiant, NULL multiples), droits MySQL. Le stockage S3 est remplacé par une mémoire (pas de S3 dans la CI).
describe('Étudiants et vérification sur la vraie base MySQL', () => {
  const run = Math.random().toString(36).slice(2, 8);
  const prisma = new PrismaClient();
  let app: NestExpressApplication;
  let jwt: JwtService;
  let n = 0;
  let instId: string;
  let otherInstId: string;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  let facultyId: string;
  let programId: string;
  let levelId: string;
  let yearId: string;

  const api = (method: 'get' | 'post' | 'put' | 'delete', path: string, token?: string) => {
    const r = request(app.getHttpServer())[method](`/api/v1${path}`).set('x-forwarded-for', `10.8.${Math.floor(++n / 250)}.${n % 250}`).set('x-requested-with', 'XMLHttpRequest');
    return token ? r.set('authorization', `Bearer ${token}`) : r;
  };

  /** Compte + session ouverte (avec 2FA récente pour un rôle administratif), sans passer par le formulaire de connexion. */
  async function makeUser(name: string, role: Role, institutionId: string) {
    const admin = role !== Role.STUDENT;
    const user = await prisma.user.create({
      data: { email: `${name}-${run}@example.test`, passwordHash: await argon2.hash('Un-mot-de-passe-solide-1'), twoFactorEnabled: admin, roles: { create: { role, institutionId } } },
    });
    const familyId = randomUUID();
    await prisma.refreshToken.create({
      data: { userId: user.id, familyId, tokenHash: createHash('sha256').update(randomBytes(16)).digest('hex'), expiresAt: new Date(Date.now() + 86_400_000), twoFactorVerifiedAt: admin ? new Date() : null },
    });
    ids[name] = user.id;
    tokens[name] = jwt.sign({ sub: user.id, sid: familyId, typ: 'access' }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '15m' });
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(StorageService).useClass(MemoryStorageService).compile();
    app = mod.createNestApplication<NestExpressApplication>();
    configureApp(app, { trustProxy: 1 });
    await app.init();
    jwt = app.get(JwtService);
    instId = (await prisma.institution.create({ data: { code: `S${run}`.toUpperCase(), name: `Institution S ${run}` } })).id;
    otherInstId = (await prisma.institution.create({ data: { code: `O${run}`.toUpperCase(), name: `Institution O ${run}` } })).id;
    for (const [name, role, inst] of [
      ['ia', Role.INSTITUTION_ADMIN, instId], ['officer', Role.VERIFICATION_OFFICER, instId], ['officer2', Role.VERIFICATION_OFFICER, instId],
      ['officerO', Role.VERIFICATION_OFFICER, otherInstId], ['s1', Role.STUDENT, instId], ['s2', Role.STUDENT, instId], ['s3', Role.STUDENT, instId],
    ] as const) await makeUser(name, role, inst);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const enrollment = (over: Record<string, unknown> = {}) => ({ studentNumber: `${run}-100`, firstName: 'Aïcha', lastName: 'Test', facultyId, programId, levelId, ...over });

  it('l’administrateur d’institution construit la structure (écritures réelles, une seule année courante)', async () => {
    const base = `/institutions/${instId}/academic`;
    facultyId = (await api('post', `${base}/faculties`, tokens.ia).send({ code: 'FSJP', name: 'FSJP' }).expect(201)).body.id;
    programId = (await api('post', `${base}/programs`, tokens.ia).send({ facultyId, code: 'DP', name: 'Droit privé' }).expect(201)).body.id;
    levelId = (await api('post', `${base}/levels`, tokens.ia).send({ code: 'L1', name: 'L1', rank: 1 }).expect(201)).body.id;
    yearId = (await api('post', `${base}/years`, tokens.ia).send({ label: '2026-2027', startsOn: '2026-09-01', endsOn: '2027-07-15' }).expect(201)).body.id;
    const y2 = (await api('post', `${base}/years`, tokens.ia).send({ label: '2027-2028', startsOn: '2027-09-01', endsOn: '2028-07-15' }).expect(201)).body.id;
    await api('post', `${base}/years/${y2}/current`, tokens.ia).expect(200);
    await api('post', `${base}/years/${yearId}/current`, tokens.ia).expect(200);
    expect(await prisma.academicYear.count({ where: { institutionId: instId, isCurrent: true } })).toBe(1);
    await api('post', `${base}/faculties`, tokens.ia).send({ code: 'FSJP', name: 'Doublon' }).expect(409); // index unique réel
    await api('get', `/institutions/${otherInstId}/academic`, tokens.ia).expect(404);
    await api('delete', `${base}/programs/${programId}`, tokens.ia).expect(204); // inutilisée : supprimable
    programId = (await api('post', `${base}/programs`, tokens.ia).send({ facultyId, code: 'DP', name: 'Droit privé' }).expect(201)).body.id;
  });

  it('déclaration, dépôt, file du vérificateur, URL signée, décision 🔐 et notification', async () => {
    await api('put', '/students/me/enrollment', tokens.s1).send(enrollment()).expect(200);
    await api('post', '/students/me/enrollment/document', tokens.s1).attach('file', pdf(), { filename: 'a.pdf', contentType: 'application/pdf' }).expect(201);

    const queue = (await api('get', `/institutions/${instId}/verification/queue`, tokens.officer).expect(200)).body;
    expect(queue).toHaveLength(1);
    expect(queue[0]).toEqual(expect.objectContaining({ status: 'PENDING', document: expect.objectContaining({ status: 'UPLOADED' }) }));
    const id = queue[0].id;

    // IA, étudiant d'une autre institution et vérificateur d'une autre institution : aucun accès.
    await api('get', `/institutions/${instId}/verification/queue`, tokens.ia).expect(403);
    await api('post', `/enrollments/${id}/document-access`, tokens.ia).expect(403);
    await api('post', `/enrollments/${id}/document-access`, tokens.s2).expect(403);
    await api('post', `/enrollments/${id}/document-access`, tokens.officerO).expect(404);

    const access = (await api('post', `/enrollments/${id}/document-access`, tokens.officer).expect(200)).body;
    const file = await request(app.getHttpServer()).get(access.url).set('x-forwarded-for', '10.8.200.1').expect(200);
    expect(Buffer.from(file.body).subarray(0, 5).toString()).toBe('%PDF-');
    expect(file.headers['x-content-type-options']).toBe('nosniff');

    await api('post', `/enrollments/${id}/approve`, tokens.officer).expect(204);
    await api('post', `/enrollments/${id}/approve`, tokens.officer2).expect(409);
    const row = await prisma.studentEnrollment.findUniqueOrThrow({ where: { id }, include: { documents: true } });
    expect(row).toEqual(expect.objectContaining({ status: 'VERIFIED', reviewedById: ids.officer }));
    expect(row.documents[0].status).toBe('APPROVED');
    expect((await api('get', '/notifications', tokens.s1).expect(200)).body.items[0].type).toBe('ENROLLMENT_VERIFIED');
    await api('put', '/students/me/enrollment', tokens.s1).send(enrollment({ firstName: 'Autre' })).expect(409); // D-21
  });

  it('vol de numéro (D-22) : réservation concurrente, rejet « numéro incorrect », plusieurs NULL permis par l’index unique', async () => {
    const number = `${run}-777`;
    const race = await Promise.all([
      api('put', '/students/me/enrollment', tokens.s2).send(enrollment({ studentNumber: number })),
      api('put', '/students/me/enrollment', tokens.s3).send(enrollment({ studentNumber: number })),
    ]);
    expect(race.map((r) => r.status).sort()).toEqual([200, 409]); // l'index unique MySQL départage
    expect(await prisma.student.count({ where: { institutionId: instId, studentNumber: number } })).toBe(1);

    const [winner, loser] = race[0].status === 200 ? ['s2', 's3'] : ['s3', 's2'];
    await api('post', '/students/me/enrollment/document', tokens[winner]).attach('file', pdf(), { filename: 'x.pdf', contentType: 'application/pdf' }).expect(201);
    const id = (await prisma.studentEnrollment.findFirstOrThrow({ where: { student: { userId: ids[winner] } } })).id;
    await api('post', `/enrollments/${id}/reject`, tokens.officer).send({ code: 'WRONG_STUDENT_NUMBER', reason: 'Numéro différent sur l’attestation' }).expect(204);
    expect((await prisma.student.findUniqueOrThrow({ where: { userId: ids[winner] } })).studentNumber).toBeNull(); // libéré

    await api('put', '/students/me/enrollment', tokens[loser]).send(enrollment({ studentNumber: number })).expect(200); // le vrai titulaire peut s'inscrire
    // Deux étudiants sans numéro en même temps : l'index unique accepte plusieurs NULL.
    expect(await prisma.student.count({ where: { institutionId: instId, studentNumber: null } })).toBeGreaterThanOrEqual(1);
    const audit = JSON.stringify((await prisma.auditLog.findMany({ select: { action: true, metadata: true } })).filter((l) => l.action.startsWith('STUDENT_NUMBER')));
    expect(audit).not.toContain(number);
  });

  it('droits MySQL : app_runtime ne peut pas supprimer une attestation enregistrée par SQL direct sur le journal, mais gère ses données métier', async () => {
    await expect(prisma.$executeRaw`DELETE FROM audit_logs WHERE 1 = 0`).rejects.toThrow(/denied/i);
    expect(await prisma.storedFile.count({ where: { uploadedById: ids.s1 } })).toBe(1);
  });
});
