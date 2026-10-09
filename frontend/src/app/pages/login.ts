import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()">
      <label>{{ i18n.t('login.email') }}<input type="email" formControlName="email" autocomplete="username" /></label>
      <label>{{ i18n.t('login.password') }}<input type="password" formControlName="password" autocomplete="current-password" /></label>
      <label>{{ i18n.t('login.totp') }}<input type="text" formControlName="totp" inputmode="numeric" maxlength="6" /></label>
      @if (error()) { <p class="error" role="alert">{{ i18n.t('login.error') }}</p> }
      <button type="submit" [disabled]="form.invalid">{{ i18n.t('login.submit') }}</button>
    </form>
  `,
  styles: `
    form { display: grid; gap: 1rem; max-inline-size: 22rem; margin-inline: auto; }
    label { display: grid; gap: .25rem; }
    .error { color: #b00020; }
  `,
})
export class Login {
  protected readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly error = signal(false);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
    totp: [''],
  });

  submit() {
    const { email, password, totp } = this.form.getRawValue();
    this.error.set(false);
    this.auth.login(email, password, totp || undefined).subscribe({
      next: (r) => { if ('accessToken' in r) this.router.navigateByUrl('/'); /* TODO: écran d'enrôlement 2FA */ },
      error: () => this.error.set(true),
    });
  }
}
