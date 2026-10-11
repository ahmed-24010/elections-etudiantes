import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ADMIN_ROLES, CurrentUser, InstitutionOption, LoginOutcome, Role, TwoFactorSetup } from './auth.models';
import { RefreshCoordinator, TabMessage, TabSync } from './refresh-coordinator';

/** En-tête exigé par le backend sur /auth/refresh et /auth/logout (défense CSRF supplémentaire). */
export const CSRF_HEADER = 'X-Requested-With';
export const CSRF_VALUE = 'XMLHttpRequest';

interface SessionBody {
  status: 'authenticated';
  accessToken: string;
}
type LoginBody = SessionBody | { status: 'two_factor_required' } | { status: 'two_factor_setup_required'; setupToken: string };

/**
 * État d'authentification. Le jeton d'accès vit UNIQUEMENT en mémoire (jamais localStorage/sessionStorage) :
 * après un rechargement, la session revient grâce au cookie HttpOnly de refresh (restore()).
 */
@Injectable({ providedIn: 'root' })
export class AuthService implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly api = environment.apiUrl;

  private readonly token = signal<string | null>(null);
  readonly user = signal<CurrentUser | null>(null);
  readonly isAuthenticated = computed(() => this.user() !== null);
  readonly isAdmin = computed(() => this.user()?.roles.some((r) => ADMIN_ROLES.includes(r.role)) ?? false);
  readonly isStudent = computed(() => this.user()?.roles.some((r) => r.role === 'STUDENT') ?? false);

  /** Jeton de configuration 2FA (D-15), en mémoire, le temps de configurer la 2FA. */
  private setupToken: string | null = null;
  readonly needsTwoFactorSetup = signal(false);

  private readonly tabs = new TabSync('elections-auth', (m) => this.onTabMessage(m));
  private readonly coordinator = new RefreshCoordinator(() => this.callRefresh(), () => this.token(), { lockName: 'elections-auth-refresh' });

  ngOnDestroy(): void {
    this.tabs.close();
  }

  accessToken(): string | null {
    return this.token();
  }

  // ------------------------------------------------------------------ session

  /** Au démarrage (et après F5) : retrouve la session via le cookie de refresh, sans bruit si elle n'existe pas. */
  async restore(): Promise<void> {
    try {
      await this.refreshAccessToken();
      await this.loadUser();
    } catch {
      this.clear();
    }
  }

  /** Renouvelle le jeton d'accès, coordonné entre les onglets (voir RefreshCoordinator). */
  refreshAccessToken(): Promise<string> {
    return this.coordinator.refresh();
  }

  private async callRefresh(): Promise<string> {
    const body = await firstValueFrom(
      this.http.post<SessionBody>(`${this.api}/auth/refresh`, null, { headers: new HttpHeaders({ [CSRF_HEADER]: CSRF_VALUE }) }),
    );
    this.token.set(body.accessToken);
    this.tabs.post({ type: 'token', token: body.accessToken });
    return body.accessToken;
  }

  private async loadUser(): Promise<void> {
    this.user.set(await firstValueFrom(this.http.get<CurrentUser>(`${this.api}/users/me`)));
  }

  private onTabMessage(m: TabMessage): void {
    if (m.type === 'logout') {
      this.clear();
      void this.router.navigate(['/login']);
      return;
    }
    // Un autre onglet a renouvelé ou ouvert la session : on adopte son jeton sans appeler le serveur.
    this.token.set(m.token);
    this.coordinator.noteForeignToken();
    if (!this.user()) void this.loadUser().catch(() => this.clear());
  }

  /** Efface l'état local (sans prévenir les autres onglets). */
  clear(): void {
    this.token.set(null);
    this.user.set(null);
    this.setupToken = null;
    this.needsTwoFactorSetup.set(false);
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post<void>(`${this.api}/auth/logout`, null, { headers: new HttpHeaders({ [CSRF_HEADER]: CSRF_VALUE }) }));
    } catch {
      /* la session locale est quand même fermée */
    }
    this.tabs.post({ type: 'logout' });
    this.clear();
    await this.router.navigate(['/login']);
  }

  /** La session est morte (refresh refusé) : on prévient les autres onglets et on retourne à la connexion. */
  sessionExpired(): void {
    this.tabs.post({ type: 'logout' });
    this.clear();
    void this.router.navigate(['/login']);
  }

  // ------------------------------------------------------------------ connexion / inscription

  institutions(): Promise<InstitutionOption[]> {
    return firstValueFrom(this.http.get<InstitutionOption[]>(`${this.api}/institutions/public`));
  }

  async register(input: { email?: string; phone?: string; password: string; institutionCode: string }): Promise<void> {
    await firstValueFrom(this.http.post(`${this.api}/auth/register`, input));
  }

  async login(identifier: string, password: string, totp?: string): Promise<LoginOutcome> {
    const body = await firstValueFrom(this.http.post<LoginBody>(`${this.api}/auth/login`, { identifier, password, ...(totp ? { totp } : {}) }));
    if (body.status === 'authenticated') {
      await this.adopt(body.accessToken);
    } else if (body.status === 'two_factor_setup_required') {
      this.setupToken = body.setupToken;
      this.needsTwoFactorSetup.set(true);
    }
    return body.status;
  }

  private async adopt(accessToken: string): Promise<void> {
    this.setupToken = null;
    this.needsTwoFactorSetup.set(false);
    this.token.set(accessToken);
    this.tabs.post({ type: 'token', token: accessToken });
    await this.loadUser();
  }

  // ------------------------------------------------------------------ 2FA

  private bearer(): { headers?: HttpHeaders } {
    // Avec un jeton de configuration, l'en-tête est posé explicitement : l'intercepteur n'y touche pas.
    return this.setupToken ? { headers: new HttpHeaders({ Authorization: `Bearer ${this.setupToken}` }) } : {};
  }

  startTwoFactorSetup(): Promise<TwoFactorSetup> {
    return firstValueFrom(this.http.post<TwoFactorSetup>(`${this.api}/auth/2fa/setup`, null, this.bearer()));
  }

  /** Active la 2FA. Avec un jeton de configuration (D-15), ouvre la session ; sinon marque la session « 2FA vérifiée ». */
  async enableTwoFactor(code: string): Promise<void> {
    const wasSetupFlow = this.setupToken !== null;
    const body = await firstValueFrom(this.http.post<SessionBody | { status: 'enabled' }>(`${this.api}/auth/2fa/enable`, { code }, this.bearer()));
    if (wasSetupFlow && body.status === 'authenticated') await this.adopt(body.accessToken);
    else await this.loadUser();
  }

  /** Step-up : prouve la 2FA pour les actions sensibles (valable 10 minutes côté serveur). */
  async stepUp(code: string): Promise<void> {
    await firstValueFrom(this.http.post<void>(`${this.api}/auth/step-up`, { code }));
  }

  /** Rôle détenu par l'utilisateur (affichage seulement : le serveur relit les rôles en base). */
  hasRole(role: Role): boolean {
    return this.user()?.roles.some((r) => r.role === role) ?? false;
  }

  /** Institution rattachée à un rôle, pour construire les URL `/institutions/:id/...` (le serveur revérifie la portée). */
  institutionIdFor(role: Role): string | null {
    return this.user()?.roles.find((r) => r.role === role && r.institutionId)?.institutionId ?? null;
  }

  /** Page d'accueil selon les rôles. */
  homeUrl(): string {
    return this.isAdmin() ? '/admin' : '/student';
  }
}
