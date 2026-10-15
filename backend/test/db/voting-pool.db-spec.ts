import { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { VotingWorld } from './voting-world';

// Régression du Sprint 5 : sous forte charge, la transaction de vote échouait en 500 (P2028, « Unable to start a transaction in
// the given time ») parce que Prisma n'attend que 2 s par défaut pour la démarrer. Le délai doit rester large, et un échec de
// démarrage doit être rejoué sans jamais produire de vote en double.
const startFailure = () => new Prisma.PrismaClientKnownRequestError('Unable to start a transaction in the given time.', { code: 'P2028', clientVersion: 'test' });

describe('Transaction de vote sous charge (P2028)', () => {
  const t = new VotingWorld();
  beforeAll(() => t.start());
  afterAll(() => t.stop());

  it('la transaction de vote demande un délai de démarrage d’au moins 10 s, en READ COMMITTED', async () => {
    const w = await t.election({ voters: 1 });
    const prisma = t.app.get(PrismaService);
    const spy = jest.spyOn(prisma, '$transaction');
    try {
      await t.vote(w.voters[0], w.electionId, t.firstChoices(w)).expect(201);
      const opts = spy.mock.calls.map((c) => c[1] as { maxWait?: number; isolationLevel?: string } | undefined).find((o) => o?.isolationLevel);
      expect(opts?.maxWait).toBeGreaterThanOrEqual(10_000);
      expect(opts?.isolationLevel).toBe('ReadCommitted');
    } finally {
      spy.mockRestore();
    }
  });

  it('un échec de démarrage (P2028) est rejoué : l’étudiant reçoit 201, un seul vote est enregistré', async () => {
    const w = await t.election({ voters: 1 });
    const prisma = t.app.get(PrismaService);
    const original = prisma.$transaction.bind(prisma) as (fn: unknown, opts?: unknown) => Promise<unknown>;
    let failures = 2;
    const spy = jest.spyOn(prisma, '$transaction').mockImplementation(((fn: unknown, opts?: unknown) => {
      if (failures-- > 0) return Promise.reject(startFailure());
      return original(fn, opts);
    }) as never);
    try {
      await t.vote(w.voters[0], w.electionId, t.firstChoices(w)).expect(201);
      expect(await t.counts(w.electionId)).toEqual({ participations: 1, ballots: 1, choices: 1 });
      await t.vote(w.voters[0], w.electionId, t.firstChoices(w)).expect(409); // et pas de second vote
    } finally {
      spy.mockRestore();
    }
  });

  it('si l’échec persiste, l’étudiant reçoit une erreur (jamais un 2xx) et rien n’est écrit', async () => {
    const w = await t.election({ voters: 1 });
    const prisma = t.app.get(PrismaService);
    const spy = jest.spyOn(prisma, '$transaction').mockImplementation((() =>
      Promise.reject(startFailure())) as never);
    try {
      const res = await t.vote(w.voters[0], w.electionId, t.firstChoices(w));
      expect(res.status).toBe(500);
      expect(await t.counts(w.electionId)).toEqual({ participations: 0, ballots: 0, choices: 0 });
    } finally {
      spy.mockRestore();
    }
  });
});
