import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { localName } from '../../core/api/academic.api';
import { CandidatesApi, FileKind, OwnCandidacy, PublicCandidate } from '../../core/api/candidates.api';
import { ElectionDetail, ElectionsApi } from '../../core/api/elections.api';
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES, PHOTO_TYPES } from '../../core/api/enrollment.api';
import { ResultPerson, ResultsApi, ResultsView } from '../../core/api/results.api';
import { VotingApi, VotingStatus } from '../../core/api/voting.api';
import { apiErrorKey } from '../../core/auth/api-error';
import { LanguageService } from '../../core/services/language.service';
import { AppModal } from '../../shared/components/app-modal/app-modal';
import { FilePicker } from '../../shared/components/file-picker/file-picker';
import { candidacyClass, electionTitle, statusClass } from './election-ui';

/** Phases affichées dans la frise, dans l'ordre. La date est celle où la phase COMMENCE. */
const PHASES = [
  { key: 'candidacy', date: 'candidacyStartsAt' },
  { key: 'review', date: 'candidacyEndsAt' },
  { key: 'voting', date: 'votingStartsAt' },
  { key: 'results', date: 'votingEndsAt' },
] as const;

/** Erreurs 409 qui signifient « la page est périmée » : l'état de l'élection a changé depuis son chargement. */
const STALE = ['candidacy_not_open', 'candidacy_window_closed', 'candidacy_locked', 'election_locked', 'invalid_state'];

/**
 * Une élection vue par l'étudiant, par phase (D-37, téléphone 375×667) : frise des phases sur une ligne, puis l'action principale
 * de la phase (candidature, bouton « Voter », résultats) ; le reste (dates, postes, candidats) est replié. L'éligibilité et les
 * états sont contrôlés par le serveur ; ceci ne fait que les montrer.
 */
