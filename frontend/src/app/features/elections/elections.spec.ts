import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { AcademicOverview } from '../../core/api/academic.api';
import { ReviewCandidate } from '../../core/api/candidates.api';
import { ElectionDetail, ElectionSummary } from '../../core/api/elections.api';
import { Role } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { settle, translocoTesting } from '../../testing';
import { CandidatesReviewPage } from './candidates-review-page';
import { ElectionDetailPage } from './election-detail-page';
import { ElectionWizardPage } from './election-wizard-page';
import { ElectionsListPage } from './elections-list-page';
import { MyElectionPage } from './my-election-page';
import { MyElectionsPage } from './my-elections-page';
import { fromLocalInput, toLocalInput } from './election-ui';

const API = '/api/v1';
const ACADEMIC = `${API}/institutions/inst-1/academic`;

@Component({ template: '' })
class Blank {}

const summary = (over: Partial<ElectionSummary> = {}): ElectionSummary => ({
  id: 'e1', institutionId: 'inst-1', academicYearId: 'y1', title: 'Bureau du groupe A — L3 Droit public', titleAr: 'مكتب المجموعة أ', description: null,
  status: 'DRAFT', candidacyStartsAt: '2026-10-15T08:00:00.000Z', candidacyEndsAt: '2026-10-25T18:00:00.000Z', votingStartsAt: '2026-11-02T08:00:00.000Z', votingEndsAt: '2026-11-04T18:00:00.000Z', ...over,
});
const position = { id: 'p1', title: 'Président', titleAr: 'الرئيس', seats: 1, maxChoices: 1, allowBlank: true, displayOrder: 1 };
const detail = (over: Partial<ElectionDetail> = {}): ElectionDetail => ({
  ...summary(), positions: [position], rules: { wholeInstitution: false, items: [{ programId: 'pr1', levelId: 'l3', groupId: 'g1' }] }, committeeCount: 3, minCommittee: 3, ...over,
});
const overview: AcademicOverview = {
  years: [{ id: 'y1', label: '2026-2027', startsOn: '2026-09-01', endsOn: '2027-07-15', isCurrent: true }],
  faculties: [{ id: 'f1', code: 'FSJP', name: 'FSJP' }],
  programs: [{ id: 'pr1', code: 'DPU', name: 'Droit public', nameAr: 'القانون العام', facultyId: 'f1', levelIds: ['l3'] }],
  levels: [{ id: 'l3', code: 'L3', name: 'Licence 3', rank: 3 }],
  groups: [{ id: 'g1', name: 'A', programId: 'pr1', levelId: 'l3', academicYearId: 'y1' }],
};

function setup(role: Role, cmp: Type<unknown>, params: Record<string, string> = {}) {
  TestBed.configureTestingModule({
    imports: [translocoTesting()],
    providers: [
      provideRouter([{ path: '**', component: Blank }]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap(params) } } },
    ],
  });
  TestBed.inject(AuthService).user.set({ id: 'u', email: 'a@example.test', phone: null, twoFactorEnabled: true, roles: [{ role, institutionId: 'inst-1', electionId: role === 'ELECTION_COMMITTEE' ? 'e1' : null }] });
  const http = TestBed.inject(HttpTestingController);
  const page = TestBed.createComponent(cmp) as ComponentFixture<unknown>;
  page.detectChanges();
  const el = page.nativeElement as HTMLElement;
  /** Répond à la prochaine requête vers `url` puis laisse les promesses se terminer. */
  const reply = async (url: string, body: object, status = 200) => {
    await settle(page);
    http.expectOne(url).flush(body, { status, statusText: 'x' });
    await settle(page);
  };
  const button = (re: RegExp, root: ParentNode = el) => Array.from(root.querySelectorAll('button')).find((b) => re.test((b.textContent ?? '').trim()))!;
  const type = (selector: string, value: string, event = 'input') => {
    const f = el.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(selector)!;
    f.value = value;
    f.dispatchEvent(new Event(event));
    page.detectChanges();
  };
  return { http, page, el, reply, button, type };
}

