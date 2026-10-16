import { CandidateStatus, ElectionStatus } from '@prisma/client';
import { DAY, VotingWorld } from './voting-world';

// 04 §11, tests 4 à 6 : conditions de vote. Dans tous les cas, RIEN n'est écrit (ni participation, ni bulletin).
describe('Conditions de vote (04 §11, 4-6)', () => {
  const t = new VotingWorld();
  beforeAll(() => t.start());
  afterAll(() => t.stop());

  const nothingWritten = async (electionId: string) => expect(await t.counts(electionId)).toEqual({ participations: 0, ballots: 0, choices: 0 });

  it.each([
    ['avant votingStartsAt', { status: ElectionStatus.VOTING_OPEN, startsIn: 2 * DAY, endsIn: 3 * DAY }],
    ['après votingEndsAt', { status: ElectionStatus.VOTING_OPEN, startsIn: -3 * DAY, endsIn: -2 * DAY }],
    ['en CANDIDACY_CLOSED', { status: ElectionStatus.CANDIDACY_CLOSED }],
    ['en CANCELLED', { status: ElectionStatus.CANCELLED, fillRoll: true }],
  ])('4. vote %s → 409 ELECTION_NOT_OPEN, rien d’écrit', async (_label, spec) => {
    const w = await t.election({ voters: 1, fillRoll: true, ...spec });
    const res = await t.vote(w.voters[0], w.electionId, t.firstChoices(w));
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('ELECTION_NOT_OPEN');
    await nothingWritten(w.electionId);
  });

  it('5. étudiant absent de voter_roll → 403 NOT_ON_VOTER_ROLL, rien d’écrit', async () => {
    const w = await t.election({ voters: 1 });
    const [outsider] = await t.students(1, 'hors-liste'); // vérifié mais pas sur la liste
    const res = await t.vote(outsider, w.electionId, t.firstChoices(w));
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('NOT_ON_VOTER_ROLL');
    await nothingWritten(w.electionId);
  });

  describe('6. bulletin invalide → 422 INVALID_BALLOT, rien d’écrit', () => {
    it.each(['candidat REJECTED', 'candidat d’un autre poste', 'poste d’une autre élection', 'poste manquant', 'poste en double', 'trop de choix', 'blanc interdit', 'doublon de candidat'])('%s', async (cas) => {
      const w = await t.election({ voters: 1, positions: [{ title: 'Président', candidates: 3, allowBlank: false }, { title: 'Trésorier', candidates: 2 }] });
      const other = await t.election({ voters: 1, positions: [{ title: 'Autre poste' }] });
      const [p1, p2] = w.positions;
      const [c1, c2, c3] = p1.candidateIds;
      let choices = [{ positionId: p1.id, candidateIds: [c1] }, { positionId: p2.id, candidateIds: [p2.candidateIds[0]] }];
      switch (cas) {
        case 'candidat REJECTED':
          await t.prisma.candidate.update({ where: { id: c3 }, data: { status: CandidateStatus.REJECTED } });
          choices = [{ positionId: p1.id, candidateIds: [c3] }, choices[1]];
          break;
        case 'candidat d’un autre poste':
          choices = [{ positionId: p1.id, candidateIds: [p2.candidateIds[0]] }, choices[1]];
          break;
        case 'poste d’une autre élection':
          choices = [choices[0], { positionId: other.positions[0].id, candidateIds: [other.positions[0].candidateIds[0]] }];
          break;
        case 'poste manquant':
          choices = [choices[0]];
          break;
        case 'poste en double':
          choices = [...choices, { positionId: p1.id, candidateIds: [c2] }];
          break;
        case 'trop de choix': // maxChoices = 1
          choices = [{ positionId: p1.id, candidateIds: [c1, c2] }, choices[1]];
          break;
        case 'blanc interdit': // allowBlank = false sur le président
          choices = [{ positionId: p1.id, candidateIds: [] }, choices[1]];
          break;
        case 'doublon de candidat':
          await t.prisma.position.update({ where: { id: p1.id }, data: { maxChoices: 2 } });
          choices = [{ positionId: p1.id, candidateIds: [c1, c1] }, choices[1]];
          break;
      }
      const res = await t.vote(w.voters[0], w.electionId, choices);
      expect(res.status).toBe(422);
      expect(res.body.message).toBe('INVALID_BALLOT');
      await nothingWritten(w.electionId);
      await nothingWritten(other.electionId);
    });
  });
});