@Component({
  selector: 'app-my-election-page',
  imports: [ReactiveFormsModule, TranslocoPipe, RouterLink, DatePipe, AppModal, FilePicker],
  template: `
    <p class="mb-2"><a routerLink="/student/elections">{{ backArrow() }} {{ 'elections.student.backList' | transloco }}</a></p>
    @if (loadError(); as key) {
      <div class="alert alert-danger" role="alert">{{ key | transloco }}</div>
    } @else if (!e()) {
      <p>{{ 'common.loading' | transloco }}</p>
    } @else {
      @let d = e()!;
      <header class="d-flex flex-wrap align-items-center gap-2 mb-2">
        <h1 class="h4 app-page-title mb-0">{{ title() }}</h1>
        <span class="badge" [class]="badge()" data-testid="status-badge">{{ 'elections.status.' + d.status | transloco }}</span>
      </header>

      @if (phaseIndex() >= 0) {
        <ol class="app-phases" data-testid="phases" [attr.aria-label]="'elections.phases.label' | transloco">
          @for (p of phases(); track p.key; let i = $index) {
            <li [class.is-current]="i === phaseIndex()" [class.is-done]="i < phaseIndex()" [attr.aria-current]="i === phaseIndex() ? 'step' : null" [attr.data-testid]="'phase-' + p.key">
              <span class="app-phase-name">{{ 'elections.phases.' + p.key | transloco }}</span>
              @if (p.date) {
                <bdi dir="ltr" class="app-phase-date">{{ p.date | date: 'dd/MM' }}</bdi>
              }
            </li>
          }
        </ol>
      }

      @if (error(); as key) {
        <div class="alert alert-danger" role="alert" data-testid="page-error">{{ key | transloco }}</div>
      }

      <!-- ACTION PRINCIPALE : toujours en tête, selon la phase -->
      @switch (d.status) {
        @case ('VOTING_OPEN') {
          @if (voteStatus(); as v) {
            @if (v.state === 'VOTED') {
              <section class="app-card app-primary p-3 text-center" data-testid="voted-card">
                <p class="h4 mb-1 text-success">{{ 'voting.panel.votedBig' | transloco }}</p>
                @if (v.votedAt) {
                  <p class="small text-body-secondary mb-0"><bdi dir="ltr">{{ v.votedAt | date: 'yyyy-MM-dd HH:mm' }}</bdi></p>
                }
              </section>
            } @else if (v.state === 'NOT_ON_ROLL') {
              <section class="app-card app-primary p-3" data-testid="not-on-roll"><p class="mb-0">{{ 'voting.panel.notOnRoll' | transloco }}</p></section>
            } @else if (!v.open) {
              <section class="app-card app-primary p-3"><p class="mb-0">{{ 'voting.panel.notOpen' | transloco }}</p></section>
            } @else {
              <a class="btn btn-primary btn-lg app-vote-cta w-100" [routerLink]="['/student/elections', electionId, 'vote']" data-testid="vote-link">{{ 'voting.panel.vote' | transloco }}</a>
              <p class="small text-body-secondary text-center mt-2 mb-3">{{ 'voting.panel.openUntil' | transloco }} <bdi dir="ltr">{{ v.votingEndsAt | date: 'yyyy-MM-dd HH:mm' }}</bdi></p>
            }
          }
        }
        @case ('RESULTS_PUBLISHED') {
          <section class="app-card app-primary p-3" data-testid="results-card">
            <h2 class="h5 app-page-title">{{ 'results.title' | transloco }}</h2>
            @if (results(); as r) {
              <p class="small text-body-secondary">{{ 'results.participation' | transloco: { registered: r.registered, voters: r.voters, rate: r.participationRate } }}</p>
              @for (p of r.positions; track p.positionId) {
                <div class="app-result">
                  <div class="fw-bold">{{ positionName(p) }}</div>
                  @if (p.tie) {
                    <div class="text-warning-emphasis">{{ 'results.tie' | transloco }}</div>
                  }
                  @for (w of p.winners; track w.candidateId) {
                    <div data-testid="winner">✔ {{ personName(w) }}</div>
                  }
                  @if (p.detailPublished) {
                    <ul class="list-unstyled small text-body-secondary mb-0">
                      @for (c of p.candidates; track c.candidateId) {
                        <li>{{ personName(c) }} : {{ 'results.votes' | transloco: { count: c.votes } }}</li>
                      }
                      <li>{{ 'results.blank' | transloco }} : {{ p.blank }}</li>
                    </ul>
                  } @else {
                    <div class="small text-body-secondary">{{ 'results.withheld' | transloco }}</div>
                  }
                </div>
              }
            } @else {
              <p class="mb-0 text-body-secondary">{{ 'common.loading' | transloco }}</p>
            }
          </section>
        }
        @case ('VOTING_CLOSED') {
          <section class="app-card app-primary p-3"><p class="mb-0">{{ 'results.pending' | transloco }}</p></section>
        }
        @case ('CANCELLED') {
          <section class="app-card app-primary p-3"><p class="mb-0">{{ 'elections.student.cancelled' | transloco }}</p></section>
        }
        @default {
          <!-- candidatures ouvertes ou fermées : ma candidature, sur une ligne -->
          <section class="app-card app-primary p-3" data-testid="candidacy-card">
            @if (mine(); as m) {
              <div class="d-flex align-items-center gap-2">
                <div class="app-min0 flex-grow-1">
                  <div class="small text-body-secondary">{{ 'elections.student.myCandidacy' | transloco }}</div>
                  <div class="fw-bold text-truncate">
                    {{ positionNameById(m.positionId) }}
                    <span class="badge" [class]="candidacy(m.status)" data-testid="my-status">{{ 'elections.candidate.status.' + m.status | transloco }}</span>
                  </div>
                </div>
              </div>
              <p class="small text-body-secondary mb-2 mt-1">{{ 'elections.student.help.' + m.status | transloco }}</p>
              @if (m.status === 'REJECTED' && m.rejectionReason) {
                <div class="alert alert-danger py-2"><strong>{{ 'elections.candidate.rejectionReason' | transloco }}</strong> {{ m.rejectionReason }}</div>
              }
              <div class="d-flex flex-wrap gap-2">
                @if (canCorrect()) {
                  <button type="button" class="btn btn-outline-primary" data-testid="edit-candidacy" [attr.aria-expanded]="showForm()" (click)="showForm.set(!showForm())">{{ 'common.edit' | transloco }}</button>
                }
                @if (m.status === 'REJECTED' && open()) {
                  <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="resubmit()">{{ 'elections.candidate.resubmit' | transloco }}</button>
                }
                @if ((m.status === 'PENDING' || m.status === 'APPROVED') && open()) {
                  <button type="button" class="btn btn-outline-danger" data-testid="withdraw" [disabled]="busy()" (click)="confirmWithdraw.set(true)">{{ 'elections.candidate.withdraw' | transloco }}</button>
                }
              </div>
              @if (canCorrect() && showForm()) {
                <form [formGroup]="form" (ngSubmit)="save()" novalidate class="mt-3">
                  <div class="row g-3">
                    <div class="col-12 col-md-6">
                      <label class="form-label" for="positionId">{{ 'elections.candidate.position' | transloco }}</label>
                      <select id="positionId" class="form-select" formControlName="positionId">
                        @for (p of d.positions; track p.id) {
                          <option [value]="p.id">{{ positionName(p) }}</option>
                        }
                      </select>
                    </div>
                    <div class="col-12">
                      <label class="form-label" for="statement">{{ 'elections.candidate.statement' | transloco }}</label>
                      <textarea id="statement" class="form-control" rows="4" maxlength="5000" formControlName="statement"></textarea>
                    </div>
                    @for (k of kinds; track k) {
                      <div class="col-12 col-md-6">
                        <label class="form-label" [for]="'file-' + k">
                          {{ 'elections.candidate.' + (k === 'photo' ? 'photo' : 'program') | transloco }}
                          @if (k === 'photo' ? m.hasPhoto : m.hasProgram) {
                            <span class="badge text-bg-success">{{ 'elections.candidate.uploaded' | transloco }}</span>
                          }
                        </label>
                        <app-file-picker [inputId]="'file-' + k" [accept]="k === 'photo' ? photoTypes : accepted" [showName]="false" [disabled]="busy()" (picked)="upload(k, $event)" />
                        <div class="form-text">{{ (k === 'photo' ? 'elections.candidate.photoHelp' : 'elections.candidate.fileHelp') | transloco }}</div>
                      </div>
                    }
                  </div>
                  <button type="submit" class="btn btn-primary mt-3" [disabled]="busy() || form.invalid">{{ 'common.save' | transloco }}</button>
                </form>
              }
            }
            @if (canApply()) {
              <p class="mb-2" [class.mt-3]="mine()">{{ 'elections.student.applyIntro' | transloco }}</p>
              @if (!showForm()) {
                <button type="button" class="btn btn-primary w-100" data-testid="start-apply" (click)="showForm.set(true)">{{ 'elections.student.becomeCandidate' | transloco }}</button>
              } @else {
                <form [formGroup]="form" (ngSubmit)="apply()" novalidate>
                  <div class="row g-3">
                    <div class="col-12 col-md-6">
                      <label class="form-label" for="positionIdNew">{{ 'elections.candidate.position' | transloco }}</label>
                      <select id="positionIdNew" class="form-select" formControlName="positionId">
                        <option value="">{{ 'common.choose' | transloco }}</option>
                        @for (p of d.positions; track p.id) {
                          <option [value]="p.id">{{ positionName(p) }}</option>
                        }
                      </select>
                    </div>
                    <div class="col-12">
                      <label class="form-label" for="statementNew">{{ 'elections.candidate.statement' | transloco }}</label>
                      <textarea id="statementNew" class="form-control" rows="3" maxlength="5000" formControlName="statement"></textarea>
                    </div>
                  </div>
                  <button type="submit" class="btn btn-primary mt-3" [disabled]="busy() || form.invalid">{{ 'elections.candidate.apply' | transloco }}</button>
                </form>
              }
            } @else if (!mine()) {
              @if (d.status === 'CANDIDACY_OPEN') {
                <p class="mb-0 text-body-secondary" data-testid="outside-window">{{ 'elections.student.outsideWindow' | transloco }}</p>
              } @else {
                <p class="mb-0 text-body-secondary">{{ 'elections.student.noApply' | transloco }}</p>
              }
            }
          </section>
        }
      }

      <!-- LE RESTE, replié -->
      <details class="app-fold" data-testid="details-fold">
        <summary>{{ 'elections.student.details' | transloco }}</summary>
        <div class="app-fold-body">
          @if (d.description) {
            <p>{{ d.description }}</p>
          }
          <dl class="row mb-0">
            @for (f of dateFields; track f) {
              @if ($any(d)[f]) {
                <dt class="col-sm-4">{{ 'elections.fields.' + f | transloco }}</dt>
                <dd class="col-sm-8"><bdi dir="ltr">{{ $any(d)[f] | date: 'yyyy-MM-dd HH:mm' }}</bdi></dd>
              }
            }
            <dt class="col-sm-4">{{ 'elections.wizard.steps.positions' | transloco }}</dt>
            <dd class="col-sm-8 mb-0">
              @for (p of d.positions; track p.id; let last = $last) {
                {{ positionName(p) }}@if (!last) {<span>{{ separator() }}</span>}
              }
            </dd>
          </dl>
        </div>
      </details>

      <details class="app-fold" data-testid="candidates-fold" [open]="foldCandidates()" (toggle)="onCandidatesToggle($event)">
        <summary>{{ 'elections.student.candidates' | transloco }} <span class="badge text-bg-secondary">{{ candidates().length }}</span></summary>
        <div class="app-fold-body">
          @if (candidates().length === 0) {
            <p class="text-body-secondary mb-0">{{ 'elections.student.noCandidates' | transloco }}</p>
          } @else {
            <div class="app-cand-list">
              @for (c of candidates(); track c.id) {
                <article class="app-cand" [attr.data-testid]="'cand-' + c.id">
                  <span class="app-avatar" aria-hidden="true">
                    @if (photos()[c.id]; as url) {
                      <img [src]="url" alt="" />
                    } @else {
                      {{ initial(c) }}
                    }
                  </span>
                  <span class="app-min0 flex-grow-1">
                    <span class="d-block fw-bold text-truncate">{{ candidateName(c) }}</span>
                    <span class="d-block small text-body-secondary text-truncate">{{ positionNameById(c.positionId) }}</span>
                  </span>
                  @if (c.hasProgram) {
                    <button type="button" class="btn btn-outline-primary btn-sm" [disabled]="busy()" (click)="view(c.id, 'program')">
                      {{ 'voting.program' | transloco }}<span class="visually-hidden"> : {{ candidateName(c) }}</span>
                    </button>
                  }
                </article>
              }
            </div>
          }
        </div>
      </details>

      @if (confirmWithdraw()) {
        <app-modal [title]="'elections.candidate.withdraw' | transloco" (closed)="confirmWithdraw.set(false)">
          <p class="mb-0">{{ 'elections.candidate.withdrawConfirm' | transloco }}</p>
          <ng-container modal-footer>
            <button type="button" class="btn btn-outline-primary" (click)="confirmWithdraw.set(false)">{{ 'common.cancel' | transloco }}</button>
            <button type="button" class="btn btn-danger" [disabled]="busy()" (click)="withdraw()">{{ 'elections.candidate.withdraw' | transloco }}</button>
          </ng-container>
        </app-modal>
      }
      @if (viewer(); as v) {
        <app-modal [title]="('elections.candidate.' + (v.kind === 'photo' ? 'viewPhoto' : 'viewProgram')) | transloco" (closed)="closeViewer()">
          @if (v.image) {
            <img class="app-photo-preview img-fluid border rounded" [src]="v.url" [alt]="'elections.candidate.viewPhoto' | transloco" />
          } @else {
            <iframe class="app-doc-frame border rounded" [src]="v.url" [title]="'elections.candidate.viewProgram' | transloco"></iframe>
          }
        </app-modal>
      }
    }
  `,
})
export class MyElectionPage implements OnInit {
  private readonly elections = inject(ElectionsApi);
  private readonly candidatesApi = inject(CandidatesApi);
  private readonly votingApi = inject(VotingApi);
  private readonly resultsApi = inject(ResultsApi);
  private readonly lang = inject(LanguageService);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly electionId = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';
  protected readonly dateFields = ['candidacyStartsAt', 'candidacyEndsAt', 'votingStartsAt', 'votingEndsAt'] as const;
  protected readonly kinds: FileKind[] = ['photo', 'program'];
  protected readonly accepted = ACCEPTED_TYPES;
  protected readonly photoTypes = PHOTO_TYPES.join(',');

