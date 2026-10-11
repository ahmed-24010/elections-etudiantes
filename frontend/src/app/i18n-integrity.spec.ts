import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Translation, TranslocoTestingModule } from '@jsverse/transloco';
import { settle } from './testing';
import { REJECTION_CODES } from './core/api/enrollment.api';
import { apiErrorKey } from './core/auth/api-error';
import { AuthService } from './core/auth/auth.service';
import { AcademicPage } from './features/admin/academic-page';
import { QueuePage } from './features/verification/queue-page';
import { ReviewPage } from './features/verification/review-page';
import { StudentHome } from './features/student/student-home';
import { StepUpDialog } from './shared/components/step-up-dialog/step-up-dialog';
import { HomePage } from './features/home/home-page';
import { LoginPage } from './features/auth/login-page';
import { RegisterPage } from './features/auth/register-page';
import { TwoFactorSetupPage } from './features/auth/two-factor-setup-page';
import { AdminLayout } from './layout/admin/admin-layout';
import { PublicLayout } from './layout/public/public-layout';
import { StudentLayout } from './layout/student/student-layout';
import { AppFooter } from './shared/components/app-footer/app-footer';

// Ces tests utilisent les VRAIS fichiers ar.json / fr.json (servis par Karma depuis public/), pas des traductions de
// test : ils échouent si une clé utilisée par une page n'existe pas, ou si une clé s'affiche brute à l'écran.

type Lang = 'ar' | 'fr';
const LANGS: Lang[] = ['fr', 'ar'];

async function loadJson(lang: Lang): Promise<Translation> {
  const res = await fetch(`/assets/i18n/${lang}.json`);
  if (!res.ok) throw new Error(`/assets/i18n/${lang}.json introuvable (${res.status})`);
  return res.json();
}

function flatKeys(obj: Translation, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flatKeys(v as Translation, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

/** Mots qui ressemblent à une clé de traduction (« institution.faculty »), dans le texte et les attributs visibles. */
export function rawKeys(root: HTMLElement): string[] {
  const attrs = Array.from(root.querySelectorAll('*')).flatMap((e) =>
    ['alt', 'aria-label', 'placeholder', 'title'].map((a) => e.getAttribute(a) ?? ''),
  );
  // Chaque morceau de texte est lu séparément : deux éléments voisins (« …consulter. » puis « Choisir ») ne doivent pas se
  // coller en un faux mot « consulter.Choisir ».
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: string[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n.textContent ?? '');
  return [...texts, ...attrs]
    .join(' ')
    .split(/[\s·]+/)
    .filter((w) => /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/.test(w));
}

function configure(langs: Record<Lang, Translation>, active: Lang) {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs,
        translocoConfig: { availableLangs: ['ar', 'fr'], defaultLang: active, fallbackLang: active },
        preloadLangs: true,
      }),
    ],
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
}

