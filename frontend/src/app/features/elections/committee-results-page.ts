import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, NgZone, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ElectionDetail, ElectionsApi } from '../../core/api/elections.api';
import { ReportLang, ReportSummary, ReportsApi } from '../../core/api/reports.api';
import { ResultPerson, ResultsApi, ResultsView, UrnCheck } from '../../core/api/results.api';
import { apiErrorKey } from '../../core/auth/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { StepUpCancelled, StepUpService } from '../../core/auth/step-up.service';
import { LanguageService } from '../../core/services/language.service';
import { AppModal } from '../../shared/components/app-modal/app-modal';
import { DATETIME, electionTitle, fromLocalInput, statusClass, toLocalInput } from './election-ui';

/**
 * Résultats côté personnel (04 §4.5, §8, §9 ; D-41 à D-45), mobile d'abord (D-37) : contrôle d'intégrité, égalités, publication par
 * le comité seulement (🔐), procès-verbal téléchargé dans la langue du site, régénération (comité et administrateur d'institution)
 * et « Vérifier l'urne ». Le serveur reste juge de tout ; l'écran ne fait que le montrer.
 */
@Component({
  selector: 'app-committee-results-page',
  imports: [TranslocoPipe, RouterLink, DatePipe, AppModal, ReactiveFormsModule],
  template: `
    <p class="mb-2"><a [routerLink]="['/admin/elections', electionId]">{{ backArrow() }} {{ 'committeeResults.back' | transloco }}</a></p>
    @if (loadError(); as key) {
      <div class="alert alert-danger" role="alert">{{ key | transloco }}</div>
    } @else if (!election()) {
      <p>{{ 'common.loading' | transloco }}</p>
    } @else {
      @let el = election()!;
      <header class="d-flex flex-wrap align-items-center gap-2 mb-1">
        <h1 class="h4 app-page-title mb-0">{{ 'committeeResults.title' | transloco }}</h1>
        <span class="badge" [class]="badge()" data-testid="status-badge">{{ 'elections.status.' + el.status | transloco }}</span>
      </header>
      <p class="text-body-secondary">{{ title() }}</p>

      @if (error(); as key) {
        <div class="alert alert-danger" role="alert" data-testid="error">{{ key | transloco }}</div>
        @if (conditions().length) {
          <ul class="small" data-testid="conditions">
            @for (c of conditions(); track c) {
              <li>{{ c | transloco }}</li>
            }
          </ul>
        }
      }
      @if (notice(); as n) {
        <div class="alert alert-success" role="status" data-testid="notice">{{ n | transloco }}</div>
      }

      @if (!available()) {
        <p class="text-body-secondary" data-testid="not-available">{{ 'committeeResults.notAvailable' | transloco }}</p>
      }

      @if (results(); as r) {
        <section class="app-card p-3 mb-3" data-testid="summary">
          <h2 class="h5 app-page-title">{{ 'committeeResults.participation' | transloco }}</h2>
          <dl class="app-stats mb-2">
            <div><dt>{{ 'committeeVote.tracking.registered' | transloco }}</dt><dd data-testid="registered"><bdi dir="ltr">{{ r.registered }}</bdi></dd></div>
            <div><dt>{{ 'committeeVote.tracking.voted' | transloco }}</dt><dd data-testid="voters"><bdi dir="ltr">{{ r.voters }}</bdi></dd></div>
            <div><dt>{{ 'committeeVote.tracking.rate' | transloco }}</dt><dd data-testid="rate"><bdi dir="ltr">{{ r.participationRate }} %</bdi></dd></div>
          </dl>
          @if (r.integrityOk === true) {
            <p class="small mb-0 text-success" data-testid="integrity-ok">{{ 'committeeResults.integrityOk' | transloco }}</p>
          } @else if (r.integrityOk === false) {
            <div class="alert alert-danger mb-0" role="alert" data-testid="integrity-failed">{{ 'committeeResults.integrityFailed' | transloco }}</div>
          }
        </section>

        @if (ties().length) {
          <section class="alert alert-warning" role="status" data-testid="ties">
            <strong>{{ 'committeeResults.tieTitle' | transloco }}</strong>
            <ul class="mb-1">
              @for (p of ties(); track p.positionId) {
                <li>{{ positionTitle(p) }}</li>
              }
            </ul>
            <span class="small d-block mb-2">{{ 'committeeResults.tieHelp' | transloco }}</span>
            @if (el.secondRound; as next) {
              <a class="btn btn-warning w-100" [routerLink]="['/admin/elections', next.id]" data-testid="second-round-link">{{ 'committeeResults.secondRound.view' | transloco: { round: next.round } }}</a>
            } @else if (isCommittee && el.status === 'RESULTS_PUBLISHED') {
              <button type="button" class="btn btn-warning w-100" [disabled]="busy()" (click)="openSecondRound()" data-testid="second-round">{{ 'committeeResults.secondRound.create' | transloco }}</button>
            } @else if (el.status === 'RESULTS_PUBLISHED') {
              <span class="small text-body-secondary" data-testid="second-round-committee-only">{{ 'committeeResults.secondRound.committeeOnly' | transloco }}</span>
            }
          </section>
        }

        <section class="mb-3" data-testid="positions">
          @for (p of r.positions; track p.positionId) {
            <article class="app-card p-3 mb-2" [attr.data-testid]="'position-' + p.positionId">
              <h3 class="h6 mb-1">{{ positionTitle(p) }}</h3>
              @if (p.detailPublished) {
                @for (c of p.candidates ?? []; track c.candidateId) {
                  <div class="d-flex justify-content-between gap-2 py-1">
                    <span [class.fw-bold]="c.isWinner">{{ person(c) }}@if (c.isWinner) { <span class="badge text-bg-primary ms-1">{{ 'committeeResults.elected' | transloco }}</span> }</span>
                    <bdi dir="ltr">{{ c.votes }}</bdi>
                  </div>
                }
                <div class="d-flex justify-content-between gap-2 text-body-secondary"><span>{{ 'committeeResults.blank' | transloco }}</span><bdi dir="ltr">{{ p.blank ?? 0 }}</bdi></div>
              } @else {
                <p class="small text-body-secondary mb-1" data-testid="withheld">{{ 'committeeResults.withheld' | transloco }}</p>
                <p class="mb-0 fw-bold">{{ p.winners.length ? names(p.winners) : '—' }}</p>
              }
              @if (p.tie) {
                <span class="badge text-bg-warning mt-1" data-testid="tie-badge">{{ 'committeeResults.tieBadge' | transloco }}</span>
              }
            </article>
          }
        </section>
      }

      @if (canPublish()) {
        <section class="app-card p-3 mb-3">
          <p class="mb-2">{{ 'committeeResults.publishHelp' | transloco }}</p>
          <button type="button" class="btn btn-success w-100" [disabled]="busy()" (click)="confirmPublish.set(true)" data-testid="publish">{{ 'committeeResults.publish' | transloco }}</button>
        </section>
      }

      @if (el.status === 'RESULTS_PUBLISHED') {
        <section class="app-card p-3 mb-3" data-testid="reports">
          <h2 class="h5 app-page-title">{{ 'committeeResults.reportTitle' | transloco }}</h2>
          @if (latest(); as rep) {
            <p class="small mb-2">{{ 'committeeResults.reportCode' | transloco }} : <code class="app-code" dir="ltr" data-testid="report-code">{{ rep.verificationCode }}</code> · {{ rep.generatedAt | date: 'yyyy-MM-dd HH:mm' }}</p>
            @if (rep.signedAt) {
              <p class="small text-success" data-testid="signed">{{ 'committeeResults.signedOn' | transloco: { date: (rep.signedAt | date: 'yyyy-MM-dd HH:mm') } }}</p>
            } @else if (isCommittee) {
              <button type="button" class="btn btn-success w-100 mb-2" [disabled]="busy()" (click)="markSigned()" data-testid="sign">{{ 'committeeResults.markSigned' | transloco }}</button>
              <p class="form-text mt-0">{{ 'committeeResults.markSignedHelp' | transloco }}</p>
            } @else {
              <p class="small text-warning-emphasis" data-testid="not-signed">{{ 'committeeResults.notSigned' | transloco }}</p>
            }
            <div class="d-grid gap-2">
              <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="download(siteLang())" data-testid="download">{{ 'committeeResults.download.' + siteLang() | transloco }}</button>
              <button type="button" class="btn btn-outline-primary" [disabled]="busy()" (click)="download(otherLang())" data-testid="download-other">{{ 'committeeResults.download.' + otherLang() | transloco }}</button>
            </div>
          } @else {
            <p class="text-body-secondary" data-testid="no-report">{{ 'committeeResults.noReport' | transloco }}</p>
          }
          <button type="button" class="btn btn-outline-secondary w-100 mt-2" [disabled]="busy()" (click)="regenerate()" data-testid="regenerate">{{ (latest() ? 'committeeResults.regenerate' : 'committeeResults.generate') | transloco }}</button>
        </section>
      }

      @if (available()) {
        <section class="app-card p-3 mb-3" data-testid="urn">
          <h2 class="h5 app-page-title">{{ 'committeeResults.urnTitle' | transloco }}</h2>
          <p class="small text-body-secondary">{{ 'committeeResults.urnHelp' | transloco }}</p>
          <button type="button" class="btn btn-outline-primary w-100" [disabled]="busy()" (click)="verifyUrn()" data-testid="verify">{{ 'committeeResults.urnVerify' | transloco }}</button>
          @if (urn(); as u) {
            @if (u.matchesTally && u.matchesReport !== false) {
              <div class="alert alert-success mt-2 mb-0" role="status" data-testid="urn-identical">
                {{ (u.matchesReport === true ? 'committeeResults.urnIdenticalReport' : 'committeeResults.urnIdenticalTally') | transloco }}
              </div>
            } @else {
              <div class="alert alert-danger mt-2 mb-0" role="alert" data-testid="urn-different">{{ 'committeeResults.urnDifferent' | transloco }}</div>
            }
            <dl class="small mt-2 mb-0">
              <dt>{{ 'committeeResults.urnComputed' | transloco }}</dt><dd><code class="app-code app-digest" dir="ltr" data-testid="digest-computed">{{ u.computedDigest }}</code></dd>
              <dt>{{ 'committeeResults.urnTally' | transloco }}</dt><dd><code class="app-code app-digest" dir="ltr">{{ u.tallyDigest }}</code></dd>
              <dt>{{ 'committeeResults.urnReport' | transloco }}</dt><dd><code class="app-code app-digest" dir="ltr" data-testid="digest-report">{{ u.reportDigest ?? '—' }}</code></dd>
            </dl>
          }
        </section>
      }

      @if (secondRoundOpen()) {
        <app-modal [title]="'committeeResults.secondRound.create' | transloco" (closed)="secondRoundOpen.set(false)">
          <p>{{ 'committeeResults.secondRound.help' | transloco }}</p>
          @if (error(); as key) {
            <div class="alert alert-danger" role="alert" data-testid="dialog-error">{{ key | transloco }}</div>
          }
          <form id="second-round-form" [formGroup]="secondRoundForm" (ngSubmit)="createSecondRound()" class="d-grid gap-3">
            @for (f of secondRoundDates; track f) {
              <div>
                <label class="form-label" [for]="'sr-' + f">{{ 'committeeResults.secondRound.' + f | transloco }}</label>
                <input [id]="'sr-' + f" class="form-control" dir="ltr" inputmode="numeric" autocomplete="off" [formControlName]="f" />
              </div>
            }
            <p class="form-text mb-0">{{ 'committeeVote.extend.dateFormat' | transloco }}</p>
          </form>
          <ng-container modal-footer>
            <button type="button" class="btn btn-outline-primary" [disabled]="busy()" (click)="secondRoundOpen.set(false)">{{ 'common.cancel' | transloco }}</button>
            <button type="submit" form="second-round-form" class="btn btn-warning" [disabled]="busy() || secondRoundForm.invalid" data-testid="second-round-confirm">{{ 'committeeResults.secondRound.confirm' | transloco }}</button>
          </ng-container>
        </app-modal>
      }

      @if (confirmPublish()) {
        <app-modal [title]="'committeeResults.publish' | transloco" (closed)="confirmPublish.set(false)">
          <p>{{ 'committeeResults.publishConfirm' | transloco }}</p>
          <ng-container modal-footer>
            <button type="button" class="btn btn-outline-primary" [disabled]="busy()" (click)="confirmPublish.set(false)">{{ 'common.cancel' | transloco }}</button>
            <button type="button" class="btn btn-success" [disabled]="busy()" (click)="publish()" data-testid="publish-confirm">{{ 'committeeResults.publish' | transloco }}</button>
          </ng-container>
        </app-modal>
      }
    }
  `,
})
export class CommitteeResultsPage implements OnInit {
  private readonly elections = inject(ElectionsApi);
  private readonly resultsApi = inject(ResultsApi);
  private readonly reportsApi = inject(ReportsApi);
  private readonly auth = inject(AuthService);
  private readonly lang = inject(LanguageService);
  private readonly stepUp = inject(StepUpService);
  private readonly route = inject(ActivatedRoute);
  private readonly zone = inject(NgZone);

