import { LoginAttemptLimiter } from '../../src/auth/login-attempt.limiter';
import { PASSWORD, VotingWorld } from './voting-world';

// D-30 / 04 §6.2 : le mot de passe est vérifié AVANT la transaction ; chaque échec compte dans le blocage du compte
// (5 échecs en 15 minutes, comme à la connexion) ; compte bloqué → 429. Test ajouté au Sprint 5 (absent des 16 tests de 04 §11).
describe('Mot de passe au moment de voter (D-30)', () => {
  const t = new VotingWorld();
  beforeAll(() => t.start());
  afterAll(() => t.stop());

  const nothingWritten = async (electionId: string) => expect(await t.counts(electionId)).toEqual({ participations: 0, ballots: 0, choices: 0 });

  it('mauvais mot de passe → 401 INVALID_PASSWORD, rien d’écrit ; le bon mot de passe fonctionne ensuite', async () => {
    const w = await t.election({ voters: 1 });
    const res = await t.vote(w.voters[0], w.electionId, t.firstChoices(w), 'pas-le-bon-mot-de-passe');
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('INVALID_PASSWORD');
    expect(JSON.stringify(res.body)).not.toContain('pas-le-bon-mot-de-passe');
    await nothingWritten(w.electionId);
    await t.vote(w.voters[0], w.electionId, t.firstChoices(w)).expect(201);
  });

  it('le mot de passe est contrôlé avant tout le reste : bulletin invalide + mauvais mot de passe → 401, pas 422', async () => {
    const w = await t.election({ voters: 1 });
    const res = await t.vote(w.voters[0], w.electionId, [], 'pas-le-bon-mot-de-passe');
    expect(res.status).toBe(401);
    await nothingWritten(w.electionId);
  });

  it('5 échecs → le compte est bloqué : 429, même avec le bon mot de passe ; rien d’écrit', async () => {
    const w = await t.election({ voters: 1 });
    for (let i = 0; i < 5; i++) expect((await t.vote(w.voters[0], w.electionId, t.firstChoices(w), 'faux')).status).toBe(401);
    const locked = await t.vote(w.voters[0], w.electionId, t.firstChoices(w), PASSWORD);
    expect(locked.status).toBe(429);
    await nothingWritten(w.electionId);
    // Le blocage tombe quand le compteur est remis à zéro (fenêtre de 15 minutes écoulée) : le vote redevient possible.
    t.app.get(LoginAttemptLimiter).reset(w.voters[0].userId);
    await t.vote(w.voters[0], w.electionId, t.firstChoices(w)).expect(201);
  });

  it('les échecs au vote et à la connexion s’additionnent (même compteur)', async () => {
    const w = await t.election({ voters: 1 });
    const user = await t.prisma.user.findUniqueOrThrow({ where: { id: w.voters[0].userId } });
    for (let i = 0; i < 3; i++) await t.api('post', '/auth/login').send({ identifier: user.email, password: 'faux' }).expect(401);
    for (let i = 0; i < 2; i++) expect((await t.vote(w.voters[0], w.electionId, t.firstChoices(w), 'faux')).status).toBe(401);
    expect((await t.vote(w.voters[0], w.electionId, t.firstChoices(w), PASSWORD)).status).toBe(429);
    await nothingWritten(w.electionId);
    t.app.get(LoginAttemptLimiter).reset(w.voters[0].userId);
  });

  it('un vote réussi remet le compteur à zéro', async () => {
    const w = await t.election({ voters: 2 });
    for (let i = 0; i < 4; i++) await t.vote(w.voters[0], w.electionId, t.firstChoices(w), 'faux').expect(401);
    await t.vote(w.voters[0], w.electionId, t.firstChoices(w)).expect(201);
    expect(t.app.get(LoginAttemptLimiter).isLocked(w.voters[0].userId)).toBe(false);
  });

  it('le blocage d’un compte ne touche pas les autres', async () => {
    const w = await t.election({ voters: 2 });
    for (let i = 0; i < 5; i++) await t.vote(w.voters[0], w.electionId, t.firstChoices(w), 'faux').expect(401);
    await t.vote(w.voters[1], w.electionId, t.firstChoices(w)).expect(201);
  });
});
