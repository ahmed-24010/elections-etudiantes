import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AcademicOverview } from '../../core/api/academic.api';
import { MAX_UPLOAD_BYTES, StudentMe } from '../../core/api/enrollment.api';
import { settle, translocoTesting } from '../../testing';
import { StudentHome, studentState } from './student-home';

const API = '/api/v1';
const YEAR = { id: 'y1', label: '2026-2027' };

const overview: AcademicOverview = {
  years: [{ id: 'y1', label: '2026-2027', startsOn: '2026-09-01', endsOn: '2027-07-15', isCurrent: true }],
  faculties: [{ id: 'f1', code: 'FSJP', name: 'FSJP' }],
  programs: [{ id: 'p1', code: 'DP', name: 'Droit privé', nameAr: 'القانون الخاص', facultyId: 'f1' }],
  levels: [{ id: 'l1', code: 'L1', name: 'Licence 1', rank: 1 }],
  groups: [{ id: 'g1', name: 'A', programId: 'p1', levelId: 'l1', academicYearId: 'y1' }],
};

const enrollment = (status: 'PENDING' | 'VERIFIED' | 'REJECTED', extra: Record<string, unknown> = {}) => ({
  id: 'e1', status, rejectionCode: null, rejectionReason: null,
  faculty: { id: 'f1', name: 'FSJP' }, program: { id: 'p1', name: 'Droit privé' }, level: { id: 'l1', name: 'Licence 1' },
  group: null, academicYear: YEAR, ...extra,
});
const student = { id: 's1', studentNumber: 'C12345', firstName: 'Aïcha', lastName: 'Test', fullNameAr: null };

const me = (over: Partial<StudentMe>): StudentMe => ({
  institutionId: 'inst-1', currentYear: YEAR, student: null, enrollment: null, document: null, canEdit: true, canUpload: false, ...over,
});