describe('Élections : outils de date', () => {
  it('« AAAA-MM-JJ HH:mm » (heure locale) fait l’aller-retour avec l’instant ISO', () => {
    const iso = fromLocalInput('2026-10-15 08:30')!;
    expect(toLocalInput(iso)).toBe('2026-10-15 08:30');
    expect(fromLocalInput('15/10/2026')).toBeUndefined();
    expect(fromLocalInput('')).toBeUndefined();
  });
});

describe('Liste des élections (administration)', () => {
  it('l’administrateur voit les élections, le bouton « Nouvelle élection » et peut filtrer par état', async () => {
    const { http, page, el, reply, type } = setup('INSTITUTION_ADMIN', ElectionsListPage);
    await reply(`${API}/institutions/inst-1/elections`, [summary(), summary({ id: 'e2', title: 'Union', titleAr: null, status: 'CANDIDACY_OPEN' })]);
    expect(el.querySelectorAll('tbody tr').length).toBe(2);
    expect(el.querySelector('a[href="/admin/elections/new"]')).not.toBeNull();
    type('select.app-filter', 'CANDIDACY_OPEN', 'change');
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
    expect(el.querySelector('tbody')!.textContent).toContain('Union');
    http.verify();
    void page;
  });

  it('un membre du comité voit la liste mais pas le bouton de création', async () => {
    const { el, reply } = setup('ELECTION_COMMITTEE', ElectionsListPage);
    await reply(`${API}/institutions/inst-1/elections`, [summary()]);
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
    expect(el.querySelector('a[href="/admin/elections/new"]')).toBeNull();
  });
});

