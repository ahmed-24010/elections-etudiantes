import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { AcademicOverview } from '../../core/api/academic.api';
import { AuthService } from '../../core/auth/auth.service';
import { settle, translocoTesting } from '../../testing';
import { AcademicListPage } from './academic-list-page';

const BASE = '/api/v1/institutions/inst-1/academic';

const overview = (over: Partial<AcademicOverview> = {}): AcademicOverview => ({
  years: [
    { id: 'y1', label: '2026-2027', startsOn: '2026-09-01T00:00:00.000Z', endsOn: '2027-07-15T00:00:00.000Z', isCurrent: true },
    { id: 'y2', label: '2025-2026', startsOn: '2025-09-01T00:00:00.000Z', endsOn: '2026-07-15T00:00:00.000Z', isCurrent: false },
  ],
  faculties: [{ id: 'f1', code: 'FSJP', name: 'FSJP' }],
  programs: [
    { id: 'p1', code: 'DP', name: 'Droit privé', facultyId: 'f1' },
    { id: 'p2', code: 'DPU', name: 'Droit public', facultyId: 'f1' },
  ],
  levels: [
    { id: 'l1', code: 'L1', name: 'Licence 1', rank: 1 },
    { id: 'l2', code: 'L2', name: 'Licence 2', rank: 2 },
  ],
  groups: [
    { id: 'g1', name: 'B', programId: 'p1', levelId: 'l1', academicYearId: 'y1' },
    { id: 'g2', name: 'A', programId: 'p2', levelId: 'l1', academicYearId: 'y1' },
    { id: 'g3', name: 'A', programId: 'p1', levelId: 'l2', academicYearId: 'y2' },
  ],
  ...over,
});

async function open(kind: string, role: 'INSTITUTION_ADMIN' | 'VERIFICATION_OFFICER' = 'INSTITUTION_ADMIN', data = overview()) {
  TestBed.configureTestingModule({
    imports: [translocoTesting()],
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: ActivatedRoute, useValue: { snapshot: { data: { kind } } } }],
  });
  TestBed.inject(AuthService).user.set({ id: 'u', email: 'ia@example.test', phone: null, twoFactorEnabled: true, roles: [{ role, institutionId: 'inst-1', electionId: null }] });
  const http = TestBed.inject(HttpTestingController);
  const page = TestBed.createComponent(AcademicListPage);
  page.detectChanges();
  if (role === 'INSTITUTION_ADMIN') {
    http.expectOne(BASE).flush(data);
    await settle(page);
  }
  const el = page.nativeElement as HTMLElement;
  const rows = () => Array.from(el.querySelectorAll('tbody tr'));
  const cells = (col: number) => rows().map((r) => r.querySelectorAll('td')[col].textContent!.trim());
  // Les tests n'embarquent pas les vraies traductions : un bouton affiche sa clé.
  const button = (key: RegExp, root: ParentNode = el) => Array.from(root.querySelectorAll('button')).find((b) => key.test((b.textContent ?? '').trim()))!;
  const type = (selector: string, value: string, event = 'input') => {
    const f = el.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
    f.value = value;
    f.dispatchEvent(new Event(event));
    page.detectChanges();
  };
  const submitModal = () => el.querySelector<HTMLFormElement>('#entity-form')!.dispatchEvent(new Event('submit')); // le fixture n'est pas dans le document : un clic ne soumettrait pas
  return { http, page, el, rows, cells, button, type, submitModal };
}