  protected readonly e = signal<ElectionDetail | null>(null);
  protected readonly mine = signal<OwnCandidacy | null>(null);
  protected readonly voteStatus = signal<VotingStatus | null>(null);
  protected readonly results = signal<ResultsView | null>(null);
  protected readonly candidates = signal<PublicCandidate[]>([]);
  protected readonly photos = signal<Record<string, string>>({});
  protected readonly loadError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  /** Le formulaire de candidature est replié tant que l'étudiant n'a pas appuyé sur « Modifier » ou « Se porter candidat ». */
  protected readonly showForm = signal(false);
  protected readonly confirmWithdraw = signal(false);
  protected readonly viewer = signal<{ kind: FileKind; url: SafeResourceUrl; image: boolean } | null>(null);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    positionId: ['', [Validators.required]],
    statement: ['', [Validators.maxLength(5000)]],
  });

  protected readonly title = computed(() => (this.e() ? electionTitle(this.e()!, this.lang.current()) : ''));
  protected readonly badge = computed(() => (this.e() ? statusClass(this.e()!.status) : ''));

  /** Phase courante dans la frise (-1 : pas de frise, ex. élection annulée). */
  protected readonly phaseIndex = computed(() => {
    switch (this.e()?.status) {
      case 'CANDIDACY_OPEN': return 0;
      case 'CANDIDACY_CLOSED': return 1;
      case 'VOTING_OPEN': return 2;
      case 'VOTING_CLOSED':
      case 'RESULTS_PUBLISHED': return 3;
      default: return -1;
    }
  });
  protected readonly phases = computed(() => PHASES.map((p) => ({ key: p.key, date: (this.e() as unknown as Record<string, string | null>)?.[p.date] ?? null })));

  /**
   * Candidatures ouvertes : statut CANDIDACY_OPEN ET date du jour dans la période (le serveur contrôle les deux ; l'afficher ici
   * évite de proposer une action qui sera refusée, et un badge « ouvertes » à côté d'une alerte « pas ouvertes »).
   */
  protected readonly open = computed(() => {
    const d = this.e();
    if (d?.status !== 'CANDIDACY_OPEN') return false;
    const now = Date.now();
    return (!d.candidacyStartsAt || now >= Date.parse(d.candidacyStartsAt)) && (!d.candidacyEndsAt || now < Date.parse(d.candidacyEndsAt));
  });
  /** Déposer : candidatures ouvertes, et pas de candidature en cours (une candidature retirée peut être redéposée). */
  protected readonly canApply = computed(() => this.open() && (!this.mine() || this.mine()!.status === 'WITHDRAWN'));
  /** Corriger : tant qu'elle n'est pas validée (en attente, ou rejetée avant redépôt). */
  protected readonly canCorrect = computed(() => this.open() && ['PENDING', 'REJECTED'].includes(this.mine()?.status ?? ''));
  /** Les candidats sont dépliés pendant les candidatures et l'examen, repliés ensuite (le vote d'abord). */
  protected readonly foldCandidates = computed(() => this.phaseIndex() <= 1);

  private objectUrl: string | null = null;
  private readonly objectUrls: string[] = [];

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.release();
      this.objectUrls.forEach((u) => URL.revokeObjectURL(u));
    });
  }

  async ngOnInit(): Promise<void> {
    try {
      await this.refresh();
    } catch (err) {
      this.loadError.set(apiErrorKey(err));
    }
  }

  /** (Re)charge tout ce que la page montre : l'élection, ses candidats, ma candidature, et selon la phase le vote ou les résultats. */
  private async refresh(): Promise<void> {
    this.e.set(await this.elections.get(this.electionId));
    this.candidates.set(await this.candidatesApi.listApproved(this.electionId));
    await this.loadMine();
    const status = this.e()?.status;
    if (status === 'VOTING_OPEN') await this.loadVoteStatus();
    if (status === 'RESULTS_PUBLISHED') await this.loadResults();
    if (this.foldCandidates()) void this.loadPhotos();
  }

  /** Où en est l'étudiant pour le vote (inscrit ? a voté ?). Un échec ne bloque pas le reste de la page. */
  private async loadVoteStatus(): Promise<void> {
    try {
      this.voteStatus.set(await this.votingApi.status(this.electionId));
    } catch {
      this.voteStatus.set(null);
    }
  }

  private async loadResults(): Promise<void> {
    try {
      this.results.set(await this.resultsApi.get(this.electionId));
    } catch {
      this.results.set(null);
    }
  }

  private async loadMine(): Promise<void> {
    try {
      this.setMine(await this.candidatesApi.mine(this.electionId));
    } catch (err) {
      if (!(err instanceof HttpErrorResponse && err.status === 404)) throw err; // pas encore candidat : normal
      this.setMine(null);
    }
  }

  private setMine(m: OwnCandidacy | null): void {
    this.mine.set(m);
    this.form.reset({ positionId: m?.positionId ?? '', statement: m?.statement ?? '' });
  }

  /** Séparateur de liste : virgule arabe en arabe. */
  protected separator(): string {
    return this.lang.current() === 'ar' ? '، ' : ', ';
  }
  protected backArrow(): string {
    return this.lang.dir() === 'rtl' ? '→' : '←';
  }
  protected candidacy(status: string): string {
    return candidacyClass(status);
  }
  protected positionName(p: { title: string; titleAr: string | null }): string {
    return localName({ name: p.title, nameAr: p.titleAr }, this.lang.current());
  }
  protected positionNameById(id: string): string {
    const p = this.e()?.positions.find((x) => x.id === id);
    return p ? this.positionName(p) : '';
  }
  protected candidateName(c: PublicCandidate): string {
    return this.lang.current() === 'ar' && c.fullNameAr ? c.fullNameAr : `${c.firstName} ${c.lastName}`;
  }
  protected personName(c: ResultPerson): string {
    return this.lang.current() === 'ar' && c.fullNameAr ? c.fullNameAr : `${c.firstName} ${c.lastName}`;
  }
  protected initial(c: PublicCandidate): string {
    return (this.candidateName(c).trim()[0] ?? '?').toUpperCase();
  }

  // ------------------------------------------------------------------ photos des candidats (à la demande)

  protected onCandidatesToggle(event: Event): void {
    if ((event.target as HTMLDetailsElement).open) void this.loadPhotos();
  }

  /** Une miniature par candidat qui a une photo ; un échec laisse l'initiale. Chargées à l'ouverture de la section (pages légères). */
  private async loadPhotos(): Promise<void> {
    for (const c of this.candidates()) {
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

  // ------------------------------------------------------------------ actions sur ma candidature

  private async act(action: () => Promise<OwnCandidacy | void>, refreshList = false): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const m = await action();
      if (m) this.setMine(m);
      this.showForm.set(false);
      if (refreshList) this.candidates.set(await this.candidatesApi.listApproved(this.electionId));
    } catch (err) {
      this.error.set(apiErrorKey(err));
      // 409 « candidatures fermées » : la page était périmée. On la recharge, pour que le badge, la frise et l'alerte disent la
      // même chose (jamais « Candidatures ouvertes » à côté de « Les candidatures ne sont pas ouvertes »).
      if (err instanceof HttpErrorResponse && err.status === 409 && STALE.includes(err.error?.message)) {
        this.showForm.set(false);
        try {
          await this.refresh();
        } catch {
          /* on garde l'alerte */
        }
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected apply(): Promise<void> {
    const v = this.form.getRawValue();
    return this.act(() => this.candidatesApi.apply(this.electionId, { positionId: v.positionId, ...(v.statement ? { statement: v.statement } : {}) }));
  }
  protected save(): Promise<void> {
    const v = this.form.getRawValue();
    return this.act(() => this.candidatesApi.update(this.electionId, { positionId: v.positionId, statement: v.statement }));
  }
  protected resubmit(): Promise<void> {
    return this.act(() => this.candidatesApi.resubmit(this.electionId));
  }
  protected async withdraw(): Promise<void> {
    this.confirmWithdraw.set(false);
    await this.act(() => this.candidatesApi.withdraw(this.electionId), true);
  }

  protected async upload(kind: FileKind, file: File | null): Promise<void> {
    if (!file) return;
    // Contrôle de confort ; le serveur reconnaît le vrai type d'après le contenu (D-23).
    if (file.size > MAX_UPLOAD_BYTES) {
      this.error.set('errors.fileTooLarge');
      return;
    }
    // La photo est une image JPEG ou PNG, jamais un PDF (le serveur le refuse aussi, d'après le contenu).
    if (kind === 'photo' && !PHOTO_TYPES.includes(file.type)) {
      this.error.set('errors.photoType');
      return;
    }
    await this.act(() => this.candidatesApi.upload(this.electionId, kind, file));
    this.showForm.set(true); // le formulaire reste ouvert : on peut déposer la photo puis le programme
  }

  protected async view(candidateId: string, kind: FileKind): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const blob = await this.candidatesApi.openFile(this.electionId, candidateId, kind);
      this.release();
      this.objectUrl = URL.createObjectURL(blob);
      this.viewer.set({ kind, url: this.sanitizer.bypassSecurityTrustResourceUrl(this.objectUrl), image: blob.type.startsWith('image/') });
    } catch (err) {
      this.error.set(apiErrorKey(err));
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
