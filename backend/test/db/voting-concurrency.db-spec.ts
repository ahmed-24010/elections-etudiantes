import { PrismaService } from '../../src/prisma/prisma.service';
import { inBatches, VotingWorld, World } from './voting-world';

// 04 §11, tests 1 à 3 : vote unique et concurrence, contre la vraie base (clé primaire de voting_participations).
describe('Vote unique et concurrence (04 §11, 1-3)', () => {
  const t = new VotingWorld();
  beforeAll(() => t.start());
  afterAll(() => t.stop());

  it('1. 50 requêtes simultanées du même étudiant → 1 participation, 1 bulletin, 49 réponses 409 ALREADY_VOTED', async () => {
    const w = await t.election({ voters: 1 });
    const results = await Promise.all(Array.from({ length: 50 }, () => t.vote(w.voters[0], w.electionId, t.firstChoices(w))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const refused = results.filter((r) => r.status === 409);
    expect(refused).toHaveLength(49);
    for (const r of refused) expect(r.body.message).toBe('ALREADY_VOTED');
    expect(results.find((r) => r.status === 201)?.body).toEqual({ status: 'recorded' }); // aucun identifiant de bulletin (04 §6.2)
    expect(await t.counts(w.electionId)).toEqual({ participations: 1, ballots: 1, choices: 1 });
  });

  it('2. 2 000 votes de 1 000 étudiants différents en parallèle (chacun 2 fois) → 1 000 participations, 1 000 bulletins', async () => {
    const w = await t.election({ voters: 1000, positions: [{ title: 'Président' }, { title: 'Trésorier' }] });
    const attempts = w.voters.flatMap((v) => [v, v]);
    const results = await inBatches(attempts, 200, (v) => t.vote(v, w.electionId, t.firstChoices(w)));
    // Quoi qu'il arrive aux requêtes (même une erreur serveur), jamais de participation sans bulletin ni l'inverse.
    const counts = await t.counts(w.electionId);
    expect(counts.participations).toBe(counts.ballots);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1000);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1000);
    expect(results.filter((r) => r.status !== 201 && r.status !== 409)).toHaveLength(0);
    expect(await t.counts(w.electionId)).toEqual({ participations: 1000, ballots: 1000, choices: 2000 });
  });

  describe('3. erreur forcée entre la participation et le bulletin', () => {
    let w: World;
    let restore: () => void;
    beforeAll(async () => {
      w = await t.election({ voters: 2 });
      // La panne est injectée sans code de test dans la production : toute écriture dans `ballot` échoue DANS la
      // transaction de vote, après l'insertion de la participation (04 §6.2, étapes 4 puis 5). Le module `voting`
      // doit donc écrire avec `prisma.$transaction(async (tx) => …)`, ce que 04 §6.2 impose de toute façon.
      const prisma = t.app.get(PrismaService);
      const original = prisma.$transaction.bind(prisma) as (fn: unknown, opts?: unknown) => Promise<unknown>;
      const spy = jest.spyOn(prisma, '$transaction').mockImplementation(((fn: unknown, opts?: unknown) => {
        if (typeof fn !== 'function') return original(fn, opts);
        return original(async (tx: Record<string, unknown>) => {
          const guarded = new Proxy(tx, {
            get: (target, prop) => (prop === 'ballot' ? new Proxy({}, { get: () => () => Promise.reject(new Error('panne forcée')) }) : target[prop as string]),
          });
          return (fn as (t: unknown) => unknown)(guarded);
        }, opts);
      }) as never);
      restore = () => spy.mockRestore();
    });
    afterAll(() => restore?.());

    it('ni participation ni bulletin ; l’étudiant peut ensuite voter normalement', async () => {
      const failed = await t.vote(w.voters[0], w.electionId, t.firstChoices(w));
      expect(failed.status).toBe(500);
      expect(JSON.stringify(failed.body)).not.toContain('panne forcée'); // pas de détail interne
      expect(await t.counts(w.electionId)).toEqual({ participations: 0, ballots: 0, choices: 0 });

      restore();
      await t.vote(w.voters[0], w.electionId, t.firstChoices(w)).expect(201);
      expect(await t.counts(w.electionId)).toEqual({ participations: 1, ballots: 1, choices: 1 });
    });
  });
});
