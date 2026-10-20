import { createHash, randomUUID } from 'crypto';
import { AuditService } from '../../src/audit/audit.service';
import { ReportsService } from '../../src/reports/reports.service';
import { VotingWorld, World } from './voting-world';

// Sprint 6B : publication des résultats par le comité (D-41), procès-verbal par langue (D-42, D-43), « Vérifier l'urne » (D-45).
// Vraie base MySQL. Les tests qui impriment un PDF exigent Chromium : CHROMIUM_PATH (Chrome préinstallé sur la CI).
const pdfIt = process.env.CHROMIUM_PATH ? it : it.skip;

describe('Publication, procès-verbal et vérification de l’urne (Sprint 6B)', () => {
  const t = new VotingWorld();
  beforeAll(() => t.start());
  afterAll(() => t.stop());

  const close = (w: World) => t.api('post', `/elections/${w.electionId}/voting/close`, w.committee[0].token).send({ reason: 'fin du scrutin' });
  const publish = (w: World, token = w.committee[0].token) => t.api('post', `/elections/${w.electionId}/results/publish`, token).send({});
  const generate = (w: World, token = t.admin.token) => t.api('post', `/elections/${w.electionId}/report`, token).send({});
  const verify = (w: World, token = w.committee[0].token) => t.api('get', `/results/${w.electionId}/verify`, token);
  const stray = (w: World) => t.prisma.ballot.create({ data: { id: randomUUID(), electionId: w.electionId } }); // un bulletin sans participation
  const status = async (w: World) => (await t.prisma.election.findUniqueOrThrow({ where: { id: w.electionId } })).status;

  /** 5 votants ; poste 1 : a 3 voix, b 2 ; poste 2 : égalité 2-2 et un blanc. */
  async function closedElection(voters = 5) {
    const w = await t.election({ voters, positions: [{ title: 'Délégué des sports', candidates: 2 }, { title: 'Secrétaire', candidates: 2 }] });
    const [[a, b], [c, d]] = w.positions.map((p) => p.candidateIds);
    const plans = [[a, c], [a, c], [a, d], [b, d], [b, null]].slice(0, voters);
    await t.simulateVotes(w, plans);
    await close(w).expect(200);
    return w;
  }

  describe('publication (D-41)', () => {
    it('le comité seulement : l’administrateur d’institution et un électeur sont refusés (403), rien ne change', async () => {
      const w = await closedElection();
      await publish(w, t.admin.token).expect(403);
      await publish(w, w.voters[0].token).expect(403);
      expect(await status(w)).toBe('VOTING_CLOSED');
    });

    it('bloquée si votants ≠ bulletins : 409 integrity_failed', async () => {
      const w = await t.election({ voters: 3, positions: [{ title: 'Président' }] });
      await t.simulateVotes(w, [[w.positions[0].candidateIds[0]], [w.positions[0].candidateIds[0]], [w.positions[0].candidateIds[1]]]);
      await stray(w); // un bulletin de trop AVANT la clôture : le décompte détecte l'écart
      await close(w).expect(200);
      const res = await publish(w);
      expect(res.status).toBe(409);
      expect(res.body.conditions).toContain('integrity_failed');
      expect(await status(w)).toBe('VOTING_CLOSED');
    });

    it('bloquée si l’urne a changé depuis le décompte : 409 tally_stale', async () => {
      const w = await closedElection();
      await stray(w); // altération APRÈS le décompte
      const res = await publish(w);
      expect(res.status).toBe(409);
      expect(res.body.conditions).toContain('tally_stale');
      expect(await status(w)).toBe('VOTING_CLOSED');
    });

    it('bloquée si la chaîne d’audit est rompue : 409 audit_chain_broken, puis possible une fois la chaîne rétablie', async () => {
      const w = await closedElection();
      const spy = jest.spyOn(t.app.get(AuditService), 'verifyChain').mockResolvedValue({ valid: false, checked: 10, brokenAtId: '7' });
      try {
        const res = await publish(w);
        expect(res.status).toBe(409);
        expect(res.body.conditions).toContain('audit_chain_broken');
        expect(await status(w)).toBe('VOTING_CLOSED');
      } finally {
        spy.mockRestore();
      }
      await publish(w).expect(200);
      expect(await status(w)).toBe('RESULTS_PUBLISHED');
    });

    it('toutes les conditions manquantes sont listées dans la même réponse', async () => {
      const w = await t.election({ voters: 3, positions: [{ title: 'Président' }] });
      await t.simulateVotes(w, [[w.positions[0].candidateIds[0]], [w.positions[0].candidateIds[0]], [w.positions[0].candidateIds[1]]]);
      await stray(w);
      await close(w).expect(200);
      await stray(w); // et encore un après
      const spy = jest.spyOn(t.app.get(AuditService), 'verifyChain').mockResolvedValue({ valid: false, checked: 1, brokenAtId: '1' });
      try {
        const res = await publish(w);
        expect([...res.body.conditions].sort()).toEqual(['audit_chain_broken', 'integrity_failed', 'tally_stale']);
      } finally {
        spy.mockRestore();
      }
    });

    it('le PV ne se génère pas avant la publication (409)', async () => {
      const w = await closedElection();
      await generate(w).expect(409);
    });
  });

  describe('D-32 : le détail se juge sur les votants de l’élection', () => {
    it('2 votants → aucun poste détaillé ; 3 votants → tous détaillés ; un seul votant à 2 choix ne dévoile rien', async () => {
      const reports = t.app.get(ReportsService);
      const ids = () => ({ reportId: randomUUID(), verificationCode: 'PV-TEST', generatedAt: new Date() });

      const two = await t.election({ voters: 2, positions: [{ title: 'Président', candidates: 2 }] });
      await t.simulateVotes(two, [[two.positions[0].candidateIds[0]], [two.positions[0].candidateIds[0]]]);
      await close(two).expect(200);
      expect((await reports.buildData(two.electionId, ids())).positions.map((p) => p.detailPublished)).toEqual([false]);

      const three = await t.election({ voters: 3, positions: [{ title: 'Président', candidates: 2 }] });
      const [x, y] = three.positions[0].candidateIds;
      await t.simulateVotes(three, [[x], [x], [y]]);
      await close(three).expect(200);
      expect((await reports.buildData(three.electionId, ids())).positions.map((p) => p.detailPublished)).toEqual([true]);

      // Un seul votant, deux choix sur un poste à 2 choix : 2 voix pour le poste, mais 1 seul votant → rien n'est publié.
      const one = await t.election({ voters: 1, positions: [{ title: 'Bureau', candidates: 3, maxChoices: 2, seats: 2 }] });
      const [p, q] = one.positions[0].candidateIds;
      await t.prisma.votingParticipation.create({ data: { electionId: one.electionId, studentId: one.voters[0].studentId } });
      const ballot = await t.prisma.ballot.create({ data: { id: randomUUID(), electionId: one.electionId } });
      await t.prisma.ballotChoice.createMany({ data: [p, q].map((candidateId) => ({ id: randomUUID(), ballotId: ballot.id, positionId: one.positions[0].id, candidateId })) });
      await close(one).expect(200);
      expect((await reports.buildData(one.electionId, ids())).positions.map((p2) => p2.detailPublished)).toEqual([false]);
      await publish(one).expect(200);
      const api = (await t.api('get', `/results/${one.electionId}`, one.voters[0].token).expect(200)).body.positions[0];
      expect(api.detailPublished).toBe(false);
    });
  });

  describe('procès-verbal : un PDF par langue (D-42, D-43)', () => {
    pdfIt('la publication crée les deux versions : même identifiant et même code, SHA-256 propres, fichiers relus identiques', async () => {
      const w = await closedElection();
      const res = await publish(w);
      expect(res.status).toBe(200);
      expect(res.body.report).toBe('generated');

      const rows = await t.prisma.electionReport.findMany({ where: { electionId: w.electionId }, include: { file: true }, orderBy: { language: 'asc' } });
      expect(rows.map((r) => r.language)).toEqual(['FR', 'AR']);
      expect(new Set(rows.map((r) => r.reportId)).size).toBe(1);
      expect(new Set(rows.map((r) => r.verificationCode)).size).toBe(1);
      expect(new Set(rows.map((r) => r.ballotsDigest)).size).toBe(1);
      expect(rows[0].sha256).not.toBe(rows[1].sha256);
      const tally = await t.prisma.electionTally.findUniqueOrThrow({ where: { electionId: w.electionId } });
      expect(rows[0].ballotsDigest).toBe(tally.ballotsDigest);

      for (const lang of ['fr', 'ar'] as const) {
        const dl = await t.api('get', `/elections/${w.electionId}/report/download?lang=${lang}`, w.committee[0].token).expect(200);
        expect(dl.headers['content-type']).toContain('application/pdf');
        expect(dl.headers['cache-control']).toContain('no-store');
        const body: Buffer = dl.body;
        expect(body.subarray(0, 5).toString()).toBe('%PDF-');
        const row = rows.find((r) => r.language === lang.toUpperCase())!;
        expect(createHash('sha256').update(body).digest('hex')).toBe(row.sha256);
      }
    });

    pdfIt('lecture : le comité et l’administrateur d’institution ; pas un électeur (403) ni une autre langue (400)', async () => {
      const w = await closedElection();
      await publish(w).expect(200);
      await t.api('get', `/elections/${w.electionId}/report/download?lang=ar`, t.admin.token).expect(200);
      await t.api('get', `/elections/${w.electionId}/report/download?lang=ar`, w.voters[0].token).expect(403);
      await t.api('get', `/elections/${w.electionId}/report/download?lang=en`, w.committee[0].token).expect(400);
      expect((await t.api('get', `/elections/${w.electionId}/reports`, t.admin.token).expect(200)).body).toHaveLength(1);
      expect(await t.prisma.auditLog.count({ where: { resourceId: w.electionId, action: { in: ['REPORT_GENERATED', 'REPORT_DOWNLOADED'] } } })).toBeGreaterThanOrEqual(2);
    });

    pdfIt('l’administrateur d’institution regénère le PV : nouveau rapport, le téléchargement donne le plus récent, la chaîne d’audit reste intègre', async () => {
      const w = await closedElection();
      await publish(w).expect(200);
      const first = (await t.api('get', `/elections/${w.electionId}/reports`, t.admin.token).expect(200)).body[0];
      const regen = await generate(w).expect(200);
      expect(regen.body.reportId).not.toBe(first.reportId);
      const list = (await t.api('get', `/elections/${w.electionId}/reports`, t.admin.token).expect(200)).body;
      expect(list.map((r: { reportId: string }) => r.reportId)).toEqual([regen.body.reportId, first.reportId]);
      const latest = await t.prisma.electionReport.findFirstOrThrow({ where: { electionId: w.electionId, language: 'FR' }, orderBy: { generatedAt: 'desc' } });
      const dl = await t.api('get', `/elections/${w.electionId}/report/download?lang=fr`, t.admin.token).expect(200);
      expect(createHash('sha256').update(dl.body).digest('hex')).toBe(latest.sha256);
      expect((await t.app.get(AuditService).verifyChain()).valid).toBe(true);
    });

    it('le PV ne contient ni identifiant d’étudiant ni choix individuel : seulement des agrégats et l’identité publique des candidats', async () => {
      const w = await closedElection();
      const data = await t.app.get(ReportsService).buildData(w.electionId, { reportId: randomUUID(), verificationCode: 'PV-TEST', generatedAt: new Date() });
      const json = JSON.stringify(data);
      for (const v of [...w.voters, ...w.committee]) {
        expect(json).not.toContain(v.studentId);
        expect(json).not.toContain(v.userId);
      }
      expect(json).not.toMatch(/@example\.test/); // pas d'e-mail de membre du comité
    });

    it('les noms de postes du PV viennent de la base ; l’égalité est signalée avec les ex-aequo', async () => {
      const w = await closedElection();
      const data = await t.app.get(ReportsService).buildData(w.electionId, { reportId: randomUUID(), verificationCode: 'PV-TEST', generatedAt: new Date() });
      expect(data.positions.map((p) => p.title)).toEqual(['Délégué des sports', 'Secrétaire']);
      const [sports, secretary] = data.positions;
      expect(sports.tie).toBeNull();
      expect(sports.winners).toHaveLength(1);
      expect(secretary.tie?.tied).toHaveLength(2);
      expect(secretary.tie?.seatsLeft).toBe(1);
      expect(secretary.winners).toEqual([]);
      expect(data).toMatchObject({ registered: 5, voters: 5, ballots: 5, turnoutRate: 100, committeeSize: 3, addedAfterFreeze: 0, extension: null });
    });

    it('un ajout exceptionnel et une prolongation figurent dans les données du PV', async () => {
      const w = await t.election({ voters: 3, startsIn: -6 * 3_600_000, endsIn: 24 * 3_600_000, positions: [{ title: 'Président' }] });
      const [c] = w.positions[0].candidateIds;
      await t.simulateVotes(w, [[c], [c], [c]]);
      await t.prisma.voterRollEntry.update({ where: { electionId_studentId: { electionId: w.electionId, studentId: w.voters[0].studentId } }, data: { addedAfterFreeze: true } });
      const H = 3_600_000;
      await t.api('post', `/elections/${w.electionId}/voting/extend`, w.committee[0].token).send({
        outageStartedAt: new Date(Date.now() - 3 * H).toISOString(), outageEndedAt: new Date(Date.now() - H).toISOString(), newEndsAt: new Date(Date.now() + 25 * H).toISOString(), reason: 'panne du serveur',
      }).expect(200);
      await close(w).expect(200);
      const data = await t.app.get(ReportsService).buildData(w.electionId, { reportId: randomUUID(), verificationCode: 'PV-TEST', generatedAt: new Date() });
      expect(data.addedAfterFreeze).toBe(1);
      expect(data.extension?.reason).toBe('panne du serveur');
      expect(data.extension?.outage).not.toBeNull();
      expect(data.extension!.newEndsAt.getTime()).toBeGreaterThan(data.extension!.originalEndsAt.getTime());
    });
  });

  describe('« Vérifier l’urne » (D-45)', () => {
    pdfIt('urne intacte : l’empreinte recalculée est identique à celle du décompte et du PV ; urne altérée : différente', async () => {
      const w = await closedElection();
      await publish(w).expect(200);
      const ok = (await verify(w).expect(200)).body;
      expect(ok).toMatchObject({ matchesTally: true, matchesReport: true });
      expect(ok.computedDigest).toBe(ok.tallyDigest);
      expect(ok.computedDigest).toBe(ok.reportDigest);
      expect(ok.reportId).toMatch(/^[0-9a-f-]{36}$/);
      expect(JSON.stringify(ok)).not.toMatch(/ballotId|choices|candidateId/); // aucun bulletin ni choix renvoyé

      await stray(w); // altération de l'urne après la publication
      const bad = (await verify(w, t.admin.token).expect(200)).body;
      expect(bad).toMatchObject({ matchesTally: false, matchesReport: false });
      expect(bad.computedDigest).not.toBe(bad.reportDigest);
      expect(await t.prisma.auditLog.count({ where: { resourceId: w.electionId, action: 'URN_VERIFIED' } })).toBe(2);
    });

    it('sans PV (ou avant sa génération) : comparée au décompte seulement ; réservé au personnel', async () => {
      const w = await closedElection();
      const res = (await verify(w).expect(200)).body;
      expect(res).toMatchObject({ matchesTally: true, matchesReport: null, reportDigest: null });
      await verify(w, w.voters[0].token).expect(403);
    });
  });
});
