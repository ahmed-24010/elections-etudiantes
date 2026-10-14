import { Role } from '@prisma/client';
import { jpeg, pdf, png } from './files';
import { bearer, createTestApp, TestContext } from './helpers';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

/** Sprint 4 : élections, règles, postes, comité, candidatures. Jamais VOTING_OPEN (le vote est au Sprint 5). */
describe('Élections et candidatures (Sprint 4)', () => {
  let t: TestContext;
  let instA: string;
  let instB: string;
  let year: string;
  let fac: string;
  let dp: string;
  let dpu: string;
  let l3: string;
  let group1: string;
  let yearB: string;
  let facB: string;
  let progB: string;
  let levelB: string;

  type Account = { id: string; token: string; fresh: string; stale: string; studentId?: string };
  const u: Record<string, Account> = {};
  let electionId: string;
  let positionId: string;

  const as = (who: string, method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string) => t.api(method, path).set('authorization', bearer(u[who].token));
  /** Action 🔐 : jeton dont la 2FA vient d'être vérifiée. */
  const fresh = (who: string, method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string) => t.api(method, path).set('authorization', bearer(u[who].fresh));
  const stale = (who: string, method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string) => t.api(method, path).set('authorization', bearer(u[who].stale));

  async function account(name: string, grants: { role: Role; institutionId?: string; electionId?: string }[], twoFactor = false) {
    const user = await t.world.addUser(`${name}@example.test`, grants, { twoFactorEnabled: twoFactor });
    const f = await t.world.session(user.id, { mfaAgeMs: twoFactor ? 0 : null });
    const s = await t.world.session(user.id, { mfaAgeMs: twoFactor ? 11 * 60_000 : null });
    u[name] = { id: user.id, token: f.token, fresh: f.token, stale: s.token };
    return u[name];
  }

  async function student(name: string, opts: { institutionId?: string; program?: string; level?: string; group?: string | null; status?: string; twoFactor?: boolean } = {}) {
    const institutionId = opts.institutionId ?? instA;
    const acc = await account(name, [{ role: Role.STUDENT, institutionId }], opts.twoFactor ?? false);
    const s = await t.prisma.student.create({ data: { userId: acc.id, institutionId, studentNumber: `N-${name}`, firstName: name, lastName: 'Test' } });
    acc.studentId = s.id as string;
    const inB = institutionId === instB;
    await t.prisma.studentEnrollment.create({
      data: {
        studentId: s.id, institutionId, academicYearId: inB ? yearB : year, facultyId: inB ? facB : fac, programId: inB ? progB : (opts.program ?? dp),
        levelId: inB ? levelB : (opts.level ?? l3), groupId: opts.group === undefined ? group1 : opts.group, status: opts.status ?? 'VERIFIED',
      },
    });
    return acc;
  }

  const body = (over: Record<string, unknown> = {}) => ({
    title: 'Bureau du groupe 1 — L3 Droit privé',
    titleAr: 'مكتب الفوج 1',
    academicYearId: year,
    candidacyStartsAt: iso(-HOUR),
    candidacyEndsAt: iso(7 * DAY),
    votingStartsAt: iso(14 * DAY),
    votingEndsAt: iso(15 * DAY),
    ...over,
  });
  const E = () => `/elections/${electionId}`;

  beforeAll(async () => {
    t = await createTestApp();
    const w = t.world;
    const p = t.prisma;
    instA = w.instA.id;
    instB = w.instB.id;
    fac = (await p.faculty.create({ data: { institutionId: instA, code: 'FSJP', name: 'FSJP' } })).id;
    dp = (await p.program.create({ data: { institutionId: instA, facultyId: fac, code: 'DP', name: 'Droit privé' } })).id;
    dpu = (await p.program.create({ data: { institutionId: instA, facultyId: fac, code: 'DPU', name: 'Droit public' } })).id;
    l3 = (await p.level.create({ data: { institutionId: instA, code: 'L3', name: 'Licence 3', rank: 3 } })).id;
    year = (await p.academicYear.create({ data: { institutionId: instA, label: '2026-2027', startsOn: new Date('2026-09-01'), endsOn: new Date('2027-07-01'), isCurrent: true } })).id;
    group1 = (await p.group.create({ data: { institutionId: instA, programId: dp, levelId: l3, academicYearId: year, name: '1' } })).id;
    facB = (await p.faculty.create({ data: { institutionId: instB, code: 'FB', name: 'Faculté B' } })).id;
    progB = (await p.program.create({ data: { institutionId: instB, facultyId: facB, code: 'PB', name: 'Filière B' } })).id;
    levelB = (await p.level.create({ data: { institutionId: instB, code: 'L3', name: 'L3 B', rank: 3 } })).id;
    yearB = (await p.academicYear.create({ data: { institutionId: instB, label: '2026-2027', startsOn: new Date('2026-09-01'), endsOn: new Date('2027-07-01'), isCurrent: true } })).id;

    await account('ia', [{ role: Role.INSTITUTION_ADMIN, institutionId: instA }], true);
    await account('iaB', [{ role: Role.INSTITUTION_ADMIN, institutionId: instB }], true);
    await account('officer', [{ role: Role.VERIFICATION_OFFICER, institutionId: instA }], true);
    // Étudiants éligibles à « DP L3 » : s1, s4, s5 et c1 (futur membre du comité)
    for (const n of ['s1', 's4', 's5']) await student(n);
    await student('s2', { program: dpu }); // éligible à une autre filière seulement
    await student('s3', { status: 'PENDING' }); // inscription non vérifiée
    await student('sB', { institutionId: instB });
    for (const n of ['c1', 'c2', 'c3']) await student(n, { twoFactor: true });
    await student('c4', { twoFactor: true });
  });
  afterAll(() => t.app.close());

  // ---------------------------------------------------------------------------------------------- création
  describe('création et brouillon', () => {
    it('seul l’administrateur d’institution crée une élection (🔓 03 §5.4) ; les autres rôles : 403 ; autre institution : 404', async () => {
      for (const who of ['s1', 'officer']) await as(who, 'post', `/institutions/${instA}/elections`).send(body()).expect(403);
      await as('iaB', 'post', `/institutions/${instA}/elections`).send(body()).expect(404);
      await t.api('post', `/institutions/${instA}/elections`).send(body()).expect(401);
    });

    it('calendrier incohérent, année d’une autre institution, champ inconnu : refusés', async () => {
      const post = (b: object) => as('ia', 'post', `/institutions/${instA}/elections`).send(b);
      await post(body({ votingEndsAt: iso(13 * DAY) })).expect(400); // fin du vote avant le début
      await post(body({ candidacyEndsAt: iso(20 * DAY) })).expect(400); // candidatures après l'ouverture du vote
      await post(body({ candidacyStartsAt: undefined })).expect(400); // une seule date de candidature
      await post(body({ academicYearId: yearB })).expect(404);
      await post(body({ status: 'VOTING_OPEN' })).expect(400); // le statut ne se choisit pas
      await post(body({ institutionId: instB })).expect(400);
    });

    it('crée un brouillon DRAFT, tracé dans audit_logs', async () => {
      const res = await as('ia', 'post', `/institutions/${instA}/elections`).send(body()).expect(201);
      electionId = res.body.id;
      expect(res.body).toEqual(expect.objectContaining({ status: 'DRAFT', institutionId: instA, academicYearId: year }));
      expect(t.prisma.auditLogs.some((l) => l.action === 'ELECTION_CREATED' && l.resourceId === electionId)).toBe(true);
    });

    it('un brouillon est invisible pour l’étudiant (404), absent de « mes élections », visible pour l’IA', async () => {
      await as('s1', 'get', E()).expect(404);
      expect((await as('s1', 'get', '/elections/mine').expect(200)).body).toEqual([]);
      const res = await as('ia', 'get', E()).expect(200);
      expect(res.body).toEqual(expect.objectContaining({ status: 'DRAFT', committeeCount: 0, minCommittee: 3 }));
      await as('iaB', 'get', E()).expect(404);
      expect((await as('ia', 'get', `/institutions/${instA}/elections`).expect(200)).body.map((e: { id: string }) => e.id)).toContain(electionId);
      await as('s1', 'get', `/institutions/${instA}/elections`).expect(403);
    });

    it('les dates se corrigent en brouillon ; le statut n’est jamais modifiable par l’API', async () => {
      await as('ia', 'patch', E()).send({ title: 'Bureau du groupe 1 — L3 Droit privé (2026)' }).expect(200);
      await as('ia', 'patch', E()).send({ votingStartsAt: iso(30 * DAY) }).expect(400); // après la fin du vote
      await as('ia', 'patch', E()).send({ status: 'CANDIDACY_OPEN' }).expect(400);
    });
  });

  // ---------------------------------------------------------------------------------------------- postes et règles
  describe('postes et règles d’éligibilité', () => {
    it('postes : ajout, doublon (409), modification, suppression', async () => {
      const p = await as('ia', 'post', `${E()}/positions`).send({ title: 'Président', titleAr: 'الرئيس', seats: 1, maxChoices: 1 }).expect(201);
      positionId = p.body.id;
      await as('ia', 'post', `${E()}/positions`).send({ title: 'Président' }).expect(409);
      await as('ia', 'post', `${E()}/positions`).send({ title: 'Secrétaire', seats: 0 }).expect(400);
      const s = await as('ia', 'post', `${E()}/positions`).send({ title: 'Secrétaire', displayOrder: 2 }).expect(201);
      await as('ia', 'patch', `${E()}/positions/${s.body.id}`).send({ seats: 2, maxChoices: 2 }).expect(200);
      await as('ia', 'delete', `${E()}/positions/${s.body.id}`).expect(204);
      await as('ia', 'delete', `${E()}/positions/${s.body.id}`).expect(404);
      await as('s1', 'post', `${E()}/positions`).send({ title: 'X' }).expect(403);
    });

    it('règles : « toute l’institution » est un choix explicite, jamais déduit', async () => {
      const put = (b: object) => as('ia', 'put', `${E()}/rules`).send(b);
      await put({ rules: [{}] }).expect(400); // règle sans critère, sans choix explicite
      await put({ rules: [{ programId: dp }], wholeInstitution: true }).expect(400);
      await put({ rules: [], wholeInstitution: true }).expect(200);
      expect((await as('ia', 'get', E())).body.rules).toEqual({ wholeInstitution: true, items: [] });
      await put({ rules: [] }).expect(200); // effacer : zéro règle = personne
      expect((await as('ia', 'get', E())).body.rules).toEqual({ wholeInstitution: false, items: [] });
    });

    it('règles : identifiants d’une autre institution (404), combinaisons impossibles (400)', async () => {
      const put = (b: object) => as('ia', 'put', `${E()}/rules`).send(b);
      await put({ rules: [{ programId: progB }] }).expect(404);
      await put({ rules: [{ groupId: group1, programId: dpu }] }).expect(400); // le groupe n'est pas de cette filière
      const otherYear = (await t.prisma.academicYear.create({ data: { institutionId: instA, label: '2025-2026', startsOn: new Date('2025-09-01'), endsOn: new Date('2026-07-01') } })).id;
      const oldGroup = (await t.prisma.group.create({ data: { institutionId: instA, programId: dp, levelId: l3, academicYearId: otherYear, name: '9' } })).id;
      await put({ rules: [{ groupId: oldGroup }] }).expect(400); // groupe d'une autre année
      await put({ rules: [{ programId: dp, levelId: l3 }] }).expect(200);
      const rules = (await as('ia', 'get', E())).body.rules;
      expect(rules.items).toEqual([expect.objectContaining({ programId: dp, levelId: l3 })]);
    });
  });

  // ---------------------------------------------------------------------------------------------- ouverture des candidatures
  describe('ouverture des candidatures : comité de 3 membres (03 §6)', () => {
    const open = (who = 'ia') => as(who, 'post', `${E()}/candidacy/open`);
    const assign = (email: string, who = 'ia') => fresh(who, 'post', `/institutions/${instA}/roles`).send({ email, role: 'ELECTION_COMMITTEE', electionId });

    it('refus tant que les prérequis manquent : calendrier, postes, règles, comité', async () => {
      const bare = (await as('ia', 'post', `/institutions/${instA}/elections`).send(body({ candidacyStartsAt: undefined, candidacyEndsAt: undefined })).expect(201)).body.id;
      const code = async (id: string) => (await as('ia', 'post', `/elections/${id}/candidacy/open`).expect(409)).body.message;
      expect(await code(bare)).toBe('candidacy_dates_required');
      await as('ia', 'patch', `/elections/${bare}`).send({ candidacyStartsAt: iso(-HOUR), candidacyEndsAt: iso(DAY) }).expect(200);
      expect(await code(bare)).toBe('positions_required');
      await as('ia', 'post', `/elections/${bare}/positions`).send({ title: 'Président' }).expect(201);
      expect(await code(bare)).toBe('rules_required');
      await as('ia', 'put', `/elections/${bare}/rules`).send({ rules: [{ programId: dp }] }).expect(200);
      expect(await code(bare)).toBe('committee_incomplete');
      await fresh('ia', 'post', `/elections/${bare}/cancel`).expect(200); // nettoyage
    });

    it('le comité se constitue par RoleAssignment ELECTION_COMMITTEE (🔐) ; 2 membres ne suffisent pas', async () => {
      await assign('c1@example.test').expect(201);
      await assign('c2@example.test').expect(201);
      await stale('ia', 'post', `/institutions/${instA}/roles`).send({ email: 'c3@example.test', role: 'ELECTION_COMMITTEE', electionId }).expect(401); // 2FA récente exigée
      expect((await as('ia', 'get', E())).body.committeeCount).toBe(2);
      expect((await open().expect(409)).body.message).toBe('committee_incomplete');
    });

    it('un membre du comité ne gère que SON élection ; l’IA d’une autre institution : 404', async () => {
      await assign('c3@example.test').expect(201);
      await as('c1', 'get', E()).expect(200);
      await as('c1', 'patch', E()).send({ title: 'Bureau du groupe 1 — modifié par le comité' }).expect(200);
      await as('c1', 'post', `/institutions/${instA}/elections`).send(body()).expect(403);
      await fresh('c1', 'post', `${E()}/cancel`).expect(403); // le comité n'annule pas sa propre élection
      expect((await as('c1', 'get', `/institutions/${instA}/elections`)).body.map((e: { id: string }) => e.id)).toEqual([electionId]); // pas la « bare » annulée
      await open('iaB').expect(404);
    });

    it('3 membres : l’ouverture passe, DRAFT → CANDIDACY_OPEN', async () => {
      const res = await open().expect(200);
      expect(res.body.status).toBe('CANDIDACY_OPEN');
      expect(res.body.committeeCount).toBe(3);
      await open().expect(409); // déjà ouverte
      expect(t.prisma.auditLogs.some((l) => l.action === 'ELECTION_CANDIDACY_OPENED')).toBe(true);
    });

    it('après l’ouverture : titre, règles et postes sont figés ; seules les dates restent modifiables', async () => {
      await as('ia', 'patch', E()).send({ title: 'autre' }).expect(409);
      await as('ia', 'put', `${E()}/rules`).send({ rules: [] }).expect(409);
      await as('ia', 'post', `${E()}/positions`).send({ title: 'Trésorier' }).expect(409);
      await as('ia', 'delete', `${E()}/positions/${positionId}`).expect(409);
      await as('ia', 'patch', E()).send({ candidacyEndsAt: iso(8 * DAY) }).expect(200);
    });
  });

  // ---------------------------------------------------------------------------------------------- visibilité étudiante
  describe('chaque étudiant voit exactement les élections qui le concernent', () => {
    it('éligible (s1, s4, s5, membres du comité étudiants) : voit l’élection dans « mes élections » et en détail', async () => {
      for (const who of ['s1', 's4', 'c1']) {
        const mine = (await as(who, 'get', '/elections/mine').expect(200)).body;
        expect(mine).toEqual([expect.objectContaining({ id: electionId, status: 'CANDIDACY_OPEN', myCandidacy: null })]);
        const detail = (await as(who, 'get', E()).expect(200)).body;
        expect(detail.positions.map((p: { title: string }) => p.title)).toEqual(['Président']);
      }
    });

    it('le détail destiné à l’étudiant ne contient ni règles ni comité ; l’IA les voit', async () => {
      const detail = (await as('s1', 'get', E())).body;
      expect(detail).not.toHaveProperty('rules');
      expect(detail).not.toHaveProperty('committeeCount');
      expect(detail).not.toHaveProperty('createdAt');
    });

    it('non éligible (autre filière, inscription non vérifiée, autre institution) : 404 partout, liste vide', async () => {
      for (const who of ['s2', 's3', 'sB']) {
        await as(who, 'get', E()).expect(404);
        await as(who, 'get', `${E()}/eligible-count`).expect(404);
        await as(who, 'get', `${E()}/candidates`).expect(404);
        expect((await as(who, 'get', '/elections/mine').expect(200)).body).toEqual([]);
      }
    });

    it('nombre d’éligibles : un chiffre pour l’IA, le comité et l’étudiant concerné — jamais une liste (D-02)', async () => {
      for (const who of ['ia', 'c1', 's1']) {
        const res = await as(who, 'get', `${E()}/eligible-count`).expect(200);
        expect(res.body).toEqual({ count: 7 }); // s1, s4, s5 et les quatre étudiants c1 à c4
      }
    });
  });

  // ---------------------------------------------------------------------------------------------- candidatures
  describe('candidatures (03 §5.5, D-05)', () => {
    const C = () => `${E()}/candidates`;
    const apply = (who: string, over: Record<string, unknown> = {}) => as(who, 'post', C()).send({ positionId, statement: 'Mon programme', ...over });
    const upload = (who: string, kind: 'photo' | 'program', buf: Buffer, filename: string, type: string) =>
      as(who, 'post', `${C()}/me/files/${kind}`).attach('file', buf, { filename, contentType: type });
    const stored = () => [...t.storage.objects.keys()].filter((k) => k.startsWith(`candidates/${instA}/${electionId}/`));
    let s1Candidate: string;
    let s4Candidate: string;

    it('un étudiant éligible dépose sa candidature : PENDING, tracée ; un second dépôt est refusé (un seul poste, D-05)', async () => {
      const res = await apply('s1').expect(201);
      s1Candidate = res.body.id;
      expect(res.body).toEqual(expect.objectContaining({ status: 'PENDING', positionId, hasPhoto: false, hasProgram: false }));
      expect(t.prisma.auditLogs.some((l) => l.action === 'CANDIDATE_APPLIED' && l.resourceId === s1Candidate)).toBe(true);
      expect((await apply('s1').expect(409)).body.message).toBe('already_candidate');
      expect((await as('s1', 'get', '/elections/mine')).body[0].myCandidacy).toBe('PENDING');
    });

    it('deux dépôts simultanés du même étudiant : exactement une candidature (unicité (electionId, studentId) en base)', async () => {
      const race = await Promise.all([apply('s4'), apply('s4')]);
      expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(t.prisma.candidate.rows.filter((c) => c.studentId === u.s4.studentId)).toHaveLength(1);
      s4Candidate = t.prisma.candidate.rows.find((c) => c.studentId === u.s4.studentId)!.id;
    });

    it('refusés : non éligible (404), personnel (403), poste étranger (400), champ inconnu (400)', async () => {
      for (const who of ['s2', 's3', 'sB']) await apply(who).expect(404);
      for (const who of ['ia', 'officer']) await apply(who).expect(403);
      await t.api('post', C()).send({ positionId }).expect(401);
      await apply('s5', { positionId: '7f1e8a30-0000-4000-8000-000000000000' }).expect(400);
      await apply('s5', { studentId: u.s1.studentId }).expect(400); // on ne candidate que pour soi
    });

    it('un membre du comité ne se porte pas candidat dans son élection (03 §6)', async () => {
      expect((await apply('c1').expect(409)).body.message).toBe('committee_member_cannot_apply');
    });

    it('et un candidat ne peut pas être nommé au comité de la même élection (dans les deux sens)', async () => {
      await apply('c4').expect(201);
      const denied = await fresh('ia', 'post', `/institutions/${instA}/roles`).send({ email: 'c4@example.test', role: 'ELECTION_COMMITTEE', electionId }).expect(409);
      expect(denied.body.message).toBe('candidate_cannot_be_committee');
      await as('c4', 'post', `${C()}/me/withdraw`).expect(200); // retiré : plus un obstacle
      await fresh('ia', 'post', `/institutions/${instA}/roles`).send({ email: 'c4@example.test', role: 'ELECTION_COMMITTEE', electionId }).expect(201);
    });

    it('correction avant validation : texte ; photo et programme déposés en S3 (type réel, 5 Mo)', async () => {
      await as('s1', 'patch', `${C()}/me`).send({ statement: 'Programme corrigé' }).expect(200);
      expect((await as('s1', 'get', `${C()}/me`)).body.statement).toBe('Programme corrigé');
      await upload('s1', 'photo', png(), 'moi.png', 'image/png').expect(201);
      const res = await upload('s1', 'program', pdf(), 'programme.pdf', 'application/pdf').expect(201);
      expect(res.body).toEqual(expect.objectContaining({ hasPhoto: true, hasProgram: true }));
      expect(stored()).toHaveLength(2);
      // Les fichiers sont reconnus par leur contenu, pas par ce que dit le client
      await upload('s1', 'photo', pdf(), 'photo.jpg', 'image/jpeg').expect(415); // un PDF n'est pas une photo
      await upload('s1', 'photo', Buffer.from('<script>alert(1)</script>'), 'photo.png', 'image/png').expect(415);
      await upload('s1', 'photo', Buffer.concat([jpeg(), Buffer.alloc(5 * 1024 * 1024)]), 'enorme.jpg', 'image/jpeg').expect(413);
      await upload('s1', 'diaporama' as 'photo', png(), 'x.png', 'image/png').expect(404);
      expect(stored()).toHaveLength(2); // aucun refus n'a laissé de fichier
    });

    it('remplacer une photo retire l’ancienne du stockage', async () => {
      await upload('s1', 'photo', jpeg(), 'moi2.jpg', 'image/jpeg').expect(201);
      expect(stored()).toHaveLength(2);
    });

    it('liste publique : seulement les candidats validés ; le personnel voit tout ; l’étudiant ne voit que la sienne', async () => {
      expect((await as('s5', 'get', C()).expect(200)).body).toEqual([]); // rien n'est validé
      const all = (await as('c1', 'get', `${C()}/all`).expect(200)).body;
      expect(all.map((c: { id: string }) => c.id).sort()).toEqual([s1Candidate, s4Candidate, ...all.map((c: { id: string }) => c.id).filter((id: string) => ![s1Candidate, s4Candidate].includes(id))].sort());
      expect(all[0]).toEqual(expect.objectContaining({ status: expect.any(String), firstName: expect.any(String) }));
      expect(all[0]).not.toHaveProperty('studentNumber');
      expect(all[0]).not.toHaveProperty('studentId');
      expect((await as('ia', 'get', `${C()}/all`).expect(200)).body.length).toBe(all.length);
      expect((await as('s1', 'get', `${C()}/all`).expect(200)).body.map((c: { id: string }) => c.id)).toEqual([s1Candidate]);
      expect((await as('s5', 'get', `${C()}/all`).expect(200)).body).toEqual([]);
      await as('s2', 'get', `${C()}/all`).expect(404);
    });

    it('photo d’un candidat non validé : réservée à lui-même et au personnel ; jamais aux autres étudiants', async () => {
      const access = (who: string) => as(who, 'post', `${C()}/${s1Candidate}/files/photo/access`);
      await access('s5').expect(404);
      await access('s2').expect(404);
      await access('s1').expect(200);
      await access('c1').expect(200);
      await access('ia').expect(200);
    });

    // ---- décision du comité 🔐
    it('décision : 2FA récente exigée (401), le comité de CETTE élection seulement ; ni l’IA ni un étudiant (403)', async () => {
      await stale('c1', 'post', `${C()}/${s1Candidate}/approve`).expect(401);
      await fresh('ia', 'post', `${C()}/${s1Candidate}/approve`).expect(403);
      await fresh('s5', 'post', `${C()}/${s1Candidate}/approve`).expect(403);
      await fresh('officer', 'post', `${C()}/${s1Candidate}/approve`).expect(403);
      await fresh('iaB', 'post', `${C()}/${s1Candidate}/approve`).expect(404);
      // c4 est dans le comité d'une AUTRE élection : pas de pouvoir ici
      const other = (await as('ia', 'post', `/institutions/${instA}/elections`).send(body()).expect(201)).body.id;
      await fresh('ia', 'post', `/institutions/${instA}/roles`).send({ email: 'c4@example.test', role: 'ELECTION_COMMITTEE', electionId: other }).expect(201);
      u.c4.token = u.c4.fresh;
      const grantsHere = t.prisma.roleAssignments.filter((r) => r.userId === u.c4.id && r.electionId === electionId && !r.revokedAt);
      for (const g of grantsHere) g.revokedAt = new Date(); // c4 quitte le comité de l'élection courante
      await fresh('c4', 'post', `${C()}/${s1Candidate}/approve`).expect(403);
      await fresh('c1', 'post', `${C()}/${s1Candidate}/approve`).expect(200);
      expect(t.prisma.candidate.rows.find((c) => c.id === s1Candidate)!.status).toBe('APPROVED');
    });

    it('la décision est tracée (🔐 + audit) et le candidat est notifié ; une seule décision par candidature', async () => {
      const actions = t.prisma.auditLogs.map((l) => l.action);
      expect(actions).toEqual(expect.arrayContaining(['candidate:review', 'CANDIDATE_APPROVED']));
      expect(t.prisma.notification.rows.some((n) => n.userId === u.s1.id && n.type === 'CANDIDACY_APPROVED')).toBe(true);
      expect((await fresh('c1', 'post', `${C()}/${s1Candidate}/approve`).expect(409)).body.message).toBe('not_reviewable');
      expect((await fresh('c1', 'post', `${C()}/${s1Candidate}/reject`).send({ reason: 'trop tard' }).expect(409)).body.message).toBe('not_reviewable');
    });

    it('rejet : motif obligatoire, lu par le candidat ; deux décisions simultanées : une seule passe', async () => {
      await fresh('c1', 'post', `${C()}/${s4Candidate}/reject`).send({}).expect(400);
      const race = await Promise.all([
        fresh('c1', 'post', `${C()}/${s4Candidate}/reject`).send({ reason: 'Dossier incomplet' }),
        fresh('c2', 'post', `${C()}/${s4Candidate}/approve`),
      ]);
      expect(race.map((r) => r.status).sort()).toEqual([200, 409]);
      const final = t.prisma.candidate.rows.find((c) => c.id === s4Candidate)!;
      expect(['APPROVED', 'REJECTED']).toContain(final.status);
      if (final.status === 'REJECTED') expect((await as('s4', 'get', `${C()}/me`)).body.rejectionReason).toBe('Dossier incomplet');
    });

    it('un candidat rejeté ne redépose pas ; une candidature validée n’est plus modifiable (« avant validation »)', async () => {
      await as('s1', 'patch', `${C()}/me`).send({ statement: 'trop tard' }).expect(409);
      await upload('s1', 'photo', png(), 'x.png', 'image/png').expect(409);
      if (t.prisma.candidate.rows.find((c) => c.id === s4Candidate)!.status === 'REJECTED') {
        expect((await apply('s4').expect(409)).body.message).toBe('candidacy_rejected');
      }
    });

    it('un membre du comité ne décide jamais de sa propre candidature (défense en profondeur, même si la ligne existait)', async () => {
      const row = await t.prisma.candidate.create({ data: { electionId, positionId, studentId: u.c2.studentId } });
      await fresh('c2', 'post', `${C()}/${row.id}/approve`).expect(403);
      t.prisma.candidate.rows = t.prisma.candidate.rows.filter((c) => c.id !== row.id);
    });

    it('approuver exige que le candidat soit encore éligible (02 §5 : au dépôt, puis à la validation)', async () => {
      const cand = (await apply('s5').expect(201)).body.id;
      const enrollment = t.prisma.studentEnrollment.rows.find((e) => e.studentId === u.s5.studentId)!;
      enrollment.status = 'EXPIRED';
      expect((await fresh('c1', 'post', `${C()}/${cand}/approve`).expect(409)).body.message).toBe('candidate_not_eligible');
      enrollment.status = 'VERIFIED';
      await fresh('c1', 'post', `${C()}/${cand}/reject`).send({ reason: 'Hors périmètre' }).expect(200);
    });

    it('candidature rejetée : correction puis redépôt tant que les candidatures sont ouvertes (comme les attestations)', async () => {
      const mine = () => as('s5', 'get', `${C()}/me`);
      expect((await mine()).body.status).toBe('REJECTED');
      const row = t.prisma.candidate.rows.find((c) => c.studentId === u.s5.studentId)!;
      await as('s5', 'patch', `${C()}/me`).send({ statement: 'Programme corrigé après rejet' }).expect(200); // la correction est permise
      await upload('s5', 'program', pdf(), 'p.pdf', 'application/pdf').expect(201);
      expect((await apply('s5').expect(409)).body.message).toBe('candidacy_rejected'); // le redépôt passe par « resubmit »
      const res = await as('s5', 'post', `${C()}/me/resubmit`).expect(200);
      expect(res.body).toEqual(expect.objectContaining({ status: 'PENDING', rejectionReason: null, hasProgram: true }));
      expect((await as('s5', 'post', `${C()}/me/resubmit`).expect(409)).body.message).toBe('candidacy_not_rejected');
      expect(t.prisma.auditLogs.some((l) => l.action === 'CANDIDATE_RESUBMITTED')).toBe(true);
      await fresh('c1', 'post', `${C()}/${row.id}/reject`).send({ reason: 'Encore incomplet' }).expect(200);
    });

    it('liste publique et fichiers d’un candidat validé : visibles pour les étudiants éligibles, via URL signée liée à l’utilisateur', async () => {
      const list = (await as('s5', 'get', C()).expect(200)).body;
      expect(list.map((c: { id: string }) => c.id)).toContain(s1Candidate);
      expect(list[0]).not.toHaveProperty('status');
      expect(list[0]).not.toHaveProperty('studentId');
      const { url } = (await as('s5', 'post', `${C()}/${s1Candidate}/files/photo/access`).expect(200)).body;
      const path = String(url).replace('/api/v1', '');
      const served = await t.api('get', path).expect(200); // la signature est l'authentification
      expect(served.headers['content-type']).toBe('image/jpeg');
      expect(served.headers['x-content-type-options']).toBe('nosniff');
      expect(served.headers['content-security-policy']).toContain('sandbox');
      expect(served.headers['cache-control']).toBe('no-store');
      // Un autre utilisateur ne peut pas réutiliser l'URL (signature liée à uid) ; un étudiant non éligible n'en obtient pas
      await t.api('get', path.replace(u.s5.id, u.s2.id)).expect(403);
      await as('s2', 'post', `${C()}/${s1Candidate}/files/photo/access`).expect(404);
      await t.api('get', path.replace(/sig=[0-9a-f]+/, `sig=${'0'.repeat(64)}`)).expect(403);
    });

    it('retrait puis nouveau dépôt : la candidature repart de zéro, les fichiers sont retirés', async () => {
      await as('s1', 'post', `${C()}/me/withdraw`).expect(200);
      expect((await as('s1', 'get', `${C()}/me`)).body.status).toBe('WITHDRAWN');
      expect((await as('s5', 'get', C()).expect(200)).body).toEqual([]); // retirée : plus listée
      const again = (await apply('s1', { statement: 'Nouvelle candidature' }).expect(201)).body;
      expect(again).toEqual(expect.objectContaining({ id: s1Candidate, status: 'PENDING', hasPhoto: false, hasProgram: false }));
      expect(stored()).toHaveLength(1); // il ne reste que le programme de s5, déposé lors de sa correction
      expect(t.prisma.candidate.rows.filter((c) => c.studentId === u.s1.studentId)).toHaveLength(1); // toujours une seule ligne
    });

    // ---- états
    it('fermeture des candidatures : plus de dépôt, mais le comité peut encore décider ; plus de retrait ni de redépôt', async () => {
      await as('s5', 'post', `${E()}/candidacy/close`).expect(403);
      expect((await as('c1', 'post', `${E()}/candidacy/close`).expect(200)).body.status).toBe('CANDIDACY_CLOSED');
      await as('ia', 'post', `${E()}/candidacy/close`).expect(409);
      await student('s6');
      expect((await apply('s6').expect(409)).body.message).toBe('candidacy_not_open');
      await as('s1', 'patch', `${C()}/me`).send({ statement: 'x' }).expect(409);
      await fresh('c1', 'post', `${C()}/${s1Candidate}/approve`).expect(200); // examen encore possible
      expect((await as('s1', 'post', `${C()}/me/withdraw`).expect(409)).body.message).toBe('candidacy_locked'); // 04 §10.5 : plus de retrait
      await as('s5', 'post', `${C()}/me/resubmit`).expect(409); // ni de redépôt
      expect((await as('s6', 'get', '/elections/mine')).body[0].status).toBe('CANDIDACY_CLOSED'); // toujours visible
    });

    it('annulation 🔐 : IA seulement, 2FA récente ; l’élection disparaît pour les étudiants ; jamais VOTING_OPEN', async () => {
      await fresh('c1', 'post', `${E()}/cancel`).expect(403);
      await stale('ia', 'post', `${E()}/cancel`).expect(401);
      expect((await fresh('ia', 'post', `${E()}/cancel`).expect(200)).body.status).toBe('CANCELLED');
      expect(t.prisma.auditLogs.some((l) => l.action === 'election:cancel' && l.result === 'SUCCESS')).toBe(true);
      expect(t.prisma.auditLogs.some((l) => l.action === 'ELECTION_CANCELLED' && l.resourceId === electionId)).toBe(true);
      await fresh('ia', 'post', `${E()}/cancel`).expect(409);
      await as('s6', 'get', E()).expect(404);
      expect((await as('s6', 'get', '/elections/mine')).body).toEqual([]);
      await as('c1', 'post', `${E()}/candidacy/open`).expect(409);
      await as('ia', 'get', E()).expect(200); // le personnel garde l'historique
      expect(t.prisma.election.rows.some((e) => e.status === 'VOTING_OPEN')).toBe(false);
    });
  });
});
