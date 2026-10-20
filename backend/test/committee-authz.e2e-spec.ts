import { Role } from '@prisma/client';
import { bearer, createTestApp, TestContext } from './helpers';

// Sprint 6A : autorisations des 4 routes du comité (03 §5.4, §8), sur les VRAIS contrôleurs et guards. Les refus se jouent
// avant le service : ces tests n'ont donc pas besoin de la base (le comportement métier est dans test/db/voting-committee).
const BODY_EXTEND = { outageStartedAt: '2026-11-03T09:00:00.000Z', outageEndedAt: '2026-11-03T10:00:00.000Z', newEndsAt: '2026-11-04T19:00:00.000Z', reason: 'panne' };
const BODY_PREVIEW = { studentNumber: '20240001' };
const BODY_ADD = { studentNumber: '20240001', reason: 'oublié' };

type Route = { name: string; method: 'get' | 'post'; path: (id: string) => string; body?: object; sensitive: boolean; permission: string };
const ROUTES: Route[] = [
  { name: 'extend', method: 'post', path: (id) => `/elections/${id}/voting/extend`, body: BODY_EXTEND, sensitive: true, permission: 'election:voting:extend' },
  { name: 'voter-roll/preview', method: 'post', path: (id) => `/elections/${id}/voter-roll/preview`, body: BODY_PREVIEW, sensitive: true, permission: 'voter_roll:add' },
  { name: 'voter-roll', method: 'post', path: (id) => `/elections/${id}/voter-roll`, body: BODY_ADD, sensitive: true, permission: 'voter_roll:add' },
  { name: 'turnout', method: 'get', path: (id) => `/elections/${id}/turnout`, sensitive: false, permission: 'turnout:read' },
];

describe('Autorisations des routes du comité (Sprint 6A)', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.app.close());

  const call = (r: Route, electionId: string, token?: string, body: object | undefined = r.body) => {
    const req = t.api(r.method, r.path(electionId));
    if (token) req.set('authorization', bearer(token));
    return r.method === 'post' ? req.send(body ?? {}) : req;
  };

  describe.each(ROUTES)('$method $name', (r) => {
    it('sans jeton → 401', async () => {
      await call(r, t.world.elX.id).expect(401);
    });

    it('un étudiant (même inscrit dans l’institution) → 403', async () => {
      const { world } = t;
      const student = await world.addUser(`etu-${r.name}@example.test`, [{ role: Role.STUDENT, institutionId: world.instA.id }]);
      const { token } = await world.session(student.id);
      await call(r, world.elX.id, token).expect(403);
    });

    it('le vérificateur et le comité d’une AUTRE élection de la même institution → 403', async () => {
      const { world } = t;
      const officer = await world.addUser(`ver-${r.name}@example.test`, [{ role: Role.VERIFICATION_OFFICER, institutionId: world.instA.id }]);
      const other = await world.addUser(`ec-y-${r.name}@example.test`, [{ role: Role.ELECTION_COMMITTEE, institutionId: world.instA.id, electionId: world.elY.id }]);
      for (const u of [officer, other]) await call(r, world.elX.id, (await world.session(u.id)).token).expect(403);
    });

    it('une institution B ne voit pas l’élection de A → 404 (comité de B et admin de B)', async () => {
      const { world } = t;
      const ecB = await world.addUser(`ec-b-${r.name}@example.test`, [{ role: Role.ELECTION_COMMITTEE, institutionId: world.instB.id, electionId: world.elZ.id }]);
      const iaB = await world.addUser(`ia-b-${r.name}@example.test`, [{ role: Role.INSTITUTION_ADMIN, institutionId: world.instB.id }]);
      for (const u of [ecB, iaB]) await call(r, world.elX.id, (await world.session(u.id)).token).expect(404);
    });

    if (r.name !== 'turnout') {
      it('le comité de l’élection sans 2FA récente (périmée ou jamais faite) → 401 step_up_required, rien n’est exécuté', async () => {
        const { world } = t;
        const ec = await world.addUser(`ec-2fa-${r.name}@example.test`, [{ role: Role.ELECTION_COMMITTEE, institutionId: world.instA.id, electionId: world.elX.id }]);
        for (const mfaAgeMs of [11 * 60_000, null]) {
          const res = await call(r, world.elX.id, (await world.session(ec.id, { mfaAgeMs })).token);
          expect([res.status, res.body.message]).toEqual([401, 'step_up_required']);
        }
      });

      it('avec une 2FA récente, la requête franchit les guards (le corps vide est ensuite refusé par la validation : 400)', async () => {
        const { world } = t;
        const ec = await world.addUser(`ec-ok-${r.name}@example.test`, [{ role: Role.ELECTION_COMMITTEE, institutionId: world.instA.id, electionId: world.elX.id }]);
        const { token } = await world.session(ec.id, { mfaAgeMs: 60_000 });
        await call(r, world.elX.id, token, {}).expect(400);
      });

      it('un refus de permission est tracé dans le journal d’audit', async () => {
        const { world, prisma } = t;
        const student = await world.addUser(`etu-audit-${r.name}@example.test`, [{ role: Role.STUDENT, institutionId: world.instA.id }]);
        await call(r, world.elX.id, (await world.session(student.id)).token).expect(403);
        expect(prisma.auditLogs.some((a) => a.actorId === student.id && a.result === 'DENIED' && a.action === r.permission)).toBe(true);
      });
    }
  });

  it('l’administrateur d’institution suit le vote (turnout) mais ne prolonge pas et n’ajoute pas d’électeur', async () => {
    const { world } = t;
    const ia = await world.addUser('ia-sprint6a@example.test', [{ role: Role.INSTITUTION_ADMIN, institutionId: world.instA.id }]);
    const { token } = await world.session(ia.id, { mfaAgeMs: 60_000 });
    for (const r of ROUTES.filter((x) => x.name !== 'turnout')) await call(r, world.elX.id, token).expect(403);
  });
});
