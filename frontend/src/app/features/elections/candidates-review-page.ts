import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AcademicApi, AcademicOverview, localName } from '../../core/api/academic.api';
import { CandidatesApi, FileKind, ReviewCandidate } from '../../core/api/candidates.api';
import { ElectionDetail, ElectionsApi } from '../../core/api/elections.api';
import { apiErrorKey } from '../../core/auth/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { StepUpCancelled, StepUpService } from '../../core/auth/step-up.service';
import { LanguageService } from '../../core/services/language.service';
import { AppModal } from '../../shared/components/app-modal/app-modal';
import { candidacyClass, electionTitle } from './election-ui';

/**
 * Écran de validation du comité (03 §5.5) : toutes les candidatures de l'élection, avec photo, programme et motifs.
 * Valider et rejeter sont des actions 🔐 (fenêtre du code 2FA) réservées au comité de CETTE élection ; l'administrateur
 * d'institution consulte seulement. Jamais de numéro étudiant ici (`student:read:minimal`).
 */
@Component({
  selector: 'app-candidates-review-page',
  imports: [TranslocoPipe, RouterLink, AppModal, ReactiveFormsModule],
  template: `
    <p><a [routerLink]="['/admin/elections', electionId]">{{ backArrow() }} {{ 'elections.detail.back' | transloco }}</a></p>
    @if (loadError(); as key) {
      <div class="alert alert-danger" role="alert">{{ key | transloco }}</div>
    } @else if (!election() || !items()) {
      <p>{{ 'common.loading' | transloco }}</p>
    } @else {
      <header class="app-page-head">
        <h1>{{ 'elections.review.title' | transloco }}</h1>
        <p>{{ title() }}</p>
      </header>

      @if (error(); as key) {
        <div class="alert alert-danger" role="alert">{{ key | transloco }}</div>
      }
      @if (canDecide() && election()!.status === 'CANDIDACY_CLOSED') {
        <div class="alert alert-info" role="status">{{ 'elections.review.closedNote' | transloco }}</div>
      }

      <section class="app-card p-3 p-md-4">
        <div class="app-toolbar">
          <select class="form-select app-filter" [attr.aria-label]="'elections.review.allStatuses' | transloco" [value]="status()" (change)="status.set($any($event.target).value)">
            <option value="">{{ 'elections.review.allStatuses' | transloco }}</option>
            @for (s of statuses; track s) {
              <option [value]="s" [selected]="s === status()">{{ 'elections.candidate.status.' + s | transloco }}</option>
            }
          </select>
          <span class="app-count" role="status">{{ 'common.results' | transloco: { count: visible().length } }}</span>
          <button type="button" class="btn btn-outline-primary" [disabled]="busy()" (click)="reload()" [attr.aria-label]="'common.refresh' | transloco">↻</button>
        </div>

        @if (visible().length === 0) {
          <p class="text-body-secondary mb-0">{{ 'common.noResults' | transloco }}</p>
        } @else {
          <div class="app-candidates">
            @for (c of visible(); track c.id) {
              <article class="app-candidate" [attr.data-testid]="'candidate-' + c.id">
                <header class="d-flex flex-wrap align-items-center gap-2">
                  <h2 class="h6 mb-0">{{ fullName(c) }}</h2>
                  <span class="badge" [class]="badge(c)">{{ 'elections.candidate.status.' + c.status | transloco }}</span>
                </header>
                <p class="mb-1 small text-body-secondary">{{ positionName(c.positionId) }} · {{ cohort(c) }}</p>
                @if (c.statement) {
                  <p class="mb-2">{{ c.statement }}</p>
                }
                @if (c.status === 'REJECTED' && c.rejectionReason) {
                  <p class="alert alert-danger py-1 px-2 small mb-2"><strong>{{ 'elections.candidate.rejectionReason' | transloco }}</strong> {{ c.rejectionReason }}</p>
                }
                <div class="d-flex flex-wrap gap-2">
                  @if (c.hasPhoto) {
                    <button type="button" class="btn btn-sm btn-outline-primary" [disabled]="busy()" (click)="view(c, 'photo')">{{ 'elections.candidate.viewPhoto' | transloco }}</button>
                  }
                  @if (c.hasProgram) {
                    <button type="button" class="btn btn-sm btn-outline-primary" [disabled]="busy()" (click)="view(c, 'program')">{{ 'elections.candidate.viewProgram' | transloco }}</button>
                  }
                  @if (canDecide() && decidable() && c.status === 'PENDING') {
                    <button type="button" class="btn btn-sm btn-success" [disabled]="busy()" (click)="approve(c)">{{ 'elections.review.approve' | transloco }}</button>
                    <button type="button" class="btn btn-sm btn-outline-danger" [disabled]="busy()" (click)="rejecting.set(c)">{{ 'elections.review.reject' | transloco }}</button>
                  }
                </div>
              </article>
            }
          </div>
        }
      </section>

      @if (rejecting(); as c) {
        <app-modal [title]="'elections.review.rejectTitle' | transloco" (closed)="closeReject()">
          <form id="reject-form" [formGroup]="rejectForm" (ngSubmit)="reject(c)" novalidate>
            <p>{{ fullName(c) }}</p>
            <label class="form-label" for="reason">{{ 'elections.review.reason' | transloco }}</label>
            <textarea id="reason" class="form-control" rows="3" maxlength="500" formControlName="reason"></textarea>
            <div class="form-text">{{ 'elections.review.reasonHint' | transloco }}</div>
          </form>
          <ng-container modal-footer>
            <button type="button" class="btn btn-outline-primary" [disabled]="busy()" (click)="closeReject()">{{ 'common.cancel' | transloco }}</button>
            <button type="submit" form="reject-form" class="btn btn-danger" [disabled]="busy() || rejectForm.invalid">{{ 'elections.review.confirmReject' | transloco }}</button>
          </ng-container>
        </app-modal>
      }

      @if (viewer(); as v) {
        <app-modal [title]="('elections.candidate.' + (v.kind === 'photo' ? 'viewPhoto' : 'viewProgram')) | transloco" (closed)="closeViewer()">
          @if (v.image) {
            <img class="img-fluid border rounded" [src]="v.url" [alt]="'elections.candidate.viewPhoto' | transloco" />
          } @else {
            <iframe class="app-doc-frame border rounded" [src]="v.url" [title]="'elections.candidate.viewProgram' | transloco"></iframe>
          }
        </app-modal>
      }
    }
  `,
})
export class CandidatesReviewPage implements OnInit {
  private readonly elections = inject(ElectionsApi);
  private readonly candidates = inject(CandidatesApi);
  private readonly academic = inject(AcademicApi);
  private readonly auth = inject(AuthService);
  private readonly lang = inject(LanguageService);
  private readonly stepUp = inject(StepUpService);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly statuses = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'] as const;
  protected readonly electionId = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';
  protected readonly election = signal<ElectionDetail | null>(null);
  protected readonly items = signal<ReviewCandidate[] | null>(null);
  protected readonly overview = signal<AcademicOverview | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly status = signal('');
  protected readonly rejecting = signal<ReviewCandidate | null>(null);
  protected readonly viewer = signal<{ kind: FileKind; url: SafeResourceUrl; image: boolean } | null>(null);
  protected readonly rejectForm = inject(FormBuilder).nonNullable.group({ reason: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(500)]] });

  /** Décider appartient au comité de l'élection (le serveur contrôle). */
  protected readonly canDecide = computed(() => this.auth.hasRole('ELECTION_COMMITTEE'));
  protected readonly decidable = computed(() => ['CANDIDACY_OPEN', 'CANDIDACY_CLOSED'].includes(this.election()?.status ?? ''));
  protected readonly title = computed(() => (this.election() ? electionTitle(this.election()!, this.lang.current()) : ''));
  protected readonly visible = computed(() => (this.items() ?? []).filter((c) => !this.status() || c.status === this.status()));

  private objectUrl: string | null = null;

  constructor() {
    // Le fichier vit en mémoire le temps de la consultation.
    inject(DestroyRef).onDestroy(() => this.release());
  }

  async ngOnInit(): Promise<void> {
    try {
      this.election.set(await this.elections.get(this.electionId));
      this.overview.set(await this.academic.overview(this.election()!.institutionId).catch(() => null));
      this.items.set(await this.candidates.listAll(this.electionId));
    } catch (e) {
      this.loadError.set(apiErrorKey(e));
    }
  }

  protected backArrow(): string {
    return this.lang.dir() === 'rtl' ? '→' : '←';
  }

  protected badge(c: ReviewCandidate): string {
    return candidacyClass(c.status);
  }

  protected fullName(c: ReviewCandidate): string {
    return this.lang.current() === 'ar' && c.fullNameAr ? c.fullNameAr : `${c.firstName} ${c.lastName}`;
  }

  protected positionName(id: string): string {
    const p = this.election()?.positions.find((x) => x.id === id);
    return p ? localName({ name: p.title, nameAr: p.titleAr }, this.lang.current()) : '';
  }

  /** Filière · niveau · groupe de l'inscription de l'année de l'élection. */
  protected cohort(c: ReviewCandidate): string {
    const o = this.overview();
    const e = c.enrollment;
    if (!o || !e) return '';
    const n = (x?: { name: string; nameAr?: string | null }) => (x ? localName(x, this.lang.current()) : '');
    return [n(o.programs.find((x) => x.id === e.programId)), n(o.levels.find((x) => x.id === e.levelId)), o.groups.find((x) => x.id === e.groupId)?.name ?? '']
      .filter(Boolean)
      .join(' · ');
  }

  protected reload(): Promise<void> {
    this.error.set(null);
    return this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      this.election.set(await this.elections.get(this.electionId));
      this.items.set(await this.candidates.listAll(this.electionId));
    } catch (e) {
      this.error.set(apiErrorKey(e));
    }
  }

  private async act(action: () => Promise<unknown>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
      await this.refresh();
    } catch (e) {
      if (!(e instanceof StepUpCancelled)) this.error.set(apiErrorKey(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected approve(c: ReviewCandidate): Promise<void> {
    return this.act(() => this.stepUp.run(() => this.candidates.approve(this.electionId, c.id)));
  }

  protected async reject(c: ReviewCandidate): Promise<void> {
    if (this.rejectForm.invalid) return;
    const reason = this.rejectForm.getRawValue().reason.trim();
    this.rejecting.set(null);
    this.rejectForm.reset({ reason: '' });
    await this.act(() => this.stepUp.run(() => this.candidates.reject(this.electionId, c.id, reason)));
  }

  protected closeReject(): void {
    if (this.busy()) return;
    this.rejecting.set(null);
    this.rejectForm.reset({ reason: '' });
  }

  protected async view(c: ReviewCandidate, kind: FileKind): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const blob = await this.candidates.openFile(this.electionId, c.id, kind);
      this.release();
      this.objectUrl = URL.createObjectURL(blob);
      // URL de blob créée ici, jamais fournie par le serveur ni par un utilisateur.
      this.viewer.set({ kind, url: this.sanitizer.bypassSecurityTrustResourceUrl(this.objectUrl), image: blob.type.startsWith('image/') });
    } catch (e) {
      this.error.set(apiErrorKey(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected closeViewer(): void {
    this.viewer.set(null);
    this.release();
  }

  private release(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }
}
