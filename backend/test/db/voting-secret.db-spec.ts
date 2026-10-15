import { ElectionStatus, PrismaClient, Role } from '@prisma/client';
import fs from 'fs';
import { PASSWORD, VotingWorld } from './voting-world';

// 04 §11, tests 7 à 11 : le secret du vote (CLAUDE.md, règles absolues 1 à 6).
describe('Secret du vote (04 §11, 7-11)', () => {
  const t = new VotingWorld();
  // Les logs sont réellement produits pendant ces tests (niveau « trace »), pour pouvoir les inspecter (test 8).
  beforeAll(() => t.start({ logLevel: 'trace' }));
  afterAll(() => t.stop());

  it('7. aucune réponse des routes /voting et /results ne contient à la fois un identifiant d’étudiant et un choix', async () => {
    const w = await t.election({ voters: 4, positions: [{ title: 'Président', candidates: 3 }, { title: 'Trésorier' }] });
    const [staff] = await t.prisma.user.findMany({ where: { roles: { some: { role: Role.INSTITUTION_ADMIN, institutionId: t.institutionId } } } });
    expect(staff).toBeDefined();
    const bodies: unknown[] = [];
    for (const v of w.voters.slice(0, 3)) {
      const r = await t.vote(v, w.electionId, t.firstChoices(w));
      expect(r.status).toBe(201);
      bodies.push(r.body);
    }
    bodies.push((await t.vote(w.voters[0], w.electionId, t.firstChoices(w))).body); // 409
    bodies.push((await t.api('get', `/voting/${w.electionId}/status`, w.voters[0].token)).body); // « Vous avez voté »
    bodies.push((await t.api('get', `/voting/${w.electionId}/status`, w.voters[3].token)).body);
    bodies.push((await t.api('get', `/voting/${w.electionId}/ballot`, w.voters[0].token)).body); // le bulletin ne se relit jamais

    await t.api('post', `/elections/${w.electionId}/voting/close`, w.committee[0].token).send({ reason: 'test' });
    for (const token of [w.voters[0].token, w.committee[0].token, t.admin.token]) {
      for (const path of [`/results/${w.electionId}`, `/results/${w.electionId}/second-round`]) bodies.push((await t.api('get', path, token)).body);
    }

    const identities = [...w.voters.flatMap((v) => [v.studentId, v.userId]), ...w.positions.flatMap((p) => p.candidateStudentIds)];
    const choices = [...w.positions.flatMap((p) => [p.id, ...p.candidateIds])];
    for (const body of bodies) {
      const text = JSON.stringify(body);
      const hasIdentity = identities.some((id) => text.includes(id));
      const hasChoice = choices.some((id) => text.includes(id));
      expect(hasIdentity && hasChoice).toBe(false);
    }
    // Les routes de vote existent bel et bien (sinon ce test passerait par défaut sur des 404).
    expect(await t.counts(w.electionId)).toMatchObject({ ballots: 3, participations: 3 });
  });

  it('8. aucune ligne de log produite pendant un vote ne contient le corps de la requête (ni le mot de passe)', async () => {
    const w = await t.election({ voters: 2 });
    const captured: string[] = [];
    const grab = (spied: jest.SpyInstance) => spied.mockImplementation(((...args: unknown[]) => {
      captured.push(...args.filter((a): a is string | Buffer => typeof a === 'string' || Buffer.isBuffer(a)).map(String));
      return args.length;
    }) as never);
    const spies = [grab(jest.spyOn(fs, 'writeSync')), grab(jest.spyOn(fs, 'write')), grab(jest.spyOn(process.stdout, 'write')), grab(jest.spyOn(process.stderr, 'write'))];
    try {
      const res = await t.vote(w.voters[0], w.electionId, t.firstChoices(w));
      expect(res.status).toBe(201);
      await t.vote(w.voters[0], w.electionId, t.firstChoices(w)).expect(409); // aussi sur le chemin d’erreur
      await t.vote(w.voters[1], w.electionId, [{ positionId: w.positions[0].id, candidateIds: ['pas-un-candidat'] }]).expect(422);
      await new Promise((r) => setTimeout(r, 500)); // pino écrit de façon asynchrone
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
    const logs = captured.join('');
    expect(logs).toContain('/voting/'); // la journalisation HTTP fonctionne : le test n’est pas vide
    for (const secret of [PASSWORD, ...w.positions.flatMap((p) => [p.candidateIds[0], 'candidateIds']), 'pas-un-candidat']) expect(logs).not.toContain(secret);
    // 04 §7.2 : pas d’identifiant d’étudiant dans les lignes qui mentionnent le vote
    for (const line of logs.split('\n').filter((l) => l.includes('/ballot'))) {
      for (const v of w.voters) {
        expect(line).not.toContain(v.studentId);
        expect(line).not.toContain(v.userId);
      }
    }
    // et rien dans audit_logs : ni choix, ni corps
    const audit = JSON.stringify(await t.prisma.auditLog.findMany({ where: { createdAt: { gte: new Date(Date.now() - 60_000) } } }), (_k, v) => (typeof v === 'bigint' ? v.toString() : v)); // l'id d'audit_logs est un BigInt
    expect(audit).not.toContain(w.positions[0].candidateIds[0]);
  });

  it('9. ballots et ballot_choices : aucune colonne de date ni d’identité, ids UUID, aucun lien vers voting_participations (schéma réel)', async () => {
    const cols = await t.prisma.$queryRaw<{ t: string; c: string; type: string; extra: string }[]>`
      SELECT table_name AS t, column_name AS c, data_type AS type, extra AS extra FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name IN ('ballots', 'ballot_choices')`;
    const byTable = (name: string) => cols.filter((c) => c.t === name).map((c) => c.c).sort();
    expect(byTable('ballots')).toEqual(['electionId', 'id']);
    expect(byTable('ballot_choices')).toEqual(['ballotId', 'candidateId', 'id', 'positionId']);
    for (const c of cols) {
      expect(c.type).not.toMatch(/date|time|year/i);
      expect(c.c).not.toMatch(/student|user|ip|agent|session|created|updated|voted|at$/i);
      expect(c.extra).not.toMatch(/auto_increment/i);
    }
    const ids = cols.filter((c) => c.c === 'id');
    expect(ids.map((c) => c.type)).toEqual(['char', 'char']);
    const refs = await t.prisma.$queryRaw<{ t: string; r: string }[]>`
      SELECT table_name AS t, referenced_table_name AS r FROM information_schema.key_column_usage
      WHERE table_schema = DATABASE() AND table_name IN ('ballots', 'ballot_choices') AND referenced_table_name IS NOT NULL`;
    expect(refs.map((r) => r.r)).not.toContain('voting_participations');
    expect(refs.map((r) => r.r)).not.toContain('voter_roll');
    expect(refs.map((r) => r.r)).not.toContain('students');
    expect(refs.map((r) => r.r)).not.toContain('users');
  });

  it('10. avant la clôture, toute route de résultats refuse, pour tous les rôles (super-admin compris)', async () => {
    const w = await t.election({ voters: 3 });
    await t.vote(w.voters[0], w.electionId, t.firstChoices(w)).expect(201);
    const [superAdmin] = await (async () => {
      const [s] = await t.students(1, 'sa');
      await t.prisma.roleAssignment.deleteMany({ where: { userId: s.userId } });
      await t.prisma.roleAssignment.create({ data: { userId: s.userId, role: Role.SUPER_ADMIN } });
      await t.prisma.user.update({ where: { id: s.userId }, data: { twoFactorEnabled: true } });
      await t.prisma.refreshToken.updateMany({ where: { userId: s.userId }, data: { twoFactorVerifiedAt: new Date() } });
      return [s];
    })();
    const tokens: Record<string, string | undefined> = { anonyme: undefined, électeur: w.voters[0].token, 'non-inscrit': (await t.students(1, 'x'))[0].token, comité: w.committee[0].token, 'admin institution': t.admin.token, 'super-admin': superAdmin.token };
    for (const status of [ElectionStatus.VOTING_OPEN, ElectionStatus.CANDIDACY_CLOSED]) {
      await t.prisma.election.update({ where: { id: w.electionId }, data: { status } });
      for (const [role, token] of Object.entries(tokens)) {
        for (const path of [`/results/${w.electionId}`, `/results/${w.electionId}/second-round`]) {
          const res = await t.api('get', path, token);
          expect([401, 403, 409].includes(res.status) ? 'refusé' : `${role} ${path} → ${res.status}`).toBe('refusé'); // jamais 200, ni 404 « la route n’existe pas »
          expect(JSON.stringify(res.body)).not.toMatch(/"votes"/);
        }
      }
    }
  });

  it('11. app_readonly ne peut pas lire ballots ; app_runtime ne peut ni modifier ni supprimer un bulletin existant', async () => {
    const url = process.env.DATABASE_READONLY_URL;
    if (!url) throw new Error('DATABASE_READONLY_URL (compte app_readonly) est requis pour ce test. Voir CLAUDE.md, section Commandes.');
    const w = await t.election({ voters: 1 });
    await t.vote(w.voters[0], w.electionId, t.firstChoices(w)).expect(201);
    const ballot = await t.prisma.ballot.findFirstOrThrow({ where: { electionId: w.electionId } });

    const readonly = new PrismaClient({ datasources: { db: { url } } });
    const denied = async (run: () => Promise<unknown>) => run().then(() => false, (e) => /denied|1142|1143/i.test(String(e)));
    try {
      expect(await denied(() => readonly.$queryRawUnsafe('SELECT id FROM ballots LIMIT 1'))).toBe(true);
      expect(await denied(() => readonly.$queryRawUnsafe('SELECT id FROM ballot_choices LIMIT 1'))).toBe(true);
      await expect(readonly.$queryRawUnsafe('SELECT COUNT(*) FROM elections')).resolves.toBeDefined(); // le reste reste lisible
    } finally {
      await readonly.$disconnect();
    }
    for (const sql of [
      `UPDATE ballots SET electionId = electionId WHERE id = '${ballot.id}'`,
      `DELETE FROM ballots WHERE id = '${ballot.id}'`,
      `UPDATE ballot_choices SET candidateId = NULL WHERE ballotId = '${ballot.id}'`,
      `DELETE FROM ballot_choices WHERE ballotId = '${ballot.id}'`,
    ]) expect(await denied(() => t.prisma.$executeRawUnsafe(sql))).toBe(true);
    expect(await t.prisma.ballot.count({ where: { id: ballot.id } })).toBe(1);
    expect(await t.prisma.ballotChoice.count({ where: { ballotId: ballot.id } })).toBe(1);
  });
});
