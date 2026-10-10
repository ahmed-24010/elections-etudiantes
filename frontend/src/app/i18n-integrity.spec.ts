import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Translation, TranslocoTestingModule } from '@jsverse/transloco';
import { apiErrorKey } from './core/auth/api-error';
import { AuthService } from './core/auth/auth.service';
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
  return [root.textContent ?? '', ...attrs]
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
        const student = render(StudentLayout).textContent ?? '';
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
    ];
    const keys = [...new Set([...cases.map(apiErrorKey), apiErrorKey(new Error('autre'))])];
    for (const lang of LANGS) {
      const known = flatKeys(json[lang]);
      expect(keys.filter((k) => !known.includes(k))).withContext(`clés d'erreur manquantes en ${lang}`).toEqual([]);
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
