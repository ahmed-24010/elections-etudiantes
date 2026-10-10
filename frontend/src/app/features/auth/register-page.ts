import { Component, OnInit, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { apiErrorKey } from '../../core/auth/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { InstitutionOption } from '../../core/auth/auth.models';

export const PASSWORD_MIN = 10;

/** Au moins un des deux : e-mail ou téléphone. */
const emailOrPhone = (group: AbstractControl): ValidationErrors | null =>
  group.get('email')?.value || group.get('phone')?.value ? null : { emailOrPhone: true };

@Component({
  selector: 'app-register-page',
  imports: [ReactiveFormsModule, RouterLink, TranslocoPipe],
  template: `
    <div class="row justify-content-center">
      <div class="col-12 col-md-8 col-lg-5">
        <h1 class="h3 mb-3">{{ 'auth.register.title' | transloco }}</h1>

        @if (done()) {
          <div class="alert alert-success" role="status">{{ 'auth.register.done' | transloco }}</div>
          <a class="btn btn-primary" routerLink="/login">{{ 'auth.login.title' | transloco }}</a>
        } @else {
          <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
            <div class="mb-3">
              <label class="form-label" for="institution">{{ 'auth.institution' | transloco }}</label>
              <select id="institution" class="form-select" formControlName="institutionCode">
                <option value="" disabled>{{ 'auth.institutionPlaceholder' | transloco }}</option>
                @for (i of institutions(); track i.code) {
                  <option [value]="i.code">{{ i.name }}</option>
                }
              </select>
            </div>
            <div class="mb-3">
              <label class="form-label" for="email">{{ 'auth.email' | transloco }}</label>
              <input id="email" type="email" class="form-control" formControlName="email" autocomplete="email" />
            </div>
            <div class="mb-3">
              <label class="form-label" for="phone">{{ 'auth.phone' | transloco }}</label>
              <input id="phone" type="tel" class="form-control" formControlName="phone" autocomplete="tel" />
              <div class="form-text">{{ 'auth.register.emailOrPhone' | transloco }}</div>
            </div>
            <div class="mb-3">
              <label class="form-label" for="password">{{ 'auth.password' | transloco }}</label>
              <input
                id="password"
                type="password"
                class="form-control"
                formControlName="password"
                autocomplete="new-password"
                [class.is-invalid]="form.controls.password.touched && form.controls.password.invalid"
              />
              <div class="form-text">{{ 'auth.register.passwordHint' | transloco: { min: passwordMin } }}</div>
            </div>
            @if (error(); as key) {
              <div class="alert alert-danger" role="alert">{{ key | transloco }}</div>
            }
            <button type="submit" class="btn btn-primary w-100" [disabled]="busy() || form.invalid">
              {{ 'auth.register.submit' | transloco }}
            </button>
          </form>
          <p class="mt-3 mb-0">
            {{ 'auth.register.haveAccount' | transloco }}
            <a routerLink="/login">{{ 'auth.login.title' | transloco }}</a>
          </p>
        }
      </div>
    </div>
  `,
})
export class RegisterPage implements OnInit {
  private readonly auth = inject(AuthService);
  protected readonly passwordMin = PASSWORD_MIN;

  protected readonly form = inject(FormBuilder).nonNullable.group(
    {
      institutionCode: ['', [Validators.required]],
      email: ['', [Validators.email, Validators.maxLength(191)]],
      phone: ['', [Validators.pattern(/^\+?[0-9 .-]{8,20}$/)]],
      password: ['', [Validators.required, Validators.minLength(PASSWORD_MIN), Validators.maxLength(128)]],
    },
    { validators: emailOrPhone },
  );
  protected readonly institutions = signal<InstitutionOption[]>([]);
  protected readonly busy = signal(false);
  protected readonly done = signal(false);
  protected readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      this.institutions.set(await this.auth.institutions());
    } catch (e) {
      this.error.set(apiErrorKey(e));
    }
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.busy()) return;
    const { email, phone, password, institutionCode } = this.form.getRawValue();
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.register({ ...(email ? { email } : {}), ...(phone ? { phone } : {}), password, institutionCode });
      // Même message que le compte existe déjà ou non : le serveur ne le dit pas, l'interface non plus.
      this.done.set(true);
    } catch (e) {
      this.error.set(apiErrorKey(e));
    } finally {
      this.busy.set(false);
    }
  }
}
