import { Role } from '@prisma/client';
import { bearer, createTestApp, TestContext } from './helpers';

// Sprint 6C : autorisations du second tour, du « PV signé » et du tableau de bord (03 §5.4, §5.7 ; D-46 à D-48),
// sur les VRAIS contrôleurs et guards. Les refus se jouent avant le service.
type Scope = 'election' | 'institution';
interface Route { name: string; method: 'get' | 'post'; scope: Scope; path: (id: string) => string; body?: object; permission: string; sensitive: boolean; allowed: Role[] }
const COMMITTEE = Role.ELECTION_COMMITTEE;
const DATES = { votingStartsAt: '2030-11-10T08:00:00.000Z', votingEndsAt: '2030-11-11T18:00:00.000Z' };
const ROUTES: Route[] = [
  { name: 'créer le second tour', method: 'post', scope: 'election', path: (id) => `/elections/${id}/second-round`, body: DATES, permission: 'election:second_round:create', sensitive: true, allowed: [COMMITTEE] },
  { name: 'marquer le PV signé', method: 'post', scope: 'election', path: (id) => `/elections/${id}/report/signed`, permission: 'report:sign', sensitive: true, allowed: [COMMITTEE] },
  { name: 'tableau de bord', method: 'get', scope: 'institution', path: (id) => `/institutions/${id}/dashboard`, permission: 'dashboard:read', sensitive: false, allowed: [Role.INSTITUTION_ADMIN] },
];

describe('Autorisations : second tour, PV signé, tableau de bord (Sprint 6C)', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.app.close());

  const call = (r: Route, id: string, token?: string, body: object | undefined = r.body) => {
    const req = t.api(r.method, r.path(id));
    if (token) req.set('authorization', bearer(token));
    return r.method === 'post' ? req.send(body ?? {}) : req;
  };
  const target = (r: Route) => (r.scope === 'election' ? t.world.elX.id : t.world.instA.id);
  const grant = (role: Role) => (role === COMMITTEE ? { role, institutionId: t.world.instA.id, electionId: t.world.elX.id } : { role, institutionId: t.world.instA.id });

  describe.each(ROUTES)('$name', (r) => {
    const slug = r.name.replace(/\W+/g, '-');

    it('sans jeton → 401', async () => {
      await call(r, target(r)).expect(401);
    });

    it('tous les rôles non autorisés → 403 (étudiant, vérificateur, super-admin, et le rôle voisin)', async () => {
      const { world } = t;
      const others = [Role.STUDENT, Role.VERIFICATION_OFFICER, Role.INSTITUTION_ADMIN, COMMITTEE].filter((x) => !r.allowed.includes(x));
      for (const role of others) {
        const u = await world.addUser(`${role.toLowerCase()}-${slug}@example.test`, [grant(role)]);
        await call(r, target(r), (await world.session(u.id)).token).expect(403);
      }
      const sa = await world.addUser(`sa-${slug}@example.test`, [{ role: Role.SUPER_ADMIN }]);
      await call(r, target(r), (await world.session(sa.id)).token).expect(403);
    });

    if (r.scope === 'election') {
      it('le comité d’une AUTRE élection de la même institution → 403', async () => {
        const { world } = t;
        const other = await world.addUser(`ec-y-${slug}@example.test`, [{ role: COMMITTEE, institutionId: world.instA.id, electionId: world.elY.id }]);
        await call(r, target(r), (await world.session(other.id)).token).expect(403);
      });
    }

    it('une autre institution → 404', async () => {
      const { world } = t;
      const ecB = await world.addUser(`ec-b-${slug}@example.test`, [{ role: COMMITTEE, institutionId: world.instB.id, electionId: world.elZ.id }]);
      const iaB = await world.addUser(`ia-b-${slug}@example.test`, [{ role: Role.INSTITUTION_ADMIN, institutionId: world.instB.id }]);
      for (const u of [ecB, iaB]) await call(r, target(r), (await world.session(u.id)).token).expect(404);
    });

    if (r.sensitive) {
      it('sans 2FA récente (périmée ou jamais faite) → 401 step_up_required, rien n’est exécuté', async () => {
        const { world } = t;
        const u = await world.addUser(`ec-2fa-${slug}@example.test`, [grant(COMMITTEE)]);
        for (const mfaAgeMs of [11 * 60_000, null]) {
          const res = await call(r, target(r), (await world.session(u.id, { mfaAgeMs })).token);
          expect([res.status, res.body.message]).toEqual([401, 'step_up_required']);
        }
      });
    }
  });

  it('second tour : une date invalide est refusée par la validation (400) APRÈS les guards, jamais avant', async () => {
    const { world } = t;
    const ec = await world.addUser('ec-dates@example.test', [{ role: COMMITTEE, institutionId: world.instA.id, electionId: world.elX.id }]);
    const { token } = await world.session(ec.id, { mfaAgeMs: 60_000 });
    await call(ROUTES[0], world.elX.id, token, { votingStartsAt: 'demain', votingEndsAt: 'après-demain' }).expect(400);
    await call(ROUTES[0], world.elX.id, token, {}).expect(400);
  });
});
