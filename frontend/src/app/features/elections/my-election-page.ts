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
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES } from '../../core/api/enrollment.api';
import { apiErrorKey } from '../../core/auth/api-error';
import { LanguageService } from '../../core/services/language.service';
import { AppModal } from '../../shared/components/app-modal/app-modal';
import { candidacyClass, electionTitle, statusClass } from './election-ui';

/**
 * Une élection vue par l'étudiant : calendrier, postes, candidats validés, et SA candidature (dépôt, correction, photo,
 * programme, retrait, redépôt après rejet). L'éligibilité et les états sont contrôlés par le serveur ; ceci ne fait que les montrer.
 */
@Component({
  selector: 'app-my-election-page',
  imports: [ReactiveFormsModule, TranslocoPipe, RouterLink, DatePipe, AppModal],
  template: `
    <p><a routerLink="/student/elections">{{ backArrow() }} {{ 'elections.student.backList' | transloco }}</a></p>
    @if (loadError(); as key) {
      <div class="alert alert-danger" role="alert">{{ key | transloco }}</div>
    } @else if (!e()) {
      <p>{{ 'common.loading' | transloco }}</p>
    } @else {
      @let d = e()!;
      <header class="app-page-head">
        <div class="d-flex flex-wrap align-items-center gap-2">
          <h1 class="mb-0">{{ title() }}</h1>
          <span class="badge" [class]="badge()">{{ 'elections.status.' + d.status | transloco }}</span>
        </div>
        @if (d.description) {
          <p>{{ d.description }}</p>
        }
      </header>

      <section class="app-card p-3 p-md-4 mb-3">
        <dl class="row mb-0">
          @for (f of dateFields; track f) {
            @if ($any(d)[f]) {
              <dt class="col-sm-4">{{ 'elections.fields.' + f | transloco }}</dt>
              <dd class="col-sm-8"><bdi dir="ltr">{{ $any(d)[f] | date: 'yyyy-MM-dd HH:mm' }}</bdi></dd>
            }
          }
          <dt class="col-sm-4">{{ 'elections.wizard.steps.positions' | transloco }}</dt>
          <dd class="col-sm-8">
            @for (p of d.positions; track p.id; let last = $last) {
              {{ positionName(p) }}@if (!last) {، }
            }
          </dd>
        </dl>
      </section>

      <section class="app-card p-3 p-md-4 mb-3" aria-live="polite">
        <h2 class="h5 app-page-title">{{ 'elections.student.myCandidacy' | transloco }}</h2>
        @if (error(); as key) {
          <div class="alert alert-danger" role="alert">{{ key | transloco }}</div>
        }
        @if (mine(); as m) {
          <p>
            <span class="badge" [class]="candidacy(m.status)" data-testid="my-status">{{ 'elections.candidate.status.' + m.status | transloco }}</span>
            · {{ positionNameById(m.positionId) }}
          </p>
          <p class="text-body-secondary">{{ 'elections.student.help.' + m.status | transloco }}</p>
          @if (m.status === 'REJECTED' && m.rejectionReason) {
            <div class="alert alert-danger"><strong>{{ 'elections.candidate.rejectionReason' | transloco }}</strong> {{ m.rejectionReason }}</div>
          }
          @if (m.statement) {
            <p class="mb-2">{{ m.statement }}</p>
          }
          @if (canCorrect()) {
            <form [formGroup]="form" (ngSubmit)="save()" novalidate class="mb-3">
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
              </div>
              <button type="submit" class="btn btn-outline-primary mt-3" [disabled]="busy() || form.invalid">{{ 'common.save' | transloco }}</button>
            </form>
            <div class="row g-3 mb-3">
              @for (k of kinds; track k) {
                <div class="col-12 col-md-6">
                  <label class="form-label" [for]="'file-' + k">
                    {{ 'elections.candidate.' + (k === 'photo' ? 'photo' : 'program') | transloco }}
                    @if (k === 'photo' ? m.hasPhoto : m.hasProgram) {
                      <span class="badge text-bg-success">{{ 'elections.candidate.uploaded' | transloco }}</span>
                    }
                  </label>
                  <input [id]="'file-' + k" class="form-control" type="file" [accept]="k === 'photo' ? photoTypes : accepted" (change)="upload(k, $any($event.target))" [disabled]="busy()" />
                  <div class="form-text">{{ 'elections.candidate.fileHelp' | transloco }}</div>
                </div>
              }
            </div>
          }
          <div class="d-flex flex-wrap gap-2">
            @if (m.status === 'REJECTED' && open()) {
              <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="resubmit()">{{ 'elections.candidate.resubmit' | transloco }}</button>
            }
            @if ((m.status === 'PENDING' || m.status === 'APPROVED') && open()) {
              <button type="button" class="btn btn-outline-danger" [disabled]="busy()" (click)="confirmWithdraw.set(true)">{{ 'elections.candidate.withdraw' | transloco }}</button>
            }
          </div>
        }
        @if (canApply()) {
          <form [formGroup]="form" (ngSubmit)="apply()" novalidate>
            <p>{{ 'elections.student.applyIntro' | transloco }}</p>
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
                <textarea id="statementNew" class="form-control" rows="4" maxlength="5000" formControlName="statement"></textarea>
              </div>
            </div>
            <button type="submit" class="btn btn-primary mt-3" [disabled]="busy() || form.invalid">{{ 'elections.candidate.apply' | transloco }}</button>
          </form>
        } @else if (!mine()) {
          <p class="text-body-secondary mb-0">{{ 'elections.student.noApply' | transloco }}</p>
        }
      </section>

      <section class="app-card p-3 p-md-4">
        <h2 class="h5 app-page-title">{{ 'elections.student.candidates' | transloco }}</h2>
        @if (candidates().length === 0) {
          <p class="text-body-secondary mb-0">{{ 'elections.student.noCandidates' | transloco }}</p>
        } @else {
          <div class="app-candidates">
            @for (c of candidates(); track c.id) {
              <article class="app-candidate">
                <h3 class="h6 mb-0">{{ candidateName(c) }}</h3>
                <p class="small text-body-secondary mb-1">{{ positionNameById(c.positionId) }}</p>
                @if (c.statement) {
                  <p class="mb-2">{{ c.statement }}</p>
                }
                <div class="d-flex flex-wrap gap-2">
                  @if (c.hasPhoto) {
                    <button type="button" class="btn btn-sm btn-outline-primary" [disabled]="busy()" (click)="view(c.id, 'photo')">{{ 'elections.candidate.viewPhoto' | transloco }}</button>
                  }
                  @if (c.hasProgram) {
                    <button type="button" class="btn btn-sm btn-outline-primary" [disabled]="busy()" (click)="view(c.id, 'program')">{{ 'elections.candidate.viewProgram' | transloco }}</button>
                  }
                </div>
              </article>
            }
          </div>
        }
      </section>

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
            <img class="img-fluid border rounded" [src]="v.url" [alt]="'elections.candidate.viewPhoto' | transloco" />
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
  private readonly lang = inject(LanguageService);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly electionId = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';
  protected readonly dateFields = ['candidacyStartsAt', 'candidacyEndsAt', 'votingStartsAt', 'votingEndsAt'] as const;
  protected readonly kinds: FileKind[] = ['photo', 'program'];
  protected readonly accepted = ACCEPTED_TYPES;
  protected readonly photoTypes = 'image/jpeg,image/png';

  protected readonly e = signal<ElectionDetail | null>(null);
  protected readonly mine = signal<OwnCandidacy | null>(null);
  protected readonly candidates = signal<PublicCandidate[]>([]);
  protected readonly loadError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly confirmWithdraw = signal(false);
  protected readonly viewer = signal<{ kind: FileKind; url: SafeResourceUrl; image: boolean } | null>(null);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    positionId: ['', [Validators.required]],
    statement: ['', [Validators.maxLength(5000)]],
  });

  protected readonly title = computed(() => (this.e() ? electionTitle(this.e()!, this.lang.current()) : ''));
  protected readonly badge = computed(() => (this.e() ? statusClass(this.e()!.status) : ''));
  protected readonly open = computed(() => this.e()?.status === 'CANDIDACY_OPEN');
  /** Déposer : candidatures ouvertes, et pas de candidature en cours (une candidature retirée peut être redéposée). */
  protected readonly canApply = computed(() => this.open() && (!this.mine() || this.mine()!.status === 'WITHDRAWN'));
  /** Corriger : tant qu'elle n'est pas validée (en attente, ou rejetée avant redépôt). */
  protected readonly canCorrect = computed(() => this.open() && ['PENDING', 'REJECTED'].includes(this.mine()?.status ?? ''));

  private objectUrl: string | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.release());
  }

  async ngOnInit(): Promise<void> {
    try {
      this.e.set(await this.elections.get(this.electionId));
      this.candidates.set(await this.candidatesApi.listApproved(this.electionId));
      await this.loadMine();
    } catch (err) {
      this.loadError.set(apiErrorKey(err));
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

  private async act(action: () => Promise<OwnCandidacy | void>, refreshList = false): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const m = await action();
      if (m) this.setMine(m);
      if (refreshList) this.candidates.set(await this.candidatesApi.listApproved(this.electionId));
    } catch (err) {
      this.error.set(apiErrorKey(err));
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

  protected async upload(kind: FileKind, input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    // Contrôle de confort ; le serveur reconnaît le vrai type d'après le contenu (D-23).
    if (file.size > MAX_UPLOAD_BYTES) {
      this.error.set('errors.fileTooLarge');
      return;
    }
    await this.act(() => this.candidatesApi.upload(this.electionId, kind, file));
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
