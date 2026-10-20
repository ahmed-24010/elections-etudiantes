import { Role } from '@prisma/client';
import { bearer, createTestApp, TestContext } from './helpers';

// Sprint 6B : autorisations des routes de publication, du procès-verbal et de « Vérifier l'urne » (03 §5.7, D-41, D-45),
// sur les VRAIS contrôleurs et guards. Les refus se jouent avant le service.
type Route = { name: string; method: 'get' | 'post'; path: (id: string) => string; permission: string; sensitive: boolean; staff: Role[] };
const COMMITTEE = Role.ELECTION_COMMITTEE;
const ROUTES: Route[] = [
  { name: 'publier les résultats', method: 'post', path: (id) => `/elections/${id}/results/publish`, permission: 'results:publish', sensitive: true, staff: [COMMITTEE] },
  { name: 'regénérer le PV', method: 'post', path: (id) => `/elections/${id}/report`, permission: 'report:generate', sensitive: true, staff: [COMMITTEE, Role.INSTITUTION_ADMIN] },
  { name: 'lister les PV', method: 'get', path: (id) => `/elections/${id}/reports`, permission: 'report:read', sensitive: false, staff: [COMMITTEE, Role.INSTITUTION_ADMIN] },
  { name: 'télécharger le PV', method: 'get', path: (id) => `/elections/${id}/report/download?lang=fr`, permission: 'report:read', sensitive: false, staff: [COMMITTEE, Role.INSTITUTION_ADMIN] },
  { name: 'vérifier l’urne', method: 'get', path: (id) => `/results/${id}/verify`, permission: 'results:read', sensitive: false, staff: [COMMITTEE, Role.INSTITUTION_ADMIN] },
];

describe('Autorisations : publication, procès-verbal, vérification de l’urne (Sprint 6B)', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.app.close());

  const call = (r: Route, electionId: string, token?: string) => {
    const req = t.api(r.method, r.path(electionId));
    if (token) req.set('authorization', bearer(token));
    return r.method === 'post' ? req.send({}) : req;
  };
  const grant = (role: Role, institutionId: string, electionId?: string) => (role === COMMITTEE ? { role, institutionId, electionId } : { role, institutionId });

  describe.each(ROUTES)('$name', (r) => {
    const slug = r.name.replace(/\W+/g, '-');

    it('sans jeton → 401', async () => {
      await call(r, t.world.elX.id).expect(401);
    });

    it('un étudiant, le vérificateur et le super-admin → 403', async () => {
      const { world } = t;
      for (const role of [Role.STUDENT, Role.VERIFICATION_OFFICER]) {
        const u = await world.addUser(`${role.toLowerCase()}-${slug}@example.test`, [{ role, institutionId: world.instA.id }]);
        await call(r, world.elX.id, (await world.session(u.id)).token).expect(403);
      }
      const sa = await world.addUser(`sa-${slug}@example.test`, [{ role: Role.SUPER_ADMIN }]);
      await call(r, world.elX.id, (await world.session(sa.id)).token).expect(403);
    });

    it('le comité d’une AUTRE élection de la même institution → 403', async () => {
      const { world } = t;
      const other = await world.addUser(`ec-y-${slug}@example.test`, [{ role: COMMITTEE, institutionId: world.instA.id, electionId: world.elY.id }]);
      await call(r, world.elX.id, (await world.session(other.id)).token).expect(403);
    });

    it('une autre institution ne voit pas l’élection → 404 (comité de B et administrateur de B)', async () => {
      const { world } = t;
      const ecB = await world.addUser(`ec-b-${slug}@example.test`, [{ role: COMMITTEE, institutionId: world.instB.id, electionId: world.elZ.id }]);
      const iaB = await world.addUser(`ia-b-${slug}@example.test`, [{ role: Role.INSTITUTION_ADMIN, institutionId: world.instB.id }]);
      for (const u of [ecB, iaB]) await call(r, world.elX.id, (await world.session(u.id)).token).expect(404);
    });

    if (r.sensitive) {
      it.each(r.staff)('%s sans 2FA récente (périmée ou jamais faite) → 401 step_up_required', async (role) => {
        const { world } = t;
        const u = await world.addUser(`${role.toLowerCase()}-2fa-${slug}@example.test`, [grant(role, world.instA.id, world.elX.id)]);
        for (const mfaAgeMs of [11 * 60_000, null]) {
          const res = await call(r, world.elX.id, (await world.session(u.id, { mfaAgeMs })).token);
          expect([res.status, res.body.message]).toEqual([401, 'step_up_required']);
        }
      });
    }
  });

  it('D-41 : l’administrateur d’institution ne publie pas les résultats, mais lit et regénère le PV', async () => {
    const { world } = t;
    const ia = await world.addUser('ia-d41@example.test', [{ role: Role.INSTITUTION_ADMIN, institutionId: world.instA.id }]);
    const { token } = await world.session(ia.id, { mfaAgeMs: 60_000 });
    await call(ROUTES[0], world.elX.id, token).expect(403); // publier
    for (const r of ROUTES.slice(1, 4)) {
      const res = await call(r, world.elX.id, token); // franchit les guards : plus de 401/403/404 « d'autorisation »
      expect([401, 403]).not.toContain(res.status);
    }
  });

  it('le téléchargement exige une langue valide (fr ou ar) : 400 sinon, après les guards', async () => {
    const { world } = t;
    const ec = await world.addUser('ec-lang@example.test', [{ role: COMMITTEE, institutionId: world.instA.id, electionId: world.elX.id }]);
    const { token } = await world.session(ec.id);
    await t.api('get', `/elections/${world.elX.id}/report/download?lang=en`).set('authorization', bearer(token)).expect(400);
    await t.api('get', `/elections/${world.elX.id}/report/download`).set('authorization', bearer(token)).expect(400);
  });
});
