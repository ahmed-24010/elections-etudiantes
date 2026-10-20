import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AcademicApi, AcademicOverview, localName } from '../../core/api/academic.api';
import { ElectionDetail, ElectionsApi, RuleItem } from '../../core/api/elections.api';
import { apiErrorKey } from '../../core/auth/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { StepUpCancelled, StepUpService } from '../../core/auth/step-up.service';
import { LanguageService } from '../../core/services/language.service';
import { AppModal } from '../../shared/components/app-modal/app-modal';
import { electionTitle, statusClass } from './election-ui';

/** Codes du serveur → clés `elections.readiness.*`. */
const CONDITION_KEYS: Record<string, string> = {
  candidacy_dates_required: 'dates',
  positions_required: 'positions',
  rules_required: 'rules',
  committee_incomplete: 'committee',
  no_eligible_voters: 'eligible',
};

/**
 * Une élection vue par son personnel : état, calendrier, postes, règles, comité, nombre d'éligibles (un chiffre, D-02) et
 * les transitions de ce sprint (ouvrir et fermer les candidatures ; annuler 🔐 pour l'administrateur d'institution).
 */
@Component({
  selector: 'app-election-detail-page',
  imports: [TranslocoPipe, RouterLink, DatePipe, AppModal, ReactiveFormsModule],
  template: `
    <p><a routerLink="/admin/elections">{{ backArrow() }} {{ 'elections.detail.back' | transloco }}</a></p>
    @if (loadError(); as key) {
      <div class="alert alert-danger" role="alert">{{ key | transloco }}</div>
    } @else if (!e()) {
      <p>{{ 'common.loading' | transloco }}</p>
    } @else {
      @let d = e()!;
      <header class="app-page-head">
        <div class="d-flex flex-wrap align-items-center gap-2">
          <h1 class="mb-0">{{ title() }}</h1>
          <span class="badge" [class]="badge()" data-testid="status">{{ 'elections.status.' + d.status | transloco }}</span>
        </div>
        @if (d.description) {
          <p>{{ d.description }}</p>
        }
      </header>

      @if (error(); as key) {
        <div class="alert alert-danger" role="alert">
          {{ key | transloco }}
          @if (conditions().length) {
            <ul class="mb-0">
              @for (c of conditions(); track c) {
                <li>{{ 'elections.readiness.' + c | transloco }}</li>
              }
            </ul>
          }
        </div>
      }

      <section class="app-card p-3 p-md-4 mb-3">
        <div class="d-flex flex-wrap gap-2">
          @if (d.status === 'DRAFT') {
            <a class="btn btn-outline-primary" [routerLink]="['/admin/elections', d.id, 'edit']">{{ 'elections.detail.edit' | transloco }}</a>
            <button type="button" class="btn btn-success" [disabled]="busy()" (click)="open()">{{ 'elections.detail.openCandidacy' | transloco }}</button>
          }
          @if (d.status === 'CANDIDACY_OPEN') {
            <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="close()">{{ 'elections.detail.closeCandidacy' | transloco }}</button>
          }
          @if (d.status !== 'DRAFT' && d.status !== 'CANCELLED') {
            <a class="btn btn-outline-primary" [routerLink]="['/admin/elections', d.id, 'candidates']" data-testid="to-candidates">{{ 'elections.detail.candidates' | transloco }}</a>
          }
          @if (d.status === 'CANDIDACY_CLOSED' || d.status === 'VOTING_OPEN' || d.status === 'VOTING_CLOSED' || d.status === 'RESULTS_PUBLISHED') {
            <a class="btn btn-primary" [routerLink]="['/admin/elections', d.id, 'vote']" data-testid="to-vote">{{ 'elections.detail.votePage' | transloco }}</a>
          }
          @if (d.status === 'VOTING_CLOSED' || d.status === 'RESULTS_PUBLISHED') {
            <a class="btn btn-primary" [routerLink]="['/admin/elections', d.id, 'results']" data-testid="to-results">{{ 'elections.detail.resultsPage' | transloco }}</a>
          }
          @if (isAdmin && canCancel()) {
            <button type="button" class="btn btn-outline-danger" [disabled]="busy()" (click)="confirmCancel.set(true)">{{ 'elections.detail.cancel' | transloco }}</button>
          }
        </div>
        @if (d.status === 'DRAFT' && !ready()) {
          <p class="form-text mb-0 mt-2">{{ 'elections.detail.notReady' | transloco }}</p>
        }
      </section>

      <div class="row g-3">
        <section class="col-12 col-lg-6">
          <div class="app-card p-3 p-md-4 h-100">
            <h2 class="h5 app-page-title">{{ 'elections.detail.calendar' | transloco }}</h2>
            <dl class="row mb-0">
              @for (f of dateFields; track f) {
                <dt class="col-sm-6">{{ 'elections.fields.' + f | transloco }}</dt>
                <dd class="col-sm-6"><bdi dir="ltr">{{ $any(d)[f] ? ($any(d)[f] | date: 'yyyy-MM-dd HH:mm') : '—' }}</bdi></dd>
              }
              <dt class="col-sm-6">{{ 'elections.detail.eligible' | transloco }}</dt>
              <dd class="col-sm-6" data-testid="eligible"><bdi dir="ltr">{{ eligible() ?? '—' }}</bdi></dd>
            </dl>
          </div>
        </section>

        <section class="col-12 col-lg-6">
          <div class="app-card p-3 p-md-4 h-100">
            <h2 class="h5 app-page-title">{{ 'elections.wizard.steps.positions' | transloco }}</h2>
            @if (d.positions.length) {
              <ul class="mb-0">
                @for (p of d.positions; track p.id) {
                  <li>{{ positionName(p) }} <small class="text-body-secondary">· {{ 'elections.positions.seats' | transloco: { count: p.seats } }}</small></li>
                }
              </ul>
            } @else {
              <p class="text-body-secondary mb-0">{{ 'elections.wizard.noPositions' | transloco }}</p>
            }
          </div>
        </section>

        <section class="col-12 col-lg-6">
          <div class="app-card p-3 p-md-4 h-100">
            <h2 class="h5 app-page-title">{{ 'elections.wizard.steps.rules' | transloco }}</h2>
            @if (d.rules?.wholeInstitution) {
              <p class="mb-0">{{ 'elections.rules.whole' | transloco }}</p>
            } @else if (d.rules?.items?.length) {
              <ul class="mb-0">
                @for (r of d.rules!.items; track $index) {
                  <li>{{ describe(r) }}</li>
                }
              </ul>
              <p class="form-text mb-0 mt-2">{{ 'elections.rules.orHelp' | transloco }}</p>
            } @else {
              <p class="text-body-secondary mb-0">{{ 'elections.rules.none' | transloco }}</p>
            }
          </div>
        </section>

        <section class="col-12 col-lg-6">
          <div class="app-card p-3 p-md-4 h-100">
            <h2 class="h5 app-page-title">{{ 'elections.wizard.steps.committee' | transloco }}</h2>
            <span class="badge" [class]="(d.committeeCount ?? 0) >= (d.minCommittee ?? 3) ? 'text-bg-success' : 'text-bg-warning'" data-testid="committee">
              {{ 'elections.committee.count' | transloco: { count: d.committeeCount ?? 0, min: d.minCommittee ?? 3 } }}
            </span>
          </div>
        </section>
      </div>

      @if (confirmCancel()) {
        <app-modal [title]="'elections.detail.cancel' | transloco" (closed)="confirmCancel.set(false)">
          <form id="cancel-form" [formGroup]="cancelForm" (ngSubmit)="cancel()" novalidate>
            <p>{{ 'elections.detail.cancelConfirm' | transloco }}</p>
            <label class="form-label" for="cancelReason">{{ 'elections.detail.cancelReason' | transloco }}</label>
            <textarea id="cancelReason" class="form-control" rows="3" maxlength="500" formControlName="reason"></textarea>
          </form>
          <ng-container modal-footer>
            <button type="button" class="btn btn-outline-primary" [disabled]="busy()" (click)="confirmCancel.set(false)">{{ 'common.cancel' | transloco }}</button>
            <button type="submit" form="cancel-form" class="btn btn-danger" [disabled]="busy() || cancelForm.invalid">{{ 'elections.detail.cancel' | transloco }}</button>
          </ng-container>
        </app-modal>
      }
    }
  `,
})
export class ElectionDetailPage implements OnInit {
  private readonly api = inject(ElectionsApi);
  private readonly academic = inject(AcademicApi);
  private readonly auth = inject(AuthService);
  private readonly lang = inject(LanguageService);
  private readonly stepUp = inject(StepUpService);
  private readonly route = inject(ActivatedRoute);

