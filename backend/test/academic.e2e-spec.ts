import { Role } from '@prisma/client';
import { bearer, createTestApp, TestContext } from './helpers';

describe('Structure académique (Sprint 3)', () => {
  let t: TestContext;
  let iaA: string;
  let iaB: string;
  let student: string;
  let officer: string;
  let sa: string;

  const base = (id: string) => `/institutions/${id}/academic`;
  const as = (token: string, method: 'get' | 'post' | 'patch' | 'delete', path: string) => t.api(method, path).set('authorization', bearer(token));

  beforeAll(async () => {
    t = await createTestApp();
    const w = t.world;
    iaA = (await w.session((await w.addUser('ia-a@example.test', [{ role: Role.INSTITUTION_ADMIN, institutionId: w.instA.id }])).id)).token;
    iaB = (await w.session((await w.addUser('ia-b@example.test', [{ role: Role.INSTITUTION_ADMIN, institutionId: w.instB.id }])).id)).token;
    student = (await w.session((await w.addUser('st@example.test', [{ role: Role.STUDENT, institutionId: w.instA.id }])).id)).token;
    officer = (await w.session((await w.addUser('vo@example.test', [{ role: Role.VERIFICATION_OFFICER, institutionId: w.instA.id }])).id)).token;
    sa = (await w.session((await w.addUser('sa@example.test', [{ role: Role.SUPER_ADMIN }])).id)).token;
  });
  afterAll(() => t.app.close());

  const A = () => base(t.world.instA.id);
  const B = () => base(t.world.instB.id);

  describe('permissions (03 §5.1)', () => {
    it('lecture pour tous les rôles de l’institution ; écriture pour l’administrateur d’institution seulement', async () => {
      for (const token of [iaA, student, officer, sa]) await as(token, 'get', A()).expect(200);
      for (const token of [student, officer, sa]) {
        await as(token, 'post', `${A()}/faculties`).send({ code: 'X', name: 'X' }).expect(403);
        await as(token, 'post', `${A()}/levels`).send({ code: 'L1', name: 'L1', rank: 1 }).expect(403);
      }
      await as(iaA, 'post', `${A()}/faculties`).send({ code: 'FSJP', name: 'Faculté des Sciences Juridiques et Politiques' }).expect(201);
    });

    it('sans jeton : 401', async () => {
      await t.api('get', A()).expect(401);
      await t.api('post', `${A()}/faculties`).send({}).expect(401);
    });
  });

  describe('isolation entre institutions (404)', () => {
    it('l’administrateur de B ne voit ni ne modifie rien de A, sur toutes les routes', async () => {
      const fac = (await as(iaA, 'get', A())).body.faculties[0];
      await as(iaB, 'get', A()).expect(404);
      await as(iaB, 'post', `${A()}/faculties`).send({ code: 'Z', name: 'Z' }).expect(404);
      await as(iaB, 'patch', `${A()}/faculties/${fac.id}`).send({ name: 'pirate' }).expect(404);
      await as(iaB, 'delete', `${A()}/faculties/${fac.id}`).expect(404);
      await as(iaB, 'post', `${A()}/years/${fac.id}/current`).expect(404);
    });

    it('depuis sa propre institution, l’identifiant d’une ressource de l’autre institution reste introuvable (404)', async () => {
      const facA = (await as(iaA, 'get', A())).body.faculties[0];
      await as(iaB, 'post', `${B()}/faculties`).send({ code: 'FB', name: 'Faculté B' }).expect(201);
      // Modifier / supprimer la faculté de A en passant par le chemin de B.
      await as(iaB, 'patch', `${B()}/faculties/${facA.id}`).send({ name: 'pirate' }).expect(404);
      await as(iaB, 'delete', `${B()}/faculties/${facA.id}`).expect(404);
      expect((await as(iaA, 'get', A())).body.faculties[0].name).toBe('Faculté des Sciences Juridiques et Politiques');
      // Créer une filière dans B avec la faculté de A : refusé.
      await as(iaB, 'post', `${B()}/programs`).send({ facultyId: facA.id, code: 'P', name: 'P' }).expect(404);
    });
  });

  describe('création et cohérence', () => {
    let faculty: string;
    let program: string;
    let level: string;
    let year: string;

    it('crée années, niveaux, filières et groupes cohérents', async () => {
      faculty = (await as(iaA, 'get', A())).body.faculties[0].id;
      program = (await as(iaA, 'post', `${A()}/programs`).send({ facultyId: faculty, code: 'DP', name: 'Droit privé', nameAr: 'القانون الخاص' }).expect(201)).body.id;
      level = (await as(iaA, 'post', `${A()}/levels`).send({ code: 'L1', name: 'Licence 1', rank: 1 }).expect(201)).body.id;
      year = (await as(iaA, 'post', `${A()}/years`).send({ label: '2026-2027', startsOn: '2026-09-01', endsOn: '2027-07-15' }).expect(201)).body.id;
      const group = await as(iaA, 'post', `${A()}/groups`).send({ programId: program, levelId: level, academicYearId: year, name: 'A' }).expect(201);
      expect(group.body.institutionId).toBe(t.world.instA.id);
      const overview = (await as(student, 'get', A())).body;
      expect(overview.programs).toHaveLength(1);
      expect(overview.groups).toHaveLength(1);
    });

    it('doublons : 409 ; données invalides : 400', async () => {
      await as(iaA, 'post', `${A()}/levels`).send({ code: 'L1', name: 'Autre', rank: 2 }).expect(409);
      await as(iaA, 'post', `${A()}/groups`).send({ programId: program, levelId: level, academicYearId: year, name: 'A' }).expect(409);
      await as(iaA, 'post', `${A()}/years`).send({ label: '2027-28', startsOn: '2027-09-01', endsOn: '2028-07-01' }).expect(400);
      await as(iaA, 'post', `${A()}/years`).send({ label: '2027-2028', startsOn: '2028-09-01', endsOn: '2027-07-01' }).expect(400);
      await as(iaA, 'post', `${A()}/levels`).send({ code: 'avec espace', name: 'x', rank: 1 }).expect(400);
      await as(iaA, 'post', `${A()}/levels`).send({ code: 'M1', name: 'x', rank: 1, institutionId: t.world.instB.id }).expect(400); // champ inconnu
    });

    it('la filière, le niveau et l’année d’un groupe doivent être de la même institution', async () => {
      const levelB = (await as(iaB, 'post', `${B()}/levels`).send({ code: 'L1', name: 'L1 B', rank: 1 }).expect(201)).body.id;
      await as(iaA, 'post', `${A()}/groups`).send({ programId: program, levelId: levelB, academicYearId: year, name: 'B' }).expect(404);
    });

    it('une seule année courante par institution', async () => {
      const y2 = (await as(iaA, 'post', `${A()}/years`).send({ label: '2027-2028', startsOn: '2027-09-01', endsOn: '2028-07-15' }).expect(201)).body.id;
      await as(iaA, 'post', `${A()}/years/${year}/current`).expect(200);
      await as(iaA, 'post', `${A()}/years/${y2}/current`).expect(200);
      const years = (await as(iaA, 'get', A())).body.years as { id: string; isCurrent: boolean }[];
      expect(years.filter((y) => y.isCurrent).map((y) => y.id)).toEqual([y2]);
    });

    it('un changement de nom n’autorise pas à déplacer une filière dans une autre faculté', async () => {
      await as(iaA, 'patch', `${A()}/programs/${program}`).send({ name: 'Droit privé (modifié)' }).expect(200);
      await as(iaA, 'patch', `${A()}/programs/${program}`).send({ facultyId: faculty }).expect(400);
    });

    it('suppression : refusée (409) si la ressource est utilisée, acceptée sinon', async () => {
      await as(iaA, 'delete', `${A()}/programs/${program}`).expect(409); // un groupe l'utilise
      await as(iaA, 'delete', `${A()}/levels/${level}`).expect(409);
      const group = (await as(iaA, 'get', A())).body.groups[0].id;
      await as(iaA, 'delete', `${A()}/groups/${group}`).expect(204);
      await as(iaA, 'delete', `${A()}/programs/${program}`).expect(204);
      await as(iaA, 'delete', `${A()}/levels/${level}`).expect(204);
      await as(iaA, 'delete', `${A()}/groups/${group}`).expect(404);
    });

    it('chaque modification est tracée dans audit_logs', () => {
      const actions = t.prisma.auditLogs.filter((l) => String(l.action).startsWith('ACADEMIC_')).map((l) => l.action);
      expect(actions).toEqual(expect.arrayContaining(['ACADEMIC_CREATED', 'ACADEMIC_UPDATED', 'ACADEMIC_DELETED']));
    });
  });
});
