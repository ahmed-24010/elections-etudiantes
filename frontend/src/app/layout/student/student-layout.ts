import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppFooter } from '../../shared/components/app-footer/app-footer';
import { AppHeader } from '../../shared/components/app-header/app-header';

@Component({
  selector: 'app-student-layout',
  imports: [RouterOutlet, AppHeader, AppFooter],
  template: `
    <app-header />
    <main class="container py-4"><router-outlet /></main>
    <app-footer />
  `,
})
export class StudentLayout {}
