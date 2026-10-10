import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService } from '../../core/auth/auth.service';
import { AppFooter } from '../../shared/components/app-footer/app-footer';
import { AppHeader } from '../../shared/components/app-header/app-header';
import { StepUpDialog } from '../../shared/components/step-up-dialog/step-up-dialog';

/** Administration : le menu ne montre que les écrans du rôle de l'utilisateur (confort ; le serveur contrôle les droits). */
@Component({
  selector: 'app-admin-layout',
  imports: [TranslocoPipe, RouterOutlet, RouterLink, RouterLinkActive, AppHeader, AppFooter, StepUpDialog],
  template: `
    <app-header />
    <main class="container py-4">
      @if (auth.hasRole('INSTITUTION_ADMIN') || auth.hasRole('VERIFICATION_OFFICER')) {
        <nav class="app-subnav mb-4" [attr.aria-label]="'nav.admin' | transloco">
          @if (auth.hasRole('INSTITUTION_ADMIN')) {
            <a routerLink="/admin/academic" routerLinkActive="active">{{ 'nav.academic' | transloco }}</a>
          }
          @if (auth.hasRole('VERIFICATION_OFFICER')) {
            <a routerLink="/admin/verification" routerLinkActive="active">{{ 'nav.verification' | transloco }}</a>
          }
        </nav>
      }
      <router-outlet />
    </main>
    <app-footer />
    <app-step-up-dialog />
  `,
})
export class AdminLayout {
  protected readonly auth = inject(AuthService);
}
