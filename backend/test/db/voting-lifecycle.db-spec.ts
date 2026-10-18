import { CandidateStatus, ElectionStatus } from '@prisma/client';
import { VotingWorld, World } from './voting-world';

// 04 §11, tests 12 à 16 : ouverture, gel de la liste, décompte, égalité, effectifs trop faibles.
describe('Cycle de vie et décompte (04 §11, 12-16)', () => {
  const t = new VotingWorld();
  beforeAll(() => t.start());
  afterAll(() => t.stop());

  const open = (w: World) => t.api('post', `/elections/${w.electionId}/voting/open`, w.committee[0].token).send({});
  const close = (w: World) => t.api('post', `/elections/${w.electionId}/voting/close`, w.committee[0].token).send({ reason: 'fin du scrutin' });
  const readyForOpening = (positions = [{ title: 'Président', candidates: 2 }]) => t.election({ status: ElectionStatus.CANDIDACY_CLOSED, withRule: true, voters: 3, positions });
  const notOpened = async (w: World) => {
    const e = await t.prisma.election.findUniqueOrThrow({ where: { id: w.electionId } });
    expect(e.status).toBe(ElectionStatus.CANDIDACY_CLOSED);
    expect(e.voterRollFrozenAt).toBeNull();
    expect(await t.prisma.voterRollEntry.count({ where: { electionId: w.electionId } })).toBe(0);
  };

  describe('12. ouverture du vote refusée (409 + liste des conditions)', () => {
    it('une candidature est en attente', async () => {
      const w = await readyForOpening();
      await t.prisma.candidate.update({ where: { id: w.positions[0].candidateIds[1] }, data: { status: CandidateStatus.PENDING } });
      const res = await open(w);
      expect(res.status).toBe(409);
      expect(res.body.conditions).toEqual(expect.arrayContaining([expect.stringMatching(/PENDING|en attente/i)]));
      await notOpened(w);
    });

    it('un poste n’a aucun candidat validé (D-34)', async () => {
      const w = await readyForOpening([{ title: 'Président', candidates: 2 }, { title: 'Trésorier', candidates: 1 }]);
      await t.prisma.candidate.update({ where: { id: w.positions[1].candidateIds[0] }, data: { status: CandidateStatus.REJECTED } });
      const res = await open(w);
      expect(res.status).toBe(409);
      expect(res.body.conditions.length).toBeGreaterThan(0);
      await notOpened(w);
    });

    it('le comité a moins de 3 membres actifs (D-03)', async () => {
      const w = await readyForOpening();
      await t.prisma.roleAssignment.updateMany({ where: { userId: w.committee[2].userId }, data: { revokedAt: new Date() } });
      const res = await open(w);
      expect(res.status).toBe(409);
      expect(res.body.conditions.length).toBeGreaterThan(0);
      await notOpened(w);
    });

    it('témoin : toutes les conditions remplies → VOTING_OPEN, liste copiée et gelée dans la même transaction', async () => {
      const w = await readyForOpening();
      const eligible = await t.prisma.studentEnrollment.count({ where: { institutionId: t.institutionId, status: 'VERIFIED', programId: t.programId, levelId: t.levelId } });
      const res = await open(w);
      expect(res.status).toBe(200);
      const e = await t.prisma.election.findUniqueOrThrow({ where: { id: w.electionId } });
      expect(e.status).toBe(ElectionStatus.VOTING_OPEN);
      expect(e.voterRollFrozenAt).not.toBeNull();
      expect(await t.prisma.voterRollEntry.count({ where: { electionId: w.electionId } })).toBe(eligible);
    });
  });

  it('13. gel de la liste : un étudiant vérifié après l’ouverture ne peut pas voter', async () => {
    const w = await readyForOpening();
    await open(w).expect(200);
    const rollSize = await t.prisma.voterRollEntry.count({ where: { electionId: w.electionId } });
    const [late] = await t.students(1, 'tardif'); // VERIFIED, mais après le gel
    const refused = await t.vote(late, w.electionId, t.firstChoices(w));
    expect(refused.status).toBe(403);
    expect(refused.body.message).toBe('NOT_ON_VOTER_ROLL');
    expect(await t.prisma.voterRollEntry.count({ where: { electionId: w.electionId } })).toBe(rollSize); // la liste n’a pas bougé
    await t.vote(w.voters[0], w.electionId, t.firstChoices(w)).expect(201); // témoin : un inscrit avant le gel vote
    expect(await t.counts(w.electionId)).toEqual({ participations: 1, ballots: 1, choices: 1 });
  });

  it('14. décompte : votants = bulletins après 1 000 votes simulés ; décompte relancé = résultat identique', async () => {
    const w = await t.election({ voters: 1000, positions: [{ title: 'Président', candidates: 3 }] });
    const [a, b, c] = w.positions[0].candidateIds;
    // 500 voix a, 300 voix b, 150 voix c, 50 blancs
    const plans = [...Array(500).fill(a), ...Array(300).fill(b), ...Array(150).fill(c), ...Array(50).fill(null)].map((x) => [x as string | null]);
    await t.simulateVotes(w, plans);
    await close(w).expect(200);

    const tally = await t.prisma.electionTally.findUniqueOrThrow({ where: { electionId: w.electionId } });
    expect(tally).toMatchObject({ participantCount: 1000, ballotCount: 1000, integrityOk: true });
    expect(tally.eligibleCount).toBe(1000);
    expect(tally.ballotsDigest).toMatch(/^[0-9a-f]{64}$/);
    const snapshot = async () => ({
      tally: (({ computedAt: _computedAt, ...rest }) => rest)(await t.prisma.electionTally.findUniqueOrThrow({ where: { electionId: w.electionId } })),
      results: (await t.prisma.positionResult.findMany({ where: { electionId: w.electionId } })).map(({ id: _id, ...rest }) => rest).sort((x, y) => String(x.candidateId).localeCompare(String(y.candidateId))),
    });
    const first = await snapshot();
    const byCandidate = new Map(first.results.map((r) => [r.candidateId, r]));
    expect(byCandidate.get(a)).toMatchObject({ votes: 500, isWinner: true, rank: 1 });
    expect(byCandidate.get(b)?.votes).toBe(300);
    expect(byCandidate.get(c)?.votes).toBe(150);
    expect(byCandidate.get(null)?.votes).toBe(50);

    await t.api('post', `/results/${w.electionId}/compute`, w.committee[0].token).send({}).expect(200); // relancé
    expect(await snapshot()).toEqual(first); // identique, sans doublon de lignes
  });

  it('15. égalité sur le dernier siège détectée ; second tour pré-rempli avec les seuls ex-aequo', async () => {
    const w = await t.election({ voters: 12, positions: [{ title: 'Président', candidates: 3 }, { title: 'Trésorier', candidates: 2 }] });
    const [p1, p2] = w.positions;
    const [a, b, c] = p1.candidateIds;
    // Président : a et b à égalité (5-5) devant c (2) ; Trésorier : un vainqueur net
    const plans = [...Array(5).fill([a, p2.candidateIds[0]]), ...Array(5).fill([b, p2.candidateIds[0]]), ...Array(2).fill([c, p2.candidateIds[1]])];
    await t.simulateVotes(w, plans);
    await close(w).expect(200);

    const res = await t.api('get', `/results/${w.electionId}`, w.committee[0].token).expect(200);
    const president = res.body.positions.find((p: { positionId: string }) => p.positionId === p1.id);
    const treasurer = res.body.positions.find((p: { positionId: string }) => p.positionId === p2.id);
    expect(president.tie).toBe(true);
    expect(president.winners ?? []).toEqual([]); // personne n’est déclaré élu à ce poste
    expect(treasurer.tie).toBe(false); // les autres postes restent publiables
    expect(treasurer.winners).toHaveLength(1);

    const draft = await t.api('get', `/results/${w.electionId}/second-round`, w.committee[0].token).expect(200);
    expect(draft.body.parentElectionId).toBe(w.electionId);
    expect(draft.body.round).toBe(2);
    expect(draft.body.positions).toHaveLength(1); // seul le poste en égalité
    expect(draft.body.positions[0].positionId).toBe(p1.id);
    expect([...draft.body.positions[0].candidateIds].sort()).toEqual([a, b].sort()); // c, éliminé, n’y figure pas
  });

  it('16. effectif inférieur à 3 sur un poste → détail non publié (D-32) ; à 3 → détail publié', async () => {
    const small = await t.election({ voters: 2, positions: [{ title: 'Président', candidates: 2 }] });
    const [s1] = small.positions[0].candidateIds;
    await t.simulateVotes(small, [[s1], [s1]]);
    const big = await t.election({ voters: 3, positions: [{ title: 'Président', candidates: 2 }] });
    const [b1, b2] = big.positions[0].candidateIds;
    await t.simulateVotes(big, [[b1], [b1], [b2]]);

    for (const w of [small, big]) {
      await close(w).expect(200);
      await t.api('post', `/elections/${w.electionId}/results/publish`, w.committee[0].token).send({}).expect(200);
    }
    const smallRes = (await t.api('get', `/results/${small.electionId}`, small.voters[0].token).expect(200)).body.positions[0];
    expect(smallRes.detailPublished).toBe(false);
    expect(smallRes.note).toBeDefined(); // « effectif trop faible pour publier le détail »
    expect(smallRes).not.toHaveProperty('votes');
    expect(JSON.stringify(smallRes)).not.toMatch(/"votes"|"blank"/); // ni voix par candidat, ni blancs
    const bigRes = (await t.api('get', `/results/${big.electionId}`, big.voters[0].token).expect(200)).body.positions[0];
    expect(bigRes.detailPublished).toBe(true);
    expect(JSON.stringify(bigRes)).toMatch(/"votes":2/);
  });
});