describe('Création en étapes', () => {
  async function toPositions() {
    const t = setup('INSTITUTION_ADMIN', ElectionWizardPage);
    await t.reply(ACADEMIC, overview);
    t.type('#title', 'Bureau du groupe A — L3 Droit public');
    t.type('#candidacyStartsAt', '2026-10-15 08:00');
    t.type('#candidacyEndsAt', '2026-10-25 18:00');
    t.type('#votingStartsAt', '2026-11-02 08:00');
    t.type('#votingEndsAt', '2026-11-04 18:00');
    (t.el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(t.page);
    const req = t.http.expectOne(`${API}/institutions/inst-1/elections`);
    return { ...t, req };
  }

  it('étape 1 : l’année courante est préremplie, les dates sont envoyées en ISO, un brouillon est créé', async () => {
    const { req, reply, el, http } = await toPositions();
    expect(req.request.body).toEqual({
      title: 'Bureau du groupe A — L3 Droit public',
      academicYearId: 'y1',
      candidacyStartsAt: fromLocalInput('2026-10-15 08:00'),
      candidacyEndsAt: fromLocalInput('2026-10-25 18:00'),
      votingStartsAt: fromLocalInput('2026-11-02 08:00'),
      votingEndsAt: fromLocalInput('2026-11-04 18:00'),
    });
    req.flush(summary());
    await settle(TestBed.createComponent(Blank)); // laisse la navigation se terminer
    await reply(`${API}/elections/e1`, detail({ positions: [] }));
    await reply(`${API}/institutions/inst-1/staff`, []);
    expect(el.querySelector('#posTitle')).not.toBeNull(); // étape « Postes »
    http.verify();
  });

  it('étape 1 : dates dans un format invalide ou champs vides : bouton désactivé', async () => {
    const { el, reply, type } = setup('INSTITUTION_ADMIN', ElectionWizardPage);
    await reply(ACADEMIC, overview);
    const submit = () => el.querySelector<HTMLButtonElement>('form button[type=submit]')!.disabled;
    expect(submit()).toBeTrue();
    type('#title', 'Un titre');
    for (const [id, v] of [['candidacyStartsAt', '15/10/2026'], ['candidacyEndsAt', '2026-10-25 18:00'], ['votingStartsAt', '2026-11-02 08:00'], ['votingEndsAt', '2026-11-04 18:00']]) type('#' + id, v);
    expect(submit()).toBeTrue(); // format français refusé
    type('#candidacyStartsAt', '2026-10-15 08:00');
    expect(submit()).toBeFalse();
  });

  it('reprise d’un brouillon : formulaire prérempli ; une élection déjà ouverte n’est plus modifiable ici', async () => {
    const draft = setup('INSTITUTION_ADMIN', ElectionWizardPage, { id: 'e1' });
    await draft.reply(ACADEMIC, overview);
    await draft.reply(`${API}/elections/e1`, detail());
    await draft.reply(`${API}/institutions/inst-1/staff`, []);
    expect(draft.el.querySelector<HTMLInputElement>('#title')!.value).toBe('Bureau du groupe A — L3 Droit public');
    TestBed.resetTestingModule();
    const open = setup('INSTITUTION_ADMIN', ElectionWizardPage, { id: 'e1' });
    await open.reply(ACADEMIC, overview);
    await open.reply(`${API}/elections/e1`, detail({ status: 'CANDIDACY_OPEN' }));
    await open.reply(`${API}/institutions/inst-1/staff`, []);
    expect(open.el.querySelector('.alert-warning')).not.toBeNull();
    expect(open.el.querySelector('#title')).toBeNull();
  });

  it('étapes postes, règles, comité : ajout d’un poste, règle sans critère refusée, membre ajouté (🔐)', async () => {
    const t = setup('INSTITUTION_ADMIN', ElectionWizardPage, { id: 'e1' });
    const { el, button, type, http, page, reply } = t;
    const empty = detail({ positions: [], rules: { wholeInstitution: false, items: [] }, committeeCount: 0 });
    await reply(ACADEMIC, overview);
    await reply(`${API}/elections/e1`, empty);
    await reply(`${API}/institutions/inst-1/staff`, []);
    // étape 1 (brouillon repris) : enregistrer = PATCH, puis rechargement
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await reply(`${API}/elections/e1`, summary());
    await reply(`${API}/elections/e1`, empty);
    await reply(`${API}/institutions/inst-1/staff`, []);
    // étape 2 : postes
    type('#posTitle', 'Président');
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await settle(page);
    const add = http.expectOne(`${API}/elections/e1/positions`);
    expect(add.request.body).toEqual({ title: 'Président', seats: 1, maxChoices: 1 });
    add.flush(position);
    await reply(`${API}/elections/e1`, detail({ rules: { wholeInstitution: false, items: [] }, committeeCount: 0 }));
    await reply(`${API}/institutions/inst-1/staff`, []);
    button(/elections\.wizard\.next/).click();
    page.detectChanges();
    // étape 3 : règles
    button(/elections\.rules\.add/).click();
    page.detectChanges();
    const save = () => button(/elections\.wizard\.saveNext/);
    expect(save().disabled).toBeTrue(); // une règle sans critère est refusée
    type('#rule-0-programId', 'pr1', 'change');
    expect(save().disabled).toBeFalse();
    save().click();
    await settle(page);
    const put = http.expectOne(`${API}/elections/e1/rules`);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ rules: [{ programId: 'pr1' }] });
    put.flush(detail());
    await settle(page);
    // étape 4 : comité (la 2FA est récente dans ce test, donc pas de fenêtre de code)
    type('#memberEmail', 'Membre@Example.test');
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await settle(page);
    const role = http.expectOne(`${API}/institutions/inst-1/roles`);
    expect(role.request.body).toEqual({ email: 'membre@example.test', role: 'ELECTION_COMMITTEE', electionId: 'e1' });
    role.flush({});
    await reply(`${API}/elections/e1`, detail({ committeeCount: 1 }));
    await reply(`${API}/institutions/inst-1/staff`, [{ assignmentId: 'a1', role: 'ELECTION_COMMITTEE', electionId: 'e1', user: { id: 'u2', email: 'membre@example.test', phone: null } }]);
    expect(el.textContent).toContain('membre@example.test');
    http.verify();
  });
});

