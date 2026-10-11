import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AcademicApi, AcademicKind, AcademicOverview, localName } from '../../core/api/academic.api';
import { apiErrorKey } from '../../core/auth/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { LanguageService } from '../../core/services/language.service';
import { ltr } from '../../core/ui/ltr';
import { AppModal } from '../../shared/components/app-modal/app-modal';

type Row = Record<string, string | number | boolean | null | undefined>;
interface Choice {
  value: string;
  label: string;
}

interface Column {
  key: string;
  /** Clé Transloco de l'en-tête. */
  label: string;
  value: (row: Row) => string;
  /** Nombre ou code : isolé de droite à gauche pour ne pas être inversé en arabe. */
  ltr?: boolean;
  /** Texte arabe : affiché de droite à gauche même dans l'interface française. */
  rtl?: boolean;
  badge?: (row: Row) => boolean;
}

interface Field {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select';
  validators: ValidatorFn[];
  ltr?: boolean;
  rtl?: boolean;
  /** Champ qui définit la ressource : saisi à la création, jamais modifié ensuite. */
  createOnly?: boolean;
  /** Valeur vide acceptée : le champ est alors omis de la requête. */
  optional?: boolean;
  options?: () => Choice[];
  initial?: string | number;
}

interface Filter {
  key: string;
  /** Clé Transloco de l'option « tous ». */
  all: string;
  options: () => Choice[];
  /** Colonne de la ligne comparée à la valeur du filtre. */
  field: string;
}

const CODE = /^[A-Za-z0-9_-]+$/;
/** Date saisie en AAAA-MM-JJ : le champ date du navigateur suivrait la langue du navigateur, pas celle de l'application. */
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS: readonly AcademicKind[] = ['years', 'faculties', 'programs', 'levels', 'groups'];

/**
 * Une page de liste de la structure académique (années, facultés, filières, niveaux ou groupes selon `data.kind`) :
 * titre et explication, recherche, filtres, nombre de résultats, « + Ajouter », tableau triable avec Modifier / Supprimer.
 * Ajout et modification se font dans une fenêtre. Réservé à l'INSTITUTION_ADMIN (le serveur contrôle les droits).
 */
