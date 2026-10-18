import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService } from '../../core/auth/auth.service';

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
  `,
})
export class HomePage {
  protected readonly auth = inject(AuthService);
}
