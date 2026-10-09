import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { authInterceptor } from './auth.interceptor';
import { waitForRequest } from '../../testing';
import { CSRF_HEADER, CSRF_VALUE, AuthService } from './auth.service';

const ME = { id: 'u1', email: 'alice@example.test', phone: null, twoFactorEnabled: false, roles: [{ role: 'STUDENT', institutionId: 'i1', electionId: null }] };
const ADMIN = { ...ME, id: 'u2', twoFactorEnabled: true, roles: [{ role: 'INSTITUTION_ADMIN', institutionId: 'i1', electionId: null }] };

function setup() {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()],
  });
  return { auth: TestBed.inject(AuthService), http: TestBed.inject(HttpTestingController), router: TestBed.inject(Router) };
}

describe('AuthService', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
  });

  describe('jeton d’accès : en mémoire uniquement', () => {
    it('après connexion, le jeton n’est écrit ni dans localStorage ni dans sessionStorage ni dans un cookie JS', async () => {
      const { auth, http } = setup();
      const secretToken = 'jwt.secret.TOKEN-A-NE-JAMAIS-STOCKER';
      const login = auth.login('alice@example.test', 'mot-de-passe-long');
      http.expectOne('/api/v1/auth/login').flush({ status: 'authenticated', accessToken: secretToken });
      await Promise.resolve();
      http.expectOne('/api/v1/users/me').flush(ME);
      expect(await login).toBe('authenticated');

      expect(auth.accessToken()).toBe(secretToken);
      expect(auth.isAuthenticated()).toBeTrue();
      for (const store of [localStorage, sessionStorage]) {
        for (let i = 0; i < store.length; i++) {
          const key = store.key(i)!;
          expect(key).not.toContain('token');
          expect(store.getItem(key)).not.toContain(secretToken);
        }
      }
      expect(document.cookie).not.toContain(secretToken);
    });

    it('n’appelle jamais Storage.setItem avec le jeton', async () => {
      const { auth, http } = setup();
      const spy = spyOn(Storage.prototype, 'setItem').and.callThrough();
      const p = auth.login('a@example.test', 'mot-de-passe-long');
      http.expectOne('/api/v1/auth/login').flush({ status: 'authenticated', accessToken: 'TOKEN-123' });
      await Promise.resolve();
      http.expectOne('/api/v1/users/me').flush(ME);
      await p;
      expect(spy.calls.allArgs().flat().join('|')).not.toContain('TOKEN-123');
    });
  });

  describe('F5 : la session revient via /auth/refresh', () => {
    it('restore() appelle /auth/refresh avec l’en-tête anti-CSRF puis charge le profil avec le nouveau jeton', async () => {
      const { auth, http } = setup();
      const restoring = auth.restore();
      const refresh = await waitForRequest(http, '/api/v1/auth/refresh');
      expect(refresh.request.method).toBe('POST');
      expect(refresh.request.headers.get(CSRF_HEADER)).toBe(CSRF_VALUE);
      expect(refresh.request.headers.has('Authorization')).toBeFalse();
      refresh.flush({ status: 'authenticated', accessToken: 'fresh-token' });
      const me = await waitForRequest(http, '/api/v1/users/me');
      expect(me.request.headers.get('Authorization')).toBe('Bearer fresh-token');
      me.flush(ME);
      await restoring;
      expect(auth.isAuthenticated()).toBeTrue();
      expect(auth.user()?.email).toBe('alice@example.test');
    });

    it('sans session (cookie absent ou expiré) : visiteur, sans exception ni redirection', async () => {
      const { auth, http, router } = setup();
      const navigate = spyOn(router, 'navigate');
      const restoring = auth.restore();
      (await waitForRequest(http, '/api/v1/auth/refresh')).flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });
      await restoring;
      expect(auth.isAuthenticated()).toBeFalse();
      expect(auth.accessToken()).toBeNull();
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  describe('connexion en deux temps', () => {
    it('mot de passe valide + 2FA active : demande le code, sans jeton ni session', async () => {
      const { auth, http } = setup();
      const p = auth.login('a@example.test', 'x');
      http.expectOne('/api/v1/auth/login').flush({ status: 'two_factor_required' });
      expect(await p).toBe('two_factor_required');
      expect(auth.accessToken()).toBeNull();
      expect(auth.isAuthenticated()).toBeFalse();
    });

    it('le code TOTP est envoyé avec le mot de passe au second appel', async () => {
      const { auth, http } = setup();
      const p = auth.login('a@example.test', 'x', '123456');
      const req = http.expectOne('/api/v1/auth/login');
      expect(req.request.body).toEqual({ identifier: 'a@example.test', password: 'x', totp: '123456' });
      req.flush({ status: 'two_factor_required' });
      await p;
    });

    it('admin sans 2FA (D-15) : seul un jeton de configuration est reçu, aucun accès', async () => {
      const { auth, http } = setup();
      const p = auth.login('admin@example.test', 'x');
      http.expectOne('/api/v1/auth/login').flush({ status: 'two_factor_setup_required', setupToken: 'SETUP' });
      expect(await p).toBe('two_factor_setup_required');
      expect(auth.needsTwoFactorSetup()).toBeTrue();
      expect(auth.accessToken()).toBeNull();
      expect(auth.isAuthenticated()).toBeFalse();
    });

    it('configuration 2FA : le jeton de configuration est posé explicitement ; l’activation ouvre la session', async () => {
      const { auth, http } = setup();
      const p = auth.login('admin@example.test', 'x');
      http.expectOne('/api/v1/auth/login').flush({ status: 'two_factor_setup_required', setupToken: 'SETUP' });
      await p;

      const setup$ = auth.startTwoFactorSetup();
      const s = http.expectOne('/api/v1/auth/2fa/setup');
      expect(s.request.headers.get('Authorization')).toBe('Bearer SETUP');
      s.flush({ secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP' });
      expect((await setup$).secret).toBe('JBSWY3DPEHPK3PXP');

      const enable = auth.enableTwoFactor('123456');
      const e = http.expectOne('/api/v1/auth/2fa/enable');
      expect(e.request.headers.get('Authorization')).toBe('Bearer SETUP');
      e.flush({ status: 'authenticated', accessToken: 'REAL-ACCESS' });
      await Promise.resolve();
      http.expectOne('/api/v1/users/me').flush(ADMIN);
      await enable;
      expect(auth.accessToken()).toBe('REAL-ACCESS');
      expect(auth.needsTwoFactorSetup()).toBeFalse();
      expect(auth.isAdmin()).toBeTrue();
    });
  });

  describe('déconnexion', () => {
    it('appelle /auth/logout avec l’en-tête anti-CSRF, efface l’état et retourne à la connexion', async () => {
      const { auth, http, router } = setup();
      const navigate = spyOn(router, 'navigate').and.resolveTo(true);
      auth.user.set(ME as never);
      const p = auth.logout();
      const req = http.expectOne('/api/v1/auth/logout');
      expect(req.request.headers.get(CSRF_HEADER)).toBe(CSRF_VALUE);
      req.flush(null, { status: 204, statusText: 'No Content' });
      await p;
      expect(auth.isAuthenticated()).toBeFalse();
      expect(auth.accessToken()).toBeNull();
      expect(navigate).toHaveBeenCalledWith(['/login']);
    });

    it('ferme quand même la session locale si le serveur est injoignable', async () => {
      const { auth, http, router } = setup();
      spyOn(router, 'navigate').and.resolveTo(true);
      auth.user.set(ME as never);
      const p = auth.logout();
      http.expectOne('/api/v1/auth/logout').error(new ProgressEvent('error'));
      await p;
      expect(auth.isAuthenticated()).toBeFalse();
    });
  });

  it('inscription : envoie le code d’institution et ne stocke rien', async () => {
    const { auth, http } = setup();
    const p = auth.register({ email: 'a@example.test', password: 'mot-de-passe-long', institutionCode: 'DEMO' });
    const req = http.expectOne('/api/v1/auth/register');
    expect(req.request.body).toEqual({ email: 'a@example.test', password: 'mot-de-passe-long', institutionCode: 'DEMO' });
    req.flush({ status: 'accepted' }, { status: 202, statusText: 'Accepted' });
    await p;
    expect(auth.isAuthenticated()).toBeFalse();
  });

  it('homeUrl : /admin pour un rôle administratif, /student sinon', () => {
    const { auth } = setup();
    auth.user.set(ME as never);
    expect(auth.homeUrl()).toBe('/student');
    auth.user.set(ADMIN as never);
    expect(auth.homeUrl()).toBe('/admin');
  });
});
