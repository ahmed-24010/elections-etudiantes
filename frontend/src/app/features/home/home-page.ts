import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService } from '../../core/auth/auth.service';
import { map, startWith } from 'rxjs';
import { HealthService } from '../../core/services/health.service';

@Component({
  selector: 'app-home-page',
  imports: [RouterLink, TranslocoPipe],
  template: `
    <section class="app-hero">
      <div class="app-hero-logos">
        <img class="app-hero-logo is-university" src="branding/logo-un.jpg" width="120" height="120" [alt]="'institution.universityLogo' | transloco" />
        <img class="app-hero-logo is-faculty" src="branding/logo-fsjp.jpg" width="190" height="190" [alt]="'institution.facultyLogo' | transloco" />
      </div>
      <h1 class="h2">{{ 'home.title' | transloco }}</h1>
      <p class="app-institution">{{ 'institution.faculty' | transloco }}</p>
      <p class="app-institution">{{ 'institution.university' | transloco }}</p>
      <div class="app-ornament" aria-hidden="true"></div>
      <p class="lead text-body-secondary">{{ 'home.subtitle' | transloco }}</p>
      <div class="d-flex gap-2 justify-content-center flex-wrap">
        @if (auth.isAuthenticated()) {
          <a class="btn btn-primary btn-lg" [routerLink]="auth.homeUrl()">{{ 'home.mySpace' | transloco }}</a>
        } @else {
          <a class="btn btn-primary btn-lg" routerLink="/login">{{ 'auth.login.title' | transloco }}</a>
          <a class="btn btn-outline-primary btn-lg" routerLink="/register">{{ 'auth.register.title' | transloco }}</a>
        }
      </div>
    </section>

    <section class="card app-status mt-4" aria-live="polite">
      <div class="card-header">{{ 'health.title' | transloco }}</div>
      <ul class="list-group list-group-flush">
        @if (state(); as s) {
          @if (s === 'checking') {
            <li class="list-group-item">{{ 'health.checking' | transloco }}</li>
          } @else if (s === 'unreachable') {
            <li class="list-group-item text-danger">{{ 'health.unreachable' | transloco }}</li>
          } @else {
            <li class="list-group-item d-flex justify-content-between">
              <span>{{ 'health.api' | transloco }}</span>
              <span class="badge text-bg-success">{{ 'health.ok' | transloco }}</span>
            </li>
            <li class="list-group-item d-flex justify-content-between">
              <span>{{ 'health.database' | transloco }}</span>
              <span class="badge" [class.text-bg-success]="s.database === 'ok'" [class.text-bg-danger]="s.database !== 'ok'">
                {{ (s.database === 'ok' ? 'health.ok' : 'health.down') | transloco }}
              </span>
            </li>
          }
        }
      </ul>
    </section>
  `,
})
export class HomePage {
  protected readonly auth = inject(AuthService);
  protected readonly state = toSignal(
    inject(HealthService).status().pipe(
      map((s) => s ?? ('unreachable' as const)),
      startWith('checking' as const),
    ),
  );
}
