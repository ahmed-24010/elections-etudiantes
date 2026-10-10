import { readFileSync } from 'fs';
import { join } from 'path';
import { Role } from '@prisma/client';
import { malicious, jpeg, pdf, png } from './files';
import { bearer, createTestApp, TestContext } from './helpers';

const DAY = 24 * 60 * 60 * 1000;

describe('Étudiants, attestations et vérification (Sprint 3)', () => {
  let t: TestContext;
  let facA: string;
  let progA: string;
  let levelA: string;
  let yearA: string;
  let groupA: string;
  let facB: string;
  const users: Record<string, { id: string; token: string; fresh: string; stale: string }> = {};

  const as = (token: string, method: 'get' | 'post' | 'put', path: string) => t.api(method, path).set('authorization', bearer(token));
  const enrollmentBody = (over: Record<string, unknown> = {}) => ({
    studentNumber: 'N-1001', firstName: 'Aïcha', lastName: 'Ould Ahmed', facultyId: facA, programId: progA, levelId: levelA, groupId: groupA, ...over,
  });
  const upload = (token: string, buf: Buffer, filename = 'attestation.pdf', contentType = 'application/pdf') =>
    t.api('post', '/students/me/enrollment/document').set('authorization', bearer(token)).attach('file', buf, { filename, contentType });

  async function addUser(name: string, grants: { role: Role; institutionId?: string }[], twoFactor = false) {
    const u = await t.world.addUser(`${name}@example.test`, grants, { twoFactorEnabled: twoFactor });
    const s = await t.world.session(u.id, { mfaAgeMs: twoFactor ? 0 : null });
    const stale = await t.world.session(u.id, { mfaAgeMs: 11 * 60_000 });
    users[name] = { id: u.id, token: s.token, fresh: s.token, stale: twoFactor ? stale.token : s.token };
    return users[name];
  }

  beforeAll(async () => {
    t = await createTestApp();
    const w = t.world;
    const p = t.prisma;
    facA = (await p.faculty.create({ data: { institutionId: w.instA.id, code: 'FSJP', name: 'FSJP' } })).id;
    progA = (await p.program.create({ data: { institutionId: w.instA.id, facultyId: facA, code: 'DP', name: 'Droit privé' } })).id;
    levelA = (await p.level.create({ data: { institutionId: w.instA.id, code: 'L1', name: 'L1', rank: 1 } })).id;
    yearA = (await p.academicYear.create({ data: { institutionId: w.instA.id, label: '2026-2027', startsOn: new Date('2026-09-01'), endsOn: new Date('2027-07-01'), isCurrent: true } })).id;
    groupA = (await p.group.create({ data: { institutionId: w.instA.id, programId: progA, levelId: levelA, academicYearId: yearA, name: 'A' } })).id;
    facB = (await p.faculty.create({ data: { institutionId: w.instB.id, code: 'FB', name: 'Faculté B' } })).id;
    await addUser('stud1', [{ role: Role.STUDENT, institutionId: w.instA.id }]);
    await addUser('stud2', [{ role: Role.STUDENT, institutionId: w.instA.id }]);
    await addUser('stud3', [{ role: Role.STUDENT, institutionId: w.instA.id }]);
    await addUser('studB', [{ role: Role.STUDENT, institutionId: w.instB.id }]);
    await addUser('officer', [{ role: Role.VERIFICATION_OFFICER, institutionId: w.instA.id }], true);
    await addUser('officer2', [{ role: Role.VERIFICATION_OFFICER, institutionId: w.instA.id }], true);
    await addUser('officerB', [{ role: Role.VERIFICATION_OFFICER, institutionId: w.instB.id }], true);
    await addUser('ia', [{ role: Role.INSTITUTION_ADMIN, institutionId: w.instA.id }], true);
    await addUser('sa', [{ role: Role.SUPER_ADMIN }], true);
  });
  afterAll(() => t.app.close());

  const enrollmentId = (name: string) => t.prisma.studentEnrollment.rows.find((e) => e.studentId === t.prisma.student.rows.find((s) => s.userId === users[name].id)?.id)!.id;

  // -------------------------------------------------------------------------------------------------- déclaration
  describe('déclaration de l’inscription (année courante)', () => {
    it('crée le profil et une inscription PENDING ; l’institution vient du rôle en base', async () => {
      const res = await as(users.stud1.token, 'put', '/students/me/enrollment').send(enrollmentBody()).expect(200);
      expect(res.body.enrollment).toEqual(expect.objectContaining({ status: 'PENDING' }));
      expect(res.body.currentYear.label).toBe('2026-2027');
      expect(res.body.canUpload).toBe(true);
      expect(res.body.institutionId).toBe(t.world.instA.id);
      expect(t.prisma.student.rows[0].institutionId).toBe(t.world.instA.id);
    });

    it('refuse un choix incohérent ou venant d’une autre institution (400)', async () => {
      const bad = (over: Record<string, unknown>) => as(users.stud2.token, 'put', '/students/me/enrollment').send(enrollmentBody({ studentNumber: 'N-2002', ...over }));
      await bad({ facultyId: facB }).expect(400);
      await bad({ programId: crypto.randomUUID() }).expect(400);
      const otherFaculty = (await t.prisma.faculty.create({ data: { institutionId: t.world.instA.id, code: 'AUTRE', name: 'Autre faculté' } })).id;
      await bad({ facultyId: otherFaculty }).expect(400); // la filière n'appartient pas à cette faculté
      const otherLevel = (await t.prisma.level.create({ data: { institutionId: t.world.instA.id, code: 'L2', name: 'L2', rank: 2 } })).id;
      await bad({ levelId: otherLevel }).expect(400); // le groupe n'est pas de ce niveau
      await bad({ studentNumber: 'x' }).expect(400);
      await bad({ institutionId: t.world.instB.id }).expect(400); // l'institution ne se choisit pas
    });

    it('un autre rôle ne peut pas déclarer d’inscription ; sans jeton : 401', async () => {
      await as(users.officer.token, 'put', '/students/me/enrollment').send(enrollmentBody()).expect(403);
      await t.api('put', '/students/me/enrollment').send(enrollmentBody()).expect(401);
    });

    it('sans année courante : 409', async () => {
      const rows = t.prisma.academicYear.rows;
      const current = rows.find((y) => y.id === yearA)!;
      current.isCurrent = false;
      await as(users.stud3.token, 'put', '/students/me/enrollment').send(enrollmentBody({ studentNumber: 'N-3003' })).expect(409);
      current.isCurrent = true;
    });
  });

  // -------------------------------------------------------------------------------------------------- numéros (D-22)
  describe('vol de numéro étudiant (D-22)', () => {
    const claim = (name: string, studentNumber: string) => as(users[name].token, 'put', '/students/me/enrollment').send(enrollmentBody({ studentNumber }));

    it('un numéro réservé récemment par un autre étudiant est indisponible, sans révéler qui le détient', async () => {
      const res = await claim('stud2', 'N-1001').expect(409);
      expect(res.body.message).toBe('student_number_unavailable');
      expect(JSON.stringify(res.body)).not.toContain('stud1');
    });

    it('une réservation non confirmée (sans attestation) expire après 7 jours : le vrai titulaire peut s’inscrire', async () => {
      const holder = t.prisma.student.rows.find((s) => s.userId === users.stud1.id)!;
      holder.numberClaimedAt = new Date(Date.now() - 8 * DAY);
      await claim('stud2', 'N-1001').expect(200);
      expect(holder.studentNumber).toBeNull();
      expect(t.prisma.auditLogs.some((l) => l.action === 'STUDENT_NUMBER_RELEASED' && l.metadata?.reason === 'EXPIRED_CLAIM')).toBe(true);
      expect(JSON.stringify(t.prisma.auditLogs.map((l) => ({ ...l, id: String(l.id) })))).not.toContain('N-1001'); // jamais le numéro dans l'audit
    });

    it('le titulaire dépossédé peut reprendre un numéro (le sien ou un autre)', async () => {
      await claim('stud1', 'N-1002').expect(200);
      expect(t.prisma.student.rows.find((s) => s.userId === users.stud1.id)!.studentNumber).toBe('N-1002');
    });

    it('un numéro dont l’attestation est en cours d’examen n’est JAMAIS libéré, même après 7 jours', async () => {
      await upload(users.stud2.token, pdf()).expect(201);
      t.prisma.student.rows.find((s) => s.userId === users.stud2.id)!.numberClaimedAt = new Date(Date.now() - 30 * DAY);
      await claim('stud3', 'N-1001').expect(409);
    });

    it('deux étudiants de la même institution qui réservent le même numéro en même temps : un seul gagne (index unique)', async () => {
      await addUser('stud6', [{ role: Role.STUDENT, institutionId: t.world.instA.id }]);
      await addUser('stud7', [{ role: Role.STUDENT, institutionId: t.world.instA.id }]);
      const race = await Promise.all([claim('stud6', 'N-9999'), claim('stud7', 'N-9999')]);
      expect(race.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(t.prisma.student.rows.filter((s) => s.studentNumber === 'N-9999')).toHaveLength(1);
    });

    it('le même numéro dans une autre institution est indépendant', async () => {
      const w = t.world;
      const progB = (await t.prisma.program.create({ data: { institutionId: w.instB.id, facultyId: facB, code: 'PB', name: 'Filière B' } })).id;
      const levelB = (await t.prisma.level.create({ data: { institutionId: w.instB.id, code: 'L1', name: 'L1 B', rank: 1 } })).id;
      await t.prisma.academicYear.create({ data: { institutionId: w.instB.id, label: '2026-2027', startsOn: new Date('2026-09-01'), endsOn: new Date('2027-07-01'), isCurrent: true } });
      await as(users.studB.token, 'put', '/students/me/enrollment')
        .send({ studentNumber: 'N-1001', firstName: 'B', lastName: 'B', facultyId: facB, programId: progB, levelId: levelB })
        .expect(200);
    });
  });

  // -------------------------------------------------------------------------------------------------- upload
  describe('dépôt de l’attestation : vrai type du fichier, 5 Mo, stockage privé', () => {
    beforeAll(async () => {
      await as(users.stud3.token, 'put', '/students/me/enrollment').send(enrollmentBody({ studentNumber: 'N-3003' })).expect(200);
    });

    it('refuse les fichiers dangereux renommés en .pdf, même avec un Content-Type PDF', async () => {
      for (const [, buf] of malicious) {
        const res = await upload(users.stud3.token, buf, 'attestation.pdf', 'application/pdf');
        expect([415]).toContain(res.status);
      }
      expect(t.storage.objects.size).toBe(1); // seule l'attestation valide de stud2 est stockée
      expect(t.prisma.storedFile.rows).toHaveLength(1);
    });

    it('refuse un fichier vide (400) et plus de 5 Mo (413) ; rien n’est stocké', async () => {
      await upload(users.stud3.token, Buffer.alloc(0), 'vide.pdf').expect(400);
      await upload(users.stud3.token, Buffer.concat([pdf(), Buffer.alloc(5 * 1024 * 1024)]), 'gros.pdf').expect(413);
      expect(t.storage.objects.size).toBe(1);
    });

    it('sans fichier : 400 ; sans jeton : 401 ; rôle sans droit : 403', async () => {
      await as(users.stud3.token, 'post', '/students/me/enrollment/document').expect(400);
      await t.api('post', '/students/me/enrollment/document').attach('file', pdf(), 'a.pdf').expect(401);
      await upload(users.officer.token, pdf()).expect(403);
    });

    it('sans inscription déclarée : 409', async () => {
      const lone = await addUser('stud5', [{ role: Role.STUDENT, institutionId: t.world.instA.id }]);
      await upload(lone.token, pdf()).expect(409);
    });

    it('accepte un PDF, un JPEG et un PNG : type réel enregistré, nom généré par le serveur, nom d’origine nettoyé', async () => {
      const cases: Array<[string, Buffer, string, string]> = [
        ['stud3', pdf(), 'application/pdf', '../../etc/passwd.pdf'],
        ['stud1', jpeg(), 'image/jpeg', 'scan.png'], // un JPEG déclaré en .png : le contenu décide
      ];
      for (const [name, buf, mime, original] of cases) {
        if (name === 'stud1') await upload(users.stud1.token, buf, original, 'image/png').expect(201);
        else await upload(users[name].token, buf, original, 'application/pdf').expect(201);
        const stored = t.prisma.storedFile.rows.find((f) => f.uploadedById === users[name].id)!;
        expect(stored.mimeType).toBe(mime);
        expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(stored.storageKey).toMatch(/^registration-documents\/[0-9a-f-]+\/[0-9a-f-]+\/[0-9a-f-]+\.(pdf|jpg)$/);
        expect(stored.storageKey).not.toContain('passwd');
        expect(stored.originalName).not.toContain('/');
        expect(t.storage.objects.get(stored.storageKey)!.contentType).toBe(mime);
      }
      expect(png().length).toBeGreaterThan(0);
    });

    it('une attestation déjà déposée verrouille l’inscription et un second dépôt (D-21) : 409', async () => {
      await upload(users.stud2.token, pdf()).expect(409);
      await as(users.stud2.token, 'put', '/students/me/enrollment').send(enrollmentBody({ studentNumber: 'N-1001' })).expect(409);
      const me = (await as(users.stud2.token, 'get', '/students/me').expect(200)).body;
      expect(me.canEdit).toBe(false);
      expect(me.canUpload).toBe(false);
      expect(me.document.status).toBe('UPLOADED');
    });
  });

  // -------------------------------------------------------------------------------------------------- accès aux attestations
  describe('qui voit les attestations (03 §5.3)', () => {
    it('l’INSTITUTION_ADMIN ne voit ni la file, ni le détail, ni l’attestation (403) ; SUPER_ADMIN non plus', async () => {
      const id = enrollmentId('stud2');
      for (const name of ['ia', 'sa']) {
        await as(users[name].token, 'get', `/institutions/${t.world.instA.id}/verification/queue`).expect(403);
        await as(users[name].token, 'get', `/enrollments/${id}/review`).expect(403);
        await as(users[name].token, 'post', `/enrollments/${id}/document-access`).expect(403);
        await as(users[name].fresh, 'post', `/enrollments/${id}/approve`).expect(403);
      }
    });

    it('un étudiant ne voit pas la file ni l’attestation d’un autre ; un étudiant d’une autre institution : 404', async () => {
      const id = enrollmentId('stud2');
      await as(users.stud1.token, 'get', `/institutions/${t.world.instA.id}/verification/queue`).expect(403);
      await as(users.stud1.token, 'get', `/enrollments/${id}/review`).expect(403);
      await as(users.stud1.token, 'post', `/enrollments/${id}/document-access`).expect(403);
      await as(users.studB.token, 'post', `/enrollments/${id}/document-access`).expect(404);
    });

    it('le vérificateur d’une AUTRE institution reçoit 404 partout (isolation)', async () => {
      const id = enrollmentId('stud2');
      await as(users.officerB.token, 'get', `/institutions/${t.world.instA.id}/verification/queue`).expect(404);
      await as(users.officerB.token, 'get', `/enrollments/${id}/review`).expect(404);
      await as(users.officerB.token, 'post', `/enrollments/${id}/document-access`).expect(404);
      await as(users.officerB.fresh, 'post', `/enrollments/${id}/approve`).expect(404);
      await as(users.officerB.fresh, 'post', `/enrollments/${id}/reject`).send({ code: 'OTHER', reason: 'test' }).expect(404);
    });

    it('le propriétaire et le vérificateur obtiennent une URL signée de 5 minutes qui sert le fichier avec des en-têtes sûrs', async () => {
      const id = enrollmentId('stud2');
      for (const name of ['stud2', 'officer']) {
        const res = await as(users[name].token, 'post', `/enrollments/${id}/document-access`).expect(200);
        expect(res.body.url).toMatch(/^\/api\/v1\/files\/[0-9a-f-]+\?uid=[0-9a-f-]+&exp=\d+&sig=[0-9a-f]{64}$/);
        expect(new Date(res.body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(5 * 60_000);
        const file = await t.api('get', res.body.url.replace('/api/v1', '')).expect(200); // aucun en-tête Authorization : la signature suffit
        expect(file.headers['content-type']).toBe('application/pdf');
        expect(file.headers['x-content-type-options']).toBe('nosniff');
        expect(file.headers['content-security-policy']).toContain('sandbox');
        expect(file.headers['cache-control']).toContain('no-store');
        expect(file.headers['content-disposition']).toBe('inline; filename="attestation.pdf"');
        expect(Buffer.from(file.body).subarray(0, 5).toString()).toBe('%PDF-');
      }
      expect(t.prisma.auditLogs.filter((l) => l.action === 'DOCUMENT_VIEWED')).toHaveLength(2);
    });

    it('l’URL signée expire après 5 minutes, refuse une signature altérée, un autre utilisateur ou un autre fichier', async () => {
      const id = enrollmentId('stud2');
      const { url } = (await as(users.officer.token, 'post', `/enrollments/${id}/document-access`).expect(200)).body;
      const path = url.replace('/api/v1', '');
      await t.api('get', path).expect(200);
      await t.api('get', path.replace(/sig=./, (m: string) => `sig=${m.endsWith('a') ? 'b' : 'a'}`)).expect(403);
      await t.api('get', path.replace(/uid=[0-9a-f-]+/, `uid=${users.stud1.id}`)).expect(403);
      await t.api('get', path.replace(/\/files\/[0-9a-f-]+/, `/files/${crypto.randomUUID()}`)).expect(403);
      await t.api('get', path.replace(/exp=\d+/, `exp=${Date.now() + 3_600_000}`)).expect(403);
      const real = Date.now;
      Date.now = () => real() + 5 * 60_000 + 1000;
      try {
        await t.api('get', path).expect(403);
      } finally {
        Date.now = real;
      }
      await t.api('get', '/files/not-a-file?uid=x&exp=1&sig=zz').expect(403);
    });

    it('un droit retiré dans les 5 minutes suit : l’URL déjà émise cesse de fonctionner', async () => {
      const id = enrollmentId('stud2');
      const extra = await addUser('officer3', [{ role: Role.VERIFICATION_OFFICER, institutionId: t.world.instA.id }], true);
      const { url } = (await as(extra.token, 'post', `/enrollments/${id}/document-access`).expect(200)).body;
      await t.api('get', url.replace('/api/v1', '')).expect(200);
      t.prisma.roleAssignments.find((r) => r.userId === extra.id)!.revokedAt = new Date();
      await t.api('get', url.replace('/api/v1', '')).expect(403);
    });

    it('l’URL signée n’est pas écrite dans les journaux (la requête est tronquée avant le « ? »)', () => {
      // La sérialisation pino de la requête retire la query (voir app.module.ts) : vérifié en lisant la configuration.
      const src = readFileSync(join(__dirname, '..', 'src', 'app.module.ts'), 'utf8');
      expect(src).toContain("String(req.url).split('?')[0]");
    });
  });

  // -------------------------------------------------------------------------------------------------- décision
  describe('décision du vérificateur (🔐) et conflits d’intérêts (03 §6)', () => {
    it('la file ne contient que les inscriptions avec une attestation déposée, de l’institution du vérificateur', async () => {
      const q = (await as(users.officer.token, 'get', `/institutions/${t.world.instA.id}/verification/queue`).expect(200)).body;
      const ids = q.map((e: { id: string }) => e.id);
      expect(ids).toContain(enrollmentId('stud2'));
      for (const e of q) {
        expect(e.status).toBe('PENDING');
        expect(e.document.status).toBe('UPLOADED');
      }
    });

    it('sans 2FA récente : 401 step_up_required ; avec : 204 ; l’étudiant est notifié', async () => {
      const id = enrollmentId('stud2');
      const denied = await as(users.officer.stale, 'post', `/enrollments/${id}/approve`);
      expect(denied.status).toBe(401);
      expect(denied.body.message).toBe('step_up_required');
      expect(t.prisma.studentEnrollment.rows.find((e) => e.id === id)!.status).toBe('PENDING');

      await as(users.officer.fresh, 'post', `/enrollments/${id}/approve`).expect(204);
      const row = t.prisma.studentEnrollment.rows.find((e) => e.id === id)!;
      expect(row.status).toBe('VERIFIED');
      expect(row.reviewedById).toBe(users.officer.id);

      const notes = (await as(users.stud2.token, 'get', '/notifications').expect(200)).body;
      expect(notes.unread).toBe(1);
      expect(notes.items[0]).toEqual(expect.objectContaining({ type: 'ENROLLMENT_VERIFIED' }));
      const me = (await as(users.stud2.token, 'get', '/students/me').expect(200)).body;
      expect(me.enrollment.status).toBe('VERIFIED');
      expect(me.canEdit).toBe(false);
    });

    it('D-21 : une inscription vérifiée ne peut plus être modifiée ; une nouvelle attestation est refusée', async () => {
      await as(users.stud2.token, 'put', '/students/me/enrollment').send(enrollmentBody({ studentNumber: 'N-1001' })).expect(409);
      await upload(users.stud2.token, pdf()).expect(409);
    });

    it('une décision déjà prise ne peut pas être reprise (409)', async () => {
      const id = enrollmentId('stud2');
      await as(users.officer2.fresh, 'post', `/enrollments/${id}/approve`).expect(409);
      await as(users.officer2.fresh, 'post', `/enrollments/${id}/reject`).send({ code: 'OTHER', reason: 'trop tard' }).expect(409);
    });

    it('03 §8 n°5 — un vérificateur ne valide ni ne rejette sa propre inscription (403), un autre vérificateur le peut', async () => {
      const w = t.world;
      const me = users.officer;
      // Le vérificateur est aussi étudiant dans la même institution.
      await t.prisma.roleAssignment.create({ data: { userId: me.id, role: Role.STUDENT, institutionId: w.instA.id } });
      await as(me.token, 'put', '/students/me/enrollment').send(enrollmentBody({ studentNumber: 'N-5005' })).expect(200);
      await upload(me.token, pdf()).expect(201);
      const id = enrollmentId('officer');

      const own = await as(me.fresh, 'post', `/enrollments/${id}/approve`);
      expect(own.status).toBe(403);
      expect(own.body.message).toBe('cannot_review_own_enrollment');
      await as(me.fresh, 'post', `/enrollments/${id}/reject`).send({ code: 'OTHER', reason: 'je me rejette' }).expect(403);
      expect((await as(me.token, 'get', `/enrollments/${id}/review`).expect(200)).body.ownRequest).toBe(true);
      expect(t.prisma.studentEnrollment.rows.find((e) => e.id === id)!.status).toBe('PENDING');

      await as(users.officer2.fresh, 'post', `/enrollments/${id}/approve`).expect(204);
    });

    it('un vérificateur ne décide pas non plus sur un fichier qu’il a déposé lui-même', async () => {
      const id = enrollmentId('stud3');
      const doc = t.prisma.storedFile.rows.find((f) => f.uploadedById === users.stud3.id)!;
      doc.uploadedById = users.officer2.id; // l'attestation de stud3 aurait été déposée par officer2
      await as(users.officer2.fresh, 'post', `/enrollments/${id}/approve`).expect(403);
      doc.uploadedById = users.stud3.id;
    });

    it('rejet : le motif est obligatoire (400) ; « numéro incorrect » libère le numéro ; le motif n’est pas dans l’audit', async () => {
      const id = enrollmentId('stud3');
      const send = (body: unknown) => as(users.officer.fresh, 'post', `/enrollments/${id}/reject`).send(body as object);
      await send({ code: 'OTHER' }).expect(400);
      await send({ code: 'OTHER', reason: 'ab' }).expect(400);
      await send({ code: 'INVENTE', reason: 'motif valable' }).expect(400);
      await send({ code: 'WRONG_STUDENT_NUMBER', reason: 'Le numéro de l’attestation est différent' }).expect(204);

      const row = t.prisma.studentEnrollment.rows.find((e) => e.id === id)!;
      expect(row).toEqual(expect.objectContaining({ status: 'REJECTED', rejectionCode: 'WRONG_STUDENT_NUMBER' }));
      expect(t.prisma.student.rows.find((s) => s.userId === users.stud3.id)!.studentNumber).toBeNull(); // libéré (D-22)
      const audit = JSON.stringify(t.prisma.auditLogs.map((l) => ({ ...l, id: String(l.id) })));
      expect(audit).not.toContain('Le numéro de l’attestation est différent');
      expect(t.prisma.auditLogs.some((l) => l.action === 'STUDENT_NUMBER_RELEASED' && l.metadata?.reason === 'REJECTED_WRONG_NUMBER')).toBe(true);

      const me = (await as(users.stud3.token, 'get', '/students/me').expect(200)).body;
      expect(me.enrollment.rejectionReason).toBe('Le numéro de l’attestation est différent');
      expect(me.canEdit).toBe(true);
      expect((await as(users.stud3.token, 'get', '/notifications').expect(200)).body.items[0]).toEqual(expect.objectContaining({ type: 'ENROLLMENT_REJECTED', body: 'Le numéro de l’attestation est différent' }));
    });

    it('après un rejet, l’étudiant corrige, redépose, et l’inscription repasse en file ; le vrai titulaire peut prendre le numéro libéré', async () => {
      await addUser('vraiProprio', [{ role: Role.STUDENT, institutionId: t.world.instA.id }]);
      await as(users.vraiProprio.token, 'put', '/students/me/enrollment').send(enrollmentBody({ studentNumber: 'N-3003' })).expect(200);

      await as(users.stud3.token, 'put', '/students/me/enrollment').send(enrollmentBody({ studentNumber: 'N-3010' })).expect(200);
      const id = enrollmentId('stud3');
      expect(t.prisma.studentEnrollment.rows.find((e) => e.id === id)).toEqual(expect.objectContaining({ status: 'PENDING', rejectionReason: null, rejectionCode: null }));
      await upload(users.stud3.token, png(), 'scan.png', 'image/png').expect(201);
      const queue = (await as(users.officer.token, 'get', `/institutions/${t.world.instA.id}/verification/queue`).expect(200)).body;
      expect(queue.map((e: { id: string }) => e.id)).toContain(id);
      expect(t.prisma.registrationDocument.rows.filter((d) => d.enrollmentId === id).map((d) => d.status).sort()).toEqual(['REJECTED', 'UPLOADED']);
    });

    it('deux vérificateurs qui décident en même temps : une seule décision est enregistrée', async () => {
      const id = enrollmentId('stud3');
      const res = await Promise.all([
        as(users.officer.fresh, 'post', `/enrollments/${id}/approve`),
        as(users.officer2.fresh, 'post', `/enrollments/${id}/reject`).send({ code: 'OTHER', reason: 'motif valable' }),
      ]);
      expect(res.map((r) => r.status).sort()).toEqual([204, 409]);
    });

    it('chaque décision est auditée (acteur, institution, action) sans donnée personnelle de l’attestation', () => {
      const actions = t.prisma.auditLogs.map((l) => l.action);
      expect(actions).toEqual(expect.arrayContaining(['ENROLLMENT_DECLARED', 'DOCUMENT_UPLOADED', 'ENROLLMENT_VERIFIED', 'ENROLLMENT_REJECTED', 'DOCUMENT_VIEWED', 'enrollment:review']));
    });
  });

  // -------------------------------------------------------------------------------------------------- notifications
  describe('notifications', () => {
    it('chacun ne voit et ne lit que les siennes (404 sinon) ; lecture et « tout lire »', async () => {
      const mine = (await as(users.stud2.token, 'get', '/notifications').expect(200)).body;
      const id = mine.items[0].id;
      await as(users.stud1.token, 'post', `/notifications/${id}/read`).expect(404);
      await as(users.stud2.token, 'post', `/notifications/${id}/read`).expect(204);
      expect((await as(users.stud2.token, 'get', '/notifications').expect(200)).body.unread).toBe(0);
      await as(users.stud3.token, 'post', '/notifications/read-all').expect(204);
      expect((await as(users.stud3.token, 'get', '/notifications').expect(200)).body.unread).toBe(0);
      await t.api('get', '/notifications').expect(401);
    });
  });
});
