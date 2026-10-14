import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { AbstractControl, FormArray, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AcademicApi, AcademicOverview, localName } from '../../core/api/academic.api';
import { ElectionBody, ElectionDetail, ElectionsApi, StaffGrant } from '../../core/api/elections.api';
import { apiErrorKey } from '../../core/auth/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { StepUpCancelled, StepUpService } from '../../core/auth/step-up.service';
import { LanguageService } from '../../core/services/language.service';
import { DATETIME, fromLocalInput, toLocalInput } from './election-ui';

const STEPS = ['info', 'positions', 'rules', 'committee', 'summary'] as const;
type Step = (typeof STEPS)[number];

/** Au moins un critère par règle : « toute l'institution » se choisit explicitement, il ne se déduit pas d'une règle vide. */
const atLeastOneCriterion = (c: AbstractControl): ValidationErrors | null => {
  const v = c.value as Record<string, string>;
  return v['facultyId'] || v['programId'] || v['levelId'] || v['groupId'] ? null : { empty: true };
};

/**
 * Création d'une élection en étapes (03 §5.4). La première étape crée le brouillon ; les suivantes (postes, règles,
 * comité) agissent sur ce brouillon, qui reste modifiable jusqu'à l'ouverture des candidatures. Même écran pour reprendre un brouillon.
 */
