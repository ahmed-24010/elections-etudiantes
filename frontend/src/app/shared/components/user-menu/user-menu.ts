import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService } from '../../../core/auth/auth.service';

/**
 * Connexion / inscription pour un visiteur ; pour un utilisateur connecté : e-mail et déconnexion sur grand écran,
 * un petit menu 👤 (e-mail + déconnexion) sur mobile, pour ne pas surcharger la barre du haut.
 */
@Component({
  selector: 'app-user-menu',
  imports: [RouterLink, TranslocoPipe],
  template: `
    @if (auth.user(); as user) {
      <div class="d-none d-md-flex align-items-center gap-2">
        <a class="btn btn-sm btn-outline-light" [routerLink]="auth.homeUrl()">{{ user.email ?? user.phone }}</a>
        <button type="button" class="btn btn-sm btn-light" (click)="auth.logout()">{{ 'auth.logout' | transloco }}</button>
      </div>
      <div class="d-md-none app-account">
        <button
          type="button"
          class="app-burger"
          aria-haspopup="true"
          [attr.aria-expanded]="open()"
          [attr.aria-label]="'auth.account' | transloco"
          (click)="open.set(!open())"
          (keydown.escape)="open.set(false)"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
          </svg>
        </button>
        @if (open()) {
          <div class="app-account-panel">
            <a class="app-account-email" [routerLink]="auth.homeUrl()" (click)="open.set(false)"><bdi dir="ltr">{{ user.email ?? user.phone }}</bdi></a>
            <button type="button" class="btn btn-sm btn-primary w-100" (click)="open.set(false); auth.logout()">{{ 'auth.logout' | transloco }}</button>
          </div>
        }
      </div>
    } @else {
      <div class="d-flex align-items-center gap-2">
        <a class="btn btn-sm btn-outline-light" routerLink="/login">{{ 'auth.login.title' | transloco }}</a>
        <a class="btn btn-sm btn-light" routerLink="/register">{{ 'auth.register.title' | transloco }}</a>
      </div>
    }
  `,
})
export class UserMenu {
  protected readonly auth = inject(AuthService);
  protected readonly open = signal(false);
}