describe('Page d’une élection (administration)', () => {
  async function load(role: Role, d: ElectionDetail, count = 12) {
    const t = setup(role, ElectionDetailPage, { id: 'e1' });
    await t.reply(`${API}/elections/e1`, d);
    await t.reply(ACADEMIC, overview);
    await t.reply(`${API}/elections/e1/eligible-count`, { count });
    return t;
  }

  it('brouillon prêt : état, nombre d’éligibles (un chiffre), règle décrite, ouverture des candidatures', async () => {
    const { el, button, http, page } = await load('INSTITUTION_ADMIN', detail());
    expect(el.querySelector('[data-testid=status]')!.textContent).toContain('elections.status.DRAFT');
    expect(el.querySelector('[data-testid=eligible]')!.textContent).toContain('12');
    expect(el.textContent).toContain('القانون العام · Licence 3 · A'); // la règle est décrite avec les noms, pas des identifiants
    expect(el.textContent).not.toContain('pr1');
    button(/openCandidacy/).click();
    await settle(page);
    http.expectOne(`${API}/elections/e1/candidacy/open`).flush(detail({ status: 'CANDIDACY_OPEN' }));
    await settle(page);
    expect(el.querySelector('[data-testid=status]')!.textContent).toContain('elections.status.CANDIDACY_OPEN');
    expect(el.querySelector('[data-testid=to-candidates]')).not.toBeNull();
  });

  it('comité incomplet : le serveur refuse et le message est affiché ; l’aide « pour ouvrir » est visible', async () => {
    const { el, button, http, page } = await load('INSTITUTION_ADMIN', detail({ committeeCount: 2 }));
    expect(el.querySelector('[data-testid=committee]')!.className).toContain('text-bg-warning');
    expect(el.textContent).toContain('elections.detail.notReady');
    button(/openCandidacy/).click();
    await settle(page);
    http
      .expectOne(`${API}/elections/e1/candidacy/open`)
      .flush({ statusCode: 409, message: 'conditions_not_met', conditions: ['committee_incomplete', 'no_eligible_voters'] }, { status: 409, statusText: 'Conflict' });
    await settle(page);
    const alert = el.querySelector('.alert-danger')!.textContent!;
    expect(alert).toContain('errors.conditionsNotMet');
    expect(alert).toContain('elections.readiness.committee'); // toutes les conditions manquantes sont listées
    expect(alert).toContain('elections.readiness.eligible');
  });

  it('annuler 🔐 : réservé à l’administrateur, avec confirmation ; le comité n’a pas le bouton', async () => {
    const admin = await load('INSTITUTION_ADMIN', detail({ status: 'CANDIDACY_OPEN' }));
    admin.button(/elections\.detail\.cancel$/).click();
    admin.page.detectChanges();
    expect(admin.el.querySelector('.modal')).not.toBeNull();
    const confirm = admin.el.querySelector<HTMLButtonElement>('.modal-footer button[type=submit]')!;
    expect(confirm.disabled).toBeTrue(); // le motif est obligatoire (04 §4.6)
    admin.type('#cancelReason', 'Décision de l’administration');
    expect(confirm.disabled).toBeFalse();
    admin.el.querySelector<HTMLFormElement>('#cancel-form')!.dispatchEvent(new Event('submit'));
    await settle(admin.page);
    const cancel = admin.http.expectOne(`${API}/elections/e1/cancel`);
    expect(cancel.request.body).toEqual({ reason: 'Décision de l’administration' });
    cancel.flush(detail({ status: 'CANCELLED' }));
    await settle(admin.page);
    expect(admin.el.querySelector('[data-testid=status]')!.textContent).toContain('CANCELLED');
    TestBed.resetTestingModule();
    const committee = await load('ELECTION_COMMITTEE', detail({ status: 'CANDIDACY_OPEN' }));
    expect(Array.from(committee.el.querySelectorAll('button')).some((b) => /elections\.detail\.cancel$/.test(b.textContent ?? ''))).toBeFalse();
  });
});

