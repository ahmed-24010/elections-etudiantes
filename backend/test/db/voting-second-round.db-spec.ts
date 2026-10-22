import { ElectionStatus, FilePurpose } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { StorageService } from '../../src/storage/storage.service';
import { VotingWorld, World } from './voting-world';

// Sprint 6C : second tour (D-01, D-46), « PV signé » (D-47), tableau de bord (D-48). Vraie base MySQL.
const H = 3_600_000;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

describe('Second tour, PV signé et tableau de bord (Sprint 6C)', () => {
  const t = new VotingWorld();
  beforeAll(() => t.start());
  afterAll(() => t.stop());

  const close = (w: World) => t.api('post', `/elections/${w.electionId}/voting/close`, w.committee[0].token).send({ reason: 'fin du scrutin' });
  const publish = (w: World) => t.api('post', `/elections/${w.electionId}/results/publish`, w.committee[0].token).send({});
  const secondRound = (w: World, token = w.committee[0].token, body: object = { votingStartsAt: iso(24 * H), votingEndsAt: iso(48 * H) }) =>
    t.api('post', `/elections/${w.electionId}/second-round`, token).send(body);

  /** Président : a et b à égalité (5-5) devant c (2). Trésorier : un vainqueur net. Résultats publiés. */
  async function publishedWithTie() {
    const w = await t.election({ voters: 12, withRule: true, positions: [{ title: 'Président', titleAr: 'الرئيس', candidates: 3 }, { title: 'Trésorier', candidates: 2 }] });
    const [p1, p2] = w.positions;
    const [a, b, c] = p1.candidateIds;
    const plans = [...Array(5).fill([a, p2.candidateIds[0]]), ...Array(5).fill([b, p2.candidateIds[0]]), ...Array(2).fill([c, p2.candidateIds[1]])];
    await t.simulateVotes(w, plans);
    await close(w).expect(200);
    await publish(w).expect(200);
    return { w, a, b, c };
  }

  async function withFiles(candidateId: string) {
    const storage = t.app.get(StorageService);
    const out: Record<string, { fileId: string; sha: string }> = {};
    for (const [kind, purpose] of [['photo', FilePurpose.CANDIDATE_PHOTO], ['program', FilePurpose.CANDIDATE_PROGRAM]] as const) {
      const body = Buffer.from(`contenu-${kind}-${candidateId}`);
      const key = `candidates/test/${randomUUID()}.${kind === 'photo' ? 'png' : 'pdf'}`;
      await storage.put(key, body, kind === 'photo' ? 'image/png' : 'application/pdf');
      const sha = createHash('sha256').update(body).digest('hex');
      const f = await t.prisma.storedFile.create({ data: { purpose, storageKey: key, originalName: `${kind}.bin`, mimeType: 'application/octet-stream', sizeBytes: body.length, sha256: sha } });
      out[kind] = { fileId: f.id, sha };
    }
    await t.prisma.candidate.update({ where: { id: candidateId }, data: { photoFileId: out.photo.fileId, programFileId: out.program.fileId, statement: 'Mon programme du premier tour' } });
    return out;
  }

  describe('création (D-01, D-46)', () => {
    it('un clic : élection liée, limitée aux ex-aequo, mêmes règles et comité, photos et programmes copiés', async () => {
      const { w, a, b, c } = await publishedWithTie();
      const files = await withFiles(a);
      const res = await secondRound(w);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ round: 2, status: 'CANDIDACY_CLOSED', parentElectionId: w.electionId });

      const child = await t.prisma.election.findUniqueOrThrow({ where: { id: res.body.id }, include: { positions: true, candidates: { include: { student: true } }, rules: true } });
      expect(child).toMatchObject({ parentElectionId: w.electionId, round: 2, institutionId: w.institutionId, voterRollFrozenAt: null });
      expect(child.title).toContain('— Tour 2');
      // Seul le poste en égalité, avec les sièges restants ; le poste décidé n'y est pas.
      expect(child.positions.map((p) => p.title)).toEqual(['Président']);
      expect(child.positions[0]).toMatchObject({ seats: 1, maxChoices: 1, titleAr: 'الرئيس' });
      // Seuls a et b (par leurs étudiants), validés ; c, éliminé, n'y figure pas ; aucun nouveau candidat.
      const parentCandidates = await t.prisma.candidate.findMany({ where: { id: { in: [a, b, c] } } });
      const tiedStudents = parentCandidates.filter((x) => x.id !== c).map((x) => x.studentId).sort();
      expect(child.candidates.map((x) => x.studentId).sort()).toEqual(tiedStudents);
      expect(child.candidates.every((x) => x.status === 'APPROVED')).toBe(true);
      expect(child.rules.length).toBeGreaterThan(0);
      expect(await t.prisma.roleAssignment.count({ where: { electionId: child.id, role: 'ELECTION_COMMITTEE', revokedAt: null } })).toBe(3);

      // Photo et programme : NOUVEAUX fichiers (autre clé), même contenu et même empreinte.
      const copy = child.candidates.find((x) => x.studentId === parentCandidates.find((p) => p.id === a)!.studentId)!;
      expect(copy.statement).toBe('Mon programme du premier tour');
      const storage = t.app.get(StorageService);
      for (const [kind, id] of [['photo', copy.photoFileId], ['program', copy.programFileId]] as const) {
        const f = await t.prisma.storedFile.findUniqueOrThrow({ where: { id: id! } });
        const old = await t.prisma.storedFile.findUniqueOrThrow({ where: { id: files[kind].fileId } });
        expect(f.id).not.toBe(old.id);
        expect(f.storageKey).not.toBe(old.storageKey);
        expect(f.sha256).toBe(files[kind].sha);
        expect((await storage.get(f.storageKey)).toString()).toBe((await storage.get(old.storageKey)).toString());
      }

      const log = await t.prisma.auditLog.findFirst({ where: { resourceId: w.electionId, action: 'ELECTION_SECOND_ROUND_CREATED' } });
      expect(log?.metadata).toMatchObject({ secondRoundId: child.id, round: 2, positions: 1, candidates: 2 });
      expect(JSON.stringify(log?.metadata)).not.toMatch(/votes?"/); // aucune donnée de vote dans l'audit

      // Le détail du premier tour renvoie vers le second.
      const detail = (await t.api('get', `/elections/${w.electionId}`, w.committee[0].token).expect(200)).body;
      expect(detail.secondRound).toMatchObject({ id: child.id, round: 2 });
    });

    it('refus : pas publiée (409), pas d’égalité (409 no_tie), dates invalides (400), administrateur d’institution (403)', async () => {
      const closed = await t.election({ voters: 3, positions: [{ title: 'Président', candidates: 2 }] });
      await t.simulateVotes(closed, [[closed.positions[0].candidateIds[0]], [closed.positions[0].candidateIds[0]], [closed.positions[0].candidateIds[1]]]);
      await close(closed).expect(200);
      expect((await secondRound(closed)).status).toBe(409); // VOTING_CLOSED : résultats non publiés

      await publish(closed).expect(200);
      const noTie = await secondRound(closed);
      expect([noTie.status, noTie.body.message]).toEqual([409, 'no_tie']);

      const { w } = await publishedWithTie();
      expect((await secondRound(w, w.committee[0].token, { votingStartsAt: iso(-H), votingEndsAt: iso(24 * H) })).status).toBe(400);
      expect((await secondRound(w, w.committee[0].token, { votingStartsAt: iso(48 * H), votingEndsAt: iso(24 * H) })).status).toBe(400);
      expect((await secondRound(w, t.admin.token)).status).toBe(403);
      expect(await t.prisma.election.count({ where: { parentElectionId: w.electionId } })).toBe(0); // rien n'a été créé
    });

    it('un seul second tour actif : dix demandes simultanées → une seule réussit ; annulé, il peut être recréé', async () => {
      const { w } = await publishedWithTie();
      const results = await Promise.all(Array.from({ length: 10 }, (_, i) => secondRound(w, w.committee[i % 3].token)));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409).every((r) => r.body.message === 'second_round_exists')).toBe(true);
      expect(await t.prisma.election.count({ where: { parentElectionId: w.electionId } })).toBe(1);

      const child = await t.prisma.election.findFirstOrThrow({ where: { parentElectionId: w.electionId } });
      await t.prisma.election.update({ where: { id: child.id }, data: { status: 'CANCELLED' } });
      expect((await secondRound(w)).status).toBe(200);
      expect(await t.prisma.election.count({ where: { parentElectionId: w.electionId } })).toBe(2);
    });
  });

  describe('déroulement du second tour : même liste électorale', () => {
    it('ouverture : la liste est la COPIE de celle du premier tour (ajout exceptionnel compris), puis vote et résultats', async () => {
      const { w, a, b, c } = await publishedWithTie();
      // Un électeur ajouté exceptionnellement au premier tour, et un étudiant vérifié APRÈS le gel (hors liste).
      const [extra] = await t.students(1, 'ajout');
      await t.prisma.voterRollEntry.create({ data: { electionId: w.electionId, studentId: extra.studentId, enrollmentId: extra.enrollmentId, addedAfterFreeze: true } });
      const [late] = await t.students(1, 'tardif');
      const child = (await secondRound(w).expect(200)).body;
      const open = (token = w.committee[0].token) => t.api('post', `/elections/${child.id}/voting/open`, token).send({});

      // Avant l'heure prévue : refus, comme pour toute élection (04 §4.3).
      const early = await open();
      expect(early.status).toBe(409);
      expect(early.body.conditions).toEqual(['voting_not_started']);
      await t.prisma.election.update({ where: { id: child.id }, data: { votingStartsAt: new Date(Date.now() - 60_000) } });
      await open().expect(200);

      const parentRoll = (await t.prisma.voterRollEntry.findMany({ where: { electionId: w.electionId } })).map((r) => r.studentId).sort();
      const childRoll = (await t.prisma.voterRollEntry.findMany({ where: { electionId: child.id } })).map((r) => r.studentId).sort();
      expect(childRoll).toEqual(parentRoll);
      expect(childRoll).toContain(extra.studentId);
      expect(childRoll).not.toContain(late.studentId);
      expect((await t.prisma.election.findUniqueOrThrow({ where: { id: child.id } })).voterRollFrozenAt).not.toBeNull();

      // Le bulletin ne propose que les ex-aequo, sur le seul poste en égalité.
      const voter = w.voters[0];
      const ballot = (await t.api('get', `/voting/${child.id}/ballot`, voter.token).expect(200)).body;
      expect(ballot.positions).toHaveLength(1);
      expect(ballot.positions[0].candidates).toHaveLength(2);
      const childCandidates = await t.prisma.candidate.findMany({ where: { electionId: child.id } });
      const idsOf = (parentId: string) => childCandidates.find((x) => x.studentId === (parentIdToStudent.get(parentId) as string))!.id;
      const parentIdToStudent = new Map((await t.prisma.candidate.findMany({ where: { id: { in: [a, b, c] } } })).map((x) => [x.id, x.studentId]));
      const winner = idsOf(a);

      // 7 électeurs du premier tour votent a, 4 votent b ; l'étudiant tardif est refusé ; personne ne vote deux fois.
      const choices = (id: string) => [{ positionId: ballot.positions[0].id, candidateIds: [id] }];
      for (const v of w.voters.slice(0, 7)) await t.vote(v, child.id, choices(winner)).expect(201);
      for (const v of w.voters.slice(7, 11)) await t.vote(v, child.id, choices(idsOf(b))).expect(201);
      expect((await t.vote(w.voters[0], child.id, choices(winner))).status).toBe(409);
      expect((await t.vote(late, child.id, choices(winner))).status).toBe(403);
      // Un candidat éliminé au premier tour n'est pas votable.
      expect((await t.vote(w.voters[11], child.id, [{ positionId: ballot.positions[0].id, candidateIds: [c] }])).status).toBe(422);

      await t.api('post', `/elections/${child.id}/voting/close`, w.committee[0].token).send({ reason: 'fin' }).expect(200);
      const res = (await t.api('get', `/results/${child.id}`, w.committee[0].token).expect(200)).body;
      expect(res.positions).toHaveLength(1);
      expect(res.positions[0]).toMatchObject({ tie: false });
      expect(res.positions[0].winners).toHaveLength(1);
      expect(res.voters).toBe(11);
      await publish({ ...w, electionId: child.id }).expect(200);
      // Plus d'égalité au second tour : pas de troisième tour proposé.
      expect(((await secondRound({ ...w, electionId: child.id })).body as { message: string }).message).toBe('no_tie');
    });
  });

  describe('« PV signé » (D-47)', () => {
    /** Un rapport (deux langues) inséré directement : la génération du PDF est testée ailleurs. */
    async function seedReport(w: World, signedAt: Date | null = null) {
      const reportId = randomUUID();
      const code = `PV-${reportId.slice(0, 8).toUpperCase()}`;
      for (const language of ['FR', 'AR'] as const) {
        const f = await t.prisma.storedFile.create({ data: { purpose: FilePurpose.ELECTION_REPORT, storageKey: `reports/test/${randomUUID()}.pdf`, originalName: 'x.pdf', mimeType: 'application/pdf', sizeBytes: 1, sha256: 'a'.repeat(64) } });
        await t.prisma.electionReport.create({ data: { electionId: w.electionId, reportId, language, fileId: f.id, verificationCode: code, ballotsDigest: 'b'.repeat(64), sha256: 'a'.repeat(64), generatedById: t.admin.userId, signedAt } });
      }
      return { reportId, code };
    }
    const sign = (w: World, token = w.committee[0].token) => t.api('post', `/elections/${w.electionId}/report/signed`, token).send({});

    it('le comité marque le PV signé : les deux langues, audité ; une seconde fois 409 ; sans PV 404 ; administrateur d’institution 403', async () => {
      const { w } = await publishedWithTie();
      await t.prisma.electionReport.deleteMany({ where: { electionId: w.electionId } }); // pas de PV (génération échouée)
      expect((await sign(w)).status).toBe(404);
      const { reportId } = await seedReport(w);
      expect((await sign(w, t.admin.token)).status).toBe(403);
      expect((await sign(w)).status).toBe(200);
      const rows = await t.prisma.electionReport.findMany({ where: { electionId: w.electionId, reportId } });
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.signedAt !== null && r.signedById === w.committee[0].userId)).toBe(true);
      const second = await sign(w);
      expect([second.status, second.body.message]).toEqual([409, 'already_signed']);
      expect(await t.prisma.auditLog.count({ where: { resourceId: w.electionId, action: 'REPORT_SIGNED' } })).toBe(1);
      const list = (await t.api('get', `/elections/${w.electionId}/reports`, t.admin.token).expect(200)).body;
      expect(list[0].signedAt).not.toBeNull();
    });

    it('un PV regénéré est un nouveau rapport, à faire signer de nouveau', async () => {
      const { w } = await publishedWithTie();
      await t.prisma.electionReport.deleteMany({ where: { electionId: w.electionId } });
      await seedReport(w);
      await sign(w).expect(200);
      await new Promise((r) => setTimeout(r, 20));
      const fresh = await seedReport(w); // plus récent, non signé
      expect((await sign(w)).status).toBe(200); // c'est bien le nouveau qui est marqué
      const rows = await t.prisma.electionReport.findMany({ where: { electionId: w.electionId, reportId: fresh.reportId } });
      expect(rows.every((r) => r.signedAt)).toBe(true);
    });

    it('CONCURRENCE : dix marquages simultanés → un seul réussit', async () => {
      const { w } = await publishedWithTie();
      await t.prisma.electionReport.deleteMany({ where: { electionId: w.electionId } });
      await seedReport(w);
      const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => sign(w, w.committee[i % 3].token)));
      expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
      expect(rs.filter((r) => r.status === 409)).toHaveLength(9);
      expect(await t.prisma.auditLog.count({ where: { resourceId: w.electionId, action: 'REPORT_SIGNED' } })).toBe(1);
    });
  });

  describe('tableau de bord de l’administrateur d’institution (D-48)', () => {
    const dashboard = (token = t.admin.token) => t.api('get', `/institutions/${t.institutionId}/dashboard`, token);

    it('élections en cours et à venir, inscriptions à vérifier, PV non signés : des chiffres exacts', async () => {
      const draft = await t.election({ status: ElectionStatus.DRAFT, voters: 1 });
      const open = await t.election({ voters: 4, positions: [{ title: 'Président', candidates: 2 }] });
      await t.simulateVotes(open, [[open.positions[0].candidateIds[0]], [open.positions[0].candidateIds[1]]]);
      const closed = await t.election({ voters: 3, positions: [{ title: 'Président', candidates: 2 }] });
      await t.simulateVotes(closed, [[closed.positions[0].candidateIds[0]], [closed.positions[0].candidateIds[0]], [closed.positions[0].candidateIds[1]]]);
      await close(closed).expect(200);
      const { w: published } = await publishedWithTie();
      await t.prisma.electionReport.deleteMany({ where: { electionId: published.electionId } });
      await seedPendingEnrollments(2);
      const withoutPv = await t.election({ voters: 3, positions: [{ title: 'Président', candidates: 2 }] });
      await t.simulateVotes(withoutPv, [[withoutPv.positions[0].candidateIds[0]], [withoutPv.positions[0].candidateIds[0]], [withoutPv.positions[0].candidateIds[1]]]);
      await close(withoutPv).expect(200);
      await publish(withoutPv).expect(200);
      await t.prisma.electionReport.deleteMany({ where: { electionId: withoutPv.electionId } }); // avec Chromium (CI), la publication crée le PV : on simule son absence

      const before = (await dashboard().expect(200)).body;
      const ids = (list: { id: string }[]) => list.map((e) => e.id);
      expect(ids(before.upcoming)).toContain(draft.electionId);
      expect(ids(before.inProgress)).toEqual(expect.arrayContaining([open.electionId, closed.electionId]));
      expect(ids(before.inProgress)).not.toContain(published.electionId); // publiée : plus « en cours »
      const row = before.inProgress.find((e: { id: string }) => e.id === open.electionId);
      expect(row.participation).toMatchObject({ registered: 4, sliced: true }); // sous 50 électeurs : tranches de 15 min (D-31)
      expect(before.inProgress.find((e: { id: string }) => e.id === closed.electionId).participation).toMatchObject({ registered: 3, voted: 3, rate: 100 });
      expect(before.counts.votingOpen).toBeGreaterThanOrEqual(1);
      expect(before.counts.awaitingPublication).toBeGreaterThanOrEqual(1);
      expect(before.pendingVerifications).toBeGreaterThanOrEqual(2);
      expect(before.publishedWithoutReport.items.map((e: { electionId: string }) => e.electionId)).toEqual(expect.arrayContaining([published.electionId, withoutPv.electionId]));

      // PV non signés : ajouter un rapport fait monter le compte ; le marquer signé le retire.
      const base = before.reportsToSign.count;
      await seedReportFor(published);
      let after = (await dashboard().expect(200)).body;
      expect(after.reportsToSign.count).toBe(base + 1);
      expect(after.reportsToSign.items.map((e: { electionId: string }) => e.electionId)).toContain(published.electionId);
      expect(after.publishedWithoutReport.items.map((e: { electionId: string }) => e.electionId)).not.toContain(published.electionId);
      await t.api('post', `/elections/${published.electionId}/report/signed`, published.committee[0].token).send({}).expect(200);
      after = (await dashboard().expect(200)).body;
      expect(after.reportsToSign.count).toBe(base);
    });

    it('D-02 : aucun nom, e-mail ni identifiant d’étudiant ou de compte ; comité et étudiant refusés (403)', async () => {
      const w = await t.election({ voters: 3 });
      const body = JSON.stringify((await dashboard().expect(200)).body);
      for (const v of [...w.voters, ...w.committee]) {
        expect(body).not.toContain(v.studentId);
        expect(body).not.toContain(v.userId);
      }
      expect(body).not.toMatch(/@example\.test/);
      await dashboard(w.committee[0].token).expect(403);
      await dashboard(w.voters[0].token).expect(403);
    });

    async function seedPendingEnrollments(n: number) {
      for (const s of await t.students(n, 'verif')) {
        await t.prisma.studentEnrollment.update({ where: { id: s.enrollmentId }, data: { status: 'PENDING' } });
        const f = await t.prisma.storedFile.create({ data: { purpose: FilePurpose.REGISTRATION_DOCUMENT, storageKey: `docs/test/${randomUUID()}.pdf`, originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 1, sha256: 'a'.repeat(64) } });
        await t.prisma.registrationDocument.create({ data: { enrollmentId: s.enrollmentId, fileId: f.id, status: 'UPLOADED' } });
      }
    }
    async function seedReportFor(w: World) {
      const reportId = randomUUID();
      for (const language of ['FR', 'AR'] as const) {
        const f = await t.prisma.storedFile.create({ data: { purpose: FilePurpose.ELECTION_REPORT, storageKey: `reports/test/${randomUUID()}.pdf`, originalName: 'x.pdf', mimeType: 'application/pdf', sizeBytes: 1, sha256: 'a'.repeat(64) } });
        await t.prisma.electionReport.create({ data: { electionId: w.electionId, reportId, language, fileId: f.id, verificationCode: `PV-${reportId.slice(0, 8)}`, ballotsDigest: 'b'.repeat(64), sha256: 'a'.repeat(64), generatedById: t.admin.userId } });
      }
    }
  });
});
