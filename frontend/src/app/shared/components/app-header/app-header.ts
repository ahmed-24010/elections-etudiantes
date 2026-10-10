import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { LanguageSwitcher } from '../language-switcher/language-switcher';
import { UserMenu } from '../user-menu/user-menu';

/** Barre du haut commune aux trois layouts : logo de l'Université, titre, langue, compte (les deux logos sont sur l'accueil). */
@Component({
  selector: 'app-header',
  imports: [RouterLink, TranslocoPipe, LanguageSwitcher, UserMenu],
  template: `
    <nav class="navbar app-navbar">
      <div class="container flex-wrap gap-2">
        <a class="navbar-brand" routerLink="/" [attr.aria-label]="'app.title' | transloco">
          <span class="app-logos">
            <img class="app-logo" src="branding/logo-un.jpg" width="44" height="44" [alt]="'institution.universityLogo' | transloco" />
          </span>
          <span class="app-brand-text d-none d-sm-inline">{{ 'app.title' | transloco }}</span>
        </a>
        <div class="d-flex align-items-center gap-3 flex-wrap">
          <app-language-switcher />
          <app-user-menu />
        </div>
      </div>
    </nav>
  `,
})
export class AppHeader {}
