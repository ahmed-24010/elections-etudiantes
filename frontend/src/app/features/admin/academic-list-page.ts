import { NgTemplateOutlet } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AcademicApi, AcademicKind, AcademicOverview, Group, Level, Program, localName } from '../../core/api/academic.api';
import { apiErrorKey } from '../../core/auth/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { LanguageService } from '../../core/services/language.service';
import { ltr } from '../../core/ui/ltr';
import { AppModal } from '../../shared/components/app-modal/app-modal';
import { IconMenu } from '../../shared/components/icon-menu/icon-menu';

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
  type: 'text' | 'number' | 'date' | 'select' | 'multi';
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
  /** Pas d'option « tous » : une valeur est toujours choisie (année de la grille des groupes). */
  required?: boolean;
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
  imports: [ReactiveFormsModule, TranslocoPipe, AppModal, IconMenu, NgTemplateOutlet],
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
            @if (!f.required) {
              <option value="">{{ f.all | transloco }}</option>
            }
            @for (o of f.options(); track o.value) {
              <option [value]="o.value" [selected]="o.value === filterValue(f.key)">{{ o.label }}</option>
            }
          </select>
        }
        <span class="app-count" role="status">{{ 'common.results' | transloco: { count: kind === 'groups' ? (grid()?.count ?? 0) : visible().length } }}</span>
        <button type="button" class="btn btn-outline-primary" [disabled]="busy()" (click)="reload()" [attr.aria-label]="'common.refresh' | transloco">↻</button>
        <button type="button" class="btn btn-primary" (click)="openCreate()">+ {{ 'common.add' | transloco }}</button>
      </div>

      @if (!ov()) {
        <p>{{ 'common.loading' | transloco }}</p>
      } @else if (kind === 'groups') {
        @if (grid(); as g) {
          @if (!g.yearId || g.programs.length === 0 || g.levels.length === 0) {
            <p class="text-body-secondary mb-0">{{ (g.yearId ? 'common.noResults' : 'academic.noYear') | transloco }}</p>
          } @else {
            <!-- Grande largeur : niveaux en lignes, filières en colonnes -->
            <table class="app-grid d-none d-md-table">
              <thead>
                <tr>
                  <th scope="col"><span class="visually-hidden">{{ 'academic.cols.level' | transloco }}</span></th>
                  @for (p of g.programs; track p.id) {
                    <th scope="col"><abbr [title]="name(p)">{{ p.code }}</abbr></th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (l of g.levels; track l.id) {
                  <tr>
                    <th scope="row"><abbr [title]="name(l)">{{ l.code }}</abbr></th>
                    @for (p of g.programs; track p.id) {
                      <td>
                        @if (p.levelIds.includes(l.id)) {
                          <ng-container *ngTemplateOutlet="cell; context: { p: p, l: l, cells: g.cells }" />
                        } @else {
                          <!-- D-24 : la filière n'existe pas à ce niveau (ex. Droit privé en L1) : aucune case -->
                          <span class="app-group-na" aria-hidden="true">–</span>
                        }
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
            <!-- Mobile : une carte par filière, niveaux en liste -->
            <div class="d-md-none app-group-cards">
              @for (p of g.programs; track p.id) {
                <section class="app-group-card">
                  <h2 class="h6"><abbr [title]="name(p)">{{ p.code }}</abbr> · {{ name(p) }}</h2>
                  <ul>
                    @for (l of g.levels; track l.id) {
                      @if (p.levelIds.includes(l.id)) {
                        <li>
                          <abbr class="app-group-level" [title]="name(l)">{{ l.code }}</abbr>
                          <ng-container *ngTemplateOutlet="cell; context: { p: p, l: l, cells: g.cells }" />
                        </li>
                      }
                    }
                  </ul>
                </section>
              }
            </div>
          }
        }
      } @else if (visible().length === 0) {
        <p class="text-body-secondary mb-0">{{ 'common.noResults' | transloco }}</p>
      } @else {
        <div class="table-responsive">
          <table class="table table-sm app-table align-middle mb-0">
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
                    <button type="button" class="app-icon-action" [disabled]="busy()" [title]="'common.edit' | transloco" [attr.aria-label]="'common.editItem' | transloco: { name: rowName(r) }" (click)="openEdit(r)">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                    </button>
                    <button type="button" class="app-icon-action is-danger" [disabled]="busy()" [title]="'common.delete' | transloco" [attr.aria-label]="'common.deleteItem' | transloco: { name: rowName(r) }" (click)="confirmDelete.set(r)">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /></svg>
                    </button>
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
              @if (f.type === 'multi') {
                <div class="app-checks" role="group" [attr.aria-label]="f.label | transloco">
                  @for (o of f.options!(); track o.value) {
                    <label class="form-check form-check-inline">
                      <input class="form-check-input" type="checkbox" [checked]="multiHas(f.key, o.value)" (change)="multiToggle(f.key, o.value)" />
                      <span class="form-check-label">{{ o.label }}</span>
                    </label>
                  }
                </div>
              } @else if (f.type === 'select') {
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

    <!-- Case de la grille des groupes : badges [A] [B] (clic : Modifier / Supprimer) et bouton « + » -->
    <ng-template #cell let-p="p" let-l="l" let-cells="cells">
      <div class="app-group-cell">
        @for (g of cells[p.id + '|' + l.id]; track g.id) {
          <app-icon-menu buttonClass="app-group-badge" [label]="'academic.groupBadge' | transloco: { name: g.name, program: name(p), level: name(l) }">
            <span icon>{{ g.name }}</span>
            <button type="button" class="app-menu-item" [disabled]="busy()" (click)="editGroup(g)">{{ 'common.edit' | transloco }}</button>
            <button type="button" class="app-menu-item" [disabled]="busy()" (click)="deleteGroup(g)">{{ 'common.delete' | transloco }}</button>
          </app-icon-menu>
        }
        <button
          type="button"
          class="app-group-add"
          [disabled]="busy()"
          [title]="'common.add' | transloco"
          [attr.aria-label]="'academic.addGroupIn' | transloco: { program: name(p), level: name(l) }"
          (click)="openCreateGroup(p, l)"
        >+</button>
      </div>
    </ng-template>

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

  /** Grille des groupes : niveaux (par ordre) en lignes, filières en colonnes, groupes de l'année choisie dans chaque case. */
  protected readonly grid = computed(() => {
    const o = this.ov();
    if (!o || this.kind !== 'groups') return null;
    const f = this.filterValues();
    const yearId = f['academicYearId'] || o.years.find((y) => y.isCurrent)?.id || o.years[0]?.id || '';
    const needle = this.search().trim().toLowerCase();
    const programs = o.programs.filter((p) => !f['programId'] || p.id === f['programId']).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    const levels = o.levels.filter((l) => !f['levelId'] || l.id === f['levelId']).sort((a, b) => a.rank - b.rank);
    const cells: Record<string, Group[]> = {};
    let count = 0;
    for (const g of o.groups) {
      if (g.academicYearId !== yearId || (needle && !g.name.toLowerCase().includes(needle))) continue;
      if (!programs.some((p) => p.id === g.programId) || !levels.some((l) => l.id === g.levelId)) continue;
      (cells[g.programId + '|' + g.levelId] ??= []).push(g);
      count++;
    }
    for (const list of Object.values(cells)) list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return { yearId, programs, levels, cells, count };
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
  protected name(item: { name: string; nameAr?: string | null }): string {
    return this.n(item);
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
        return [
          code, name, nameAr, faculty,
          {
            key: 'levelIds',
            label: 'academic.cols.levels',
            value: (r) => (this.ov()?.levels ?? []).filter((l) => ((r['levelIds'] as unknown as string[]) ?? []).includes(l.id)).sort((a, b) => a.rank - b.rank).map((l) => l.code).join(' · '),
            ltr: true,
          },
        ];
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
        { key: 'academicYearId', all: 'academic.filters.allYears', options: years, field: 'academicYearId', required: true },
      ];
    }
    return [];
  }

  protected filterValue(key: string): string {
    if (this.kind === 'groups' && key === 'academicYearId') return this.grid()?.yearId ?? '';
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
        return [
          select('facultyId', 'academic.cols.faculty', faculties),
          codeField(32),
          text('name', 255),
          nameAr(255),
          { key: 'levelIds', label: 'academic.cols.levels', type: 'multi', validators: [Validators.required], options: levels, initial: [] as unknown as string },
        ];
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

  /** « + » d'une case de la grille : filière, niveau et année déjà remplis. */
  protected openCreateGroup(p: Program, l: Level): void {
    this.startForm(null, { programId: p.id, levelId: l.id, academicYearId: this.grid()?.yearId ?? '' });
  }
  protected editGroup(g: Group): void {
    this.openEdit(g as unknown as Row);
  }
  protected deleteGroup(g: Group): void {
    this.confirmDelete.set(g as unknown as Row);
  }
  protected openEdit(row: Row): void {
    this.startForm(row);
  }

  private startForm(row: Row | null, preset: Record<string, string> = {}): void {
    const controls: Record<string, [unknown, ValidatorFn[]]> = {};
    for (const f of this.fieldsFor(row)) {
      let value: unknown = f.initial ?? '';
      if (preset[f.key]) value = preset[f.key];
      if (row) value = f.type === 'date' ? this.date(row[f.key]) : f.type === 'multi' ? [...((row[f.key] as unknown as string[]) ?? [])] : (row[f.key] as string | number | null | undefined) ?? '';
      if (f.type === 'multi') value = [...(value as string[])];
      controls[f.key] = [value, f.validators];
    }
    this.form = this.fb.group(controls);
    this.formError.set(null);
    this.modal.set({ row });
  }

  /** Cases à cocher (niveaux d'une filière) : la valeur du contrôle est la liste des identifiants cochés. */
  protected multiHas(key: string, value: string): boolean {
    return ((this.form.get(key)?.value as string[]) ?? []).includes(value);
  }
  protected multiToggle(key: string, value: string): void {
    const ctrl = this.form.get(key)!;
    const cur = (ctrl.value as string[]) ?? [];
    ctrl.setValue(cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]);
    ctrl.markAsDirty();
  }

  protected closeModal(): void {
    if (!this.busy()) this.modal.set(null);
  }

  /** Corps de la requête : champs facultatifs vides omis, nombres convertis. */
  private body(row: Row | null): Record<string, unknown> {
    const raw = this.form.getRawValue() as Record<string, string | number | string[]>;
    const out: Record<string, unknown> = {};
    for (const f of this.fieldsFor(row)) {
      const v = raw[f.key];
      if (f.type === 'multi') {
        out[f.key] = v;
        continue;
      }
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
