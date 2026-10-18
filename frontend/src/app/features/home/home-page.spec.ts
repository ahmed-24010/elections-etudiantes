import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../../environments/environment';
import { translocoTesting } from '../../testing';
import { HomePage } from './home-page';

describe('HomePage', () => {
  function setup() {
    TestBed.configureTestingModule({
      imports: [HomePage, translocoTesting()],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(HomePage);
    fixture.detectChanges();
    return { fixture, http: TestBed.inject(HttpTestingController) };
  }
  const url = `${environment.apiUrl}/health`;

  it("n'affiche pas l'état du système et n'appelle pas /health (réservé au SUPER_ADMIN)", () => {
    const { fixture, http } = setup();
    http.expectNone(url);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.app-status')).toBeNull();
    expect(el.textContent).not.toContain('Vérification en cours');
    expect(el.querySelector('.badge')).toBeNull();
  });

  it('affiche les deux logos et les liens de connexion / inscription pour un visiteur', () => {
    const { fixture } = setup();
    const el = fixture.nativeElement as HTMLElement;
    const logos = Array.from(el.querySelectorAll('img.app-hero-logo')).map((i) => i.getAttribute('src'));
    expect(logos).toEqual(['branding/logo-un.jpg', 'branding/logo-fsjp.jpg']);
    expect(Array.from(el.querySelectorAll('img')).every((i) => !!i.getAttribute('alt'))).toBeTrue();
    expect(el.querySelector('a[href="/login"]')).toBeTruthy();
    expect(el.querySelector('a[href="/register"]')).toBeTruthy();
  });
});
