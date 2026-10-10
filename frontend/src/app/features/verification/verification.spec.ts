import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { ReviewDetail } from '../../core/api/verification.api';
import { AuthService } from '../../core/auth/auth.service';
import { StepUpCancelled, StepUpService } from '../../core/auth/step-up.service';
import { StepUpDialog } from '../../shared/components/step-up-dialog/step-up-dialog';
import { settle, translocoTesting } from '../../testing';
import { QueuePage } from './queue-page';
import { ReviewPage } from './review-page';

const API = '/api/v1';
const STEP_UP_401 = { statusCode: 401, message: 'step_up_required' };

const detail = (over: Partial<ReviewDetail> = {}): ReviewDetail => ({
  id: 'e1',
  status: 'PENDING',
  submittedAt: '2026-10-10T10:00:00.000Z',
  student: { studentNumber: 'C12345', firstName: 'Aïcha', lastName: 'Test', fullNameAr: null },
  faculty: { name: 'FSJP' },
  program: { name: 'Droit privé' },
  level: { name: 'Licence 1' },
  group: { name: 'A' },
  academicYear: { label: '2026-2027' },
  document: { id: 'd1', status: 'UPLOADED', mimeType: 'application/pdf', sizeBytes: 1000 },
  ownRequest: false,
  ...over,
});

function setup() {
  TestBed.configureTestingModule({
    imports: [translocoTesting()],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'e1' }) } } },
    ],
  });
  TestBed.inject(AuthService).user.set({
    id: 'officer', email: 'v@example.test', phone: null, twoFactorEnabled: true,
    roles: [{ role: 'VERIFICATION_OFFICER', institutionId: 'inst-1', electionId: null }],
  });
  return TestBed.inject(HttpTestingController);
}

describe('StepUpService (actions 🔐)', () => {
  it('sans 401 « step_up_required », l’action passe directement, sans fenêtre', async () => {
    setup();
    const stepUp = TestBed.inject(StepUpService);
    expect(await stepUp.run(async () => 'ok')).toBe('ok');
    expect(stepUp.pending()).toBeNull();
  });

  it('sur 401 step_up_required : ouvre la fenêtre, vérifie le code, puis rejoue l’action UNE fois', async () => {
    const http = setup();
    const stepUp = TestBed.inject(StepUpService);
    let calls = 0;
    const result = stepUp.run(async () => {
      calls++;
      if (calls === 1) {
        throw new HttpErrorResponse({ status: 401, error: STEP_UP_401 });
      }
      return 'fait';
    });
    await new Promise((resolve) => setTimeout(resolve));
    expect(stepUp.pending()).not.toBeNull();

    const submitted = stepUp.submit('123456');
    const req = http.expectOne(`${API}/auth/step-up`);
    expect(req.request.body).toEqual({ code: '123456' });
    req.flush(null, { status: 204, statusText: 'No Content' });
    await submitted;
    expect(await result).toBe('fait');
    expect(calls).toBe(2);
    expect(stepUp.pending()).toBeNull();
  });

  it('fermer la fenêtre annule l’action (StepUpCancelled), sans la rejouer', async () => {
    setup();
    const stepUp = TestBed.inject(StepUpService);
    let calls = 0;
    const result = stepUp.run(async () => {
      calls++;
      throw new HttpErrorResponse({ status: 401, error: STEP_UP_401 });
    });
    await new Promise((resolve) => setTimeout(resolve));
    stepUp.cancel();
    await expectAsync(result).toBeRejectedWithError(StepUpCancelled);
    expect(calls).toBe(1);
  });

  it('une autre erreur (403) n’ouvre pas la fenêtre et remonte telle quelle', async () => {
    setup();
    const stepUp = TestBed.inject(StepUpService);
    await expectAsync(stepUp.run(async () => { throw new HttpErrorResponse({ status: 403 }); })).toBeRejected();
    expect(stepUp.pending()).toBeNull();
  });
});

