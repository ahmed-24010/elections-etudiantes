import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';

export type Role = 'SUPER_ADMIN' | 'INSTITUTION_ADMIN' | 'ELECTION_COMMISSIONER' | 'STUDENT';

export interface Tokens { accessToken: string; refreshToken: string }
export interface SetupRequired { twoFactorSetupRequired: true; setupToken: string }
export type LoginResult = Tokens | SetupRequired;

/**
 * Jetons gardés en mémoire uniquement (jamais localStorage) pour limiter l'impact d'une XSS.
 * Conséquence : un rechargement de page déconnecte. Un refresh token en cookie HttpOnly
 * est prévu (voir docs/security.md).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly tokens = signal<Tokens | null>(null);

  readonly accessToken = computed(() => this.tokens()?.accessToken ?? null);
  readonly isAuthenticated = computed(() => this.tokens() !== null);
  readonly role = computed<Role | null>(() => {
    const t = this.tokens()?.accessToken;
    if (!t) return null;
    try {
      return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role as Role;
    } catch {
      return null;
    }
  });

  login(email: string, password: string, totp?: string): Observable<LoginResult> {
    return this.http
      .post<LoginResult>(`${environment.apiUrl}/auth/login`, { email, password, ...(totp ? { totp } : {}) })
      .pipe(tap((r) => { if ('accessToken' in r) this.tokens.set(r); }));
  }

  logout() {
    const t = this.tokens();
    this.tokens.set(null);
    if (t) this.http.post(`${environment.apiUrl}/auth/logout`, { refreshToken: t.refreshToken }).subscribe({ error: () => {} });
  }
}