describe('Pages de structure académique', () => {
  it('chaque page : titre, explication, recherche, nombre de résultats, « + Ajouter » et un tableau', async () => {
    for (const [kind, count] of [['years', 2], ['faculties', 1], ['programs', 2], ['levels', 2]] as const) {
      TestBed.resetTestingModule();
      const { el, rows } = await open(kind);
      expect(el.querySelector('h1')?.textContent).toContain(`academic.pages.${kind}.title`);
      expect(el.querySelector('.app-page-head p')?.textContent).toContain(`academic.pages.${kind}.subtitle`);
      expect(el.querySelector('input[type=search]')).toBeTruthy();
      expect(el.querySelector('.app-count')?.textContent).toContain('common.results');
      expect(Array.from(el.querySelectorAll('button')).some((b) => /^\+/.test((b.textContent ?? '').trim()))).toBeTrue();
      expect(rows().length).withContext(kind).toBe(count);
    }
  });

  it('recherche : filtre les lignes ; filtre par faculté pour les filières', async () => {
    const { rows, type } = await open('programs');
    type('input[type=search]', 'public');
    expect(rows().length).toBe(1);
    type('input[type=search]', '');
    expect(rows().length).toBe(2);
    type('select.app-filter', 'f1', 'change');
    expect(rows().length).toBe(2);
  });

  it('groupes : filtres par filière, niveau et année ; l’année courante est présélectionnée', async () => {
    const { el, rows, type } = await open('groups');
    expect(el.querySelectorAll('select.app-filter').length).toBe(3);
    expect(rows().length).toBe(2); // année courante seulement (g3 est en 2025-2026)
    type('select.app-filter:nth-of-type(3)', '', 'change'); // toutes les années
    expect(rows().length).toBe(3);
    type('select.app-filter:nth-of-type(1)', 'p1', 'change');
    expect(rows().length).toBe(2);
    type('select.app-filter:nth-of-type(2)', 'l2', 'change');
    expect(rows().length).toBe(1);
  });

  it('groupes : tableau triable (clic sur l’en-tête : croissant, décroissant, sans tri)', async () => {
    const { el, cells, page } = await open('groups');
    const header = () => el.querySelector<HTMLButtonElement>('thead th:nth-child(1) button')!;
    expect(cells(0)).toEqual(['B', 'A']);
    header().click();
    page.detectChanges();
    expect(cells(0)).toEqual(['A', 'B']);
    expect(el.querySelector('thead th:nth-child(1)')?.getAttribute('aria-sort')).toBe('ascending');
    header().click();
    page.detectChanges();
    expect(cells(0)).toEqual(['B', 'A']);
    expect(el.querySelector('thead th:nth-child(1)')?.getAttribute('aria-sort')).toBe('descending');
  });

  it('ajouter : fenêtre, champs obligatoires, POST sans champ facultatif vide, rechargement, fermeture', async () => {
    const { http, page, el, button, type, submitModal } = await open('faculties');
    button(/^\+/).click();
    page.detectChanges();
    expect(el.querySelector('.modal')).toBeTruthy();
    expect(el.querySelector<HTMLButtonElement>('.modal-footer button[type=submit]')!.disabled).toBeTrue();
    type('#f-code', 'FST');
    type('#f-name', 'Sciences');
    submitModal();
    const req = http.expectOne(`${BASE}/faculties`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ code: 'FST', name: 'Sciences' });
    req.flush({ id: 'f2' }, { status: 201, statusText: 'Created' });
    await settle(page);
    http.expectOne(BASE).flush(overview({ faculties: [{ id: 'f1', code: 'FSJP', name: 'FSJP' }, { id: 'f2', code: 'FST', name: 'Sciences' }] }));
    await settle(page);
    expect(el.querySelector('.modal')).toBeNull();
    expect(el.textContent).toContain('Sciences');
  });

  it('un code invalide (espace) empêche l’envoi', async () => {
    const { page, el, button, type } = await open('faculties');
    button(/^\+/).click();
    page.detectChanges();
    type('#f-code', 'bad code');
    type('#f-name', 'X');
    expect(el.querySelector<HTMLButtonElement>('.modal-footer button[type=submit]')!.disabled).toBeTrue();
  });

  it('modifier : champs préremplis, PATCH ; les champs qui définissent la ressource ne sont pas modifiables', async () => {
    const { http, page, el, button, type, submitModal } = await open('programs');
    button(/common\.edit$/).click();
    page.detectChanges();
    expect(el.querySelector('#f-facultyId')).toBeNull(); // la filière ne change pas de faculté
    expect(el.querySelector<HTMLInputElement>('#f-name')!.value).toBe('Droit privé');
    type('#f-name', 'Droit privé 2');
    submitModal();
    const req = http.expectOne(`${BASE}/programs/p1`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ code: 'DP', name: 'Droit privé 2', nameAr: '' });
    req.flush({});
    await settle(page);
    http.expectOne(BASE).flush(overview());
  });

  it('années : dates saisies en AAAA-MM-JJ (pas de champ date du navigateur), validées', async () => {
    const { http, page, el, button, type, submitModal } = await open('years');
    button(/^\+/).click();
    page.detectChanges();
    expect(el.querySelector('input[type=date]')).toBeNull();
    type('#f-label', '2027-2028');
    type('#f-startsOn', '01/09/2027'); // format français : refusé
    type('#f-endsOn', '2028-07-15');
    expect(el.querySelector<HTMLButtonElement>('.modal-footer button[type=submit]')!.disabled).toBeTrue();
    type('#f-startsOn', '2027-09-01');
    submitModal();
    const req = http.expectOne(`${BASE}/years`);
    expect(req.request.body).toEqual({ label: '2027-2028', startsOn: '2027-09-01', endsOn: '2028-07-15' });
    req.flush({}, { status: 201, statusText: 'Created' });
    await settle(page);
    http.expectOne(BASE).flush(overview());
  });

  it('supprimer : confirmation dans une fenêtre ; « utilisé » (409) est expliqué', async () => {
    const { http, page, el, button } = await open('faculties');
    button(/common\.delete$/).click();
    page.detectChanges();
    http.expectNone(`${BASE}/faculties/f1`); // un clic ne supprime rien
    expect(el.querySelector('.modal-body')?.textContent).toContain('academic.deleteConfirm');
    button(/common\.delete$/, el.querySelector('.modal-footer')!).click();
    const req = http.expectOne(`${BASE}/faculties/f1`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ statusCode: 409, message: 'in_use' }, { status: 409, statusText: 'Conflict' });
    await settle(page);
    expect(el.querySelector('.alert-danger')?.textContent).toContain('errors.inUse');
  });

  it('années : « définir comme courante » appelle years/:id/current ; la courante porte un badge', async () => {
    const { http, page, el, button } = await open('years');
    expect(el.querySelectorAll('.badge.text-bg-success').length).toBe(1);
    button(/academic\.makeCurrent$/).click();
    http.expectOne(`${BASE}/years/y2/current`).flush({}, { status: 200, statusText: 'OK' });
    await settle(page);
    http.expectOne(BASE).flush(overview());
  });

  it('Échap ferme la fenêtre', async () => {
    const { page, el, button } = await open('levels');
    button(/^\+/).click();
    page.detectChanges();
    el.querySelector('.modal')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    page.detectChanges();
    expect(el.querySelector('.modal')).toBeNull();
  });

  it('sans rôle d’administrateur d’institution : aucune requête, message d’interdiction', async () => {
    const { http, page, el } = await open('years', 'VERIFICATION_OFFICER');
    await settle(page);
    http.expectNone(BASE);
    expect(el.querySelector('.alert-danger')).toBeTruthy();
  });
});
