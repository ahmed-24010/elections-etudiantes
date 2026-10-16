import { VotingService } from '../../src/voting/voting.service';
import { VotingWorld } from './voting-world';

// Bulletin vierge (D-35), statut de l'électeur, notification (D-36) et participation en chiffres (D-02, D-31).
describe('Écrans du vote : bulletin, statut, notification, participation', () => {
  const t = new VotingWorld();
  beforeAll(() => t.start());
  afterAll(() => t.stop());

  describe('bulletin vierge (GET /voting/:id/ballot)', () => {
    it('postes et candidats validés seulement, sans aucun identifiant d’étudiant', async () => {
      const w = await t.election({ voters: 1, positions: [{ title: 'Président', candidates: 3 }, { title: 'Trésorier', candidates: 2, maxChoices: 2, allowBlank: false }] });
      await t.prisma.candidate.update({ where: { id: w.positions[0].candidateIds[2] }, data: { status: 'REJECTED' } });
      const res = await t.api('get', `/voting/${w.electionId}/ballot`, w.voters[0].token).expect(200);
      expect(res.body.positions).toHaveLength(2);
      const [p1, p2] = res.body.positions;
      expect(p1.candidates).toHaveLength(2); // le candidat rejeté n’y figure pas
      expect(p2).toMatchObject({ maxChoices: 2, allowBlank: false });
      const text = JSON.stringify(res.body);
      for (const id of [...w.positions.flatMap((p) => p.candidateStudentIds), ...w.voters.flatMap((v) => [v.studentId, v.userId])]) expect(text).not.toContain(id);
    });

    it('l’ordre des candidats est aléatoire à chaque appel (D-35)', async () => {
      const w = await t.election({ voters: 1, positions: [{ title: 'Président', candidates: 8 }] });
      const orders = new Set<string>();
      for (let i = 0; i < 12; i++) {
        const res = await t.api('get', `/voting/${w.electionId}/ballot`, w.voters[0].token).expect(200);
        const ids: string[] = res.body.positions[0].candidates.map((c: { id: string }) => c.id);
        expect([...ids].sort()).toEqual([...w.positions[0].candidateIds].sort());
        orders.add(ids.join());
      }
      expect(orders.size).toBeGreaterThan(1); // 8! ordres possibles : douze tirages identiques sont pratiquement impossibles
    });

    it('refusé hors du vote : 409 ELECTION_NOT_OPEN, 403 NOT_ON_VOTER_ROLL, 409 ALREADY_VOTED', async () => {
      const closed = await t.election({ voters: 1, status: 'CANDIDACY_CLOSED', fillRoll: true });
      expect((await t.api('get', `/voting/${closed.electionId}/ballot`, closed.voters[0].token)).body.message).toBe('ELECTION_NOT_OPEN');
      const w = await t.election({ voters: 1 });
      const [outsider] = await t.students(1, 'hors-liste');
      expect((await t.api('get', `/voting/${w.electionId}/ballot`, outsider.token)).body.message).toBe('NOT_ON_VOTER_ROLL');
      await t.vote(w.voters[0], w.electionId, t.firstChoices(w)).expect(201);
      expect((await t.api('get', `/voting/${w.electionId}/ballot`, w.voters[0].token)).body.message).toBe('ALREADY_VOTED');
    });
  });

  describe('statut de l’électeur (GET /voting/:id/status)', () => {
    it('NOT_VOTED puis VOTED avec l’heure ; NOT_ON_ROLL pour un étudiant hors liste ; jamais le contenu du vote', async () => {
      const w = await t.election({ voters: 1 });
      const [outsider] = await t.students(1, 'hors-liste');
      expect((await t.api('get', `/voting/${w.electionId}/status`, w.voters[0].token).expect(200)).body).toMatchObject({ state: 'NOT_VOTED', open: true, votedAt: null });
      expect((await t.api('get', `/voting/${w.electionId}/status`, outsider.token).expect(200)).body).toMatchObject({ state: 'NOT_ON_ROLL' });
      await t.vote(w.voters[0], w.electionId, t.firstChoices(w)).expect(201);
      const after = await t.api('get', `/voting/${w.electionId}/status`, w.voters[0].token).expect(200);
      expect(after.body).toMatchObject({ state: 'VOTED' });
      expect(Math.abs(Date.now() - new Date(after.body.votedAt).getTime())).toBeLessThan(120_000);
      for (const id of w.positions[0].candidateIds) expect(JSON.stringify(after.body)).not.toContain(id);
    });

    it('un membre du comité n’y a pas accès (c’est l’état de l’étudiant lui-même)', async () => {
      const w = await t.election({ voters: 1 });
      await t.api('get', `/voting/${w.electionId}/status`, w.committee[0].token).expect(403);
    });
  });

  describe('notification « un vote a été enregistré pour vous » (D-36)', () => {
    it('une notification après le vote : le titre de l’élection, aucun choix', async () => {
      const w = await t.election({ voters: 2, positions: [{ title: 'Président' }, { title: 'Trésorier' }] });
      const title = (await t.prisma.election.findUniqueOrThrow({ where: { id: w.electionId } })).title;
      await t.vote(w.voters[0], w.electionId, t.firstChoices(w)).expect(201);
      const mine = await t.api('get', '/notifications', w.voters[0].token).expect(200);
      expect(mine.body.items).toEqual([expect.objectContaining({ type: 'VOTE_RECORDED', body: title })]);
      const text = JSON.stringify(mine.body);
      for (const id of w.positions.flatMap((p) => [p.id, ...p.candidateIds])) expect(text).not.toContain(id);
      // l’autre électeur, qui n’a pas voté, n’a rien ; un vote refusé ne notifie personne
      expect((await t.api('get', '/notifications', w.voters[1].token).expect(200)).body.items).toEqual([]);
      await t.vote(w.voters[0], w.electionId, t.firstChoices(w)).expect(409);
      expect((await t.api('get', '/notifications', w.voters[0].token).expect(200)).body.items).toHaveLength(1);
    });
  });

  describe('« Mes élections » (GET /elections/mine) : hasVoted', () => {
    it('un simple booléen : false avant le vote, true après ; jamais un choix, un identifiant de bulletin ni l’ancien champ myVote', async () => {
      const w = await t.election({ voters: 2, positions: [{ title: 'Président' }, { title: 'Trésorier' }] });
      const mine = async (token: string) => {
        const res = await t.api('get', '/elections/mine', token).expect(200);
        return res.body.find((e: { id: string }) => e.id === w.electionId);
      };
      const before = await mine(w.voters[0].token);
      expect(before.hasVoted).toBe(false);
      await t.vote(w.voters[0], w.electionId, t.firstChoices(w)).expect(201);
      const after = await mine(w.voters[0].token);
      expect(after.hasVoted).toBe(true);
      expect(after).not.toHaveProperty('myVote');
      expect((await mine(w.voters[1].token)).hasVoted).toBe(false); // l'autre électeur n'a pas voté
      const text = JSON.stringify(after);
      for (const id of w.positions.flatMap((p) => [p.id, ...p.candidateIds])) expect(text).not.toContain(id);
      expect(Object.values(after).filter((v) => typeof v === 'boolean')).toEqual([true]); // le seul booléen est hasVoted
    });
  });

  describe('participation en chiffres (GET /elections/:id/turnout, D-02, D-31)', () => {
    it('sous 50 électeurs : le nombre de votants ne bouge que par tranches de 15 minutes', async () => {
      const w = await t.election({ voters: 5 });
      await t.simulateVotes(w, [[w.positions[0].candidateIds[0]], [w.positions[0].candidateIds[0]], [null]]);
      const votedAt = (await t.prisma.votingParticipation.findFirstOrThrow({ where: { electionId: w.electionId }, orderBy: { votedAt: 'asc' } })).votedAt.getTime();
      const slot = 15 * 60_000;
      const svc = t.app.get(VotingService);
      const sameSlot = await svc.turnout(w.electionId, Math.floor(votedAt / slot) * slot + slot - 1); // fin de la tranche où l'on a voté
      expect(sameSlot).toMatchObject({ registered: 5, voted: 0, sliced: true }); // les votes de la tranche en cours ne se voient pas encore
      const nextSlot = await svc.turnout(w.electionId, (Math.floor(votedAt / slot) + 1) * slot);
      expect(nextSlot).toMatchObject({ registered: 5, voted: 3, rate: 60, sliced: true });
    });

    it('à partir de 50 électeurs : chiffre en direct', async () => {
      const w = await t.election({ voters: 50 });
      await t.simulateVotes(w, [[w.positions[0].candidateIds[0]], [w.positions[0].candidateIds[0]]]);
      expect(await t.app.get(VotingService).turnout(w.electionId)).toMatchObject({ registered: 50, voted: 2, sliced: false });
    });

    it('route : le comité et l’admin voient des chiffres ; un électeur est refusé ; aucune liste, aucun identifiant', async () => {
      const w = await t.election({ voters: 3 });
      await t.vote(w.voters[0], w.electionId, t.firstChoices(w)).expect(201);
      for (const token of [w.committee[0].token, t.admin.token]) {
        const res = await t.api('get', `/elections/${w.electionId}/turnout`, token).expect(200);
        expect(Object.keys(res.body).sort()).toEqual(['asOf', 'rate', 'registered', 'sliced', 'voted']);
        const text = JSON.stringify(res.body);
        for (const v of w.voters) expect(text).not.toContain(v.studentId);
      }
      await t.api('get', `/elections/${w.electionId}/turnout`, w.voters[0].token).expect(403);
      await t.api('get', `/elections/${w.electionId}/turnout`).expect(401);
    });
  });
});
