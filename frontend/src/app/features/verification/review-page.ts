import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { localName } from '../../core/api/academic.api';
import { REJECTION_CODES, RejectionCode } from '../../core/api/enrollment.api';
import { ReviewDetail, VerificationApi } from '../../core/api/verification.api';
import { apiErrorKey } from '../../core/auth/api-error';
import { StepUpCancelled, StepUpService } from '../../core/auth/step-up.service';
import { LanguageService } from '../../core/services/language.service';

type Outcome = 'approved' | 'rejected';

/**
 * Examen d'une inscription : données déclarées, attestation (URL signée de 5 min, téléchargée par le navigateur puis
 * affichée depuis un blob local) et décision. Valider et rejeter passent par la fenêtre 2FA (StepUpService).
 */
@Component({
  selector: 'app-review-page',
  imports: [ReactiveFormsModule, RouterLink, TranslocoPipe, DatePipe],
  template: `
    <p><a routerLink="/admin/verification">← {{ 'verification.review.back' | transloco }}</a></p>
    @if (loadError(); as key) {
      <div class="alert alert-danger" role="alert">{{ key | transloco }}</div>
    } @else if (!detail()) {
      <p>{{ 'common.loading' | transloco }}</p>
    } @else {
      @let d = detail()!;
      <section class="app-card p-4 mb-4">
        <h1 class="h3 app-page-title">{{ 'verification.review.title' | transloco }}</h1>
        <dl class="row mb-0">
          <dt class="col-sm-4">{{ 'student.fields.name' | transloco }}</dt>
          <dd class="col-sm-8">{{ d.student.firstName }} {{ d.student.lastName }}</dd>
          @if (d.student.fullNameAr) {
            <dt class="col-sm-4">{{ 'student.fields.fullNameAr' | transloco }}</dt>
            <dd class="col-sm-8" dir="rtl">{{ d.student.fullNameAr }}</dd>
          }
          <dt class="col-sm-4">{{ 'student.fields.studentNumber' | transloco }}</dt>
          <dd class="col-sm-8"><bdi dir="ltr">{{ d.student.studentNumber }}</bdi></dd>
          <dt class="col-sm-4">{{ 'student.fields.faculty' | transloco }}</dt>
          <dd class="col-sm-8">{{ name(d.faculty) }}</dd>
          <dt class="col-sm-4">{{ 'student.fields.program' | transloco }}</dt>
          <dd class="col-sm-8">{{ name(d.program) }}</dd>
          <dt class="col-sm-4">{{ 'student.fields.level' | transloco }}</dt>
          <dd class="col-sm-8">{{ name(d.level) }}</dd>
          @if (d.group) {
            <dt class="col-sm-4">{{ 'student.fields.group' | transloco }}</dt>
            <dd class="col-sm-8">{{ d.group.name }}</dd>
          }
          <dt class="col-sm-4">{{ 'student.year' | transloco }}</dt>
          <dd class="col-sm-8"><bdi dir="ltr">{{ d.academicYear.label }}</bdi></dd>
          <dt class="col-sm-4">{{ 'verification.queue.submitted' | transloco }}</dt>
          <dd class="col-sm-8"><bdi dir="ltr">{{ d.submittedAt | date: 'yyyy-MM-dd HH:mm' }}</bdi></dd>
        </dl>
      </section>

      <section class="app-card p-4 mb-4">
        <h2 class="h5 app-page-title">{{ 'verification.review.document' | transloco }}</h2>
        @if (viewerUrl(); as url) {
          @if (isImage()) {
            <img class="img-fluid border rounded" [src]="url" [alt]="'verification.review.document' | transloco" />
          } @else {
            <iframe class="app-doc-frame border rounded" [src]="url" [title]="'verification.review.document' | transloco"></iframe>
          }
        } @else if (!outcome()) {
          <button type="button" class="btn btn-outline-primary" [disabled]="viewing()" (click)="view()">
            {{ 'verification.review.show' | transloco }}
          </button>
          <p class="form-text mb-0">{{ 'verification.review.signedHint' | transloco }}</p>
        }
        @if (viewError(); as key) {
          <div class="alert alert-danger mt-3 mb-0" role="alert">{{ key | transloco }}</div>
        }
      </section>

      <section class="app-card p-4 mb-4" aria-live="polite">
        <h2 class="h5 app-page-title">{{ 'verification.review.decision' | transloco }}</h2>
        @if (outcome(); as o) {
          <div class="alert alert-success mb-0" role="status">{{ 'verification.review.done.' + o | transloco }}</div>
        } @else if (d.ownRequest) {
          <div class="alert alert-warning mb-0" role="alert">{{ 'verification.review.ownRequest' | transloco }}</div>
        } @else {
          @if (!rejecting()) {
            <div class="d-flex flex-wrap gap-2">
              <button type="button" class="btn btn-success" [disabled]="busy()" (click)="approve()">{{ 'verification.review.approve' | transloco }}</button>
              <button type="button" class="btn btn-outline-primary" [disabled]="busy()" (click)="rejecting.set(true)">{{ 'verification.review.reject' | transloco }}</button>
            </div>
          } @else {
            <form [formGroup]="rejectForm" (ngSubmit)="reject()" novalidate>
              <div class="mb-3">
                <label class="form-label" for="rejectCode">{{ 'verification.review.code' | transloco }}</label>
                <select id="rejectCode" class="form-select" formControlName="code">
                  <option value="">{{ 'student.fields.choose' | transloco }}</option>
                  @for (c of codes; track c) {
                    <option [value]="c">{{ 'verification.codes.' + c | transloco }}</option>
                  }
                </select>
                @if (rejectForm.controls.code.value === 'WRONG_STUDENT_NUMBER') {
                  <div class="form-text">{{ 'verification.review.wrongNumberHint' | transloco }}</div>
                }
              </div>
              <div class="mb-3">
                <label class="form-label" for="rejectReason">{{ 'verification.review.reason' | transloco }}</label>
                <textarea id="rejectReason" class="form-control" rows="3" maxlength="500" formControlName="reason"></textarea>
                <div class="form-text">{{ 'verification.review.reasonHint' | transloco }}</div>
              </div>
              <div class="d-flex flex-wrap gap-2">
                <button type="submit" class="btn btn-primary" [disabled]="busy() || rejectForm.invalid">{{ 'verification.review.confirmReject' | transloco }}</button>
                <button type="button" class="btn btn-outline-primary" [disabled]="busy()" (click)="rejecting.set(false)">{{ 'common.cancel' | transloco }}</button>
              </div>
            </form>
          }
          @if (decisionError(); as key) {
            <div class="alert alert-danger mt-3 mb-0" role="alert">{{ key | transloco }}</div>
          }
        }
      </section>
    }
  `,
})
export class ReviewPage implements OnInit {
  private readonly api = inject(VerificationApi);
  private readonly stepUp = inject(StepUpService);
  private readonly route = inject(ActivatedRoute);
  private readonly lang = inject(LanguageService);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly codes = REJECTION_CODES;
  protected readonly detail = signal<ReviewDetail | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly viewerUrl = signal<SafeResourceUrl | null>(null);
  protected readonly viewing = signal(false);
  protected readonly viewError = signal<string | null>(null);
  protected readonly rejecting = signal(false);
  protected readonly busy = signal(false);
  protected readonly decisionError = signal<string | null>(null);
  protected readonly outcome = signal<Outcome | null>(null);

