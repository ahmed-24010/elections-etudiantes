import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { filter } from 'rxjs';
import { Role } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { AppFooter } from '../../shared/components/app-footer/app-footer';
import { AppHeader } from '../../shared/components/app-header/app-header';
import { StepUpDialog } from '../../shared/components/step-up-dialog/step-up-dialog';

interface MenuSection {
  /** Clé Transloco du titre de section. */
  title: string;
  /** Rôle qui voit la section (le serveur contrôle les droits ; ceci filtre l'affichage). */
  role: Role;
  items: { label: string; path: string }[];
}

export const ADMIN_MENU: readonly MenuSection[] = [
  {
    title: 'nav.academic',
    role: 'INSTITUTION_ADMIN',
    items: [
      { label: 'nav.years', path: '/admin/academic/years' },
      { label: 'nav.faculties', path: '/admin/academic/faculties' },
      { label: 'nav.programs', path: '/admin/academic/programs' },
      { label: 'nav.levels', path: '/admin/academic/levels' },
      { label: 'nav.groups', path: '/admin/academic/groups' },
    ],
  },
  {
    title: 'nav.verification',
    role: 'VERIFICATION_OFFICER',
    items: [{ label: 'nav.enrollments', path: '/admin/verification' }],
  },
];

const MOBILE = '(max-width: 991.98px)';

/**
 * Administration : menu latéral repliable (☰) filtré selon le rôle, contenu à côté. Le menu est du côté du début de
 * lecture (à droite en arabe). Sur mobile il est replié par défaut et s'ouvre par-dessus la page.
 */
@Component({
  selector: 'app-admin-layout',
  imports: [TranslocoPipe, RouterOutlet, RouterLink, RouterLinkActive, AppHeader, AppFooter, StepUpDialog],
  template: `
    <app-header [fluid]="true">
      @if (sections().length) {
        <button
          type="button"
          class="app-burger"
          aria-controls="admin-sidebar"
          [attr.aria-expanded]="open()"
          [attr.aria-label]="'nav.toggleMenu' | transloco"
          (click)="open.set(!open())"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      }
    </app-header>
    <div class="app-admin">
      @if (sections().length) {
        <aside id="admin-sidebar" class="app-sidebar" [class.is-collapsed]="!open()">
          <nav [attr.aria-label]="'nav.admin' | transloco">
            @for (s of sections(); track s.title) {
              <h2 class="app-sidebar-title">{{ s.title | transloco }}</h2>
              <ul class="app-sidebar-list">
                @for (i of s.items; track i.path) {
                  <li><a [routerLink]="i.path" routerLinkActive="active">{{ i.label | transloco }}</a></li>
                }
              </ul>
            }
          </nav>
        </aside>
        @if (open() && mobile()) {
          <button type="button" class="app-sidebar-backdrop" tabindex="-1" aria-hidden="true" (click)="open.set(false)"></button>
        }
      }
      <main class="app-admin-main"><router-outlet /></main>
    </div>
    <app-footer />
    <app-step-up-dialog />
  `,
})
export class AdminLayout {
  protected readonly auth = inject(AuthService);
  private readonly query = typeof matchMedia === 'function' ? matchMedia(MOBILE) : null;

  protected readonly mobile = signal(this.query?.matches ?? false);
  /** Ouvert d'office sur grand écran, replié sur mobile. */
  protected readonly open = signal(!this.mobile());
  protected readonly sections = computed(() => ADMIN_MENU.filter((s) => this.auth.hasRole(s.role)));

  constructor() {
    const onChange = (e: MediaQueryListEvent) => {
      this.mobile.set(e.matches);
      this.open.set(!e.matches);
    };
    this.query?.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => this.query?.removeEventListener('change', onChange));
    // Sur mobile, choisir une page referme le menu.
    inject(Router)
      .events.pipe(filter((e) => e instanceof NavigationEnd), takeUntilDestroyed())
      .subscribe(() => {
        if (this.mobile()) this.open.set(false);
      });
  }
}