@Component({
  selector: 'app-election-wizard-page',
  imports: [ReactiveFormsModule, RouterLink, TranslocoPipe],
  template: `
    <header class="app-page-head">
      <h1>{{ (editing() ? 'elections.wizard.editTitle' : 'elections.wizard.title') | transloco }}</h1>
      <p>{{ 'elections.wizard.subtitle' | transloco }}</p>
    </header>

    @if (loadError(); as key) {
      <div class="alert alert-danger" role="alert">{{ key | transloco }}</div>
    } @else if (locked()) {
      <div class="alert alert-warning" role="alert">
        {{ 'elections.wizard.locked' | transloco }}
        <a [routerLink]="['/admin/elections', electionId()]">{{ 'elections.wizard.toDetail' | transloco }}</a>
      </div>
    } @else {
      <ol class="app-steps" [attr.aria-label]="'elections.wizard.stepsLabel' | transloco">
        @for (s of steps; track s; let i = $index) {
          <li [class.is-current]="s === step()" [class.is-done]="i < stepIndex()" [attr.aria-current]="s === step() ? 'step' : null">
            <span class="app-step-num">{{ i + 1 }}</span>
            <span class="app-step-label">{{ 'elections.wizard.steps.' + s | transloco }}</span>
          </li>
        }
      </ol>

      @if (error(); as key) {
        <div class="alert alert-danger" role="alert">{{ key | transloco }}</div>
      }

      <section class="app-card p-3 p-md-4">
        @switch (step()) {
          @case ('info') {
            <form [formGroup]="info" (ngSubmit)="saveInfo()" novalidate>
              <div class="row g-3">
                <div class="col-12 col-md-6">
                  <label class="form-label" for="title">{{ 'elections.fields.title' | transloco }}</label>
                  <input id="title" class="form-control" formControlName="title" maxlength="255" />
                </div>
                <div class="col-12 col-md-6">
                  <label class="form-label" for="titleAr">{{ 'elections.fields.titleAr' | transloco }}</label>
                  <input id="titleAr" class="form-control" formControlName="titleAr" maxlength="255" dir="rtl" />
                </div>
                <div class="col-12">
                  <label class="form-label" for="description">{{ 'elections.fields.description' | transloco }}</label>
                  <textarea id="description" class="form-control" rows="3" maxlength="5000" formControlName="description"></textarea>
                </div>
                @if (!editing()) {
                  <div class="col-12 col-md-6">
                    <label class="form-label" for="academicYearId">{{ 'elections.fields.year' | transloco }}</label>
                    <select id="academicYearId" class="form-select" formControlName="academicYearId">
                      <option value="">{{ 'common.choose' | transloco }}</option>
                      @for (y of overview()?.years ?? []; track y.id) {
                        <option [value]="y.id">{{ y.label }}</option>
                      }
                    </select>
                  </div>
                }
                @for (f of dateFields; track f) {
                  <div class="col-12 col-md-6">
                    <label class="form-label" [for]="f">{{ 'elections.fields.' + f | transloco }}</label>
                    <input [id]="f" class="form-control" [formControlName]="f" dir="ltr" inputmode="numeric" autocomplete="off" [placeholder]="'elections.wizard.datePlaceholder' | transloco" />
                  </div>
                }
              </div>
              <p class="form-text">{{ 'elections.wizard.datesHelp' | transloco }}</p>
              <div class="d-flex flex-wrap gap-2">
                <button type="submit" class="btn btn-primary" [disabled]="busy() || info.invalid">{{ 'elections.wizard.saveNext' | transloco }}</button>
                <a class="btn btn-outline-primary" routerLink="/admin/elections">{{ 'common.cancel' | transloco }}</a>
              </div>
            </form>
          }

          @case ('positions') {
            <h2 class="h5 app-page-title">{{ 'elections.wizard.steps.positions' | transloco }}</h2>
            <p class="form-text">{{ 'elections.wizard.positionsHelp' | transloco }}</p>
            @if (detail()?.positions?.length) {
              <ul class="app-list">
                @for (p of detail()!.positions; track p.id) {
                  <li>
                    <span>{{ positionName(p) }} <small class="text-body-secondary">· {{ 'elections.positions.seats' | transloco: { count: p.seats } }}</small></span>
                    <button type="button" class="btn btn-sm btn-outline-danger" [disabled]="busy()" (click)="removePosition(p.id)">{{ 'common.delete' | transloco }}</button>
                  </li>
                }
              </ul>
            } @else {
              <p class="text-body-secondary">{{ 'elections.wizard.noPositions' | transloco }}</p>
            }
            <form [formGroup]="position" (ngSubmit)="addPosition()" novalidate class="row g-2 align-items-end">
              <div class="col-12 col-md-4">
                <label class="form-label" for="posTitle">{{ 'elections.positions.title' | transloco }}</label>
                <input id="posTitle" class="form-control" formControlName="title" maxlength="191" />
              </div>
              <div class="col-12 col-md-4">
                <label class="form-label" for="posTitleAr">{{ 'elections.positions.titleAr' | transloco }}</label>
                <input id="posTitleAr" class="form-control" formControlName="titleAr" maxlength="191" dir="rtl" />
              </div>
              <div class="col-6 col-md-2">
                <label class="form-label" for="posSeats">{{ 'elections.positions.seatsLabel' | transloco }}</label>
                <input id="posSeats" class="form-control" type="number" min="1" max="50" formControlName="seats" dir="ltr" />
              </div>
              <div class="col-6 col-md-2">
                <button type="submit" class="btn btn-outline-primary w-100" [disabled]="busy() || position.invalid">+ {{ 'common.add' | transloco }}</button>
              </div>
            </form>
            <div class="d-flex flex-wrap gap-2 mt-4">
              <button type="button" class="btn btn-outline-primary" (click)="go('info')">{{ 'elections.wizard.back' | transloco }}</button>
              <button type="button" class="btn btn-primary" [disabled]="!detail()?.positions?.length" (click)="go('rules')">{{ 'elections.wizard.next' | transloco }}</button>
            </div>
          }

          @case ('rules') {
            <h2 class="h5 app-page-title">{{ 'elections.wizard.steps.rules' | transloco }}</h2>
            <p class="form-text">{{ 'elections.wizard.rulesHelp' | transloco }}</p>
            <div class="form-check mb-3">
              <input id="whole" class="form-check-input" type="checkbox" [checked]="whole()" (change)="setWhole($any($event.target).checked)" />
              <label class="form-check-label" for="whole">{{ 'elections.rules.whole' | transloco }}</label>
            </div>
            @if (whole()) {
              <div class="alert alert-info">{{ 'elections.rules.wholeHelp' | transloco }}</div>
            } @else {
              @if (rules.length === 0) {
                <div class="alert alert-warning">{{ 'elections.rules.none' | transloco }}</div>
              }
              @for (r of rules.controls; track r; let i = $index) {
                <div class="app-rule" [formGroup]="$any(r)">
                  <div class="row g-2">
                    @for (k of ruleKeys; track k) {
                      <div class="col-6 col-md-3">
                        <label class="form-label small" [for]="'rule-' + i + '-' + k">{{ 'elections.rules.' + k | transloco }}</label>
                        <select [id]="'rule-' + i + '-' + k" class="form-select form-select-sm" [formControlName]="k">
                          <option value="">{{ 'elections.rules.any' | transloco }}</option>
                          @for (o of options(k, $any(r).value); track o.value) {
                            <option [value]="o.value">{{ o.label }}</option>
                          }
                        </select>
                      </div>
                    }
                  </div>
                  <div class="d-flex justify-content-between align-items-center mt-2">
                    @if (r.invalid) {
                      <small class="text-danger">{{ 'elections.rules.needCriterion' | transloco }}</small>
                    } @else {
                      <span></span>
                    }
                    <button type="button" class="btn btn-sm btn-outline-danger" (click)="removeRule(i)">{{ 'common.delete' | transloco }}</button>
                  </div>
                </div>
              }
              <button type="button" class="btn btn-outline-primary btn-sm" (click)="addRule()">+ {{ 'elections.rules.add' | transloco }}</button>
              <p class="form-text mt-2">{{ 'elections.rules.orHelp' | transloco }}</p>
            }
            <div class="d-flex flex-wrap gap-2 mt-4">
              <button type="button" class="btn btn-outline-primary" (click)="go('positions')">{{ 'elections.wizard.back' | transloco }}</button>
              <button type="button" class="btn btn-primary" [disabled]="busy() || rulesInvalid()" (click)="saveRules()">{{ 'elections.wizard.saveNext' | transloco }}</button>
            </div>
          }

          @case ('committee') {
            <h2 class="h5 app-page-title">{{ 'elections.wizard.steps.committee' | transloco }}</h2>
            <p class="form-text">{{ 'elections.wizard.committeeHelp' | transloco: { min: 3 } }}</p>
            <p>
              <span class="badge" [class]="committee().length >= 3 ? 'text-bg-success' : 'text-bg-warning'">
                {{ 'elections.committee.count' | transloco: { count: committee().length, min: 3 } }}
              </span>
            </p>
            @if (committee().length) {
              <ul class="app-list">
                @for (m of committee(); track m.assignmentId) {
                  <li>
                    <bdi dir="ltr">{{ m.user.email ?? m.user.phone }}</bdi>
                    @if (isAdmin) {
                      <button type="button" class="btn btn-sm btn-outline-danger" [disabled]="busy()" (click)="removeMember(m)">{{ 'elections.committee.remove' | transloco }}</button>
                    }
                  </li>
                }
              </ul>
            }
            @if (isAdmin) {
              <form [formGroup]="member" (ngSubmit)="addMember()" novalidate class="row g-2 align-items-end">
                <div class="col-12 col-md-8">
                  <label class="form-label" for="memberEmail">{{ 'elections.committee.email' | transloco }}</label>
                  <input id="memberEmail" class="form-control" type="email" formControlName="email" dir="ltr" autocomplete="off" />
                  <div class="form-text">{{ 'elections.committee.emailHelp' | transloco }}</div>
                </div>
                <div class="col-12 col-md-4">
                  <button type="submit" class="btn btn-outline-primary w-100" [disabled]="busy() || member.invalid">+ {{ 'elections.committee.add' | transloco }}</button>
                </div>
              </form>
            } @else {
              <p class="text-body-secondary">{{ 'elections.committee.adminOnly' | transloco }}</p>
            }
            <div class="d-flex flex-wrap gap-2 mt-4">
              <button type="button" class="btn btn-outline-primary" (click)="go('rules')">{{ 'elections.wizard.back' | transloco }}</button>
              <button type="button" class="btn btn-primary" (click)="go('summary')">{{ 'elections.wizard.next' | transloco }}</button>
            </div>
          }

          @case ('summary') {
            <h2 class="h5 app-page-title">{{ 'elections.wizard.steps.summary' | transloco }}</h2>
            <ul class="app-checklist">
              @for (c of readiness(); track c.key) {
                <li [class.is-ok]="c.ok">
                  <span aria-hidden="true">{{ c.ok ? '✓' : '✗' }}</span>
                  {{ 'elections.readiness.' + c.key | transloco }}
                  <span class="visually-hidden">{{ (c.ok ? 'elections.readiness.ok' : 'elections.readiness.missing') | transloco }}</span>
                </li>
              }
            </ul>
            @if (eligible() !== null) {
              <p>{{ 'elections.summary.eligible' | transloco: { count: eligible() } }}</p>
            }
            <div class="d-flex flex-wrap gap-2 mt-3">
              <button type="button" class="btn btn-outline-primary" (click)="go('committee')">{{ 'elections.wizard.back' | transloco }}</button>
              <a class="btn btn-primary" [routerLink]="['/admin/elections', electionId()]">{{ 'elections.wizard.finish' | transloco }}</a>
            </div>
          }
        }
      </section>
    }
  `,
})
export class ElectionWizardPage implements OnInit {
  private readonly api = inject(ElectionsApi);
  private readonly academic = inject(AcademicApi);
  private readonly auth = inject(AuthService);
  private readonly lang = inject(LanguageService);
  private readonly stepUp = inject(StepUpService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly steps = STEPS;
  protected readonly dateFields = ['candidacyStartsAt', 'candidacyEndsAt', 'votingStartsAt', 'votingEndsAt'] as const;
  protected readonly ruleKeys = ['facultyId', 'programId', 'levelId', 'groupId'] as const;

  protected readonly step = signal<Step>('info');
  protected readonly stepIndex = computed(() => STEPS.indexOf(this.step()));
  protected readonly electionId = signal<string>('');
  protected readonly editing = computed(() => !!this.electionId());
  protected readonly detail = signal<ElectionDetail | null>(null);
  protected readonly overview = signal<AcademicOverview | null>(null);
  protected readonly committee = signal<StaffGrant[]>([]);
  protected readonly eligible = signal<number | null>(null);
  protected readonly whole = signal(false);
  protected readonly locked = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly isAdmin = this.auth.hasRole('INSTITUTION_ADMIN');

  private institutionId = '';

  protected readonly info = this.fb.group({
    title: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(255)]],
    titleAr: ['', [Validators.maxLength(255)]],
    description: ['', [Validators.maxLength(5000)]],
    academicYearId: ['', [Validators.required]],
    candidacyStartsAt: ['', [Validators.required, Validators.pattern(DATETIME)]],
    candidacyEndsAt: ['', [Validators.required, Validators.pattern(DATETIME)]],
    votingStartsAt: ['', [Validators.required, Validators.pattern(DATETIME)]],
    votingEndsAt: ['', [Validators.required, Validators.pattern(DATETIME)]],
  });
  protected readonly position = this.fb.group({
    title: ['', [Validators.required, Validators.maxLength(191)]],
    titleAr: ['', [Validators.maxLength(191)]],
    seats: [1, [Validators.required, Validators.min(1), Validators.max(50)]],
  });
  protected readonly member = this.fb.group({ email: ['', [Validators.required, Validators.email]] });
  protected readonly rules = new FormArray<ReturnType<ElectionWizardPage['newRule']>>([]);

  protected readonly readiness = computed(() => {
    const d = this.detail();
    return [
      { key: 'dates', ok: !!d?.candidacyStartsAt && !!d?.candidacyEndsAt },
      { key: 'positions', ok: (d?.positions.length ?? 0) > 0 },
      { key: 'rules', ok: !!d?.rules && (d.rules.wholeInstitution || d.rules.items.length > 0) },
      { key: 'committee', ok: this.committee().length >= 3 },
    ];
  });

  async ngOnInit(): Promise<void> {
    this.institutionId = this.auth.institutionIdFor('INSTITUTION_ADMIN') ?? this.auth.institutionIdFor('ELECTION_COMMITTEE') ?? '';
    if (!this.institutionId) {
      this.loadError.set('errors.forbidden');
      return;
    }
    try {
      this.overview.set(await this.academic.overview(this.institutionId));
      const current = this.overview()?.years.find((y) => y.isCurrent);
      if (current) this.info.controls.academicYearId.setValue(current.id);
      const id = this.route.snapshot.paramMap.get('id');
      if (id) {
        this.electionId.set(id);
        await this.load();
        const d = this.detail()!;
        if (d.status !== 'DRAFT') {
          this.locked.set(true);
          return;
        }
        this.info.patchValue({
          title: d.title,
          titleAr: d.titleAr ?? '',
          description: d.description ?? '',
          academicYearId: d.academicYearId,
          candidacyStartsAt: toLocalInput(d.candidacyStartsAt),
          candidacyEndsAt: toLocalInput(d.candidacyEndsAt),
          votingStartsAt: toLocalInput(d.votingStartsAt),
          votingEndsAt: toLocalInput(d.votingEndsAt),
        });
        this.fillRules(d);
      } else if (this.isAdmin === false) {
        this.loadError.set('errors.forbidden'); // seul l'administrateur d'institution crée une élection
      }
    } catch (e) {
      this.loadError.set(apiErrorKey(e));
    }
  }

  // ------------------------------------------------------------------ chargement

  private async load(): Promise<void> {
    const id = this.electionId();
    this.detail.set(await this.api.get(id));
    try {
      this.committee.set((await this.api.staff(this.institutionId)).filter((g) => g.role === 'ELECTION_COMMITTEE' && g.electionId === id));
    } catch {
      this.committee.set([]); // la liste du personnel est réservée à l'administrateur d'institution
    }
  }

  private fillRules(d: ElectionDetail): void {
    this.rules.clear();
    this.whole.set(!!d.rules?.wholeInstitution);
    for (const r of d.rules?.items ?? []) {
      const g = this.newRule();
      g.setValue({ facultyId: r.facultyId ?? '', programId: r.programId ?? '', levelId: r.levelId ?? '', groupId: r.groupId ?? '' });
      this.rules.push(g);
    }
  }

  protected positionName(p: { title: string; titleAr: string | null }): string {
    return localName({ name: p.title, nameAr: p.titleAr }, this.lang.current());
  }

  protected async go(step: Step): Promise<void> {
    this.error.set(null);
    this.step.set(step);
    if (step === 'summary') {
      this.eligible.set(null);
      try {
        await this.load();
        this.eligible.set((await this.api.eligibleCount(this.electionId())).count);
      } catch (e) {
        this.error.set(apiErrorKey(e));
      }
    }
  }

  private async run(action: () => Promise<unknown>): Promise<boolean> {
    if (this.busy()) return false;
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
      return true;
    } catch (e) {
      if (!(e instanceof StepUpCancelled)) this.error.set(apiErrorKey(e));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  // ------------------------------------------------------------------ étape 1 : informations

  protected saveInfo(): Promise<void> {
    return this.run(async () => {
      const v = this.info.getRawValue();
      const candidacyStartsAt = fromLocalInput(v.candidacyStartsAt);
      const candidacyEndsAt = fromLocalInput(v.candidacyEndsAt);
      const votingStartsAt = fromLocalInput(v.votingStartsAt);
      const votingEndsAt = fromLocalInput(v.votingEndsAt);
      if (!candidacyStartsAt || !candidacyEndsAt || !votingStartsAt || !votingEndsAt) throw new Error('dates');
      const body: ElectionBody = {
        title: v.title,
        ...(v.titleAr ? { titleAr: v.titleAr } : {}),
        ...(v.description ? { description: v.description } : {}),
        candidacyStartsAt,
        candidacyEndsAt,
        votingStartsAt,
        votingEndsAt,
      };
      if (this.editing()) {
        await this.api.update(this.electionId(), body);
      } else {
        const created = await this.api.create(this.institutionId, { ...body, academicYearId: v.academicYearId });
        this.electionId.set(created.id);
        // L'adresse suit le brouillon créé : recharger la page reprend l'édition au lieu d'en créer un second.
        await this.router.navigate(['/admin/elections', created.id, 'edit'], { replaceUrl: true });
      }
      await this.load();
      this.step.set('positions');
    }).then(() => undefined);
  }

  // ------------------------------------------------------------------ étape 2 : postes

  protected addPosition(): Promise<void> {
    return this.run(async () => {
      const v = this.position.getRawValue();
      await this.api.addPosition(this.electionId(), { title: v.title, ...(v.titleAr ? { titleAr: v.titleAr } : {}), seats: v.seats, maxChoices: 1 });
      this.position.reset({ title: '', titleAr: '', seats: 1 });
      await this.load();
    }).then(() => undefined);
  }

  protected removePosition(id: string): Promise<void> {
    return this.run(async () => {
      await this.api.removePosition(this.electionId(), id);
      await this.load();
    }).then(() => undefined);
  }

  // ------------------------------------------------------------------ étape 3 : règles

  private newRule() {
    return this.fb.group({ facultyId: [''], programId: [''], levelId: [''], groupId: [''] }, { validators: atLeastOneCriterion });
  }
  protected addRule(): void {
    this.rules.push(this.newRule());
  }
  protected removeRule(i: number): void {
    this.rules.removeAt(i);
  }
  protected setWhole(value: boolean): void {
    this.whole.set(value);
  }
  protected rulesInvalid(): boolean {
    return !this.whole() && (this.rules.length === 0 || this.rules.invalid);
  }

  /** Listes déroulantes d'une règle : les choix se resserrent selon ce qui est déjà choisi (faculté → filière, filière + niveau → groupe). */
  protected options(key: 'facultyId' | 'programId' | 'levelId' | 'groupId', value: Record<string, string>): { value: string; label: string }[] {
    const o = this.overview();
    if (!o) return [];
    const n = (x: { name: string; nameAr?: string | null }) => localName(x, this.lang.current());
    switch (key) {
      case 'facultyId':
        return o.faculties.map((f) => ({ value: f.id, label: n(f) }));
      case 'programId':
        return o.programs
          .filter((p) => (!value['facultyId'] || p.facultyId === value['facultyId']) && (!value['levelId'] || p.levelIds.includes(value['levelId'])))
          .map((p) => ({ value: p.id, label: n(p) }));
      case 'levelId':
        return o.levels.map((l) => ({ value: l.id, label: n(l) }));
      default: {
        const year = this.detail()?.academicYearId ?? this.info.controls.academicYearId.value;
        return o.groups
          .filter((g) => g.academicYearId === year && (!value['programId'] || g.programId === value['programId']) && (!value['levelId'] || g.levelId === value['levelId']))
          .map((g) => {
            const p = o.programs.find((x) => x.id === g.programId);
            const l = o.levels.find((x) => x.id === g.levelId);
            return { value: g.id, label: `${g.name} · ${p?.code ?? ''} ${l?.code ?? ''}`.trim() };
          });
      }
    }
  }

  protected saveRules(): Promise<void> {
    return this.run(async () => {
      const items = this.rules.getRawValue().map((r) => ({
        ...(r.facultyId ? { facultyId: r.facultyId } : {}),
        ...(r.programId ? { programId: r.programId } : {}),
        ...(r.levelId ? { levelId: r.levelId } : {}),
        ...(r.groupId ? { groupId: r.groupId } : {}),
      }));
      this.detail.set(await this.api.setRules(this.electionId(), this.whole() ? { rules: [], wholeInstitution: true } : { rules: items }));
      this.step.set('committee');
    }).then(() => undefined);
  }

  // ------------------------------------------------------------------ étape 4 : comité 🔐

  protected addMember(): Promise<void> {
    return this.run(async () => {
      await this.stepUp.run(() => this.api.addCommitteeMember(this.institutionId, this.electionId(), this.member.getRawValue().email.trim().toLowerCase()));
      this.member.reset({ email: '' });
      await this.load();
    }).then(() => undefined);
  }

  protected removeMember(m: StaffGrant): Promise<void> {
    return this.run(async () => {
      await this.stepUp.run(() => this.api.removeCommitteeMember(this.institutionId, m.assignmentId));
      await this.load();
    }).then(() => undefined);
  }
}