  protected readonly rejectForm = inject(FormBuilder).nonNullable.group({
    code: ['' as RejectionCode | '', [Validators.required]],
    reason: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(500)]],
  });

  private objectUrl: string | null = null;
  private id = '';

  constructor() {
    // L'attestation vit en mémoire le temps de l'examen : on libère le blob en quittant la page.
    inject(DestroyRef).onDestroy(() => this.release());
  }

  async ngOnInit(): Promise<void> {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    try {
      this.detail.set(await this.api.detail(this.id));
    } catch (e) {
      this.loadError.set(apiErrorKey(e));
    }
  }

  protected name(item: { name: string; nameAr?: string | null }): string {
    return localName(item, this.lang.current());
  }

  protected isImage(): boolean {
    return this.detail()?.document?.mimeType.startsWith('image/') ?? false;
  }

  private release(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  protected async view(): Promise<void> {
    this.viewing.set(true);
    this.viewError.set(null);
    try {
      const blob = await this.api.openDocument(this.id);
      this.release();
      this.objectUrl = URL.createObjectURL(blob);
      // URL de blob créée ici, jamais fournie par le serveur ni par un utilisateur.
      this.viewerUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.objectUrl));
    } catch (e) {
      this.viewError.set(apiErrorKey(e));
    } finally {
      this.viewing.set(false);
    }
  }

  protected approve(): Promise<void> {
    return this.decide(() => this.api.approve(this.id), 'approved');
  }

  protected reject(): Promise<void> {
    if (this.rejectForm.invalid) return Promise.resolve();
    const { code, reason } = this.rejectForm.getRawValue();
    return this.decide(() => this.api.reject(this.id, code as RejectionCode, reason), 'rejected');
  }

  private async decide(action: () => Promise<void>, outcome: Outcome): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.decisionError.set(null);
    try {
      await this.stepUp.run(action);
      this.outcome.set(outcome);
      this.release();
      this.viewerUrl.set(null); // la décision est prise : l'attestation n'a plus à rester affichée
    } catch (e) {
      if (!(e instanceof StepUpCancelled)) this.decisionError.set(apiErrorKey(e));
    } finally {
      this.busy.set(false);
    }
  }
}