async function load(state: StudentMe) {
  TestBed.configureTestingModule({ imports: [translocoTesting()], providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  const http = TestBed.inject(HttpTestingController);
  const page = TestBed.createComponent(StudentHome);
  page.detectChanges();
  http.expectOne(`${API}/students/me`).flush(state);
  await settle(page);
  if (state.canEdit) {
    http.expectOne(`${API}/institutions/inst-1/academic`).flush(overview);
    await settle(page);
  }
  http.expectOne(`${API}/notifications`).flush({ unread: 0, items: [] });
  await settle(page);
  return { http, page, el: page.nativeElement as HTMLElement };
}

describe('États de l’inscription de l’étudiant', () => {
  it('traduit les données du serveur en six états', () => {
    expect(studentState(null)).toBe('NO_YEAR');
    expect(studentState(me({ currentYear: null }))).toBe('NO_YEAR');
    expect(studentState(me({}))).toBe('NOT_DECLARED');
    expect(studentState(me({ student, enrollment: enrollment('PENDING') }))).toBe('NEEDS_DOCUMENT');
    expect(studentState(me({ student, enrollment: enrollment('PENDING'), document: { id: 'd', status: 'UPLOADED', createdAt: '', mimeType: 'application/pdf', sizeBytes: 1 } }))).toBe('UNDER_REVIEW');
    expect(studentState(me({ student, enrollment: enrollment('VERIFIED') }))).toBe('VERIFIED');
    expect(studentState(me({ student, enrollment: enrollment('REJECTED') }))).toBe('REJECTED');
  });
});

describe('Tableau de bord étudiant', () => {
  it('inscription non déclarée : formulaire seul (pas de dépôt), faculté unique présélectionnée', async () => {
    const { el } = await load(me({}));
    expect(el.querySelector('[data-testid=state]')?.textContent).toContain('NOT_DECLARED');
    expect(el.querySelector('form')).toBeTruthy();
    expect(el.querySelector('input[type=file]')).toBeNull();
    expect(el.querySelector<HTMLSelectElement>('#facultyId')!.value).toBe('f1');
  });

  it('déclarer : envoie les champs remplis, sans groupe vide ni nom arabe vide', async () => {
    const { http, page, el } = await load(me({}));
    const set = (id: string, value: string, event = 'input') => {
      const field = el.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!;
      field.value = value;
      field.dispatchEvent(new Event(event));
    };
    set('studentNumber', 'C12345');
    set('firstName', 'Aïcha');
    set('lastName', 'Test');
    set('programId', 'p1', 'change');
    set('levelId', 'l1', 'change');
    page.detectChanges();
    el.querySelector<HTMLButtonElement>('form button[type=submit]')!.click();
    const req = http.expectOne(`${API}/students/me/enrollment`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ studentNumber: 'C12345', firstName: 'Aïcha', lastName: 'Test', facultyId: 'f1', programId: 'p1', levelId: 'l1' });
    req.flush(me({ student, enrollment: enrollment('PENDING'), canUpload: true }));
    await settle(page);
    expect(el.querySelector('input[type=file]')).toBeTruthy(); // l'étape suivante apparaît
  });

  it('numéro indisponible (409) : message générique, le formulaire reste', async () => {
    const { http, page, el } = await load(me({}));
    const field = (id: string, v: string) => {
      const i = el.querySelector<HTMLInputElement>(`#${id}`)!;
      i.value = v;
      i.dispatchEvent(new Event('input'));
    };
    field('studentNumber', 'C12345');
    field('firstName', 'A');
    field('lastName', 'B');
    for (const id of ['programId', 'levelId']) {
      const s = el.querySelector<HTMLSelectElement>(`#${id}`)!;
      s.value = id === 'programId' ? 'p1' : 'l1';
      s.dispatchEvent(new Event('change'));
    }
    page.detectChanges();
    el.querySelector<HTMLButtonElement>('form button[type=submit]')!.click();
    http.expectOne(`${API}/students/me/enrollment`).flush({ statusCode: 409, message: 'student_number_unavailable' }, { status: 409, statusText: 'Conflict' });
    await settle(page);
    expect(el.querySelector('.alert-danger')?.textContent).toContain('errors.numberUnavailable');
    expect(el.querySelector('form')).toBeTruthy();
  });

  it('dépôt : un fichier de plus de 5 Mo est refusé AVANT l’envoi', async () => {
    const { http, page, el } = await load(me({ student, enrollment: enrollment('PENDING'), canUpload: true }));
    const input = el.querySelector<HTMLInputElement>('input[type=file]')!;
    const big = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], 'gros.pdf', { type: 'application/pdf' });
    const transfer = new DataTransfer();
    transfer.items.add(big);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change'));
    page.detectChanges();
    expect(el.querySelector('.alert-danger')?.textContent).toContain('errors.fileTooLarge');
    expect(el.querySelector<HTMLButtonElement>('.btn-success')!.disabled).toBeTrue();
    http.expectNone(`${API}/students/me/enrollment/document`);
  });

  it('dépôt : envoie le fichier en multipart puis affiche « en cours d’examen »', async () => {
    const { http, page, el } = await load(me({ student, enrollment: enrollment('PENDING'), canUpload: true }));
    const input = el.querySelector<HTMLInputElement>('input[type=file]')!;
    const transfer = new DataTransfer();
    transfer.items.add(new File(['%PDF-1.4'], 'attestation.pdf', { type: 'application/pdf' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change'));
    page.detectChanges();
    el.querySelector<HTMLButtonElement>('.btn-success')!.click();
    const req = http.expectOne(`${API}/students/me/enrollment/document`);
    expect(req.request.body instanceof FormData).toBeTrue();
    expect((req.request.body as FormData).get('file')).toBeInstanceOf(File);
    req.flush({ id: 'd1', status: 'UPLOADED' }, { status: 201, statusText: 'Created' });
    await settle(page);
    http.expectOne(`${API}/students/me`).flush(
      me({ student, enrollment: enrollment('PENDING'), document: { id: 'd1', status: 'UPLOADED', createdAt: '', mimeType: 'application/pdf', sizeBytes: 8 }, canEdit: false, canUpload: false }),
    );
    await settle(page);
    expect(el.querySelector('[data-testid=state]')?.textContent).toContain('UNDER_REVIEW');
    expect(el.querySelector('input[type=file]')).toBeNull();
    expect(el.querySelector('form')).toBeNull(); // D-21 : plus de modification pendant l’examen
  });

  it('type refusé par le serveur (415) et fichier trop gros côté nginx (413 JSON) : messages dédiés', async () => {
    for (const [status, body, key] of [
      [415, { statusCode: 415, message: 'BAD_TYPE' }, 'errors.fileType'],
      [413, { statusCode: 413, message: 'TOO_LARGE' }, 'errors.fileTooLarge'],
    ] as const) {
      TestBed.resetTestingModule();
      const { http, page, el } = await load(me({ student, enrollment: enrollment('PENDING'), canUpload: true }));
      const input = el.querySelector<HTMLInputElement>('input[type=file]')!;
      const transfer = new DataTransfer();
      transfer.items.add(new File(['MZ'], 'faux.pdf', { type: 'application/pdf' }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change'));
      page.detectChanges();
      el.querySelector<HTMLButtonElement>('.btn-success')!.click();
      http.expectOne(`${API}/students/me/enrollment/document`).flush(body, { status, statusText: 'Error' });
      await settle(page);
      expect(el.querySelector('.alert-danger')?.textContent).toContain(key);
    }
  });

  it('vérifié : badge vert « Compte vérifié », récapitulatif, ni formulaire ni dépôt', async () => {
    const { el } = await load(me({ student, enrollment: enrollment('VERIFIED'), canEdit: false }));
    const badge = el.querySelector('[data-testid=state]')!;
    expect(badge.textContent).toContain('VERIFIED');
    expect(badge.classList).toContain('text-bg-success');
    expect(el.querySelector('form')).toBeNull();
    expect(el.querySelector('input[type=file]')).toBeNull();
    expect(el.textContent).toContain('C12345');
  });

  it('rejeté : affiche le motif du vérificateur et rouvre le formulaire (corriger puis redéposer)', async () => {
    const { el } = await load(
      me({ student, enrollment: enrollment('REJECTED', { rejectionCode: 'WRONG_STUDENT_NUMBER', rejectionReason: 'Numéro différent' }), canEdit: true }),
    );
    expect(el.querySelector('[data-testid=state]')?.classList).toContain('text-bg-danger');
    expect(el.querySelector('.alert-danger')?.textContent).toContain('Numéro différent');
    expect(el.querySelector('form')).toBeTruthy();
  });

  it('notifications : liste, et « tout marquer comme lu » appelle le serveur', async () => {
    TestBed.configureTestingModule({ imports: [translocoTesting()], providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    const http = TestBed.inject(HttpTestingController);
    const page = TestBed.createComponent(StudentHome);
    page.detectChanges();
    http.expectOne(`${API}/students/me`).flush(me({ student, enrollment: enrollment('VERIFIED'), canEdit: false }));
    await settle(page);
    http.expectOne(`${API}/notifications`).flush({
      unread: 1,
      items: [{ id: 'n1', type: 'ENROLLMENT_VERIFIED', body: '', readAt: null, createdAt: '2026-10-10T10:00:00.000Z' }],
    });
    await settle(page);
    const el = page.nativeElement as HTMLElement;
    expect(el.querySelectorAll('li.list-group-item').length).toBe(1);
    const button = Array.from(el.querySelectorAll('button')).find((b) => /markAllRead/.test(b.textContent ?? ''))!;
    button.click();
    http.expectOne(`${API}/notifications/read-all`).flush(null, { status: 204, statusText: 'No Content' });
    await settle(page);
    http.expectOne(`${API}/notifications`).flush({ unread: 0, items: [] });
    await settle(page);
    expect(el.querySelectorAll('li.list-group-item').length).toBe(0);
  });
});
