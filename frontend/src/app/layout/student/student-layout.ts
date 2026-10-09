import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { LanguageSwitcher } from '../../shared/components/language-switcher/language-switcher';

@Component({
  selector: 'app-student-layout',
  imports: [RouterLink, TranslocoPipe, LanguageSwitcher],
  template: `
    <nav class="navbar navbar-dark bg-dark">
      <div class="container">
        <a class="navbar-brand" routerLink="/">{{ 'app.title' | transloco }}</a>
        <app-language-switcher />
      </div>
    </nav>
    <main class="container py-4"><p class="lead">{{ 'layout.student' | transloco }}</p></main>
  `,
})
export class StudentLayout {}
