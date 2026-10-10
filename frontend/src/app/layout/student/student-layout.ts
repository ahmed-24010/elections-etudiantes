import { Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AppFooter } from '../../shared/components/app-footer/app-footer';
import { AppHeader } from '../../shared/components/app-header/app-header';

@Component({
  selector: 'app-student-layout',
  imports: [TranslocoPipe, AppHeader, AppFooter],
  template: `
    <app-header />
    <main class="container py-4">
      <section class="app-card p-4">
        <h1 class="h3 app-page-title">{{ 'student.welcome.title' | transloco }}</h1>
        <p class="lead mb-0">{{ 'student.welcome.text' | transloco }}</p>
      </section>
    </main>
    <app-footer />
  `,
})
export class StudentLayout {}
