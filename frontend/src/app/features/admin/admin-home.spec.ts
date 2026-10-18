import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../core/auth/auth.service';
import { Role } from '../../core/auth/auth.models';
import { environment } from '../../../environments/environment';
import { translocoTesting } from '../../testing';
import { AdminHome } from './admin-home';

describe('AdminHome : état du système', () => {
  const url = `${environment.apiUrl}/health`;
  function setup(role: Role) {
    TestBed.configureTestingModule({ imports: [AdminHome, translocoTesting()], providers: [provideHttpClient(), provideHttpClientTesting()] });
    TestBed.inject(AuthService).user.set({ id: 'u', email: 'a@example.test', phone: null, twoFactorEnabled: true, roles: [{ role, institutionId: null, electionId: null }] });
    const fixture = TestBed.createComponent(AdminHome);
    fixture.detectChanges();
    return { fixture, http: TestBed.inject(HttpTestingController) };
  }

  it('SUPER_ADMIN : affiche API OK et base OK', () => {
    const { fixture, http } = setup('SUPER_ADMIN');
    expect(fixture.nativeElement.textContent).toContain('Vérification en cours');
    http.expectOne(url).flush({ api: 'ok', database: 'ok' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.text-bg-success').length).toBe(2);
    expect(fixture.nativeElement.querySelector('.text-bg-danger')).toBeNull();
  });

  it('SUPER_ADMIN : signale la base indisponible', () => {
    const { fixture, http } = setup('SUPER_ADMIN');
    http.expectOne(url).flush({ api: 'ok', database: 'down' }, { status: 503, statusText: 'x' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.text-bg-danger')?.textContent).toContain('Indisponible');
  });

  it('SUPER_ADMIN : signale un serveur injoignable', () => {
    const { fixture, http } = setup('SUPER_ADMIN');
    http.expectOne(url).error(new ProgressEvent('error'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Serveur injoignable');
  });

  it('comité : aucun encadré, aucun appel /health', () => {
    const { fixture, http } = setup('ELECTION_COMMITTEE');
    http.expectNone(url);
    expect(fixture.nativeElement.querySelector('.app-status')).toBeNull();
  });
});