  protected readonly electionId = this.route.snapshot.paramMap.get('id') ?? '';
  /** Seul le comité publie (D-41) ; l'administrateur d'institution lit, télécharge, regénère et vérifie. */
  protected readonly isCommittee = this.auth.hasRole('ELECTION_COMMITTEE');

  protected readonly election = signal<ElectionDetail | null>(null);
  protected readonly results = signal<ResultsView | null>(null);
  protected readonly reports = signal<ReportSummary[]>([]);
  protected readonly urn = signal<UrnCheck | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly conditions = signal<string[]>([]);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly confirmPublish = signal(false);
  protected readonly secondRoundOpen = signal(false);
  protected readonly secondRoundDates = ['votingStartsAt', 'votingEndsAt'] as const;
  protected readonly secondRoundForm = inject(FormBuilder).nonNullable.group({
    votingStartsAt: ['', [Validators.required, Validators.pattern(DATETIME)]],
    votingEndsAt: ['', [Validators.required, Validators.pattern(DATETIME)]],
  });

  protected readonly title = computed(() => (this.election() ? electionTitle(this.election()!, this.lang.current()) : ''));
  protected readonly badge = computed(() => (this.election() ? statusClass(this.election()!.status) : ''));
  /** Les résultats existent à partir de la clôture du vote (04 §7.2) : avant, le serveur refuse pour tous les rôles. */
  protected readonly available = computed(() => ['VOTING_CLOSED', 'RESULTS_PUBLISHED'].includes(this.election()?.status ?? ''));
  protected readonly canPublish = computed(() => this.isCommittee && this.election()?.status === 'VOTING_CLOSED' && this.results() !== null);
  protected readonly ties = computed(() => (this.results()?.positions ?? []).filter((p) => p.tie));
  protected readonly latest = computed(() => this.reports().find((r) => !r.revoked) ?? null);
  protected readonly siteLang = computed<ReportLang>(() => (this.lang.current() === 'ar' ? 'ar' : 'fr'));
  protected readonly otherLang = computed<ReportLang>(() => (this.siteLang() === 'ar' ? 'fr' : 'ar'));

