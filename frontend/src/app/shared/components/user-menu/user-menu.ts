import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService } from '../../../core/auth/auth.service';

/** Connexion / inscription pour un visiteur ; compte et déconnexion pour un utilisateur connecté. */
@Component({
  selector: 'app-user-menu',
  imports: [RouterLink, TranslocoPipe],
  template: `
    <div class="d-flex align-items-center gap-2">
      @if (auth.user(); as user) {
        <a class="btn btn-sm btn-outline-light" [routerLink]="auth.homeUrl()">{{ user.email ?? user.phone }}</a>
        <button type="button" class="btn btn-sm btn-light" (click)="auth.logout()">{{ 'auth.logout' | transloco }}</button>
      } @else {
        <a class="btn btn-sm btn-outline-light" routerLink="/login">{{ 'auth.login.title' | transloco }}</a>
        <a class="btn btn-sm btn-light" routerLink="/register">{{ 'auth.register.title' | transloco }}</a>
      }
    </div>
  `,
})
export class UserMenu {
  protected readonly auth = inject(AuthService);
}