function render(cmp: Type<unknown>): HTMLElement {
  const fixture = TestBed.createComponent(cmp);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('Traductions : aucune clé brute à l’écran', () => {
  let json: Record<Lang, Translation>;
  beforeAll(async () => {
    json = { fr: await loadJson('fr'), ar: await loadJson('ar') };
  });

  it('ar.json et fr.json ont exactement les mêmes clés, toutes non vides', () => {
    const fr = flatKeys(json.fr).sort();
    const ar = flatKeys(json.ar).sort();
    expect(fr.filter((k) => !ar.includes(k))).withContext('clés présentes en fr seulement').toEqual([]);
    expect(ar.filter((k) => !fr.includes(k))).withContext('clés présentes en ar seulement').toEqual([]);
    for (const lang of LANGS) {
      const empties = flatKeys(json[lang]).filter((k) => {
        const value = k.split('.').reduce<unknown>((o, p) => (o as Translation)[p], json[lang]);
        return typeof value !== 'string' || value.trim() === '';
      });
      expect(empties).withContext(`valeurs vides en ${lang}`).toEqual([]);
    }
  });

  const pages: [string, Type<unknown>][] = [
    ['layout public (en-tête + pied de page)', PublicLayout],
    ['espace étudiant', StudentLayout],
    ['espace admin', AdminLayout],
    ['accueil', HomePage],
    ['connexion', LoginPage],
    ['inscription', RegisterPage],
    ['configuration 2FA', TwoFactorSetupPage],
    ['pied de page', AppFooter],
    ['tableau de bord étudiant', StudentHome],
    ['structure académique', AcademicPage],
    ['file du vérificateur', QueuePage],
    ['examen d’une inscription', ReviewPage],
    ['fenêtre de code 2FA', StepUpDialog],
  ];

  for (const lang of LANGS) {
    describe(`en ${lang}`, () => {
      for (const [name, cmp] of pages) {
        it(`${name} : aucune clé brute, visiteur`, () => {
          configure(json, lang);
          expect(rawKeys(render(cmp))).toEqual([]);
        });
      }

      it('espaces étudiant et admin : aucune clé brute, utilisateur connecté (menu compte)', () => {
        configure(json, lang);
        TestBed.inject(AuthService).user.set({
          id: 'u', email: 'alice@example.test', phone: null, twoFactorEnabled: true,
          roles: [{ role: 'STUDENT', institutionId: 'i', electionId: null }, { role: 'INSTITUTION_ADMIN', institutionId: 'i', electionId: null }],
        });
        for (const cmp of [StudentLayout, AdminLayout, PublicLayout, HomePage]) expect(rawKeys(render(cmp))).toEqual([]);
      });

      it('le pied de page et le message de bienvenue affichent le texte traduit', () => {
        configure(json, lang);
        const footer = render(AppFooter).textContent ?? '';
        expect(footer).toContain((json[lang] as Record<string, Record<string, string>>)['institution']['faculty']);
        expect(footer).toContain((json[lang] as Record<string, Record<string, string>>)['institution']['university']);
        TestBed.resetTestingModule();
        configure(json, lang);
        const student = render(StudentHome).textContent ?? '';
        const welcome = (json[lang] as Record<string, Record<string, Record<string, string>>>)['student']['welcome'];
        expect(student).toContain(welcome['title']);
        expect(student).toContain(welcome['text']);
        expect(student).not.toMatch(/vide pour|فارغ/);
      });
    });
  }

  it('chaque message d’erreur possible de l’API correspond à une clé existante dans les deux langues', () => {
    const cases: HttpErrorResponse[] = [
      new HttpErrorResponse({ status: 0 }),
      new HttpErrorResponse({ status: 429 }),
      new HttpErrorResponse({ status: 401, error: { message: 'invalid_credentials' } }),
      new HttpErrorResponse({ status: 401 }),
      new HttpErrorResponse({ status: 400, error: { message: 'invalid_code' } }),
      new HttpErrorResponse({ status: 400, error: { message: 'invalid_institution' } }),
      new HttpErrorResponse({ status: 500 }),
      new HttpErrorResponse({ status: 401, error: { message: 'step_up_required' } }),
      new HttpErrorResponse({ status: 403 }),
      new HttpErrorResponse({ status: 404 }),
      new HttpErrorResponse({ status: 413, error: { message: 'TOO_LARGE' } }),
      new HttpErrorResponse({ status: 413 }), // page d'erreur d'un proxy sans JSON
      new HttpErrorResponse({ status: 415, error: { message: 'BAD_TYPE' } }),
      new HttpErrorResponse({ status: 400, error: { message: 'EMPTY' } }),
      ...[
        'student_number_unavailable', 'enrollment_verified_locked', 'enrollment_under_review', 'document_not_allowed', 'enrollment_required',
        'no_current_year', 'not_reviewable', 'in_use', 'already_exists',
      ].map((message) => new HttpErrorResponse({ status: 409, error: { message } })),
      new HttpErrorResponse({ status: 400, error: { message: 'invalid_academic_choice' } }),
      new HttpErrorResponse({ status: 400, error: { message: 'invalid_dates' } }),
      new HttpErrorResponse({ status: 403, error: { message: 'cannot_review_own_enrollment' } }),
    ];
    const keys = [...new Set([...cases.map(apiErrorKey), apiErrorKey(new Error('autre'))])];
    for (const lang of LANGS) {
      const known = flatKeys(json[lang]);
      expect(keys.filter((k) => !known.includes(k))).withContext(`clés d'erreur manquantes en ${lang}`).toEqual([]);
    }
  });

  it('les états, motifs de rejet et types de notification construits dynamiquement ont une traduction dans les deux langues', () => {
    const states = ['NO_YEAR', 'NOT_DECLARED', 'NEEDS_DOCUMENT', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED'];
    const dynamic = [
      ...states.flatMap((s) => [`student.status.${s}`, `student.status.help.${s}`]),
      ...REJECTION_CODES.map((c) => `verification.codes.${c}`),
      'notifications.types.ENROLLMENT_VERIFIED',
      'notifications.types.ENROLLMENT_REJECTED',
      'verification.review.done.approved',
      'verification.review.done.rejected',
    ];
    for (const lang of LANGS) {
      const known = flatKeys(json[lang]);
      expect(dynamic.filter((k) => !known.includes(k))).withContext(`clés dynamiques manquantes en ${lang}`).toEqual([]);
    }
  });

  describe('écrans avec données : aucune clé brute dans chaque état', () => {
    const base = { institutionId: 'i', currentYear: { id: 'y', label: '2026-2027' }, student: { id: 's', studentNumber: 'C1', firstName: 'A', lastName: 'B', fullNameAr: null }, canEdit: false, canUpload: false };
    const label = { id: 'x', name: 'N' };
    const enrol = (status: string, extra = {}) => ({ id: 'e', status, rejectionCode: null, rejectionReason: null, faculty: label, program: label, level: label, group: null, academicYear: { id: 'y', label: '2026-2027' }, ...extra });
    const doc = { id: 'd', status: 'UPLOADED', createdAt: '2026-10-10T10:00:00Z', mimeType: 'application/pdf', sizeBytes: 1 };
    const states: [string, Record<string, unknown>][] = [
      ['sans année', { ...base, currentYear: null, student: null, enrollment: null, document: null }],
      ['non déclarée', { ...base, student: null, enrollment: null, document: null, canEdit: true }],
      ['attestation à déposer', { ...base, enrollment: enrol('PENDING'), document: null, canEdit: true, canUpload: true }],
      ['en cours d’examen', { ...base, enrollment: enrol('PENDING'), document: doc }],
      ['vérifiée', { ...base, enrollment: enrol('VERIFIED'), document: { ...doc, status: 'APPROVED' } }],
      ...REJECTION_CODES.map((c): [string, Record<string, unknown>] => [`rejetée (${c})`, { ...base, enrollment: enrol('REJECTED', { rejectionCode: c, rejectionReason: 'Motif' }), document: { ...doc, status: 'REJECTED' }, canEdit: true }]),
    ];

    for (const lang of LANGS) {
      for (const [name, state] of states) {
        it(`tableau de bord étudiant, ${name}, en ${lang}`, async () => {
          configure(json, lang);
          const http = TestBed.inject(HttpTestingController);
          const fixture = TestBed.createComponent(StudentHome);
          fixture.detectChanges();
          http.expectOne('/api/v1/students/me').flush(state);
          await settle(fixture);
          if (state['canEdit']) {
            http.expectOne('/api/v1/institutions/i/academic').flush({ years: [], faculties: [label], programs: [], levels: [], groups: [] });
            await settle(fixture);
          }
          http.expectOne('/api/v1/notifications').flush({
            unread: 2,
            items: [
              { id: '1', type: 'ENROLLMENT_VERIFIED', body: '', readAt: null, createdAt: '2026-10-10T10:00:00Z' },
              { id: '2', type: 'ENROLLMENT_REJECTED', body: 'Motif', readAt: null, createdAt: '2026-10-10T10:00:00Z' },
            ],
          });
          await settle(fixture);
          expect(rawKeys(fixture.nativeElement)).toEqual([]);
        });
      }

      it(`examen d’une inscription (formulaire de rejet ouvert) en ${lang}`, async () => {
        configure(json, lang);
        TestBed.configureTestingModule({ providers: [{ provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'e' }) } } }] });
        const http = TestBed.inject(HttpTestingController);
        const fixture = TestBed.createComponent(ReviewPage);
        fixture.detectChanges();
        http.expectOne('/api/v1/enrollments/e/review').flush({
          id: 'e', status: 'PENDING', submittedAt: '2026-10-10T10:00:00Z', ownRequest: false,
          student: { studentNumber: 'C1', firstName: 'A', lastName: 'B', fullNameAr: 'ا ب' },
          faculty: label, program: label, level: label, group: { name: 'A' }, academicYear: { label: '2026-2027' }, document: { id: 'd', status: 'UPLOADED', mimeType: 'application/pdf', sizeBytes: 1 },
        });
        await settle(fixture);
        const el = fixture.nativeElement as HTMLElement;
        expect(rawKeys(el)).toEqual([]);
        Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === (json[lang] as Record<string, Record<string, Record<string, string>>>)['verification']['review']['reject'])!.click();
        fixture.detectChanges();
        expect(el.querySelector('#rejectCode')).toBeTruthy();
        expect(rawKeys(el)).toEqual([]);
      });
    }
  });

  describe('le détecteur lui-même (preuve que le test échouerait)', () => {
    it('repère les clés brutes quand une traduction manque (cas du bug : institution.* absent)', () => {
      const incomplete = { fr: { app: { title: 'x' } }, ar: { app: { title: 'x' } } } as Record<Lang, Translation>;
      configure(incomplete, 'fr');
      expect(rawKeys(render(AppFooter)).sort()).toEqual(['institution.faculty', 'institution.university']);
    });

    it('ne signale pas du texte normal (e-mail, URL, ponctuation)', () => {
      const el = document.createElement('div');
      el.innerHTML = '<p>Écrire à alice@example.test · Faculté des Sciences. Voir https://exemple.test/a.b</p>';
      expect(rawKeys(el)).toEqual([]);
    });
  });
});
