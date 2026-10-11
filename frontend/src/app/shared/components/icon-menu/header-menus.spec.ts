import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { LanguageService } from '../../../core/services/language.service';
import { translocoTesting } from '../../../testing';
import { AppHeader } from '../app-header/app-header';

function create(loggedIn: boolean) {
  TestBed.configureTestingModule({ imports: [AppHeader, translocoTesting()], providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  const auth = TestBed.inject(AuthService);
  if (loggedIn) auth.user.set({ id: 'u', email: 'alice@example.test', phone: null, twoFactorEnabled: false, roles: [{ role: 'STUDENT', institutionId: 'i', electionId: null }] });
  const fixture = TestBed.createComponent(AppHeader);
  document.body.appendChild(fixture.nativeElement); // le focus et les clics extérieurs ont besoin d'un vrai document
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const toggle = (host: string) => el.querySelector<HTMLButtonElement>(`${host} .app-icon-btn`)!;
  const panel = (host: string) => el.querySelector<HTMLElement>(`${host} .app-menu-panel`);
  return { fixture, el, auth, toggle, panel };
}

describe('Barre du haut : icônes 🌐 et 👤', () => {
  afterEach(() => document.querySelectorAll('app-header').forEach((e) => e.remove()));

  it('🌐 : bouton accessible, menu fermé ; il liste العربية et Français, la langue actuelle est marquée', () => {
    const { fixture, toggle, panel } = create(false);
    const globe = toggle('app-language-switcher');
    expect(globe.tagName).toBe('BUTTON');
    expect(globe.getAttribute('aria-label')).toBeTruthy();
    expect(globe.getAttribute('aria-expanded')).toBe('false');
    expect(globe.querySelector('svg')).toBeTruthy(); // icône SVG
    expect(panel('app-language-switcher')).toBeNull();
    TestBed.inject(LanguageService).current.set('fr');
    globe.click();
    fixture.detectChanges();
    const items = Array.from(panel('app-language-switcher')!.querySelectorAll('button'));
    expect(items.map((b) => b.textContent!.replace('✓', '').trim())).toEqual(['العربية', 'Français']);
    expect(items.map((b) => b.getAttribute('aria-current'))).toEqual([null, 'true']);
    expect(items[1].textContent).toContain('✓');
    expect(globe.getAttribute('aria-expanded')).toBe('true');
  });

  it('choisir une langue appelle le service et referme le menu', () => {
    const { fixture, toggle, panel } = create(false);
    const use = spyOn(TestBed.inject(LanguageService), 'use').and.resolveTo();
    toggle('app-language-switcher').click();
    fixture.detectChanges();
    panel('app-language-switcher')!.querySelector<HTMLButtonElement>('button[lang=fr]')!.click();
    fixture.detectChanges();
    expect(use).toHaveBeenCalledWith('fr');
    expect(panel('app-language-switcher')).toBeNull();
  });

  it('visiteur : 🌐 + boutons Connexion et Inscription, pas de 👤', () => {
    const { el, toggle } = create(false);
    expect(toggle('app-language-switcher')).toBeTruthy();
    expect(el.querySelector('app-user-menu .app-icon-btn')).toBeNull();
    expect(el.querySelector('app-user-menu a[href="/login"]')).toBeTruthy();
    expect(el.querySelector('app-user-menu a[href="/register"]')).toBeTruthy();
  });

  it('connecté : 👤 ouvre un menu avec l’e-mail et « Déconnexion » ; plus de bouton texte dans la barre', () => {
    const { fixture, el, auth, toggle, panel } = create(true);
    expect(el.querySelector('app-user-menu > .btn, app-user-menu > div > .btn')).toBeNull();
    expect(panel('app-user-menu')).toBeNull();
    toggle('app-user-menu').click();
    fixture.detectChanges();
    const open = panel('app-user-menu')!;
    expect(open.textContent).toContain('alice@example.test');
    const logout = spyOn(auth, 'logout').and.resolveTo();
    Array.from(open.querySelectorAll('button')).find((b) => /Déconnexion/.test(b.textContent!))!.click();
    expect(logout).toHaveBeenCalled();
  });

  it('un clic à l’extérieur ferme le menu ; un clic dans le menu (hors choix) le laisse ouvert', () => {
    const { fixture, toggle, panel } = create(true);
    toggle('app-user-menu').click();
    fixture.detectChanges();
    panel('app-user-menu')!.click();
    fixture.detectChanges();
    expect(panel('app-user-menu')).not.toBeNull();
    document.body.click();
    fixture.detectChanges();
    expect(panel('app-user-menu')).toBeNull();
  });

  it('Échap ferme le menu et rend le focus au bouton', () => {
    const { fixture, toggle, panel } = create(true);
    const button = toggle('app-user-menu');
    button.click();
    fixture.detectChanges();
    panel('app-user-menu')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(panel('app-user-menu')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('ouvrir un menu referme l’autre (clic extérieur)', () => {
    const { fixture, toggle, panel } = create(true);
    toggle('app-language-switcher').click();
    fixture.detectChanges();
    toggle('app-user-menu').click();
    fixture.detectChanges();
    expect(panel('app-language-switcher')).toBeNull();
    expect(panel('app-user-menu')).not.toBeNull();
  });
});