const candidate = (over: Partial<ReviewCandidate> = {}): ReviewCandidate => ({
  id: 'c1', positionId: 'p1', status: 'PENDING', statement: 'Mon programme', rejectionReason: null, hasPhoto: true, hasProgram: false, reviewedAt: null,
  firstName: 'Aïcha', lastName: 'Test', fullNameAr: null, enrollment: { programId: 'pr1', levelId: 'l3', groupId: 'g1' }, ...over,
});

describe('Validation des candidatures (comité)', () => {
  async function load(role: Role, status: ElectionDetail['status'] = 'CANDIDACY_OPEN', items = [candidate(), candidate({ id: 'c2', status: 'REJECTED', rejectionReason: 'Dossier incomplet', firstName: 'Omar' })]) {
    const t = setup(role, CandidatesReviewPage, { id: 'e1' });
    await t.reply(`${API}/elections/e1`, detail({ status }));
    await t.reply(ACADEMIC, overview);
    await t.reply(`${API}/elections/e1/candidates/all`, items);
    return t;
  }

  it('liste toutes les candidatures avec poste, filière · niveau · groupe et motif de rejet ; jamais de numéro étudiant', async () => {
    const { el } = await load('ELECTION_COMMITTEE');
    expect(el.querySelectorAll('.app-candidate').length).toBe(2);
    expect(el.textContent).toContain('الرئيس'); // l'interface de test est en arabe
    expect(el.textContent).toContain('القانون العام · Licence 3 · A');
    expect(el.textContent).toContain('Dossier incomplet');
    expect(el.textContent).not.toMatch(/C12345|studentNumber/);
  });

  it('valider : action 🔐 envoyée au serveur, puis liste rechargée', async () => {
    const { el, button, http, page } = await load('ELECTION_COMMITTEE');
    button(/review\.approve/, el.querySelector('[data-testid=candidate-c1]')!).click();
    await settle(page);
    http.expectOne(`${API}/elections/e1/candidates/c1/approve`).flush({});
    await settle(page);
    http.expectOne(`${API}/elections/e1`).flush(detail());
    await settle(page);
    http.expectOne(`${API}/elections/e1/candidates/all`).flush([candidate({ status: 'APPROVED' })]);
    await settle(page);
    expect(el.querySelector('.badge')!.textContent).toContain('APPROVED');
  });

  it('rejeter : motif obligatoire avant l’envoi', async () => {
    const { el, button, type, http, page } = await load('ELECTION_COMMITTEE');
    button(/review\.reject/, el.querySelector('[data-testid=candidate-c1]')!).click();
    page.detectChanges();
    const confirm = () => el.querySelector<HTMLButtonElement>('.modal-footer button[type=submit]')!;
    expect(confirm().disabled).toBeTrue();
    type('#reason', 'ab');
    expect(confirm().disabled).toBeTrue();
    type('#reason', 'Programme manquant');
    expect(confirm().disabled).toBeFalse();
    el.querySelector<HTMLFormElement>('#reject-form')!.dispatchEvent(new Event('submit'));
    await settle(page);
    const req = http.expectOne(`${API}/elections/e1/candidates/c1/reject`);
    expect(req.request.body).toEqual({ reason: 'Programme manquant' });
    req.flush({});
  });

  it('l’administrateur d’institution consulte sans pouvoir décider ; après la fermeture le comité décide encore ; annulée : plus rien', async () => {
    const ia = await load('INSTITUTION_ADMIN');
    expect(Array.from(ia.el.querySelectorAll('button')).some((b) => /review\.approve/.test(b.textContent ?? ''))).toBeFalse();
    TestBed.resetTestingModule();
    const closed = await load('ELECTION_COMMITTEE', 'CANDIDACY_CLOSED');
    expect(closed.el.textContent).toContain('elections.review.closedNote');
    expect(Array.from(closed.el.querySelectorAll('button')).some((b) => /review\.approve/.test(b.textContent ?? ''))).toBeTrue();
    TestBed.resetTestingModule();
    const cancelled = await load('ELECTION_COMMITTEE', 'CANCELLED');
    expect(Array.from(cancelled.el.querySelectorAll('button')).some((b) => /review\.approve/.test(b.textContent ?? ''))).toBeFalse();
  });
});

