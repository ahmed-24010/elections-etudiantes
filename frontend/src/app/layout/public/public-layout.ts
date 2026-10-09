import { Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { LanguageSwitcher } from '../../shared/components/language-switcher/language-switcher';

@Component({
  selector: 'app-public-layout',
  imports: [RouterLink, RouterOutlet, TranslocoPipe, LanguageSwitcher],
  template: `
    <nav class="navbar navbar-dark bg-dark">
      <div class="container">
        <a class="navbar-brand" routerLink="/">{{ 'app.title' | transloco }}</a>
        <app-language-switcher />
      </div>
    </nav>
    <main class="container py-4"><router-outlet /></main>
  `,
})
export class PublicLayout {}