@Component({
  selector: 'app-academic-list-page',
  imports: [ReactiveFormsModule, TranslocoPipe, AppModal],
  template: `
    <header class="app-page-head">
      <h1>{{ 'academic.pages.' + kind + '.title' | transloco }}</h1>
      <p>{{ 'academic.pages.' + kind + '.subtitle' | transloco }}</p>
    </header>

    @if (error(); as key) {
      <div class="alert alert-danger" role="alert">{{ key | transloco }}</div>
    }

    <section class="app-card p-3 p-md-4">
      <div class="app-toolbar">
        <input
          class="form-control app-search"
          type="search"
          [value]="search()"
          (input)="search.set($any($event.target).value)"
          [placeholder]="'common.searchPlaceholder' | transloco"
          [attr.aria-label]="'common.search' | transloco"
        />
        @for (f of filters; track f.key) {
          <select class="form-select app-filter" [attr.aria-label]="f.all | transloco" [value]="filterValue(f.key)" (change)="setFilter(f.key, $any($event.target).value)">
            <option value="">{{ f.all | transloco }}</option>
            @for (o of f.options(); track o.value) {
              <option [value]="o.value" [selected]="o.value === filterValue(f.key)">{{ o.label }}</option>
            }
          </select>
        }
        <span class="app-count" role="status">{{ 'common.results' | transloco: { count: visible().length } }}</span>
        <button type="button" class="btn btn-outline-primary" [disabled]="busy()" (click)="reload()" [attr.aria-label]="'common.refresh' | transloco">↻</button>
        <button type="button" class="btn btn-primary" (click)="openCreate()">+ {{ 'common.add' | transloco }}</button>
      </div>

      @if (!ov()) {
        <p>{{ 'common.loading' | transloco }}</p>
      } @else if (visible().length === 0) {
        <p class="text-body-secondary mb-0">{{ 'common.noResults' | transloco }}</p>
      } @else {
        <div class="table-responsive">
          <table class="table app-table align-middle mb-0">
            <thead>
              <tr>
                @for (c of columns; track c.key) {
                  <th scope="col" [attr.aria-sort]="ariaSort(c.key)">
                    <button type="button" class="app-sort" (click)="sortBy(c.key)">
                      {{ c.label | transloco }}<span aria-hidden="true">{{ sortMark(c.key) }}</span>
                    </button>
                  </th>
                }
                <th scope="col"><span class="visually-hidden">{{ 'common.actions' | transloco }}</span></th>
              </tr>
            </thead>
            <tbody>
              @for (r of visible(); track r['id']) {
                <tr>
                  @for (c of columns; track c.key) {
                    <td>
                      @if (c.badge) {
                        @if (c.badge(r)) {
                          <span class="badge text-bg-success">{{ 'academic.current' | transloco }}</span>
                        }
                      } @else if (c.ltr) {
                        <bdi dir="ltr">{{ c.value(r) }}</bdi>
                      } @else if (c.rtl) {
                        <bdi dir="rtl">{{ c.value(r) }}</bdi>
                      } @else {
                        {{ c.value(r) }}
                      }
                    </td>
                  }
                  <td class="app-actions">
                    @if (kind === 'years' && !r['isCurrent']) {
                      <button type="button" class="btn btn-sm btn-outline-primary" [disabled]="busy()" (click)="makeCurrent(r)">{{ 'academic.makeCurrent' | transloco }}</button>
                    }
                    <button type="button" class="btn btn-sm btn-outline-primary" [disabled]="busy()" (click)="openEdit(r)">{{ 'common.edit' | transloco }}</button>
                    <button type="button" class="btn btn-sm btn-outline-primary" [disabled]="busy()" (click)="confirmDelete.set(r)">{{ 'common.delete' | transloco }}</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>

    @if (modal(); as m) {
      <app-modal [title]="('academic.pages.' + kind + (m.row ? '.edit' : '.add')) | transloco" (closed)="closeModal()">
        <form id="entity-form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
          @for (f of fieldsFor(m.row); track f.key) {
            <div class="mb-3">
              <label class="form-label" [for]="'f-' + f.key">{{ f.label | transloco }}</label>
              @if (f.type === 'select') {
                <select class="form-select" [id]="'f-' + f.key" [formControlName]="f.key">
                  <option value="">{{ 'common.choose' | transloco }}</option>
                  @for (o of f.options!(); track o.value) {
                    <option [value]="o.value">{{ o.label }}</option>
                  }
                </select>
              } @else {
                <input
                  class="form-control"
                  [id]="'f-' + f.key"
                  [formControlName]="f.key"
                  [type]="f.type === 'number' ? 'number' : 'text'"
                  [attr.dir]="f.ltr ? 'ltr' : f.rtl ? 'rtl' : null"
                  [attr.inputmode]="f.type === 'date' || f.type === 'number' ? 'numeric' : null"
                  [placeholder]="f.type === 'date' ? ('academic.datePlaceholder' | transloco) : ''"
                  autocomplete="off"
                />
              }
            </div>
          }
          @if (formError(); as key) {
            <div class="alert alert-danger mb-0" role="alert">{{ key | transloco }}</div>
          }
        </form>
        <ng-container modal-footer>
          <button type="button" class="btn btn-outline-primary" [disabled]="busy()" (click)="closeModal()">{{ 'common.cancel' | transloco }}</button>
          <button type="submit" form="entity-form" class="btn btn-primary" [disabled]="busy() || form.invalid">{{ 'common.save' | transloco }}</button>
        </ng-container>
      </app-modal>
    }

    @if (confirmDelete(); as row) {
      <app-modal [title]="'common.delete' | transloco" (closed)="confirmDelete.set(null)">
        <p class="mb-0">{{ 'academic.deleteConfirm' | transloco: { name: rowName(row) } }}</p>
        <ng-container modal-footer>
          <button type="button" class="btn btn-outline-primary" [disabled]="busy()" (click)="confirmDelete.set(null)">{{ 'common.cancel' | transloco }}</button>
          <button type="button" class="btn btn-danger" [disabled]="busy()" (click)="remove(row)">{{ 'common.delete' | transloco }}</button>
        </ng-container>
      </app-modal>
    }
  `,
})
export class AcademicListPage implements OnInit {
  private readonly api = inject(AcademicApi);
  private readonly auth = inject(AuthService);
  private readonly lang = inject(LanguageService);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly kind: AcademicKind = this.readKind();