describe('Fenêtre de code 2FA', () => {
  it('un code incorrect laisse la fenêtre ouverte avec un message ; un bon code la ferme', async () => {
    const http = setup();
    const stepUp = TestBed.inject(StepUpService);
    const dialog = TestBed.createComponent(StepUpDialog);
    dialog.detectChanges();
    expect(dialog.nativeElement.querySelector('.modal')).toBeNull();

    const outcome = new Promise<void>((resolve, reject) => stepUp.pending.set({ resolve, reject }));
    dialog.detectChanges();
    const el = dialog.nativeElement as HTMLElement;
    const input = el.querySelector<HTMLInputElement>('#step-up-code')!;
    expect(input).toBeTruthy();

    const type = (value: string) => {
      input.value = value;
      input.dispatchEvent(new Event('input'));
      dialog.detectChanges();
    };
    type('111111');
    el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    http.expectOne(`${API}/auth/step-up`).flush({ statusCode: 400, message: 'invalid_code' }, { status: 400, statusText: 'Bad Request' });
    await settle(dialog);
    expect(el.querySelector('.alert-danger')).toBeTruthy();
    expect(stepUp.pending()).not.toBeNull();

    type('222222');
    el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    http.expectOne(`${API}/auth/step-up`).flush(null, { status: 204, statusText: 'No Content' });
    await settle(dialog);
    await outcome;
    expect(stepUp.pending()).toBeNull();
    expect(el.querySelector('.modal')).toBeNull();
  });

  it('refuse un code qui n’a pas 6 chiffres (bouton désactivé, aucun appel)', () => {
    const http = setup();
    const stepUp = TestBed.inject(StepUpService);
    const dialog = TestBed.createComponent(StepUpDialog);
    stepUp.pending.set({ resolve: () => undefined, reject: () => undefined });
    dialog.detectChanges();
    const el = dialog.nativeElement as HTMLElement;
    const input = el.querySelector<HTMLInputElement>('#step-up-code')!;
    input.value = '12ab';
    input.dispatchEvent(new Event('input'));
    dialog.detectChanges();
    expect(el.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBeTrue();
    http.expectNone(`${API}/auth/step-up`);
  });
});

describe('File du vérificateur', () => {
  it('liste les inscriptions de SON institution, et affiche un message quand elle est vide', async () => {
    const http = setup();
    const page = TestBed.createComponent(QueuePage);
    page.detectChanges();
    http.expectOne(`${API}/institutions/inst-1/verification/queue`).flush([detail()]);
    await settle(page);
    const el = page.nativeElement as HTMLElement;
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
    expect(el.textContent).toContain('C12345');
    expect(el.querySelector('a[href="/admin/verification/e1"]')).toBeTruthy();
  });

  it('file vide : pas de tableau', async () => {
    const http = setup();
    const page = TestBed.createComponent(QueuePage);
    page.detectChanges();
    http.expectOne(`${API}/institutions/inst-1/verification/queue`).flush([]);
    await settle(page);
    expect((page.nativeElement as HTMLElement).querySelector('table')).toBeNull();
  });

  it('403 de l’API : message d’erreur, pas de liste', async () => {
    const http = setup();
    const page = TestBed.createComponent(QueuePage);
    page.detectChanges();
    http.expectOne(`${API}/institutions/inst-1/verification/queue`).flush({ message: 'Forbidden' }, { status: 403, statusText: 'Forbidden' });
    await settle(page);
    expect((page.nativeElement as HTMLElement).querySelector('.alert-danger')).toBeTruthy();
  });
});

describe('Examen d’une inscription', () => {
  async function open(over: Partial<ReviewDetail> = {}) {
    const http = setup();
    const page = TestBed.createComponent(ReviewPage);
    const dialog = TestBed.createComponent(StepUpDialog);
    page.detectChanges();
    http.expectOne(`${API}/enrollments/e1/review`).flush(detail(over));
    await settle(page);
    return { http, page, dialog, el: page.nativeElement as HTMLElement };
  }
  // Les tests n'embarquent pas les vraies traductions : un bouton affiche sa clé, on le retrouve par elle.
  const button = (el: HTMLElement, key: RegExp) => Array.from(el.querySelectorAll('button')).find((b) => key.test((b.textContent ?? '').trim()))!;

  it('affiche l’attestation via l’URL signée : POST document-access, puis GET de l’URL, affichée depuis un blob local', async () => {
    const { http, page, el } = await open();
    expect(el.querySelector('iframe')).toBeNull();
    button(el, /review\.show$/).click();
    http.expectOne(`${API}/enrollments/e1/document-access`).flush({ url: '/api/v1/files/f1?uid=u&exp=1&sig=s', expiresAt: '2026-10-10T10:05:00.000Z' });
    await settle(page);
    const file = http.expectOne('/api/v1/files/f1?uid=u&exp=1&sig=s');
    expect(file.request.responseType).toBe('blob');
    file.flush(new Blob(['%PDF-1.4'], { type: 'application/pdf' }));
    await settle(page);
    const frame = el.querySelector('iframe')!;
    expect(frame).toBeTruthy();
    expect(frame.getAttribute('src')).toMatch(/^blob:/);
  });

  it('une image est affichée dans une balise img, pas dans un cadre', async () => {
    const { http, page, el } = await open({ document: { id: 'd1', status: 'UPLOADED', mimeType: 'image/png', sizeBytes: 10 } });
    button(el, /review\.show$/).click();
    http.expectOne(`${API}/enrollments/e1/document-access`).flush({ url: '/api/v1/files/f2?uid=u&exp=1&sig=s', expiresAt: '' });
    await settle(page);
    http.expectOne('/api/v1/files/f2?uid=u&exp=1&sig=s').flush(new Blob(['x'], { type: 'image/png' }));
    await settle(page);
    expect(el.querySelector('iframe')).toBeNull();
    expect(el.querySelector('img.img-fluid')?.getAttribute('src')).toMatch(/^blob:/);
  });

  it('valider : 401 step_up_required → fenêtre du code → code accepté → l’action est rejouée → confirmation', async () => {
    const { http, page, dialog, el } = await open();
    button(el, /review\.approve$/).click();
    http.expectOne(`${API}/enrollments/e1/approve`).flush(STEP_UP_401, { status: 401, statusText: 'Unauthorized' });
    await settle(page);
    dialog.detectChanges();
    const input = (dialog.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#step-up-code')!;
    expect(input).toBeTruthy(); // la fenêtre est ouverte
    input.value = '654321';
    input.dispatchEvent(new Event('input'));
    dialog.detectChanges();
    (dialog.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    http.expectOne(`${API}/auth/step-up`).flush(null, { status: 204, statusText: 'No Content' });
    await settle(page);
    http.expectOne(`${API}/enrollments/e1/approve`).flush(null, { status: 204, statusText: 'No Content' });
    await settle(page, dialog);
    expect(el.querySelector('.alert-success')).toBeTruthy();
    expect(el.querySelector('.btn-success')).toBeNull(); // plus de bouton : la décision est prise
    expect((dialog.nativeElement as HTMLElement).querySelector('.modal')).toBeNull();
  });

  it('valider avec une 2FA récente : aucun code demandé', async () => {
    const { http, page, dialog, el } = await open();
    button(el, /review\.approve$/).click();
    http.expectOne(`${API}/enrollments/e1/approve`).flush(null, { status: 204, statusText: 'No Content' });
    await settle(page);
    http.expectNone(`${API}/auth/step-up`);
    expect(el.querySelector('.alert-success')).toBeTruthy();
    expect((dialog.nativeElement as HTMLElement).querySelector('.modal')).toBeNull();
  });

  it('rejeter : motif et explication obligatoires, puis POST du code et de l’explication', async () => {
    const { http, page, el } = await open();
    button(el, /review\.reject$/).click();
    page.detectChanges();
    const submit = el.querySelector<HTMLButtonElement>('form button[type=submit]')!;
    expect(submit.disabled).toBeTrue(); // formulaire vide

    const select = el.querySelector<HTMLSelectElement>('#rejectCode')!;
    select.value = 'WRONG_STUDENT_NUMBER';
    select.dispatchEvent(new Event('change'));
    const reason = el.querySelector<HTMLTextAreaElement>('#rejectReason')!;
    reason.value = 'Numéro différent de l’attestation';
    reason.dispatchEvent(new Event('input'));
    page.detectChanges();
    expect(submit.disabled).toBeFalse();
    submit.form!.dispatchEvent(new Event("submit")); // le fixture n’est pas rattaché au document : un clic ne soumettrait pas le formulaire
    const req = http.expectOne(`${API}/enrollments/e1/reject`);
    expect(req.request.body).toEqual({ code: 'WRONG_STUDENT_NUMBER', reason: 'Numéro différent de l’attestation' });
    req.flush(null, { status: 204, statusText: 'No Content' });
    await settle(page);
    expect(el.querySelector('.alert-success')).toBeTruthy();
  });

  it('le vérificateur est l’étudiant ou le déposant (ownRequest) : aucun bouton de décision', async () => {
    const { el } = await open({ ownRequest: true });
    expect(el.querySelector('.btn-success')).toBeNull();
    expect(el.querySelector('.alert-warning')).toBeTruthy();
  });

  it('409 « déjà traitée » (autre vérificateur) : message, pas de confirmation de succès', async () => {
    const { http, page, el } = await open();
    button(el, /review\.approve$/).click();
    http.expectOne(`${API}/enrollments/e1/approve`).flush({ statusCode: 409, message: 'not_reviewable' }, { status: 409, statusText: 'Conflict' });
    await settle(page);
    expect(el.querySelector('.alert-danger')).toBeTruthy();
    expect(el.querySelector('.alert-success')).toBeNull();
  });
});