describe('Mes élections (étudiant)', () => {
  it('liste uniquement ce que le serveur renvoie, avec l’état de ma candidature ; vide : message', async () => {
    const t = setup('STUDENT', MyElectionsPage);
    await t.reply(`${API}/elections/mine`, [summary({ status: 'CANDIDACY_OPEN', myCandidacy: 'PENDING' })]);
    expect(t.el.querySelectorAll('article').length).toBe(1);
    expect(t.el.textContent).toContain('elections.candidate.status.PENDING');
    TestBed.resetTestingModule();
    const empty = setup('STUDENT', MyElectionsPage);
    await empty.reply(`${API}/elections/mine`, []);
    expect(empty.el.textContent).toContain('elections.student.empty');
  });
});

describe('Une élection et ma candidature (étudiant)', () => {
  const own = (over = {}) => ({ id: 'c1', positionId: 'p1', status: 'PENDING', statement: 'Mon programme', rejectionReason: null, hasPhoto: false, hasProgram: false, ...over });
  async function load(status: ElectionDetail['status'], mine: object | null) {
    const t = setup('STUDENT', MyElectionPage, { id: 'e1' });
    await t.reply(`${API}/elections/e1`, { ...detail({ status }), rules: undefined, committeeCount: undefined, minCommittee: undefined, eligible: true });
    await t.reply(`${API}/elections/e1/candidates`, [{ id: 'c9', positionId: 'p1', statement: 'Pour tous', hasPhoto: false, hasProgram: false, firstName: 'Omar', lastName: 'Ba', fullNameAr: null }]);
    if (mine) await t.reply(`${API}/elections/e1/candidates/me`, mine);
    else await t.reply(`${API}/elections/e1/candidates/me`, { statusCode: 404, message: 'Not Found' }, 404);
    return t;
  }

  it('candidatures ouvertes, pas encore candidat : liste des candidats validés et formulaire de dépôt (poste obligatoire)', async () => {
    const { el, type, http, page } = await load('CANDIDACY_OPEN', null);
    expect(el.textContent).toContain('Omar Ba');
    const submit = () => el.querySelector<HTMLButtonElement>('form button[type=submit]')!;
    expect(submit().disabled).toBeTrue();
    type('#positionIdNew', 'p1', 'change');
    type('#statementNew', 'Mon projet');
    expect(submit().disabled).toBeFalse();
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await settle(page);
    const req = http.expectOne(`${API}/elections/e1/candidates`);
    expect(req.request.body).toEqual({ positionId: 'p1', statement: 'Mon projet' });
    req.flush(own());
    await settle(page);
    expect(el.querySelector('[data-testid=my-status]')!.textContent).toContain('PENDING');
  });

  it('candidature en attente : correction et dépôt de fichiers possibles, retrait avec confirmation', async () => {
    const { el, button, page, http } = await load('CANDIDACY_OPEN', own());
    expect(el.querySelector('#file-photo')).not.toBeNull();
    expect(el.querySelector<HTMLInputElement>('#file-photo')!.accept).toBe('image/jpeg,image/png'); // une photo n'est pas un PDF
    button(/candidate\.withdraw$/).click();
    page.detectChanges();
    button(/candidate\.withdraw$/, el.querySelector('.modal-footer')!).click();
    await settle(page);
    http.expectOne(`${API}/elections/e1/candidates/me/withdraw`).flush(own({ status: 'WITHDRAWN' }));
    await settle(page);
    http.expectOne(`${API}/elections/e1/candidates`).flush([]);
    await settle(page);
    expect(el.querySelector('[data-testid=my-status]')!.textContent).toContain('WITHDRAWN');
    expect(el.querySelector('#positionIdNew')).not.toBeNull(); // elle peut être redéposée tant que c'est ouvert
  });

  it('candidature rejetée : motif visible, correction puis « redéposer » (tant que les candidatures sont ouvertes)', async () => {
    const { el, button, page, http } = await load('CANDIDACY_OPEN', own({ status: 'REJECTED', rejectionReason: 'Programme manquant' }));
    expect(el.textContent).toContain('Programme manquant');
    expect(el.querySelector('#statement')).not.toBeNull();
    button(/candidate\.resubmit/).click();
    await settle(page);
    http.expectOne(`${API}/elections/e1/candidates/me/resubmit`).flush(own());
    await settle(page);
    expect(el.querySelector('[data-testid=my-status]')!.textContent).toContain('PENDING');
  });

  it('candidatures fermées : plus de retrait, de correction ni de redépôt (04 §10.5)', async () => {
    const pending = await load('CANDIDACY_CLOSED', own());
    expect(Array.from(pending.el.querySelectorAll('button')).some((b) => /candidate\.withdraw$|candidate\.resubmit/.test(b.textContent ?? ''))).toBeFalse();
    expect(pending.el.querySelector('#statement')).toBeNull();
    TestBed.resetTestingModule();
    const rejected = await load('CANDIDACY_CLOSED', own({ status: 'REJECTED', rejectionReason: 'x' }));
    expect(Array.from(rejected.el.querySelectorAll('button')).some((b) => /candidate\.resubmit/.test(b.textContent ?? ''))).toBeFalse();
    TestBed.resetTestingModule();
    const none = await load('CANDIDACY_CLOSED', null);
    expect(none.el.querySelector('#positionIdNew')).toBeNull();
    expect(none.el.textContent).toContain('elections.student.noApply');
  });
});