  protected readonly ov = signal<AcademicOverview | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly search = signal('');
  protected readonly filterValues = signal<Record<string, string>>({});
  protected readonly sort = signal<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  protected readonly modal = signal<{ row: Row | null } | null>(null);
  protected readonly confirmDelete = signal<Row | null>(null);
  protected form: FormGroup = this.fb.group({});

  private institutionId = '';

  protected readonly columns: Column[] = this.buildColumns();
  protected readonly filters: Filter[] = this.buildFilters();
  private readonly fields: Field[] = this.buildFields();

  /** Lignes affichées : filtrées, recherchées puis triées. */
  protected readonly visible = computed<Row[]>(() => {
    const o = this.ov();
    if (!o) return [];
    const needle = this.search().trim().toLowerCase();
    const active = this.filterValues();
    let rows = (o[this.kind] as unknown as Row[]).filter((r) => this.filters.every((f) => !active[f.key] || r[f.field] === active[f.key]));
    if (needle) rows = rows.filter((r) => this.columns.some((c) => !c.badge && c.value(r).toLowerCase().includes(needle)) || String(r['nameAr'] ?? '').toLowerCase().includes(needle));
    const s = this.sort();
    const col = s && this.columns.find((c) => c.key === s.key);
    if (col && s) {
      const sign = s.dir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => sign * col.value(a).localeCompare(col.value(b), this.lang.current(), { numeric: true }));
    }
    return rows;
  });

  async ngOnInit(): Promise<void> {
    this.institutionId = this.auth.institutionIdFor('INSTITUTION_ADMIN') ?? '';
    if (!this.institutionId) {
      this.error.set('errors.forbidden');
      return;
    }
    await this.reload();
    // Groupes : l'année courante est présélectionnée (liste plus courte).
    const current = this.ov()?.years.find((y) => y.isCurrent);
    if (this.kind === 'groups' && current) this.filterValues.set({ academicYearId: current.id });
  }

  private readKind(): AcademicKind {
    const kind = inject(ActivatedRoute).snapshot.data['kind'] as AcademicKind;
    return KINDS.includes(kind) ? kind : 'years';
  }

  // ------------------------------------------------------------------ affichage

  private n(item: { name: string; nameAr?: string | null }): string {
    return localName(item, this.lang.current());
  }
  private byId<T extends { id: string }>(list: T[] | undefined, id: unknown): T | undefined {
    return list?.find((x) => x.id === id);
  }
  private date = (v: unknown) => String(v ?? '').slice(0, 10);

  private buildColumns(): Column[] {
    const code: Column = { key: 'code', label: 'academic.cols.code', value: (r) => String(r['code']), ltr: true };
    const name: Column = { key: 'name', label: 'academic.cols.name', value: (r) => String(r['name']) };
    const nameAr: Column = { key: 'nameAr', label: 'academic.cols.nameAr', value: (r) => String(r['nameAr'] ?? ''), rtl: true };
    const faculty: Column = { key: 'facultyId', label: 'academic.cols.faculty', value: (r) => { const f = this.byId(this.ov()?.faculties, r['facultyId']); return f ? this.n(f) : ''; } };
    switch (this.kind) {
      case 'years':
        return [
          { key: 'label', label: 'academic.cols.label', value: (r) => String(r['label']), ltr: true },
          { key: 'startsOn', label: 'academic.cols.startsOn', value: (r) => this.date(r['startsOn']), ltr: true },
          { key: 'endsOn', label: 'academic.cols.endsOn', value: (r) => this.date(r['endsOn']), ltr: true },
          { key: 'isCurrent', label: 'academic.cols.status', value: (r) => (r['isCurrent'] ? '1' : '0'), badge: (r) => !!r['isCurrent'] },
        ];
      case 'faculties':
        return [code, name, nameAr];
      case 'programs':
        return [code, name, nameAr, faculty];
      case 'levels':
        return [code, name, nameAr, { key: 'rank', label: 'academic.cols.rank', value: (r) => String(r['rank']), ltr: true }];
      case 'groups':
        return [
          { key: 'name', label: 'academic.cols.group', value: (r) => String(r['name']) },
          { key: 'programId', label: 'academic.cols.program', value: (r) => { const p = this.byId(this.ov()?.programs, r['programId']); return p ? this.n(p) : ''; } },
          { key: 'levelId', label: 'academic.cols.level', value: (r) => { const l = this.byId(this.ov()?.levels, r['levelId']); return l ? this.n(l) : ''; } },
          { key: 'academicYearId', label: 'academic.cols.year', value: (r) => this.byId(this.ov()?.years, r['academicYearId'])?.label ?? '', ltr: true },
        ];
    }
  }

  private buildFilters(): Filter[] {
    const faculties = () => (this.ov()?.faculties ?? []).map((f) => ({ value: f.id, label: this.n(f) }));
    const programs = () => (this.ov()?.programs ?? []).map((p) => ({ value: p.id, label: this.n(p) }));
    const levels = () => (this.ov()?.levels ?? []).map((l) => ({ value: l.id, label: this.n(l) }));
    const years = () => (this.ov()?.years ?? []).map((y) => ({ value: y.id, label: ltr(y.label) }));
    if (this.kind === 'programs') return [{ key: 'facultyId', all: 'academic.filters.allFaculties', options: faculties, field: 'facultyId' }];
    if (this.kind === 'groups') {
      return [
        { key: 'programId', all: 'academic.filters.allPrograms', options: programs, field: 'programId' },
        { key: 'levelId', all: 'academic.filters.allLevels', options: levels, field: 'levelId' },
        { key: 'academicYearId', all: 'academic.filters.allYears', options: years, field: 'academicYearId' },
      ];
    }
    return [];
  }

  protected filterValue(key: string): string {
    return this.filterValues()[key] ?? '';
  }
  protected setFilter(key: string, value: string): void {
    this.filterValues.update((v) => ({ ...v, [key]: value }));
  }

  protected rowName(row: Row): string {
    return String(row['label'] ?? row['name'] ?? '');
  }

  // ------------------------------------------------------------------ tri

  protected sortBy(key: string): void {
    const s = this.sort();
    this.sort.set(s?.key === key ? (s.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' });
  }
  protected ariaSort(key: string): 'ascending' | 'descending' | 'none' {
    const s = this.sort();
    return s?.key === key ? (s.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  }
  protected sortMark(key: string): string {
    const s = this.sort();
    return s?.key === key ? (s.dir === 'asc' ? ' ▲' : ' ▼') : '';
  }

  // ------------------------------------------------------------------ formulaire

  private buildFields(): Field[] {
    const text = (key: string, max: number, extra: Partial<Field> = {}): Field => ({ key, label: `academic.cols.${key}`, type: 'text', validators: [Validators.required, Validators.maxLength(max)], ...extra });
    const nameAr = (max: number): Field => ({ key: 'nameAr', label: 'academic.cols.nameAr', type: 'text', validators: [Validators.maxLength(max)], rtl: true, optional: true });
    const codeField = (max: number): Field => text('code', max, { validators: [Validators.required, Validators.maxLength(max), Validators.pattern(CODE)], ltr: true });
    const select = (key: string, label: string, options: () => Choice[]): Field => ({ key, label, type: 'select', validators: [Validators.required], options, createOnly: true });
    const faculties = () => (this.ov()?.faculties ?? []).map((f) => ({ value: f.id, label: this.n(f) }));
    const programs = () => (this.ov()?.programs ?? []).map((p) => ({ value: p.id, label: this.n(p) }));
    const levels = () => (this.ov()?.levels ?? []).map((l) => ({ value: l.id, label: this.n(l) }));
    const years = () => (this.ov()?.years ?? []).map((y) => ({ value: y.id, label: ltr(y.label) }));
    const date = (key: string): Field => ({ key, label: `academic.cols.${key}`, type: 'date', validators: [Validators.required, Validators.pattern(DATE)], ltr: true });
    switch (this.kind) {
      case 'years':
        return [
          { key: 'label', label: 'academic.cols.label', type: 'text', validators: [Validators.required, Validators.pattern(/^\d{4}-\d{4}$/)], ltr: true },
          date('startsOn'),
          date('endsOn'),
        ];
      case 'faculties':
        return [codeField(32), text('name', 255), nameAr(255)];
      case 'programs':
        return [select('facultyId', 'academic.cols.faculty', faculties), codeField(32), text('name', 255), nameAr(255)];
      case 'levels':
        return [codeField(16), text('name', 100), nameAr(100), { key: 'rank', label: 'academic.cols.rank', type: 'number', validators: [Validators.required, Validators.min(0), Validators.max(100)], ltr: true, initial: 1 }];
      case 'groups':
        return [
          select('programId', 'academic.cols.program', programs),
          select('levelId', 'academic.cols.level', levels),
          select('academicYearId', 'academic.cols.year', years),
          text('name', 32),
        ];
    }
  }

  protected fieldsFor(row: Row | null): Field[] {
    return this.fields.filter((f) => !(row && f.createOnly));
  }

  protected openCreate(): void {
    this.startForm(null);
  }
  protected openEdit(row: Row): void {
    this.startForm(row);
  }

  private startForm(row: Row | null): void {
    const controls: Record<string, [string | number, ValidatorFn[]]> = {};
    for (const f of this.fieldsFor(row)) {
      let value: string | number = f.initial ?? '';
      if (row) value = f.type === 'date' ? this.date(row[f.key]) : (row[f.key] as string | number | null | undefined) ?? '';
      controls[f.key] = [value, f.validators];
    }
    this.form = this.fb.group(controls);
    this.formError.set(null);
    this.modal.set({ row });
  }

  protected closeModal(): void {
    if (!this.busy()) this.modal.set(null);
  }

  /** Corps de la requête : champs facultatifs vides omis, nombres convertis. */
  private body(row: Row | null): Record<string, unknown> {
    const raw = this.form.getRawValue() as Record<string, string | number>;
    const out: Record<string, unknown> = {};
    for (const f of this.fieldsFor(row)) {
      const v = raw[f.key];
      if (f.optional && v === '' && !row) continue;
      out[f.key] = f.type === 'number' ? Number(v) : v;
    }
    return out;
  }

  protected async submit(): Promise<void> {
    const m = this.modal();
    if (!m || this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.formError.set(null);
    try {
      const body = this.body(m.row);
      if (m.row) await this.api.update(this.institutionId, this.kind, String(m.row['id']), body);
      else await this.api.create(this.institutionId, this.kind, body);
      this.modal.set(null);
      await this.fetch();
    } catch (e) {
      this.formError.set(apiErrorKey(e));
    } finally {
      this.busy.set(false);
    }
  }

  // ------------------------------------------------------------------ actions

  protected async reload(): Promise<void> {
    this.error.set(null);
    await this.fetch();
  }

  private async fetch(): Promise<void> {
    try {
      this.ov.set(await this.api.overview(this.institutionId));
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
      await this.fetch();
    } catch (e) {
      this.error.set(apiErrorKey(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected makeCurrent(row: Row): Promise<void> {
    return this.act(() => this.api.setCurrentYear(this.institutionId, String(row['id'])));
  }

  protected async remove(row: Row): Promise<void> {
    this.confirmDelete.set(null);
    await this.act(() => this.api.remove(this.institutionId, this.kind, String(row['id'])));
  }
}