  async ngOnInit(): Promise<void> {
    try {
      this.election.set(await this.elections.get(this.electionId));
    } catch (err) {
      this.loadError.set(apiErrorKey(err));
      return;
    }
    await this.refresh();
  }

  protected backArrow(): string {
    return this.lang.dir() === 'rtl' ? '→' : '←';
  }
  protected positionTitle(p: { title: string; titleAr: string | null }): string {
    return this.lang.current() === 'ar' && p.titleAr ? p.titleAr : p.title;
  }
  protected person(p: ResultPerson): string {
    return this.lang.current() === 'ar' && p.fullNameAr ? p.fullNameAr : `${p.firstName} ${p.lastName}`;
  }
  protected names(list: ResultPerson[]): string {
    return list.map((p) => this.person(p)).join(this.lang.current() === 'ar' ? '، ' : ', ');
  }

  private async refresh(): Promise<void> {
    if (!this.available()) return;
    try {
      this.results.set(await this.resultsApi.get(this.electionId));
      if (this.election()?.status === 'RESULTS_PUBLISHED') this.reports.set(await this.reportsApi.list(this.electionId));
    } catch (err) {
      this.error.set(apiErrorKey(err));
    }
  }

  /** Une action du serveur, avec la fenêtre du code 2FA si elle est 🔐. Renvoie vrai si elle a abouti. */
  private async act(run: () => Promise<unknown>, sensitive = false): Promise<boolean> {
    if (this.busy()) return false;
    this.busy.set(true);
    this.error.set(null);
    this.conditions.set([]);
    this.notice.set(null);
    try {
      await (sensitive ? this.stepUp.run(run) : run());
      return true;
    } catch (err) {
      if (!(err instanceof StepUpCancelled)) {
        this.error.set(apiErrorKey(err));
        const list = err instanceof HttpErrorResponse ? err.error?.conditions : null;
        if (Array.isArray(list)) this.conditions.set(list.map((c: string) => `committeeResults.conditions.${c}`));
      }
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  protected async publish(): Promise<void> {
    this.confirmPublish.set(false);
    let report: 'generated' | 'failed' = 'generated';
    const ok = await this.act(async () => (report = (await this.resultsApi.publish(this.electionId)).report), true);
    if (!ok) return;
    this.notice.set(report === 'generated' ? 'committeeResults.published' : 'committeeResults.publishedNoReport');
    this.election.set(await this.elections.get(this.electionId));
    await this.refresh();
  }

  /** Une journée de vote le lendemain : de 8 h à 18 h (heure locale), modifiable ; un seul clic suffit pour confirmer. */
  protected openSecondRound(): void {
    const day = (offsetDays: number, hour: number) => {
      const d = new Date();
      d.setDate(d.getDate() + offsetDays);
      d.setHours(hour, 0, 0, 0);
      return toLocalInput(d.toISOString());
    };
    this.secondRoundForm.setValue({ votingStartsAt: day(1, 8), votingEndsAt: day(1, 18) });
    this.error.set(null);
    this.secondRoundOpen.set(true);
  }

  protected async createSecondRound(): Promise<void> {
    if (this.secondRoundForm.invalid) return;
    const v = this.secondRoundForm.getRawValue();
    const votingStartsAt = fromLocalInput(v.votingStartsAt);
    const votingEndsAt = fromLocalInput(v.votingEndsAt);
    if (!votingStartsAt || !votingEndsAt) return;
    this.secondRoundOpen.set(false);
    if (await this.act(() => this.elections.createSecondRound(this.electionId, { votingStartsAt, votingEndsAt }), true)) {
      this.notice.set('committeeResults.secondRound.created');
      this.election.set(await this.elections.get(this.electionId));
    } else {
      this.secondRoundOpen.set(true); // refus (dates, second tour déjà créé…) : la fenêtre reste ouverte et remplie
    }
  }

  protected async markSigned(): Promise<void> {
    if (await this.act(() => this.reportsApi.markSigned(this.electionId), true)) {
      this.notice.set('committeeResults.signed');
      this.reports.set(await this.reportsApi.list(this.electionId));
    }
  }

  protected async regenerate(): Promise<void> {
    if (await this.act(() => this.reportsApi.generate(this.electionId), true)) {
      this.notice.set('committeeResults.regenerated');
      this.reports.set(await this.reportsApi.list(this.electionId));
      this.urn.set(null);
    }
  }

  protected async download(lang: ReportLang): Promise<void> {
    let blob: Blob | null = null;
    if (!(await this.act(async () => (blob = await this.reportsApi.download(this.electionId, lang))))) return;
    const code = this.latest()?.verificationCode ?? 'PV';
    const url = URL.createObjectURL(blob as unknown as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${code}-${lang}.pdf`;
    a.click();
    // Hors de la zone : un minuteur en attente ne doit pas empêcher l'application d'être « stable ».
    this.zone.runOutsideAngular(() => setTimeout(() => URL.revokeObjectURL(url), 10_000));
  }

  protected async verifyUrn(): Promise<void> {
    this.urn.set(null);
    await this.act(async () => this.urn.set(await this.resultsApi.verifyUrn(this.electionId)));
  }
}
