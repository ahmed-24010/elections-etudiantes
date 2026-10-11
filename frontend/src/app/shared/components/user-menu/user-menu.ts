import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService } from '../../../core/auth/auth.service';
import { IconMenu } from '../icon-menu/icon-menu';

/** Utilisateur connecté : 👤 → menu (e-mail + Déconnexion), sur tous les écrans. Visiteur : boutons Connexion / Inscription. */
@Component({
  selector: 'app-user-menu',
  imports: [RouterLink, TranslocoPipe, IconMenu],
  template: `
    @if (auth.user(); as user) {
      <app-icon-menu [label]="'auth.account' | transloco">
        <svg icon width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
        </svg>
        <a class="app-menu-email" [routerLink]="auth.homeUrl()"><bdi dir="ltr">{{ user.email ?? user.phone }}</bdi></a>
        <button type="button" class="app-menu-item" (click)="auth.logout()">{{ 'auth.logout' | transloco }}</button>
      </app-icon-menu>
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
}
