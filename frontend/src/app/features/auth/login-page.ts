import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { apiErrorKey } from '../../core/auth/api-error';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, RouterLink, TranslocoPipe],
  template: `
    <div class="row justify-content-center">
      <div class="col-12 col-md-8 col-lg-5">
        <div class="app-card p-4">
        <h1 class="h3 app-page-title mb-3">{{ 'auth.login.title' | transloco }}</h1>
        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          @if (!needsTotp()) {
            <div class="mb-3">
              <label class="form-label" for="identifier">{{ 'auth.identifier' | transloco }}</label>
              <input id="identifier" class="form-control" formControlName="identifier" autocomplete="username" />
            </div>
            <div class="mb-3">
              <label class="form-label" for="password">{{ 'auth.password' | transloco }}</label>
              <input id="password" type="password" class="form-control" formControlName="password" autocomplete="current-password" />
            </div>
          } @else {
            <p class="text-body-secondary">{{ 'auth.login.totpHint' | transloco }}</p>
            <div class="mb-3">
              <label class="form-label" for="totp">{{ 'auth.code' | transloco }}</label>
              <input
                id="totp"
                class="form-control"
                formControlName="totp"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="6"
              />
            </div>
          }
          @if (error(); as key) {
            <div class="alert alert-danger" role="alert">{{ key | transloco }}</div>
          }
          <button type="submit" class="btn btn-primary w-100" [disabled]="busy() || form.invalid">
            {{ 'auth.login.submit' | transloco }}
          </button>
        </form>
        <p class="mt-3 mb-0">
          {{ 'auth.login.noAccount' | transloco }}
          <a routerLink="/register">{{ 'auth.register.title' | transloco }}</a>
        </p>
        </div>
      </div>
    </div>
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    identifier: ['', [Validators.required, Validators.maxLength(191)]],
    password: ['', [Validators.required]],
    totp: ['', [Validators.pattern(/^\d{6}$/)]],
  });
  protected readonly needsTotp = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.busy()) return;
    const { identifier, password, totp } = this.form.getRawValue();
    if (this.needsTotp() && !totp) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const outcome = await this.auth.login(identifier, password, this.needsTotp() ? totp : undefined);
      if (outcome === 'two_factor_required') {
        this.needsTotp.set(true);
        this.form.controls.totp.addValidators(Validators.required);
        this.form.controls.totp.updateValueAndValidity();
      } else if (outcome === 'two_factor_setup_required') {
        await this.router.navigate(['/2fa-setup']);
      } else {
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        // On n'accepte qu'un chemin interne : pas de redirection ouverte vers un autre site.
        await this.router.navigateByUrl(returnUrl?.startsWith('/') && !returnUrl.startsWith('//') ? returnUrl : this.auth.homeUrl());
      }
    } catch (e) {
      this.error.set(apiErrorKey(e));
      if (this.needsTotp()) this.form.controls.totp.reset('');
    } finally {
      this.busy.set(false);
    }
  }
}
