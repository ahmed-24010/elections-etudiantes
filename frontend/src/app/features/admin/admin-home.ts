import { Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService } from '../../core/auth/auth.service';
import { SystemStatus } from './system-status';

/** Accueil de l'administration pour les rôles qui n'ont pas encore d'écran (SUPER_ADMIN, comité). L'état du système n'y est affiché qu'au SUPER_ADMIN. */
@Component({
  selector: 'app-admin-home',
  imports: [TranslocoPipe, SystemStatus],
  template: `
    <p class="lead">{{ 'layout.admin' | transloco }}</p>
    @if (auth.hasRole('SUPER_ADMIN')) {
      <app-system-status />
    }
  `,
})
export class AdminHome {
  protected readonly auth = inject(AuthService);
}
