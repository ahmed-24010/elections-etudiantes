import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { FormBuilder, FormControl, FormRecord, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { localName } from '../../core/api/academic.api';
import { CandidatesApi } from '../../core/api/candidates.api';
import { Ballot, BallotCandidate, BallotPosition, VotingApi } from '../../core/api/voting.api';
import { apiErrorKey } from '../../core/auth/api-error';
import { LanguageService } from '../../core/services/language.service';
import { AppModal } from '../../shared/components/app-modal/app-modal';
import { Answer, chooseBlank, emptyAnswer, isAnswered, toChoices, toggleCandidate } from './ballot-logic';

type Screen = 'loading' | 'blocked' | 'position' | 'summary' | 'confirm' | 'done';

const messageOf = (err: unknown): string | undefined => {
  if (!(err instanceof HttpErrorResponse)) return undefined;
  const m = err.error?.message;
  return Array.isArray(m) ? m[0] : m;
};

/**
 * Vote (04 §6.1), conçu pour un téléphone (D-37) : un poste par étape, récapitulatif, confirmation avec ressaisie du mot
 * de passe (D-30), puis « Votre vote est enregistré ». Aucun reçu des choix : une fois le vote envoyé, les choix et le mot de
 * passe sont effacés de la mémoire de la page. L'ordre des candidats est celui tiré au hasard par le serveur (D-35).
 */
@Component({
  selector: 'app-vote-page',
  imports: [ReactiveFormsModule, TranslocoPipe, RouterLink, DatePipe, AppModal],
  template: `
    @switch (screen()) {
      @case ('loading') {
        <p>{{ 'common.loading' | transloco }}</p>
      }
      @case ('blocked') {
        <section class="app-card p-3 p-md-4">
          <h1 id="vote-heading" tabindex="-1" class="h4 app-page-title">{{ 'voting.title' | transloco }}</h1>
          <div class="alert alert-warning" role="alert" data-testid="vote-blocked">{{ blockedKey() | transloco }}</div>
          <a class="btn btn-primary" routerLink="/student/elections">{{ 'voting.done.back' | transloco }}</a>
        </section>
      }
      @case ('position') {
        @let p = position()!;
        <section class="app-card p-3 p-md-4" aria-live="polite">
          <p class="small text-body-secondary mb-1">{{ title() }}</p>
          <p class="small mb-1" data-testid="vote-progress">{{ 'voting.progress' | transloco: { current: index() + 1, total: total() } }}</p>
          <div class="progress mb-3" aria-hidden="true"><div class="progress-bar" [style.inline-size.%]="((index() + 1) / total()) * 100"></div></div>
          <h1 id="vote-heading" tabindex="-1" class="h4 app-page-title">{{ positionName(p) }}</h1>
          <fieldset class="border-0 p-0 m-0" aria-labelledby="vote-heading">
            <p class="mb-3" data-testid="vote-instruction">
              {{ (p.maxChoices > 1 ? 'voting.chooseUpTo' : 'voting.chooseOne') | transloco: { max: p.maxChoices } }}
              @if (p.maxChoices > 1) {
                <span class="text-body-secondary">· {{ 'voting.selectedCount' | transloco: { count: answerOf(p).ids.length, max: p.maxChoices } }}</span>
              }
            </p>
            <div class="app-ballot">
              @for (c of p.candidates; track c.id) {
                <div class="app-choice-wrap">
                  <label class="app-choice" [for]="'choice-' + c.id" [class.is-selected]="isSelected(p, c)" [attr.data-testid]="'candidate-' + c.id">
                    @if (p.maxChoices > 1) {
                      <input class="app-choice-input" type="checkbox" [id]="'choice-' + c.id" [name]="'pos-' + p.id" [checked]="isSelected(p, c)" [disabled]="!isSelected(p, c) && full(p)" (change)="pick(p, c)" />
                    } @else {
                      <input class="app-choice-input" type="radio" [id]="'choice-' + c.id" [name]="'pos-' + p.id" [checked]="isSelected(p, c)" (change)="pick(p, c)" />
                    }
                    <span class="app-avatar" aria-hidden="true">
                      @if (photos()[c.id]; as url) {
                        <img [src]="url" alt="" />
                      } @else {
                        {{ initial(c) }}
                      }
                    </span>
                    <span class="app-choice-body">
                      <span class="app-choice-name">{{ candidateName(c) }}</span>
                      @if (c.statement) {
                        <span class="small text-body-secondary app-clamp">{{ c.statement }}</span>
                      }
                    </span>
                  </label>
                  @if (c.hasProgram) {
                    <button type="button" class="btn btn-link btn-sm app-choice-program" [disabled]="busy()" (click)="viewProgram(c)">
                      {{ 'voting.program' | transloco }}<span class="visually-hidden"> : {{ candidateName(c) }}</span>
                    </button>
                  }
                </div>
              }
              @if (p.allowBlank) {
                <label class="app-choice" [for]="'blank-' + p.id" [class.is-selected]="answerOf(p).blank" data-testid="blank-choice">
                  @if (p.maxChoices > 1) {
                    <input class="app-choice-input" type="checkbox" [id]="'blank-' + p.id" [name]="'pos-' + p.id" [checked]="answerOf(p).blank" (change)="blank(p)" />
                  } @else {
                    <input class="app-choice-input" type="radio" [id]="'blank-' + p.id" [name]="'pos-' + p.id" [checked]="answerOf(p).blank" (change)="blank(p)" />
                  }
                  <span class="app-choice-body">
                    <span class="app-choice-name">{{ 'voting.blank' | transloco }}</span>
                    <span class="small text-body-secondary">{{ 'voting.blankHelp' | transloco }}</span>
                  </span>
                </label>
              }
            </div>
          </fieldset>
          <div class="app-ballot-nav">
            @if (index() > 0 && !editing()) {
              <button type="button" class="btn btn-outline-primary" (click)="previous()">{{ 'voting.previous' | transloco }}</button>
            }
            <button type="button" class="btn btn-primary" data-testid="vote-next" [disabled]="!isAnswered(p)" (click)="next()">
              {{ (editing() ? 'voting.backToSummary' : last() ? 'voting.review' : 'voting.next') | transloco }}
            </button>
          </div>
        </section>
      }
      @case ('summary') {
        <section class="app-card p-3 p-md-4">
          <h1 id="vote-heading" tabindex="-1" class="h4 app-page-title">{{ 'voting.summary.title' | transloco }}</h1>
          <p>{{ 'voting.summary.help' | transloco }}</p>
          <ul class="list-unstyled app-summary">
            @for (p of ballot()!.positions; track p.id; let i = $index) {
              <li class="app-summary-item">
                <div class="min-w-0">
                  <div class="fw-bold">{{ positionName(p) }}</div>
                  <div [attr.data-testid]="'summary-' + p.id">
                    @if (answerOf(p).blank) {
                      {{ 'voting.blank' | transloco }}
                    } @else {
                      {{ chosenNames(p) }}
                    }
                  </div>
                </div>
                <button type="button" class="btn btn-outline-primary btn-sm" (click)="edit(i)">
                  {{ 'voting.summary.modify' | transloco }}<span class="visually-hidden"> : {{ positionName(p) }}</span>
                </button>
              </li>
            }
          </ul>
          <div class="app-ballot-nav">
            <button type="button" class="btn btn-outline-primary" (click)="previous()">{{ 'voting.previous' | transloco }}</button>
            <button type="button" class="btn btn-primary" data-testid="vote-continue" (click)="go('confirm')">{{ 'voting.summary.continue' | transloco }}</button>
          </div>
        </section>
      }
      @case ('confirm') {
        <section class="app-card p-3 p-md-4">
          <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
            <h1 id="vote-heading" tabindex="-1" class="h4 app-page-title">{{ 'voting.confirm.title' | transloco }}</h1>
            <div class="alert alert-warning" role="note" data-testid="vote-final">{{ 'voting.confirm.final' | transloco }}</div>
            <label class="form-label" for="vote-password">{{ 'voting.confirm.password' | transloco }}</label>
            <input id="vote-password" class="form-control" type="password" formControlName="password" autocomplete="current-password" [attr.aria-invalid]="error() ? 'true' : null" />
            <div class="form-text mb-3">{{ 'voting.confirm.passwordHelp' | transloco }}</div>
            @if (error(); as key) {
              <div class="alert alert-danger" role="alert" data-testid="vote-error">{{ key | transloco }}</div>
            }
            <div class="app-ballot-nav">
              <button type="button" class="btn btn-outline-primary" [disabled]="busy()" (click)="go('summary')">{{ 'voting.confirm.back' | transloco }}</button>
              <button type="submit" class="btn btn-success" data-testid="vote-submit" [disabled]="busy() || form.invalid">
                {{ (busy() ? 'voting.confirm.sending' : 'voting.confirm.submit') | transloco }}
              </button>
            </div>
          </form>
        </section>
      }
      @case ('done') {
        <section class="app-card p-4 text-center" role="status" aria-live="polite" data-testid="vote-done">
          <div class="app-done-icon" aria-hidden="true">✓</div>
          <h1 id="vote-heading" tabindex="-1" class="h3 app-page-title">{{ (alreadyVoted() ? 'voting.done.already' : 'voting.done.title') | transloco }}</h1>
          @if (votedAt(); as at) {
            <p>{{ 'voting.done.at' | transloco }} <bdi dir="ltr">{{ at | date: 'yyyy-MM-dd HH:mm' }}</bdi></p>
          }
          <p class="text-body-secondary">{{ 'voting.done.secret' | transloco }}</p>
          <a class="btn btn-primary" routerLink="/student/elections">{{ 'voting.done.back' | transloco }}</a>
        </section>
      }
    }

    @if (viewer(); as v) {
      <app-modal [title]="'voting.program' | transloco" (closed)="closeViewer()">
        @if (v.image) {
          <img class="img-fluid border rounded" [src]="v.url" [alt]="'voting.program' | transloco" />
        } @else {
          <iframe class="app-doc-frame border rounded" [src]="v.url" [title]="'voting.program' | transloco"></iframe>
        }
      </app-modal>
    }
  `,
})
export class VotePage implements OnInit {
  private readonly voting = inject(VotingApi);
  private readonly candidatesApi = inject(CandidatesApi);
  private readonly lang = inject(LanguageService);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly electionId = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';

  protected readonly screen = signal<Screen>('loading');
  protected readonly ballot = signal<Ballot | null>(null);
  protected readonly index = signal(0);
  /** Vrai quand l'électeur vient du récapitulatif pour modifier un poste : « Suivant » y retourne. */
  protected readonly editing = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly blockedKey = signal('errors.generic');
  protected readonly alreadyVoted = signal(false);
  protected readonly votedAt = signal<string | null>(null);
  protected readonly photos = signal<Record<string, string>>({});
  protected readonly viewer = signal<{ url: SafeResourceUrl; image: boolean } | null>(null);

  /** Une réponse par poste. */
  protected readonly answers = new FormRecord<FormControl<Answer>>({});
  protected readonly form = inject(FormBuilder).nonNullable.group({ password: ['', [Validators.required]] });

  protected readonly total = computed(() => this.ballot()?.positions.length ?? 0);
  protected readonly position = computed<BallotPosition | null>(() => this.ballot()?.positions[this.index()] ?? null);
  protected readonly last = computed(() => this.index() === this.total() - 1);
  protected readonly title = computed(() => {
    const b = this.ballot();
    return b ? (this.lang.current() === 'ar' && b.titleAr ? b.titleAr : b.title) : '';
  });

  private objectUrls: string[] = [];
  private programUrl: string | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.objectUrls.forEach((u) => URL.revokeObjectURL(u));
      if (this.programUrl) URL.revokeObjectURL(this.programUrl);
    });
  }

  async ngOnInit(): Promise<void> {
    try {
      const ballot = await this.voting.ballot(this.electionId);
      for (const p of ballot.positions) this.answers.addControl(p.id, new FormControl(emptyAnswer(), { nonNullable: true }));
      this.ballot.set(ballot);
      this.show(0);
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 409 && messageOf(err) === 'ALREADY_VOTED') {
        await this.finish(true);
        return;
      }
      this.blockedKey.set(apiErrorKey(err));
      this.go('blocked');
    }
  }

  // ------------------------------------------------------------------ navigation

  /** Change d'écran et place le focus sur son titre (lecteurs d'écran, clavier). */
  protected go(screen: Screen): void {
    this.screen.set(screen);
    this.error.set(null);
    setTimeout(() => document.getElementById('vote-heading')?.focus());
  }

  private show(index: number): void {
    this.index.set(index);
    this.go('position');
    void this.loadPhotos(this.ballot()!.positions[index]);
  }

  protected next(): void {
    if (this.editing()) {
      this.editing.set(false);
      this.go('summary');
    } else if (this.last()) this.go('summary');
    else this.show(this.index() + 1);
  }

  protected previous(): void {
    if (this.screen() === 'summary') this.show(this.total() - 1);
    else this.show(this.index() - 1);
  }

  protected edit(index: number): void {
    this.editing.set(true);
    this.show(index);
  }

  // ------------------------------------------------------------------ choix

  protected answerOf(p: BallotPosition): Answer {
    return this.answers.controls[p.id]?.value ?? emptyAnswer();
  }
  protected isSelected(p: BallotPosition, c: BallotCandidate): boolean {
    return this.answerOf(p).ids.includes(c.id);
  }
  protected full(p: BallotPosition): boolean {
    return this.answerOf(p).ids.length >= p.maxChoices;
  }
  protected isAnswered(p: BallotPosition): boolean {
    return isAnswered(this.answerOf(p), p);
  }
  protected pick(p: BallotPosition, c: BallotCandidate): void {
    this.answers.controls[p.id].setValue(toggleCandidate(this.answerOf(p), c.id, p.maxChoices));
  }
  /** Vote blanc : exclusif. Sur un poste à cases à cocher, un second clic le décoche. */
  protected blank(p: BallotPosition): void {
    this.answers.controls[p.id].setValue(p.maxChoices > 1 && this.answerOf(p).blank ? emptyAnswer() : chooseBlank());
  }

  /** Noms des candidats choisis pour ce poste, séparés selon la langue (virgule arabe en arabe). */
  protected chosenNames(p: BallotPosition): string {
    const a = this.answerOf(p);
    return p.candidates.filter((c) => a.ids.includes(c.id)).map((c) => this.candidateName(c)).join(this.lang.current() === 'ar' ? '، ' : ', ');
  }

  // ------------------------------------------------------------------ affichage

  protected positionName(p: { title: string; titleAr: string | null }): string {
    return localName({ name: p.title, nameAr: p.titleAr }, this.lang.current());
  }
  protected candidateName(c: BallotCandidate): string {
    return this.lang.current() === 'ar' && c.fullNameAr ? c.fullNameAr : `${c.firstName} ${c.lastName}`;
  }
  protected initial(c: BallotCandidate): string {
    return (this.candidateName(c).trim()[0] ?? '?').toUpperCase();
  }

  /** Photos chargées à la demande, poste par poste (pages légères, D-37) ; un échec laisse simplement l'initiale. */
  private async loadPhotos(p: BallotPosition): Promise<void> {
    for (const c of p.candidates) {
      if (!c.hasPhoto || this.photos()[c.id]) continue;
      try {
        const url = URL.createObjectURL(await this.candidatesApi.openFile(this.electionId, c.id, 'photo'));
        this.objectUrls.push(url);
        this.photos.update((m) => ({ ...m, [c.id]: url }));
      } catch {
        /* l'initiale reste affichée */
      }
    }
  }

  protected async viewProgram(c: BallotCandidate): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const blob = await this.candidatesApi.openFile(this.electionId, c.id, 'program');
      this.closeViewer();
      this.programUrl = URL.createObjectURL(blob);
      this.viewer.set({ url: this.sanitizer.bypassSecurityTrustResourceUrl(this.programUrl), image: blob.type.startsWith('image/') });
    } catch {
      /* le programme est facultatif : le vote reste possible */
    } finally {
      this.busy.set(false);
    }
  }

  protected closeViewer(): void {
    this.viewer.set(null);
    if (this.programUrl) URL.revokeObjectURL(this.programUrl);
    this.programUrl = null;
  }

  // ------------------------------------------------------------------ envoi

  /** Le bouton est désactivé pendant l'envoi ; la vraie protection contre le double envoi est en base (04 §6.3). */
  protected async submit(): Promise<void> {
    if (this.busy() || this.form.invalid) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.voting.cast(this.electionId, toChoices(this.ballot()!.positions, this.answers.getRawValue()), this.form.controls.password.value);
      await this.finish(false);
    } catch (err) {
      await this.onCastError(err);
    } finally {
      this.busy.set(false);
    }
  }

  private async onCastError(err: unknown): Promise<void> {
    const status = err instanceof HttpErrorResponse ? err.status : 0;
    const message = messageOf(err);
    if (status === 409 && message === 'ALREADY_VOTED') return this.finish(true); // 04 §6.3 : « Votre vote a déjà été enregistré »
    if ((status === 409 && message === 'ELECTION_NOT_OPEN') || (status === 403 && message === 'NOT_ON_VOTER_ROLL')) {
      this.blockedKey.set(apiErrorKey(err));
      this.clearSecrets();
      return this.go('blocked');
    }
    if (status === 401 && message === 'INVALID_PASSWORD') {
      this.form.reset({ password: '' });
      this.error.set('errors.invalidPassword');
      return;
    }
    if (status === 429 || status === 422 || status === 401 || status === 403) {
      this.error.set(apiErrorKey(err));
      return;
    }
    // Panne ou délai dépassé : le vote a peut-être été enregistré. On le vérifie avant de proposer de réessayer.
    try {
      if ((await this.voting.status(this.electionId)).state === 'VOTED') return this.finish(false);
    } catch {
      /* statut inconnu : message prudent ci-dessous */
    }
    this.error.set('errors.voteUncertain');
  }

  /** Écran final. Aucun reçu : les choix et le mot de passe sont effacés de la page. */
  private async finish(already: boolean): Promise<void> {
    this.alreadyVoted.set(already);
    this.clearSecrets();
    try {
      this.votedAt.set((await this.voting.status(this.electionId)).votedAt);
    } catch {
      this.votedAt.set(already ? null : new Date().toISOString());
    }
    this.go('done');
  }

  private clearSecrets(): void {
    for (const control of Object.values(this.answers.controls)) control.setValue(emptyAnswer());
    this.form.reset({ password: '' });
  }
}