  protected readonly dateFields = ['candidacyStartsAt', 'candidacyEndsAt', 'votingStartsAt', 'votingEndsAt'] as const;
  protected readonly e = signal<ElectionDetail | null>(null);
  protected readonly eligible = signal<number | null>(null);
  protected readonly overview = signal<AcademicOverview | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly confirmCancel = signal(false);
  /** Conditions non remplies listées par le serveur à l'ouverture (04 §4). */
  protected readonly conditions = signal<string[]>([]);
  protected readonly cancelForm = inject(FormBuilder).nonNullable.group({ reason: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(500)]] });
  protected readonly isAdmin = this.auth.hasRole('INSTITUTION_ADMIN');

  protected readonly title = computed(() => (this.e() ? electionTitle(this.e()!, this.lang.current()) : ''));
  protected readonly badge = computed(() => (this.e() ? statusClass(this.e()!.status) : ''));
  /** Même contrôle que le serveur à l'ouverture (qui reste juge) : dates, poste, règle, 3 membres. */
  protected readonly ready = computed(() => {
    const d = this.e();
    return !!d && !!d.candidacyStartsAt && !!d.candidacyEndsAt && d.positions.length > 0 && (!!d.rules?.wholeInstitution || (d.rules?.items.length ?? 0) > 0) && (d.committeeCount ?? 0) >= (d.minCommittee ?? 3) && (this.eligible() ?? 0) > 0;
  });
  protected readonly canCancel = computed(() => ['DRAFT', 'CANDIDACY_OPEN', 'CANDIDACY_CLOSED'].includes(this.e()?.status ?? ''));

  private id = '';

  async ngOnInit(): Promise<void> {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    try {
      const d = await this.api.get(this.id);
      this.e.set(d);
      const institutionId = d.institutionId;
      this.overview.set(await this.academic.overview(institutionId).catch(() => null));
      this.eligible.set(await this.api.eligibleCount(this.id).then((r) => r.count, () => null));
    } catch (err) {
      this.loadError.set(apiErrorKey(err));
    }
  }

  protected backArrow(): string {
    return this.lang.dir() === 'rtl' ? '→' : '←';
  }

  protected positionName(p: { title: string; titleAr: string | null }): string {
    return localName({ name: p.title, nameAr: p.titleAr }, this.lang.current());
  }

  /** Une règle en une phrase : critères séparés par « · » (ET). */
  protected describe(r: RuleItem): string {
    const o = this.overview();
    const n = (x?: { name: string; nameAr?: string | null }) => (x ? localName(x, this.lang.current()) : '');
    const g = o?.groups.find((x) => x.id === r.groupId);
    return [
      n(o?.faculties.find((x) => x.id === r.facultyId)),
      n(o?.programs.find((x) => x.id === (r.programId ?? g?.programId))),
      n(o?.levels.find((x) => x.id === r.levelId)),
      g ? g.name : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  private async act(action: () => Promise<ElectionDetail>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.conditions.set([]);
    try {
      this.e.set(await action());
    } catch (err) {
      if (!(err instanceof StepUpCancelled)) {
        this.error.set(apiErrorKey(err));
        const list = err instanceof HttpErrorResponse ? err.error?.conditions : null;
        if (Array.isArray(list)) this.conditions.set(list.map((c: string) => CONDITION_KEYS[c] ?? c));
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected open(): Promise<void> {
    return this.act(() => this.api.openCandidacy(this.id));
  }
  protected close(): Promise<void> {
    return this.act(() => this.api.closeCandidacy(this.id));
  }
  protected async cancel(): Promise<void> {
    if (this.cancelForm.invalid) return;
    const reason = this.cancelForm.getRawValue().reason.trim();
    this.confirmCancel.set(false);
    this.cancelForm.reset({ reason: '' });
    await this.act(() => this.stepUp.run(() => this.api.cancel(this.id, reason)));
  }
}
