import { ConflictException } from '@nestjs/common';
import { CandidateStatus, ElectionStatus } from '@prisma/client';
import { ElectionSchedulerService } from '../../src/voting/election-scheduler.service';
import { VotingLifecycleService } from '../../src/voting/voting-lifecycle.service';
import { DAY, VotingWorld } from './voting-world';

// 04 §3, §4.2 à §4.4 : transitions automatiques à l'heure de la BASE. La tâche planifiée est désactivée en test ; on appelle
// `runDueTransitions` directement (la même fonction que la tâche exécute chaque minute).
describe('Transitions automatiques (04 §4.2-4.4)', () => {
  const t = new VotingWorld();
  let scheduler: ElectionSchedulerService;
  beforeAll(async () => {
    await t.start();
    scheduler = t.app.get(ElectionSchedulerService);
  });
  afterAll(() => t.stop());

  const statusOf = async (id: string) => (await t.prisma.election.findUniqueOrThrow({ where: { id } })).status;

  it('clôture les candidatures à candidacyEndsAt, puis ouvre le vote à votingStartsAt si tout est prêt (liste gelée)', async () => {
    const w = await t.election({ status: ElectionStatus.CANDIDACY_OPEN, withRule: true, voters: 3, startsIn: -60_000 });
    await scheduler.runDueTransitions();
    const e = await t.prisma.election.findUniqueOrThrow({ where: { id: w.electionId } });
    expect(e.status).toBe(ElectionStatus.VOTING_OPEN);
    expect(e.voterRollFrozenAt).not.toBeNull();
    expect(await t.prisma.voterRollEntry.count({ where: { electionId: w.electionId } })).toBeGreaterThan(0);
    const audit = await t.prisma.auditLog.findMany({ where: { resourceId: w.electionId } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['ELECTION_CANDIDACY_CLOSED', 'ELECTION_VOTING_OPENED']));
    expect(audit.every((a) => a.actorId === null)).toBe(true); // actions du système
  });

  it('l’ouverture automatique n’a pas lieu si une condition manque, et le comité est notifié une seule fois', async () => {
    const w = await t.election({ status: ElectionStatus.CANDIDACY_CLOSED, withRule: true, startsIn: -60_000 });
    await t.prisma.candidate.update({ where: { id: w.positions[0].candidateIds[1] }, data: { status: CandidateStatus.PENDING } });
    await scheduler.runDueTransitions();
    await scheduler.runDueTransitions();
    expect(await statusOf(w.electionId)).toBe(ElectionStatus.CANDIDACY_CLOSED);
    expect(await t.prisma.voterRollEntry.count({ where: { electionId: w.electionId } })).toBe(0);
    for (const member of w.committee) {
      const notes = await t.prisma.notification.findMany({ where: { userId: member.userId, type: 'VOTING_OPEN_BLOCKED' } });
      expect(notes).toHaveLength(1);
      expect(JSON.parse(notes[0].body)).toEqual({ electionId: w.electionId, conditions: ['candidacies_pending'] });
    }
  });

  it('n’ouvre pas avant votingStartsAt', async () => {
    const w = await t.election({ status: ElectionStatus.CANDIDACY_CLOSED, withRule: true, startsIn: DAY });
    await scheduler.runDueTransitions();
    expect(await statusOf(w.electionId)).toBe(ElectionStatus.CANDIDACY_CLOSED);
  });

  it('clôture le vote à votingEndsAt et lance le décompte ; ne clôture jamais avant', async () => {
    const closing = await t.election({ voters: 4, startsIn: -2 * DAY, endsIn: -60_000 });
    await t.simulateVotes(closing, [[closing.positions[0].candidateIds[0]], [closing.positions[0].candidateIds[0]], [null]]);
    const running = await t.election({ voters: 1 }); // fin dans 1 jour
    await scheduler.runDueTransitions();
    expect(await statusOf(closing.electionId)).toBe(ElectionStatus.VOTING_CLOSED);
    expect(await t.prisma.electionTally.findUniqueOrThrow({ where: { electionId: closing.electionId } })).toMatchObject({ participantCount: 3, ballotCount: 3, integrityOk: true });
    expect(await statusOf(running.electionId)).toBe(ElectionStatus.VOTING_OPEN);
  });

  it('rattrape le décompte d’une élection clôturée dont le décompte a échoué', async () => {
    const w = await t.election({ voters: 2 });
    await t.simulateVotes(w, [[w.positions[0].candidateIds[0]]]);
    await t.prisma.election.update({ where: { id: w.electionId }, data: { status: ElectionStatus.VOTING_CLOSED } }); // clôture sans décompte
    expect(await t.prisma.electionTally.count({ where: { electionId: w.electionId } })).toBe(0);
    await scheduler.runDueTransitions();
    expect(await t.prisma.electionTally.findUniqueOrThrow({ where: { electionId: w.electionId } })).toMatchObject({ participantCount: 1, ballotCount: 1 });
  });

  it('trois ouvertures simultanées : une seule passe (verrou sur la ligne de l’élection), les autres reçoivent 409', async () => {
    const w = await t.election({ status: ElectionStatus.CANDIDACY_CLOSED, withRule: true, voters: 3, startsIn: -60_000 });
    const lifecycle = t.app.get(VotingLifecycleService);
    const results = await Promise.allSettled([lifecycle.open(null, w.electionId), lifecycle.open(null, w.electionId), lifecycle.open(null, w.electionId)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(ConflictException);
    expect(await statusOf(w.electionId)).toBe(ElectionStatus.VOTING_OPEN);
    const eligible = await t.prisma.studentEnrollment.count({ where: { institutionId: t.institutionId, status: 'VERIFIED', programId: t.programId, levelId: t.levelId } });
    expect(await t.prisma.voterRollEntry.count({ where: { electionId: w.electionId } })).toBe(eligible); // liste copiée une seule fois
  });
});