// Fichiers des candidatures : « Voir la photo » / « Voir le programme » (bug : image blanche), boutons de fichier
// traduits, photo JPEG ou PNG seulement. Ces tests utilisent un vrai navigateur : l'image est réellement décodée.
describe('Fichiers des candidatures', () => {
  const png = (): Promise<Blob> => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 6;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(0, 0, 8, 6);
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
  };
  const SIGNED = '/api/v1/files/f1?uid=u&exp=1&sig=s';

  async function openViewer(kind: 'photo' | 'program', blob: Blob) {
    const t = setup('ELECTION_COMMITTEE', CandidatesReviewPage, { id: 'e1' });
    await t.reply(`${API}/elections/e1`, detail());
    await t.reply(ACADEMIC, overview);
    await t.reply(`${API}/elections/e1/candidates/all`, [candidate({ hasProgram: true })]);
    const card = t.el.querySelector('[data-testid=candidate-c1]')!;
    t.button(kind === 'photo' ? /candidate\.viewPhoto/ : /candidate\.viewProgram/, card).click();
    await settle(t.page);
    t.http.expectOne(`${API}/elections/e1/candidates/c1/files/${kind}/access`).flush({ url: SIGNED });
    await settle(t.page);
    t.http.expectOne(SIGNED).flush(blob);
    await settle(t.page);
    return t;
  }

  it('« Voir la photo » : la photo reçue est réellement affichée (décodée, taille > 0), pas une image vide', async () => {
    const { el } = await openViewer('photo', await png());
    const img = el.querySelector<HTMLImageElement>('.modal-body img')!;
    expect(img).not.toBeNull();
    expect(img.src.startsWith('blob:')).toBeTrue(); // une URL blob: est acceptée par le navigateur pour <img>
    await img.decode();
    expect([img.naturalWidth, img.naturalHeight]).toEqual([8, 6]);
    expect(el.querySelector('.modal-body iframe')).toBeNull();
  });

  it('« Voir la photo » : une photo transparente ou blanche reste visible (damier derrière l’image)', async () => {
    const { el } = await openViewer('photo', await png());
    const img = el.querySelector<HTMLImageElement>('.modal-body img')!;
    expect(img.classList).toContain('app-photo-preview');
    expect(getComputedStyle(img).backgroundImage).not.toBe('none');
  });

  it('« Voir le programme » : un PDF s’ouvre dans un cadre (blob), jamais dans une balise <img>', async () => {
    const { el } = await openViewer('program', new Blob(['%PDF-1.4\n%%EOF\n'], { type: 'application/pdf' }));
    const frame = el.querySelector<HTMLIFrameElement>('.modal-body iframe')!;
    expect(frame).not.toBeNull();
    expect(frame.src.startsWith('blob:')).toBeTrue();
    expect(el.querySelector('.modal-body img')).toBeNull();
  });

  it('photo : un PDF ou une image GIF est refusé côté client (aucun envoi), un PNG est envoyé', async () => {
    const t = setup('STUDENT', MyElectionPage, { id: 'e1' });
    await t.reply(`${API}/elections/e1`, { ...detail({ status: 'CANDIDACY_OPEN' }), rules: undefined, committeeCount: undefined, minCommittee: undefined, eligible: true });
    await t.reply(`${API}/elections/e1/candidates`, []);
    await t.reply(`${API}/elections/e1/candidates/me`, { id: 'c1', positionId: 'p1', status: 'PENDING', statement: 'x', rejectionReason: null, hasPhoto: false, hasProgram: false });
    const pick = async (file: File) => {
      const input = t.el.querySelector<HTMLInputElement>('#file-photo')!;
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change'));
      await settle(t.page);
    };
    for (const bad of [new File(['x'], 'a.pdf', { type: 'application/pdf' }), new File(['x'], 'a.gif', { type: 'image/gif' })]) {
      await pick(bad);
      t.http.expectNone(`${API}/elections/e1/candidates/me/files/photo`);
      expect(t.el.querySelector('[role=alert]')!.textContent).toContain('errors.photoType');
    }
    await pick(new File([await png()], 'moi.png', { type: 'image/png' }));
    t.http.expectOne(`${API}/elections/e1/candidates/me/files/photo`).flush({ id: 'c1', positionId: 'p1', status: 'PENDING', statement: 'x', rejectionReason: null, hasPhoto: true, hasProgram: false });
  });

  it('sélecteur de fichier : libellé traduit (pas le texte natif du navigateur), champ natif masqué mais présent', async () => {
    const t = setup('STUDENT', MyElectionPage, { id: 'e1' });
    await t.reply(`${API}/elections/e1`, { ...detail({ status: 'CANDIDACY_OPEN' }), rules: undefined, committeeCount: undefined, minCommittee: undefined, eligible: true });
    await t.reply(`${API}/elections/e1/candidates`, []);
    await t.reply(`${API}/elections/e1/candidates/me`, { id: 'c1', positionId: 'p1', status: 'PENDING', statement: 'x', rejectionReason: null, hasPhoto: false, hasProgram: false });
    const label = t.el.querySelector<HTMLLabelElement>('label.app-file-button')!;
    expect(label.textContent).toContain('common.chooseFile');
    expect(label.htmlFor).toBe('file-photo');
    expect(getComputedStyle(t.el.querySelector('#file-photo')!).opacity).toBe('0'); // le « Choose file » du navigateur n'est pas visible
    expect(label.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  });
});
