import { Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AppFooter } from '../../shared/components/app-footer/app-footer';
import { AppHeader } from '../../shared/components/app-header/app-header';

@Component({
  selector: 'app-admin-layout',
  imports: [TranslocoPipe, AppHeader, AppFooter],
  template: `
    <app-header />
    <main class="container py-4"><p class="lead">{{ 'layout.admin' | transloco }}</p></main>
    <app-footer />
  `,
})
export class AdminLayout {}
