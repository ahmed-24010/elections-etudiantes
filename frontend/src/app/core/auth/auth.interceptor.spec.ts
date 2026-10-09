import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { waitForRequest } from '../../testing';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';

function setup() {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()],
  });
  const auth = TestBed.inject(AuthService);
  auth.user.set({ id: 'u1', email: 'a@example.test', phone: null, twoFactorEnabled: false, roles: [] });
  return { auth, http: TestBed.inject(HttpClient), ctrl: TestBed.inject(HttpTestingController), router: TestBed.inject(Router) };
}

const unauthorized = (message = 'Unauthorized') => [{ message }, { status: 401, statusText: 'Unauthorized' }] as const;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('authInterceptor', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
  });

  it('ajoute le jeton d’accès (en mémoire) aux appels API, et seulement à eux', async () => {
    const { auth, http, ctrl } = setup();
    (auth as unknown as { token: { set(v: string): void } }).token.set('TOKEN');
    http.get('/api/v1/users/me').subscribe();
    expect(ctrl.expectOne('/api/v1/users/me').request.headers.get('Authorization')).toBe('Bearer TOKEN');
    http.get('/assets/i18n/fr.json').subscribe();
    expect(ctrl.expectOne('/assets/i18n/fr.json').request.headers.has('Authorization')).toBeFalse();
    http.get('https://autre-site.example/api/v1/x').subscribe();
    expect(ctrl.expectOne('https://autre-site.example/api/v1/x').request.headers.has('Authorization')).toBeFalse();
  });

  it('sur 401 : renouvelle le jeton UNE fois puis rejoue la requête avec le nouveau jeton', async () => {
    const { auth, http, ctrl } = setup();
    (auth as unknown as { token: { set(v: string): void } }).token.set('OLD');
    let result: unknown;
    http.get('/api/v1/users/me').subscribe((r) => (result = r));

    ctrl.expectOne('/api/v1/users/me').flush(...unauthorized());
    const refresh = await waitForRequest(ctrl, '/api/v1/auth/refresh');
    expect(refresh.request.headers.get('X-Requested-With')).toBe('XMLHttpRequest');
    refresh.flush({ status: 'authenticated', accessToken: 'NEW' });
    const retry = await waitForRequest(ctrl, '/api/v1/users/me');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer NEW');
    retry.flush({ ok: true });
    expect(result).toEqual({ ok: true });
  });

  it('plusieurs requêtes en 401 en même temps : un seul renouvellement', async () => {
    const { auth, http, ctrl } = setup();
    (auth as unknown as { token: { set(v: string): void } }).token.set('OLD');
    const done: string[] = [];
    for (const url of ['/api/v1/a', '/api/v1/b', '/api/v1/c']) http.get(url).subscribe(() => done.push(url));

    for (const url of ['/api/v1/a', '/api/v1/b', '/api/v1/c']) ctrl.expectOne(url).flush(...unauthorized());
    (await waitForRequest(ctrl, '/api/v1/auth/refresh')).flush({ status: 'authenticated', accessToken: 'NEW' });
    for (const url of ['/api/v1/a', '/api/v1/b', '/api/v1/c']) {
      const r = await waitForRequest(ctrl, url);
      expect(r.request.headers.get('Authorization')).toBe('Bearer NEW');
      r.flush({});
    }
    expect(done.length).toBe(3);
  });

  it('si le renouvellement est refusé : la session est terminée, retour à la connexion, pas de boucle', async () => {
    const { auth, http, ctrl, router } = setup();
    const navigate = spyOn(router, 'navigate').and.resolveTo(true);
    (auth as unknown as { token: { set(v: string): void } }).token.set('OLD');
    let error: unknown;
    http.get('/api/v1/users/me').subscribe({ error: (e) => (error = e) });

    ctrl.expectOne('/api/v1/users/me').flush(...unauthorized());
    (await waitForRequest(ctrl, '/api/v1/auth/refresh')).flush(...unauthorized());
    await tick();
    ctrl.expectNone('/api/v1/users/me');
    expect(error).toBeTruthy();
    expect(auth.isAuthenticated()).toBeFalse();
    expect(auth.accessToken()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/login']);
  });

  it('401 « step_up_required » : transmis tel quel, ce n’est pas une session expirée', async () => {
    const { auth, http, ctrl } = setup();
    (auth as unknown as { token: { set(v: string): void } }).token.set('TOKEN');
    let status = 0;
    http.post('/api/v1/institutions/i1/roles', {}).subscribe({ error: (e) => (status = e.status) });
    ctrl.expectOne('/api/v1/institutions/i1/roles').flush(...unauthorized('step_up_required'));
    await tick();
    ctrl.expectNone('/api/v1/auth/refresh');
    expect(status).toBe(401);
    expect(auth.isAuthenticated()).toBeTrue();
  });

  it('un 401 sur /auth/login (mauvais mot de passe) ne déclenche aucun renouvellement', async () => {
    const { http, ctrl } = setup();
    let status = 0;
    http.post('/api/v1/auth/login', {}).subscribe({ error: (e) => (status = e.status) });
    ctrl.expectOne('/api/v1/auth/login').flush(...unauthorized('invalid_credentials'));
    await tick();
    ctrl.expectNone('/api/v1/auth/refresh');
    expect(status).toBe(401);
  });

  it('un en-tête Authorization posé explicitement (jeton de configuration 2FA) n’est ni remplacé ni renouvelé', async () => {
    const { auth, http, ctrl } = setup();
    (auth as unknown as { token: { set(v: string): void } }).token.set('ACCESS');
    let status = 0;
    http.post('/api/v1/auth/2fa/setup', null, { headers: { Authorization: 'Bearer SETUP' } }).subscribe({ error: (e) => (status = e.status) });
    const req = ctrl.expectOne('/api/v1/auth/2fa/setup');
    expect(req.request.headers.get('Authorization')).toBe('Bearer SETUP');
    req.flush(...unauthorized());
    await tick();
    ctrl.expectNone('/api/v1/auth/refresh');
    expect(status).toBe(401);
  });

  it('une erreur autre que 401 (403, 500) est transmise sans renouvellement', async () => {
    const { http, ctrl } = setup();
    const statuses: number[] = [];
    http.get('/api/v1/x').subscribe({ error: (e) => statuses.push(e.status) });
    ctrl.expectOne('/api/v1/x').flush({}, { status: 403, statusText: 'Forbidden' });
    http.get('/api/v1/y').subscribe({ error: (e) => statuses.push(e.status) });
    ctrl.expectOne('/api/v1/y').flush({}, { status: 500, statusText: 'Server Error' });
    await tick();
    ctrl.expectNone('/api/v1/auth/refresh');
    expect(statuses).toEqual([403, 500]);
  });
});
