import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { LanguageSwitcher } from '../../shared/components/language-switcher/language-switcher';
import { UserMenu } from '../../shared/components/user-menu/user-menu';

@Component({
  selector: 'app-admin-layout',
  imports: [RouterLink, TranslocoPipe, LanguageSwitcher, UserMenu],
  template: `
    <nav class="navbar navbar-dark bg-dark">
      <div class="container">
        <a class="navbar-brand" routerLink="/">{{ 'app.title' | transloco }}</a>
        <div class="d-flex align-items-center gap-3">
          <app-language-switcher />
          <app-user-menu />
        </div>
      </div>
    </nav>
    <main class="container py-4"><p class="lead">{{ 'layout.admin' | transloco }}</p></main>
  `,
})
export class AdminLayout {}
