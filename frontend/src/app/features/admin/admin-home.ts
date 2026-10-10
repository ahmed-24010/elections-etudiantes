import { Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/** Accueil de l'administration pour les rôles qui n'ont pas encore d'écran (SUPER_ADMIN, comité). */
@Component({
  selector: 'app-admin-home',
  imports: [TranslocoPipe],
  template: `<p class="lead">{{ 'layout.admin' | transloco }}</p>`,
})
export class AdminHome {}
