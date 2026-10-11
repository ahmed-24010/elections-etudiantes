import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { translocoTesting } from '../testing';
import { AdminLayout } from './admin/admin-layout';
import { PublicLayout } from './public/public-layout';
import { StudentLayout } from './student/student-layout';

describe('Layouts vides', () => {
  for (const [name, cmp] of [['public', PublicLayout], ['étudiant', StudentLayout], ['admin', AdminLayout]] as const) {
    it(`le layout ${name} affiche le titre et le sélecteur de langue`, () => {
      TestBed.configureTestingModule({ imports: [cmp, translocoTesting()], providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
      const fixture = TestBed.createComponent(cmp);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.navbar-brand')?.textContent).toContain('Élections étudiantes');
      expect(el.querySelectorAll('app-language-switcher button').length).toBe(1); // 🌐 : les langues sont dans un menu fermé
    });
  }
});

describe('Menu utilisateur dans les layouts', () => {
  const create = () => {
    TestBed.configureTestingModule({
      imports: [PublicLayout, translocoTesting()],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    return TestBed.createComponent(PublicLayout);
  };

  it('la barre du haut ne contient que le logo de l’Université', () => {
    const fixture = create();
    fixture.detectChanges();
    const logos = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('nav img')).map((i) => i.getAttribute('src'));
    expect(logos).toEqual(['branding/logo-un.jpg']);
  });

  it('visiteur : liens connexion et inscription, pas de déconnexion', () => {
    const fixture = create();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('a[href="/login"]')).toBeTruthy();
    expect(el.querySelector('a[href="/register"]')).toBeTruthy();
    expect(el.textContent).not.toContain('Déconnexion');
  });

  it('connecté : e-mail et bouton de déconnexion', async () => {
    const { AuthService } = await import('../core/auth/auth.service');
    const fixture = create();
    TestBed.inject(AuthService).user.set({ id: 'u', email: 'alice@example.test', phone: null, twoFactorEnabled: false, roles: [{ role: 'STUDENT', institutionId: 'i', electionId: null }] });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-user-menu button')).toBeTruthy(); // 👤 ; e-mail et déconnexion sont dans le menu
    expect(el.querySelector('a[href="/login"]')).toBeNull();
  });
});

