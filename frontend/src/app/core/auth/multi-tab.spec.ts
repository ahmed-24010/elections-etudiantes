import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injector } from '@angular/core';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ME = { id: 'u1', email: 'alice@example.test', phone: null, twoFactorEnabled: false, roles: [{ role: 'STUDENT', institutionId: 'i1', electionId: null }] };

/** Serveur simulé : refresh token à usage unique, un rejeu révoque la session de TOUS les onglets. */
class FakeBackend {
  cookie = 'c0';
  revoked = false;
  refreshCalls = 0;
  private n = 0;
  private readonly used = new Set<string>();

  refresh(sent: string): string {
    this.refreshCalls++;
    if (this.revoked || sent !== this.cookie || this.used.has(sent)) {
      this.revoked = true;
      throw new HttpErrorResponse({ status: 401, error: { message: 'Unauthorized' } });
    }
    this.used.add(sent);
    this.cookie = `c${++this.n}`;
    return `access-${this.cookie}`;
  }
}

/** Un « onglet » : son propre AuthService et son propre HttpClient, face au même serveur et au même cookie. */
function makeTab(backend: FakeBackend) {
  const navigate = jasmine.createSpy('navigate').and.resolveTo(true);
  const http = {
    post: (url: string) =>
      new Observable((sub) => {
        const sent = backend.cookie; // le navigateur joint le cookie au départ de la requête
        setTimeout(() => {
          try {
            if (url.endsWith('/auth/refresh')) sub.next({ status: 'authenticated', accessToken: backend.refresh(sent) });
            else if (url.endsWith('/auth/login')) sub.next({ status: 'authenticated', accessToken: 'login-token' });
            else sub.next(null);
            sub.complete();
          } catch (e) {
            sub.error(e);
          }
        }, 25);
      }),
    get: () => new Observable((sub) => { sub.next(ME); sub.complete(); }),
  };
  const injector = Injector.create({
    providers: [
      { provide: HttpClient, useValue: http },
      { provide: Router, useValue: { navigate } },
      AuthService,
    ],
  });
  return { auth: injector.get(AuthService), navigate };
}

describe('Deux onglets ouverts sur la même session', () => {
  const tabs: ReturnType<typeof makeTab>[] = [];
  const open = (backend: FakeBackend) => {
    const t = makeTab(backend);
    tabs.push(t);
    return t;
  };
  afterEach(() => {
    tabs.splice(0).forEach((t) => t.auth.ngOnDestroy());
  });

  it('F5 simultané dans deux onglets : les deux retrouvent la session, personne n’est déconnecté', async () => {
    const backend = new FakeBackend();
    const a = open(backend);
    const b = open(backend);
    await Promise.all([a.auth.restore(), b.auth.restore()]);
    expect(backend.revoked).toBeFalse();
    expect(a.auth.isAuthenticated()).toBeTrue();
    expect(b.auth.isAuthenticated()).toBeTrue();
  });

  it('jetons d’accès expirés dans les deux onglets au même instant : renouvellement sans rejeu', async () => {
    const backend = new FakeBackend();
    const a = open(backend);
    const b = open(backend);
    await Promise.all([a.auth.restore(), b.auth.restore()]);

    // Les deux onglets découvrent au même moment que leur jeton a expiré (401) et se renouvellent ensemble.
    const [ta, tb] = await Promise.all([a.auth.refreshAccessToken(), b.auth.refreshAccessToken()]);
    expect(backend.revoked).toBeFalse();
    expect(ta).toBeTruthy();
    expect(tb).toBeTruthy();
    expect(a.auth.isAuthenticated()).toBeTrue();
    expect(b.auth.isAuthenticated()).toBeTrue();
  });

  it('rafale de renouvellements croisés pendant une longue session : jamais de déconnexion', async () => {
    const backend = new FakeBackend();
    const a = open(backend);
    const b = open(backend);
    const c = open(backend);
    await Promise.all([a.auth.restore(), b.auth.restore(), c.auth.restore()]);
    for (let i = 0; i < 5; i++) {
      await Promise.all([a.auth.refreshAccessToken(), b.auth.refreshAccessToken(), c.auth.refreshAccessToken()]);
    }
    expect(backend.revoked).toBeFalse();
    expect([a, b, c].every((t) => t.auth.accessToken())).toBeTrue();
  });

  it('un onglet qui renouvelle partage son jeton : l’autre l’adopte sans appeler le serveur', async () => {
    const backend = new FakeBackend();
    const a = open(backend);
    const b = open(backend);
    await a.auth.restore();
    await sleep(60); // le message BroadcastChannel arrive dans b
    expect(b.auth.accessToken()).toBe(a.auth.accessToken());
    expect(b.auth.isAuthenticated()).toBeTrue(); // b a chargé le profil sans refresh
    expect(backend.refreshCalls).toBe(1);
  });

  it('connexion dans un onglet : l’autre onglet (visiteur) devient connecté', async () => {
    const backend = new FakeBackend();
    const a = open(backend);
    const b = open(backend);
    await a.auth.login('alice@example.test', 'mot-de-passe-long');
    await sleep(60);
    expect(b.auth.isAuthenticated()).toBeTrue();
    expect(b.auth.accessToken()).toBe('login-token');
  });

  it('déconnexion dans un onglet : l’autre onglet est déconnecté et renvoyé à la connexion', async () => {
    const backend = new FakeBackend();
    const a = open(backend);
    const b = open(backend);
    await Promise.all([a.auth.restore(), b.auth.restore()]);
    await sleep(60);
    await a.auth.logout();
    await sleep(60);
    expect(a.auth.isAuthenticated()).toBeFalse();
    expect(b.auth.isAuthenticated()).toBeFalse();
    expect(b.auth.accessToken()).toBeNull();
    expect(b.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('session réellement expirée : tous les onglets retournent à la connexion', async () => {
    const backend = new FakeBackend();
    const a = open(backend);
    const b = open(backend);
    await Promise.all([a.auth.restore(), b.auth.restore()]);
    await sleep(60);
    backend.revoked = true; // session fermée côté serveur
    await expectAsync(a.auth.refreshAccessToken()).toBeRejected();
    a.auth.sessionExpired();
    await sleep(60);
    expect(b.auth.isAuthenticated()).toBeFalse();
    expect(b.navigate).toHaveBeenCalledWith(['/login']);
  });
});
