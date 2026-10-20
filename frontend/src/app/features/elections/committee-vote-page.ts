import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, NgZone, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { localName } from '../../core/api/academic.api';
import { ElectionDetail, ElectionsApi } from '../../core/api/elections.api';
import { Turnout, VoterPreview, VotingApi } from '../../core/api/voting.api';
import { apiErrorKey } from '../../core/auth/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { StepUpCancelled, StepUpService } from '../../core/auth/step-up.service';
import { LanguageService } from '../../core/services/language.service';
import { AppModal } from '../../shared/components/app-modal/app-modal';
import { DATETIME, electionTitle, fromLocalInput, statusClass } from './election-ui';

type Dialog = 'close' | 'extend' | 'addVoter' | null;

/** Rafraîchissement automatique du suivi. Les chiffres des petites élections ne bougent de toute façon que par tranches de 15 min (D-31). */
const REFRESH_MS = 60_000;

/**
 * Suivi du vote par le comité (04 §4.3-4.4, §5.2, §10.1 ; 03 §5.4), conçu pour un téléphone (D-37) : des chiffres seulement
 * (D-02), puis les actions 🔐 — ouvrir, clôturer, prolonger une seule fois après une panne (D-33, D-38) et ajouter
 * exceptionnellement un électeur par son matricule (D-39). Le serveur reste juge de tout ; l'écran ne fait que le montrer.
 * L'administrateur d'institution voit le suivi et peut ouvrir / clôturer, mais seul le comité prolonge et ajoute.
 */
