import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AcademicOverview } from '../../core/api/academic.api';
import { AuthService } from '../../core/auth/auth.service';
import { settle, translocoTesting } from '../../testing';
import { AcademicPage } from './academic-page';

const BASE = '/api/v1/institutions/inst-1/academic';

const overview = (over: Partial<AcademicOverview> = {}): AcademicOverview => ({
  years: [{ id: 'y1', label: '2026-2027', startsOn: '2026-09-01T00:00:00.000Z', endsOn: '2027-07-15T00:00:00.000Z', isCurrent: true }],
  faculties: [{ id: 'f1', code: 'FSJP', name: 'FSJP' }],
  programs: [{ id: 'p1', code: 'DP', name: 'Droit privé', facultyId: 'f1' }],
  levels: [{ id: 'l1', code: 'L1', name: 'Licence 1', rank: 1 }],
  groups: [],
  ...over,
});

async function open(role: 'INSTITUTION_ADMIN' | 'VERIFICATION_OFFICER' = 'INSTITUTION_ADMIN') {
  TestBed.configureTestingModule({ imports: [translocoTesting()], providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  TestBed.inject(AuthService).user.set({ id: 'u', email: 'ia@example.test', phone: null, twoFactorEnabled: true, roles: [{ role, institutionId: 'inst-1', electionId: null }] });
  const http = TestBed.inject(HttpTestingController);
  const page = TestBed.createComponent(AcademicPage);
  page.detectChanges();
  return { http, page, el: page.nativeElement as HTMLElement };
}

const fill = (el: HTMLElement, id: string, value: string, event = 'input') => {
  const field = el.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!;
  field.value = value;
  field.dispatchEvent(new Event(event));
};

describe('Structure académique (administrateur d’institution)', () => {
  it('charge la structure de SON institution et affiche une section par type', async () => {
    const { http, page, el } = await open();
    http.expectOne(BASE).flush(overview());
    await settle(page);
    expect(el.querySelectorAll('section.app-card').length).toBe(5);
    expect(el.textContent).toContain('2026-2027');
    expect(el.textContent).toContain('Droit privé');
    expect(el.querySelector('.badge.text-bg-success')).toBeTruthy(); // année courante
  });

  it('sans rôle d’administrateur d’institution : aucune requête, message d’interdiction', async () => {
    const { http, page, el } = await open('VERIFICATION_OFFICER');
    await settle(page);
    http.expectNone(BASE);
    expect(el.querySelector('.alert-danger')).toBeTruthy();
  });

  it('ajouter une faculté : POST sans champ vide, puis rechargement', async () => {
    const { http, page, el } = await open();
    http.expectOne(BASE).flush(overview());
    await settle(page);
    fill(el, 'fCode', 'FST');
    fill(el, 'fName', 'Sciences');
    page.detectChanges();
    el.querySelector<HTMLFormElement>('form:has(#fCode)')!.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    const req = http.expectOne(`${BASE}/faculties`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ code: 'FST', name: 'Sciences' });
    req.flush({ id: 'f2' }, { status: 201, statusText: 'Created' });
    await settle(page);
    http.expectOne(BASE).flush(overview({ faculties: [{ id: 'f1', code: 'FSJP', name: 'FSJP' }, { id: 'f2', code: 'FST', name: 'Sciences' }] }));
    await settle(page);
    expect(el.textContent).toContain('Sciences');
  });

  it('un code invalide (espace) empêche l’envoi', async () => {
    const { http, page, el } = await open();
    http.expectOne(BASE).flush(overview());
    await settle(page);
    fill(el, 'fCode', 'bad code');
    fill(el, 'fName', 'X');
    page.detectChanges();
    expect(el.querySelector<HTMLFormElement>('form:has(#fCode)')!.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBeTrue();
  });

  it('supprimer demande une confirmation (deux clics) ; « utilisé » (409) est expliqué', async () => {
    const { http, page, el } = await open();
    http.expectOne(BASE).flush(overview());
    await settle(page);
    const del = () => Array.from(el.querySelectorAll('button')).filter((b) => /academic\.delete$/.test((b.textContent ?? '').trim()));
    // première liste : années ; la 2e « supprimer » est celle de la faculté
    del()[1].click();
    page.detectChanges();
    http.expectNone(`${BASE}/faculties/f1`); // un seul clic ne supprime rien
    const confirm = Array.from(el.querySelectorAll('button')).find((b) => /academic\.confirmDelete$/.test((b.textContent ?? '').trim()))!;
    confirm.click();
    const req = http.expectOne(`${BASE}/faculties/f1`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ statusCode: 409, message: 'in_use' }, { status: 409, statusText: 'Conflict' });
    await settle(page);
    expect(el.querySelector('.alert-danger')?.textContent).toContain('errors.inUse');
  });

  it('définir une autre année comme courante : POST years/:id/current', async () => {
    const { http, page, el } = await open();
    http.expectOne(BASE).flush(
      overview({ years: [
        { id: 'y1', label: '2026-2027', startsOn: '2026-09-01', endsOn: '2027-07-15', isCurrent: true },
        { id: 'y2', label: '2027-2028', startsOn: '2027-09-01', endsOn: '2028-07-15', isCurrent: false },
      ] }),
    );
    await settle(page);
    Array.from(el.querySelectorAll('button')).find((b) => /academic\.makeCurrent$/.test((b.textContent ?? '').trim()))!.click();
    http.expectOne(`${BASE}/years/y2/current`).flush({}, { status: 200, statusText: 'OK' });
    await settle(page);
    http.expectOne(BASE).flush(overview());
  });
});
