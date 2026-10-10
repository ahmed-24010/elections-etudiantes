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

  it('affiche API OK et base OK', () => {
    const { fixture, http } = setup();
    expect(fixture.nativeElement.textContent).toContain('Vérification en cours');
    http.expectOne(url).flush({ api: 'ok', database: 'ok' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.text-bg-success').length).toBe(2);
    expect(fixture.nativeElement.querySelector('.text-bg-danger')).toBeNull();
  });

  it('signale la base indisponible', () => {
    const { fixture, http } = setup();
    http.expectOne(url).flush({ api: 'ok', database: 'down' }, { status: 503, statusText: 'x' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.text-bg-danger')?.textContent).toContain('Indisponible');
  });

  it('signale un serveur injoignable', () => {
    const { fixture, http } = setup();
    http.expectOne(url).error(new ProgressEvent('error'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Serveur injoignable');
  });

  it('affiche les deux logos et les liens de connexion / inscription pour un visiteur', () => {
    const { fixture, http } = setup();
    http.expectOne(url).flush({ api: 'ok', database: 'ok' });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const logos = Array.from(el.querySelectorAll('img.app-hero-logo')).map((i) => i.getAttribute('src'));
    expect(logos).toEqual(['branding/logo-un.jpg', 'branding/logo-fsjp.jpg']);
    expect(Array.from(el.querySelectorAll('img')).every((i) => !!i.getAttribute('alt'))).toBeTrue();
    expect(el.querySelector('a[href="/login"]')).toBeTruthy();
    expect(el.querySelector('a[href="/register"]')).toBeTruthy();
  });
});
