import { Component, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { apiErrorKey } from '../../../core/auth/api-error';
import { StepUpService } from '../../../core/auth/step-up.service';

/** Fenêtre de saisie du code 2FA pour les actions sensibles (voir StepUpService). Affichée seulement quand une action la demande. */
@Component({
  selector: 'app-step-up-dialog',
  imports: [ReactiveFormsModule, TranslocoPipe],
  template: `
    @if (stepUp.pending()) {
      <div class="modal-backdrop fade show"></div>
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="step-up-title" (keydown.escape)="cancel()">
        <div class="modal-dialog modal-dialog-centered">
          <form class="modal-content app-card" [formGroup]="form" (ngSubmit)="submit()" novalidate>
            <div class="modal-header">
              <h2 class="modal-title h5 app-page-title" id="step-up-title">{{ 'stepUp.title' | transloco }}</h2>
            </div>
            <div class="modal-body">
              <p>{{ 'stepUp.intro' | transloco }}</p>
              <label class="form-label" for="step-up-code">{{ 'auth.code' | transloco }}</label>
              <input
                #codeInput
                id="step-up-code"
                class="form-control"
                formControlName="code"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="6"
                dir="ltr"
              />
              @if (error(); as key) {
                <div class="alert alert-danger mt-3 mb-0" role="alert">{{ key | transloco }}</div>
              }
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline-primary" (click)="cancel()" [disabled]="busy()">{{ 'common.cancel' | transloco }}</button>
              <button type="submit" class="btn btn-primary" [disabled]="busy() || form.invalid">{{ 'stepUp.confirm' | transloco }}</button>
            </div>
          </form>
        </div>
      </div>
    }
  `,
})
export class StepUpDialog {
  protected readonly stepUp = inject(StepUpService);
  private readonly codeInput = viewChild<ElementRef<HTMLInputElement>>('codeInput');

  protected readonly form = inject(FormBuilder).nonNullable.group({
    code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    // À l'ouverture : champ vide, focus dans le champ du code.
    effect(() => {
      const input = this.codeInput();
      if (input) {
        this.form.reset();
        this.error.set(null);
        input.nativeElement.focus();
      }
    });
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.stepUp.submit(this.form.getRawValue().code);
    } catch (e) {
      this.error.set(apiErrorKey(e));
      this.form.reset();
    } finally {
      this.busy.set(false);
    }
  }

  protected cancel(): void {
    this.stepUp.cancel();
  }
}
