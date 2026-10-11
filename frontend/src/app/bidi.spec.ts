import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { TranslocoTestingModule, Translation } from '@jsverse/transloco';
import { AuthService } from './core/auth/auth.service';
import { LanguageService } from './core/services/language.service';
import { AcademicPage } from './features/admin/academic-page';
import { StudentHome } from './features/student/student-home';
import { QueuePage } from './features/verification/queue-page';
import { ReviewPage } from './features/verification/review-page';
import { settle } from './testing';

// En arabe (RTL), « 2026-2027 » mal isolé s'affiche « 2027-2026 ». Tout nombre ou code (année, date, numéro) doit donc être
// isolé : dans un <bdi>/un élément dir="ltr", ou entouré des isolats Unicode (options de liste, texte brut).
const NUMBERY = /\d{4}-\d{2,4}(-\d{2})?|[A-Z]\d{4,}/;

/** Morceaux de texte qui contiennent une année, une date ou un numéro sans être isolés. */
export function unisolated(root: HTMLElement): string[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const bad: string[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent ?? '';
    if (!NUMBERY.test(text)) continue;
    const el = n.parentElement!;
    if (el.closest('[dir=ltr]') || text.includes('⁦')) continue;
    bad.push(text.trim());
  }
  return bad;
}

const ar: Translation = { app: { title: 'x' } };
const label = { id: 'x', name: 'N' };

function setup() {
  TestBed.configureTestingModule({
    imports: [TranslocoTestingModule.forRoot({ langs: { ar, fr: ar }, translocoConfig: { availableLangs: ['ar', 'fr'], defaultLang: 'ar' }, preloadLangs: true })],
    providers: [
      provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'e' }) } } },
    ],
  });
  TestBed.inject(LanguageService).current.set('ar');
  TestBed.inject(AuthService).user.set({
    id: 'u', email: 'a@example.test', phone: null, twoFactorEnabled: true,
    roles: [{ role: 'INSTITUTION_ADMIN', institutionId: 'inst-1', electionId: null }, { role: 'VERIFICATION_OFFICER', institutionId: 'inst-1', electionId: null }],
  });
  return TestBed.inject(HttpTestingController);
}

describe('Arabe (RTL) : nombres et codes isolés', () => {
  it('le détecteur repère une année non isolée (preuve que le test échouerait)', () => {
    const el = document.createElement('div');
    el.innerHTML = '<p>السنة : 2026-2027</p><p>السنة : <bdi dir="ltr">2026-2027</bdi></p>';
    expect(unisolated(el)).toEqual(['السنة : 2026-2027']);
  });

  it('tableau de bord étudiant : l’année « 2026-2027 » est dans un <bdi dir="ltr">', async () => {
    const http = setup();
    const page = TestBed.createComponent(StudentHome);
    page.detectChanges();
    http.expectOne('/api/v1/students/me').flush({
      institutionId: 'inst-1', currentYear: { id: 'y', label: '2026-2027' },
      student: { id: 's', studentNumber: 'C12345', firstName: 'A', lastName: 'B', fullNameAr: null },
      enrollment: { id: 'e', status: 'VERIFIED', rejectionCode: null, rejectionReason: null, faculty: label, program: label, level: label, group: null, academicYear: { id: 'y', label: '2026-2027' } },
      document: null, canEdit: false, canUpload: false,
    });
    await settle(page);
    http.expectOne('/api/v1/notifications').flush({ unread: 1, items: [{ id: '1', type: 'ENROLLMENT_VERIFIED', body: '', readAt: null, createdAt: '2026-10-10T10:00:00Z' }] });
    await settle(page);
    const el = page.nativeElement as HTMLElement;
    const year = Array.from(el.querySelectorAll('bdi')).find((b) => b.textContent === '2026-2027')!;
    expect(year.getAttribute('dir')).toBe('ltr');
    expect(unisolated(el)).toEqual([]);
  });

  it('file du vérificateur et examen : années, dates et numéros isolés', async () => {
    const item = {
      id: 'e', status: 'PENDING', submittedAt: '2026-10-10T10:00:00Z', ownRequest: false,
      student: { studentNumber: 'C12345', firstName: 'A', lastName: 'B', fullNameAr: null },
      faculty: label, program: label, level: label, group: { name: 'A' }, academicYear: { label: '2026-2027' },
      document: { id: 'd', status: 'UPLOADED', mimeType: 'application/pdf', sizeBytes: 1 },
    };
    const http = setup();
    const queue = TestBed.createComponent(QueuePage);
    queue.detectChanges();
    http.expectOne('/api/v1/institutions/inst-1/verification/queue').flush([item]);
    await settle(queue);
    expect(unisolated(queue.nativeElement)).toEqual([]);

    const review = TestBed.createComponent(ReviewPage);
    review.detectChanges();
    http.expectOne('/api/v1/enrollments/e/review').flush(item);
    await settle(review);
    expect(unisolated(review.nativeElement)).toEqual([]);
  });

  it('structure académique : années, dates, codes isolés ; la flèche suit le sens de lecture ; dates saisies en AAAA-MM-JJ', async () => {
    const http = setup();
    const page = TestBed.createComponent(AcademicPage);
    page.detectChanges();
    http.expectOne('/api/v1/institutions/inst-1/academic').flush({
      years: [{ id: 'y', label: '2026-2027', startsOn: '2026-09-01T00:00:00Z', endsOn: '2027-07-15T00:00:00Z', isCurrent: true }],
      faculties: [{ id: 'f', code: 'FSJP', name: 'FSJP' }], programs: [], levels: [{ id: 'l', code: 'L1', name: 'L1', rank: 1 }],
      groups: [{ id: 'g', name: 'A', programId: 'p', levelId: 'l', academicYearId: 'y' }],
    });
    await settle(page);
    const el = page.nativeElement as HTMLElement;
    expect(unisolated(el)).toEqual([]);
    expect(el.textContent).toContain('←'); // arabe : la flèche pointe vers la gauche
    expect(el.textContent).not.toContain('→');
    // plus de champ date du navigateur (son format suivrait la langue du navigateur : « jj/mm/aaaa »)
    expect(el.querySelector('input[type=date]')).toBeNull();
    expect(el.querySelector('#yStart')?.getAttribute('dir')).toBe('ltr');

    TestBed.inject(LanguageService).current.set('fr');
    page.detectChanges();
    expect(el.textContent).toContain('→');
  });
});
