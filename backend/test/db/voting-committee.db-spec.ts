import { ElectionStatus } from '@prisma/client';
import { DAY, VotingWorld, World } from './voting-world';

// Sprint 6A : prolongation unique (D-33, D-38), ajout exceptionnel d'un électeur (04 §5.2, D-39), suivi du vote (D-02, D-31).
// Vraie base MySQL. Non exécuté en local sans Docker : à lancer avec `npm run test:db` (la CI les lance).
describe('Comité : prolongation, ajout exceptionnel, suivi (Sprint 6A)', () => {
  const t = new VotingWorld();
  beforeAll(() => t.start());
  afterAll(() => t.stop());

  const H = 3_600_000;
  const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
  const extend = (w: World, body: Record<string, unknown> = {}, token = w.committee[0].token) =>
    t.api('post', `/elections/${w.electionId}/voting/extend`, token).send({ outageStartedAt: iso(-3 * H), outageEndedAt: iso(-1 * H), newEndsAt: iso(DAY + 2 * H - 1000), reason: 'panne du serveur', ...body });
  const ends = async (w: World) => (await t.prisma.election.findUniqueOrThrow({ where: { id: w.electionId } })).votingEndsAt;

  describe('prolongation', () => {
    it('prolonge une fois, garde la fin initiale, écrit l’audit avec motif et panne', async () => {
      const w = await t.election({ endsIn: DAY });
      const before = await ends(w);
      const res = await extend(w);
      expect(res.status).toBe(200);
      const e = await t.prisma.election.findUniqueOrThrow({ where: { id: w.electionId } });
      expect(e.votingEndsAt.getTime()).toBeGreaterThan(before.getTime());
      expect(e.votingEndsAtOriginal?.getTime()).toBe(before.getTime());
      expect(e.votingExtendedAt).not.toBeNull();
      const log = await t.prisma.auditLog.findFirst({ where: { resourceId: w.electionId, action: 'ELECTION_VOTING_EXTENDED' } });
      expect(log?.metadata).toMatchObject({ reason: 'panne du serveur' });
      expect(log?.actorId).toBe(w.committee[0].userId);
    });

    it('deuxième prolongation refusée (409), la fin ne bouge plus', async () => {
      const w = await t.election({ endsIn: DAY });
      await extend(w).expect(200);
      const after = await ends(w);
      const second = await extend(w, { newEndsAt: iso(DAY + 3 * H) });
      expect(second.status).toBe(409);
      expect(second.body.message).toBe('already_extended');
      expect((await ends(w)).getTime()).toBe(after.getTime());
    });

    it('CONCURRENCE : dix prolongations simultanées → une seule réussit', async () => {
      const w = await t.election({ endsIn: DAY });
      const results = await Promise.all(Array.from({ length: 10 }, (_, i) => extend(w, {}, w.committee[i % 3].token)));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(9);
      expect(await t.prisma.auditLog.count({ where: { resourceId: w.electionId, action: 'ELECTION_VOTING_EXTENDED' } })).toBe(1);
    });

    it('refuse plus que la panne, plus de 24 h, un raccourcissement, une panne incohérente (422)', async () => {
      const w = await t.election({ endsIn: DAY });
      const cases: [string, Record<string, unknown>][] = [
        ['extension_exceeds_outage', { newEndsAt: iso(DAY + 3 * H) }],
        ['extension_not_after_current', { newEndsAt: iso(DAY - H) }],
        ['outage_invalid', { outageEndedAt: iso(2 * H) }],
      ];
      for (const [code, body] of cases) {
        const r = await extend(w, body);
        expect([r.status, r.body.message]).toEqual([422, code]);
      }
      expect((await t.prisma.election.findUniqueOrThrow({ where: { id: w.electionId } })).votingExtendedAt).toBeNull();
    });

    it('refuse hors VOTING_OPEN et après l’heure de fin (409) : prolonger AVANT la fin', async () => {
      const closed = await t.election({ status: ElectionStatus.VOTING_CLOSED });
      expect((await extend(closed)).status).toBe(409);
      const late = await t.election({ endsIn: -H }); // VOTING_OPEN mais l’heure de fin est passée
      const r = await extend(late, { outageStartedAt: iso(-5 * H), outageEndedAt: iso(-3 * H), newEndsAt: iso(-H + 2 * H) });
      expect(r.status).toBe(409);
    });

    it('exige la 2FA récente (401) et le rôle comité (pas un étudiant, pas un autre comité)', async () => {
      const w = await t.election({ endsIn: DAY });
      await t.prisma.refreshToken.updateMany({ where: { userId: w.committee[1].userId }, data: { twoFactorVerifiedAt: new Date(Date.now() - 3 * H) } });
      expect((await extend(w, {}, w.committee[1].token)).status).toBe(401);
      expect((await extend(w, {}, w.voters[0].token)).status).toBe(403);
      const other = await t.election({ endsIn: DAY });
      expect([403, 404]).toContain((await extend(w, {}, other.committee[0].token)).status);
      expect((await t.prisma.election.findUniqueOrThrow({ where: { id: w.electionId } })).votingExtendedAt).toBeNull();
    });

    it('un vote est possible après l’ancienne heure de fin, grâce à la prolongation', async () => {
      const w = await t.election({ endsIn: 60_000 });
      await t.prisma.election.update({ where: { id: w.electionId }, data: { votingEndsAt: new Date(Date.now() + 2000) } });
      await extend(w, { newEndsAt: iso(2000 + 1.5 * H), outageStartedAt: iso(-3 * H), outageEndedAt: iso(-1 * H) }).expect(200);
      await new Promise((r) => setTimeout(r, 2500));
      await t.vote(w.voters[0], w.electionId, t.firstChoices(w)).expect(201);
    });
  });

  describe('ajout exceptionnel', () => {
    const preview = (w: World, studentNumber: string, token = w.committee[0].token) => t.api('post', `/elections/${w.electionId}/voter-roll/preview`, token).send({ studentNumber });
    const add = (w: World, studentNumber: string, reason = 'oublié par la scolarité', token = w.committee[0].token) =>
      t.api('post', `/elections/${w.electionId}/voter-roll`, token).send({ studentNumber, reason });
    const numberOf = async (studentId: string) => (await t.prisma.student.findUniqueOrThrow({ where: { id: studentId } })).studentNumber as string;
    const rollSize = (w: World) => t.prisma.voterRollEntry.count({ where: { electionId: w.electionId } });

    /** Élection ouverte avec une règle programme + niveau, puis un étudiant vérifié APRÈS le gel (donc hors liste). */
    async function opened() {
      const w = await t.election({ withRule: true, voters: 3 });
      const [late] = await t.students(1, 'tardif');
      return { w, late, number: await numberOf(late.studentId) };
    }

    it('aperçu : filière, niveau, groupe, sans le nom ; n’écrit rien', async () => {
      const { w, number } = await opened();
      const before = await rollSize(w);
      const res = await preview(w, number);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['faculty', 'group', 'level', 'program']);
      expect(JSON.stringify(res.body)).not.toMatch(new RegExp(`${number}|Test`)); // ni matricule ni nom
      expect(await rollSize(w)).toBe(before);
    });

    it('ajoute l’électeur : il peut voter, l’audit garde le motif, turnout compte l’ajout', async () => {
      const { w, late, number } = await opened();
      const before = await rollSize(w);
      const res = await add(w, number);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ registered: before + 1 });
      const entry = await t.prisma.voterRollEntry.findUniqueOrThrow({ where: { electionId_studentId: { electionId: w.electionId, studentId: late.studentId } } });
      expect(entry.addedAfterFreeze).toBe(true);
      const log = await t.prisma.auditLog.findFirst({ where: { resourceId: w.electionId, action: 'ELECTION_VOTER_ADDED' } });
      expect(log?.metadata).toMatchObject({ reason: 'oublié par la scolarité' });
      expect(JSON.stringify(log?.metadata)).not.toContain(number);
      await t.vote(late, w.electionId, t.firstChoices(w)).expect(201);
      const turnout = await t.api('get', `/elections/${w.electionId}/turnout`, w.committee[0].token).expect(200);
      expect(turnout.body).toMatchObject({ registered: before + 1, voted: 1, addedAfterFreeze: 1 });
    });

    it('tous les refus se ressemblent : inconnu, non vérifié, hors règles, déjà inscrit (404 voter_not_addable)', async () => {
      const { w, number } = await opened();
      const [unverified] = await t.students(1, 'nonverif');
      await t.prisma.studentEnrollment.updateMany({ where: { studentId: unverified.studentId }, data: { status: 'PENDING' } });
      const [outside] = await t.students(1, 'horsregle');
      const otherLevel = await t.prisma.level.create({ data: { institutionId: t.institutionId, code: `X${Math.random().toString(36).slice(2, 6)}`, name: 'Autre niveau', rank: 9 } });
      await t.prisma.studentEnrollment.updateMany({ where: { studentId: outside.studentId }, data: { levelId: otherLevel.id } });
      const onRoll = await numberOf(w.voters[0].studentId);
      const bodies = [];
      for (const n of ['MATRICULE-INCONNU', await numberOf(unverified.studentId), await numberOf(outside.studentId), onRoll]) {
        for (const r of [await preview(w, n), await add(w, n)]) {
          expect(r.status).toBe(404);
          bodies.push(JSON.stringify(r.body));
        }
      }
      expect(new Set(bodies.map((b) => JSON.parse(b).message))).toEqual(new Set(['voter_not_addable']));
      expect(await add(w, number).then((r) => r.status)).toBe(200); // témoin : un ajoutable passe
    });

    it('même étudiant ajouté deux fois en parallèle : une seule inscription', async () => {
      const { w, number } = await opened();
      const before = await rollSize(w);
      const rs = await Promise.all(Array.from({ length: 6 }, () => add(w, number)));
      expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
      expect(rs.filter((r) => r.status === 404)).toHaveLength(5);
      expect(await rollSize(w)).toBe(before + 1);
    });

    it('seulement en VOTING_OPEN (409), 🔐 2FA récente, et comité seulement', async () => {
      const { w, number } = await opened();
      await t.prisma.election.update({ where: { id: w.electionId }, data: { status: ElectionStatus.VOTING_CLOSED } });
      expect((await add(w, number)).status).toBe(409);
      expect((await preview(w, number)).status).toBe(409);
      await t.prisma.election.update({ where: { id: w.electionId }, data: { status: ElectionStatus.VOTING_OPEN } });
      await t.prisma.refreshToken.updateMany({ where: { userId: w.committee[2].userId }, data: { twoFactorVerifiedAt: new Date(Date.now() - 3 * H) } });
      expect((await add(w, number, 'oubli', w.committee[2].token)).status).toBe(401);
      expect((await add(w, number, 'oubli', w.voters[0].token)).status).toBe(403);
      expect((await add(w, number, 'x')).status).toBe(400); // motif trop court
    });
  });

  it('suivi : chiffres seulement (D-02), tranches de 15 min sous 50 électeurs (D-31), pas de liste nominative', async () => {
    const w = await t.election({ voters: 4 });
    await t.simulateVotes(w, [[w.positions[0].candidateIds[0]], [w.positions[0].candidateIds[1]]]);
    const res = await t.api('get', `/elections/${w.electionId}/turnout`, w.committee[0].token).expect(200);
    expect(res.body).toMatchObject({ registered: 4, sliced: true, extended: false, addedAfterFreeze: 0 });
    expect(Object.keys(res.body).sort()).toEqual(['addedAfterFreeze', 'asOf', 'extended', 'rate', 'registered', 'sliced', 'status', 'voted', 'votingEndsAt', 'votingStartsAt'].sort());
    expect(JSON.stringify(res.body)).not.toMatch(new RegExp(w.voters[0].studentId));
    expect(new Date(res.body.asOf).getTime() % (15 * 60_000)).toBe(0);
  });
});