@Component({
  selector: 'app-committee-vote-page',
  imports: [ReactiveFormsModule, TranslocoPipe, RouterLink, DatePipe, AppModal],
  template: `
    <p class="mb-2"><a [routerLink]="['/admin/elections', electionId]">{{ backArrow() }} {{ 'committeeVote.back' | transloco }}</a></p>
    @if (loadError(); as key) {
      <div class="alert alert-danger" role="alert">{{ key | transloco }}</div>
    } @else if (!election()) {
      <p>{{ 'common.loading' | transloco }}</p>
    } @else {
      @let el = election()!;
      <header class="d-flex flex-wrap align-items-center gap-2 mb-3">
        <h1 class="h4 app-page-title mb-0">{{ 'committeeVote.title' | transloco }}</h1>
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
        <div class="alert alert-success" role="status" data-testid="notice">{{ n }}</div>
      }

      @if (el.status === 'CANDIDACY_CLOSED') {
        <section class="app-card p-3 mb-3">
          <p class="mb-2">{{ 'committeeVote.open.help' | transloco }}</p>
          <button type="button" class="btn btn-success w-100" [disabled]="busy()" (click)="openVoting()" data-testid="open">{{ 'committeeVote.open.button' | transloco }}</button>
        </section>
      } @else if (!tracked()) {
        <p class="text-body-secondary">{{ 'committeeVote.notAvailable' | transloco }}</p>
      }

      @if (turnout(); as t) {
        <section class="app-card p-3 mb-3" data-testid="tracking">
          <div class="d-flex align-items-center justify-content-between gap-2 mb-2">
            <h2 class="h5 app-page-title mb-0">{{ 'committeeVote.tracking.title' | transloco }}</h2>
            <button type="button" class="btn btn-outline-primary" [disabled]="refreshing()" (click)="refresh()" [attr.aria-label]="'committeeVote.tracking.refresh' | transloco" data-testid="refresh">↻</button>
          </div>
          <dl class="app-stats mb-2">
            <div><dt>{{ 'committeeVote.tracking.registered' | transloco }}</dt><dd data-testid="registered"><bdi dir="ltr">{{ t.registered }}</bdi></dd></div>
            <div><dt>{{ 'committeeVote.tracking.voted' | transloco }}</dt><dd data-testid="voted"><bdi dir="ltr">{{ t.voted }}</bdi></dd></div>
            <div><dt>{{ 'committeeVote.tracking.rate' | transloco }}</dt><dd data-testid="rate"><bdi dir="ltr">{{ t.rate }} %</bdi></dd></div>
          </dl>
          @if (t.sliced) {
            <p class="small text-body-secondary mb-1" data-testid="sliced">
              {{ 'committeeVote.tracking.asOf' | transloco: { time: (t.asOf | date: 'HH:mm') } }} · {{ 'committeeVote.tracking.sliced' | transloco }}
            </p>
          }
          @if (t.addedAfterFreeze > 0) {
            <p class="small mb-1" data-testid="added">{{ 'committeeVote.tracking.added' | transloco: { count: t.addedAfterFreeze } }}</p>
          }
          <p class="small text-body-secondary mb-0">{{ 'committeeVote.tracking.numbersOnly' | transloco }}</p>
        </section>

        <section class="app-card p-3 mb-3">
          <h2 class="h5 app-page-title">{{ 'committeeVote.window.title' | transloco }}</h2>
          <p class="mb-1">{{ 'committeeVote.window.ends' | transloco }} : <bdi dir="ltr" data-testid="ends">{{ t.votingEndsAt | date: 'yyyy-MM-dd HH:mm' }}</bdi></p>
          @if (t.extended) {
            <p class="mb-0 small" data-testid="extended"><span class="badge text-bg-warning">{{ 'committeeVote.window.extended' | transloco }}</span></p>
          }
        </section>

        @if (el.status === 'VOTING_OPEN') {
          <section class="app-card p-3 mb-3">
            <div class="d-grid gap-2">
              @if (isCommittee) {
                @if (t.extended) {
                  <p class="small text-body-secondary mb-0" data-testid="already">{{ 'committeeVote.extend.already' | transloco }}</p>
                } @else {
                  <button type="button" class="btn btn-outline-primary" [disabled]="busy()" (click)="show('extend')" data-testid="extend">{{ 'committeeVote.extend.button' | transloco }}</button>
                }
                <button type="button" class="btn btn-outline-primary" [disabled]="busy()" (click)="show('addVoter')" data-testid="add-voter">{{ 'committeeVote.addVoter.button' | transloco }}</button>
              }
              <button type="button" class="btn btn-outline-danger" [disabled]="busy()" (click)="show('close')" data-testid="close">{{ 'committeeVote.close.button' | transloco }}</button>
            </div>
          </section>
        }
      }

      @switch (dialog()) {
        @case ('close') {
          <app-modal [title]="'committeeVote.close.title' | transloco" (closed)="hide()">
            <p>{{ 'committeeVote.close.help' | transloco }}</p>
            @if (dialogError(); as key) {
              <div class="alert alert-danger" role="alert" data-testid="dialog-error">{{ key | transloco }}</div>
            }
            <form id="close-form" [formGroup]="closeForm" (ngSubmit)="closeVoting()">
              <label class="form-label" for="close-reason">{{ 'committeeVote.close.reason' | transloco }}</label>
              <textarea id="close-reason" class="form-control" rows="3" maxlength="500" formControlName="reason"></textarea>
            </form>
            <ng-container modal-footer>
              <button type="button" class="btn btn-outline-primary" [disabled]="busy()" (click)="hide()">{{ 'common.cancel' | transloco }}</button>
              <button type="submit" form="close-form" class="btn btn-danger" [disabled]="busy() || closeForm.invalid" data-testid="close-submit">{{ 'committeeVote.close.submit' | transloco }}</button>
            </ng-container>
          </app-modal>
        }
        @case ('extend') {
          <app-modal [title]="'committeeVote.extend.title' | transloco" (closed)="hide()">
            <p>{{ 'committeeVote.extend.help' | transloco }}</p>
            @if (dialogError(); as key) {
              <div class="alert alert-danger" role="alert" data-testid="dialog-error">{{ key | transloco }}</div>
            }
            <form id="extend-form" [formGroup]="extendForm" (ngSubmit)="extendVoting()" class="d-grid gap-3">
              @for (f of extendDates; track f) {
                <div>
                  <label class="form-label" [for]="'extend-' + f">{{ 'committeeVote.extend.' + f | transloco }}</label>
                  <input [id]="'extend-' + f" class="form-control" dir="ltr" inputmode="numeric" autocomplete="off" placeholder="2026-11-03 10:00" [formControlName]="f" />
                </div>
              }
              <p class="form-text mb-0">{{ 'committeeVote.extend.dateFormat' | transloco }}</p>
              <div>
                <label class="form-label" for="extend-reason">{{ 'committeeVote.extend.reason' | transloco }}</label>
                <textarea id="extend-reason" class="form-control" rows="3" maxlength="500" formControlName="reason"></textarea>
              </div>
            </form>
            <ng-container modal-footer>
              <button type="button" class="btn btn-outline-primary" [disabled]="busy()" (click)="hide()">{{ 'common.cancel' | transloco }}</button>
              <button type="submit" form="extend-form" class="btn btn-primary" [disabled]="busy() || extendForm.invalid" data-testid="extend-submit">{{ 'committeeVote.extend.submit' | transloco }}</button>
            </ng-container>
          </app-modal>
        }
        @case ('addVoter') {
          <app-modal [title]="'committeeVote.addVoter.title' | transloco" (closed)="hide()">
            <p>{{ 'committeeVote.addVoter.help' | transloco }}</p>
            @if (dialogError(); as key) {
              <div class="alert alert-danger" role="alert" data-testid="dialog-error">{{ key | transloco }}</div>
            }
            @if (!preview()) {
              <form id="lookup-form" [formGroup]="lookupForm" (ngSubmit)="lookup()">
                <label class="form-label" for="voter-number">{{ 'committeeVote.addVoter.studentNumber' | transloco }}</label>
                <input id="voter-number" class="form-control" dir="ltr" autocomplete="off" maxlength="64" formControlName="studentNumber" />
              </form>
            } @else {
              @let p = preview()!;
              <p class="mb-1">{{ 'committeeVote.addVoter.previewTitle' | transloco }}</p>
              <dl class="mb-3" data-testid="preview">
                <dt>{{ 'committeeVote.addVoter.faculty' | transloco }}</dt><dd>{{ name(p.faculty) }}</dd>
                <dt>{{ 'committeeVote.addVoter.program' | transloco }}</dt><dd>{{ name(p.program) }}</dd>
                <dt>{{ 'committeeVote.addVoter.level' | transloco }}</dt><dd>{{ name(p.level) }}</dd>
                <dt>{{ 'committeeVote.addVoter.group' | transloco }}</dt><dd>{{ p.group ?? ('committeeVote.addVoter.noGroup' | transloco) }}</dd>
              </dl>
              <form id="add-form" [formGroup]="addForm" (ngSubmit)="addVoter()">
                <label class="form-label" for="add-reason">{{ 'committeeVote.addVoter.reason' | transloco }}</label>
                <textarea id="add-reason" class="form-control" rows="3" maxlength="500" formControlName="reason"></textarea>
              </form>
            }
            <ng-container modal-footer>
              @if (!preview()) {
                <button type="button" class="btn btn-outline-primary" [disabled]="busy()" (click)="hide()">{{ 'common.cancel' | transloco }}</button>
                <button type="submit" form="lookup-form" class="btn btn-primary" [disabled]="busy() || lookupForm.invalid" data-testid="lookup-submit">{{ 'committeeVote.addVoter.check' | transloco }}</button>
              } @else {
                <button type="button" class="btn btn-outline-primary" [disabled]="busy()" (click)="resetLookup()">{{ 'committeeVote.addVoter.back' | transloco }}</button>
                <button type="submit" form="add-form" class="btn btn-primary" [disabled]="busy() || addForm.invalid" data-testid="add-submit">{{ 'committeeVote.addVoter.submit' | transloco }}</button>
              }
            </ng-container>
          </app-modal>
        }
      }
    }
  `,
})
export class CommitteeVotePage implements OnInit {
  private readonly elections = inject(ElectionsApi);
  private readonly voting = inject(VotingApi);
  private readonly auth = inject(AuthService);
  private readonly lang = inject(LanguageService);
  private readonly i18n = inject(TranslocoService);
  private readonly stepUp = inject(StepUpService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly electionId = this.route.snapshot.paramMap.get('id') ?? '';
  protected readonly extendDates = ['outageStart', 'outageEnd', 'newEnd'] as const;
  protected readonly isCommittee = this.auth.hasRole('ELECTION_COMMITTEE');

  protected readonly election = signal<ElectionDetail | null>(null);
  protected readonly turnout = signal<Turnout | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly dialogError = signal<string | null>(null);
  protected readonly conditions = signal<string[]>([]);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly refreshing = signal(false);
  protected readonly dialog = signal<Dialog>(null);
  protected readonly preview = signal<VoterPreview | null>(null);

  protected readonly title = computed(() => (this.election() ? electionTitle(this.election()!, this.lang.current()) : ''));
  /** Le suivi existe à partir de l'ouverture du vote : avant, il n'y a pas de liste électorale à compter. */
  protected readonly tracked = computed(() => ['VOTING_OPEN', 'VOTING_CLOSED', 'RESULTS_PUBLISHED'].includes(this.election()?.status ?? ''));
  protected readonly badge = computed(() => (this.election() ? statusClass(this.election()!.status) : ''));

  protected readonly closeForm = this.fb.group({ reason: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(500)]] });
  protected readonly extendForm = this.fb.group({
    outageStart: ['', [Validators.required, Validators.pattern(DATETIME)]],
    outageEnd: ['', [Validators.required, Validators.pattern(DATETIME)]],
    newEnd: ['', [Validators.required, Validators.pattern(DATETIME)]],
    reason: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(500)]],
  });
  protected readonly lookupForm = this.fb.group({ studentNumber: ['', [Validators.required, Validators.maxLength(64), Validators.pattern(/\S/)]] });
  protected readonly addForm = this.fb.group({ reason: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(500)]] });

  async ngOnInit(): Promise<void> {
    try {
      this.election.set(await this.elections.get(this.electionId));
    } catch (err) {
      this.loadError.set(apiErrorKey(err));
      return;
    }
    await this.refresh();
    // Hors de la zone : un minuteur permanent ne doit pas empêcher l'application d'être « stable » (tests, rendu côté serveur).
    const timer = this.zone.runOutsideAngular(() => setInterval(() => this.zone.run(() => void this.refresh()), REFRESH_MS));
    this.destroyRef.onDestroy(() => clearInterval(timer));
  }

  protected backArrow(): string {
    return this.lang.dir() === 'rtl' ? '→' : '←';
  }

  protected name(x: { name: string; nameAr: string | null }): string {
    return localName(x, this.lang.current());
  }

  protected async refresh(): Promise<void> {
    if (!this.tracked() || this.refreshing()) return;
    this.refreshing.set(true);
    try {
      this.turnout.set(await this.voting.turnout(this.electionId));
    } catch {
      /* le suivi se rafraîchit seul ; une erreur passagère ne masque pas les chiffres déjà affichés */
    } finally {
      this.refreshing.set(false);
    }
  }

  protected show(d: Exclude<Dialog, null>): void {
    this.error.set(null);
    this.notice.set(null);
    this.dialogError.set(null);
    this.dialog.set(d);
  }

  protected hide(): void {
    this.dialog.set(null);
    this.resetLookup();
    this.closeForm.reset();
    this.extendForm.reset();
  }

  protected resetLookup(): void {
    this.preview.set(null);
    this.dialogError.set(null);
    this.addForm.reset();
    this.lookupForm.reset();
  }

  /** Lance une action 🔐 ; la fenêtre du code 2FA s'ouvre si la 2FA est ancienne. Renvoie vrai si l'action a abouti. */
  private async act(run: () => Promise<unknown>, onError: (key: string) => void = (k) => this.error.set(k)): Promise<boolean> {
    if (this.busy()) return false;
    this.busy.set(true);
    this.error.set(null);
    this.dialogError.set(null);
    this.conditions.set([]);
    try {
      await this.stepUp.run(run);
      return true;
    } catch (err) {
      if (!(err instanceof StepUpCancelled)) {
        onError(apiErrorKey(err));
        const list = err instanceof HttpErrorResponse ? err.error?.conditions : null;
        if (Array.isArray(list)) this.conditions.set(list.map((c: string) => `committeeVote.conditions.${c}`));
        if (err instanceof HttpErrorResponse && err.status === 409) await this.reload(); // la page était périmée
      }
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private async reload(): Promise<void> {
    try {
      this.election.set(await this.elections.get(this.electionId));
    } catch {
      /* on garde l'affichage actuel */
    }
    await this.refresh();
  }

  protected async openVoting(): Promise<void> {
    if (await this.act(() => this.voting.openVoting(this.electionId))) {
      this.notice.set(this.i18n.translate('committeeVote.open.done'));
      await this.reload();
    }
  }

  protected async closeVoting(): Promise<void> {
    if (this.closeForm.invalid) return;
    const reason = this.closeForm.getRawValue().reason.trim();
    if (await this.act(() => this.voting.closeVoting(this.electionId, reason), (k) => this.dialogError.set(k))) {
      this.hide();
      this.notice.set(this.i18n.translate('committeeVote.close.done'));
      await this.reload();
    }
  }

  protected async extendVoting(): Promise<void> {
    if (this.extendForm.invalid) return;
    const v = this.extendForm.getRawValue();
    const outageStartedAt = fromLocalInput(v.outageStart);
    const outageEndedAt = fromLocalInput(v.outageEnd);
    const newEndsAt = fromLocalInput(v.newEnd);
    if (!outageStartedAt || !outageEndedAt || !newEndsAt) return;
    const body = { outageStartedAt, outageEndedAt, newEndsAt, reason: v.reason.trim() };
    // En cas de refus (422, 409), la fenêtre reste ouverte et remplie : le comité corrige sans tout ressaisir.
    if (await this.act(() => this.voting.extendVoting(this.electionId, body), (k) => this.dialogError.set(k))) {
      this.hide();
      this.notice.set(this.i18n.translate('committeeVote.extend.done', { date: v.newEnd }));
      await this.reload();
    }
  }

  protected async lookup(): Promise<void> {
    if (this.lookupForm.invalid) return;
    this.dialogError.set(null);
    await this.act(
      async () => this.preview.set(await this.voting.previewVoter(this.electionId, this.lookupForm.getRawValue().studentNumber.trim())),
      (key) => this.dialogError.set(key),
    );
  }

  protected async addVoter(): Promise<void> {
    if (this.addForm.invalid || !this.preview()) return;
    const studentNumber = this.lookupForm.getRawValue().studentNumber.trim();
    const reason = this.addForm.getRawValue().reason.trim();
    let registered = 0;
    const ok = await this.act(
      async () => (registered = (await this.voting.addVoter(this.electionId, studentNumber, reason)).registered),
      (key) => this.dialogError.set(key),
    );
    if (ok) {
      this.hide();
      this.notice.set(this.i18n.translate('committeeVote.addVoter.done', { count: registered }));
      await this.refresh();
    }
  }
}
