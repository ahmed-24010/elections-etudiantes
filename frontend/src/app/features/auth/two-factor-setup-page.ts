import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { apiErrorKey } from '../../core/auth/api-error';
import { AuthService } from '../../core/auth/auth.service';

/** Configuration de la 2FA : obligatoire pour les rôles administratifs (D-10, D-15), optionnelle pour les étudiants. */
@Component({
  selector: 'app-two-factor-setup-page',
  imports: [ReactiveFormsModule, TranslocoPipe],
  template: `
    <div class="row justify-content-center">
      <div class="col-12 col-md-8 col-lg-6">
        <h1 class="h3 mb-3">{{ 'auth.twoFactor.title' | transloco }}</h1>
        <p>{{ 'auth.twoFactor.intro' | transloco }}</p>

        @if (setup(); as s) {
          <div class="text-center my-3">
            @if (qr(); as src) {
              <img [src]="src" width="200" height="200" [alt]="'auth.twoFactor.qrAlt' | transloco" />
            }
          </div>
          <p class="mb-1">{{ 'auth.twoFactor.manual' | transloco }}</p>
          <p><code dir="ltr" class="user-select-all">{{ s.secret }}</code></p>

          <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
            <div class="mb-3">
              <label class="form-label" for="code">{{ 'auth.code' | transloco }}</label>
              <input
                id="code"
                class="form-control"
                formControlName="code"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="6"
              />
            </div>
            @if (error(); as key) {
              <div class="alert alert-danger" role="alert">{{ key | transloco }}</div>
            }
            <button type="submit" class="btn btn-primary w-100" [disabled]="busy() || form.invalid">
              {{ 'auth.twoFactor.submit' | transloco }}
            </button>
          </form>
        } @else if (error(); as key) {
          <div class="alert alert-danger" role="alert">{{ key | transloco }}</div>
        } @else {
          <p>{{ 'common.loading' | transloco }}</p>
        }
      </div>
    </div>
  `,
})
export class TwoFactorSetupPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });
  protected readonly setup = signal<{ secret: string; otpauthUri: string } | null>(null);
  protected readonly qr = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      const setup = await this.auth.startTwoFactorSetup();
      this.setup.set(setup);
      // Chargé à la demande : la bibliothèque de QR code n'alourdit pas le reste de l'application.
      const { default: QRCode } = await import('qrcode');
      this.qr.set(await QRCode.toDataURL(setup.otpauthUri, { width: 200, margin: 1 }));
    } catch (e) {
      this.error.set(apiErrorKey(e));
    }
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.enableTwoFactor(this.form.getRawValue().code);
      await this.router.navigateByUrl(this.auth.homeUrl());
    } catch (e) {
      this.error.set(apiErrorKey(e));
      this.form.reset();
    } finally {
      this.busy.set(false);
    }
  }
}
