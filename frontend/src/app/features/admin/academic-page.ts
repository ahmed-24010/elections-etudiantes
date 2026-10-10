import { Component, OnInit, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { AcademicApi, AcademicKind, AcademicOverview, localName } from '../../core/api/academic.api';
import { apiErrorKey } from '../../core/auth/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { LanguageService } from '../../core/services/language.service';

interface Target {
  kind: AcademicKind;
  id: string;
}
const same = (a: Target | null, kind: AcademicKind, id: string) => a?.kind === kind && a.id === id;
const CODE = /^[A-Za-z0-9_-]+$/;

/**
 * Structure académique de l'institution (INSTITUTION_ADMIN) : années, facultés, filières, niveaux, groupes.
 * Suppression en deux clics (confirmation). Une ressource utilisée n'est pas supprimable (409 « in_use », signalé).
 */
@Component({
  selector: 'app-academic-page',
  imports: [ReactiveFormsModule, TranslocoPipe, NgTemplateOutlet],
  template: `
    <h1 class="h3 app-page-title mb-3">{{ 'academic.title' | transloco }}</h1>
    @if (error(); as key) {
      <div class="alert alert-danger" role="alert">{{ key | transloco }}</div>
    }
    @if (ov(); as o) {
      <!-- ============ années ============ -->
      <section class="app-card p-4 mb-4">
        <h2 class="h5 app-page-title">{{ 'academic.years' | transloco }}</h2>
        <ul class="list-group list-group-flush mb-3">
          @for (y of o.years; track y.id) {
            <li class="list-group-item px-0 d-flex flex-wrap align-items-center gap-2">
              <span class="fw-bold" dir="ltr">{{ y.label }}</span>
              <span class="text-body-secondary small" dir="ltr">{{ y.startsOn.slice(0, 10) }} → {{ y.endsOn.slice(0, 10) }}</span>
              @if (y.isCurrent) {
                <span class="badge text-bg-success">{{ 'academic.current' | transloco }}</span>
              } @else {
                <button type="button" class="btn btn-sm btn-outline-primary" [disabled]="busy()" (click)="makeCurrent(y.id)">{{ 'academic.makeCurrent' | transloco }}</button>
              }
              <span class="ms-auto"><ng-container *ngTemplateOutlet="deleteBtn; context: { kind: 'years', id: y.id }" /></span>
            </li>
          } @empty {
            <li class="list-group-item px-0 text-body-secondary">{{ 'academic.none' | transloco }}</li>
          }
        </ul>
        <form class="app-inline-form" [formGroup]="yearForm" (ngSubmit)="addYear()" novalidate>
          <div><label class="form-label" for="yLabel">{{ 'academic.fields.yearLabel' | transloco }}</label>
            <input id="yLabel" class="form-control" formControlName="label" placeholder="2026-2027" dir="ltr" /></div>
          <div><label class="form-label" for="yStart">{{ 'academic.fields.startsOn' | transloco }}</label>
            <input id="yStart" type="date" class="form-control" formControlName="startsOn" /></div>
          <div><label class="form-label" for="yEnd">{{ 'academic.fields.endsOn' | transloco }}</label>
            <input id="yEnd" type="date" class="form-control" formControlName="endsOn" /></div>
          <button type="submit" class="btn btn-primary" [disabled]="busy() || yearForm.invalid">{{ 'academic.add' | transloco }}</button>
        </form>
      </section>

      <!-- ============ facultés ============ -->
      <section class="app-card p-4 mb-4">
        <h2 class="h5 app-page-title">{{ 'academic.faculties' | transloco }}</h2>
        <ul class="list-group list-group-flush mb-3">
          @for (f of o.faculties; track f.id) {
            <li class="list-group-item px-0">
              <ng-container *ngTemplateOutlet="row; context: { kind: 'faculties', item: f, label: label(f), code: f.code, showAr: true }" />
            </li>
          } @empty {
            <li class="list-group-item px-0 text-body-secondary">{{ 'academic.none' | transloco }}</li>
          }
        </ul>
        <form class="app-inline-form" [formGroup]="facultyForm" (ngSubmit)="addFaculty()" novalidate>
          <div><label class="form-label" for="fCode">{{ 'academic.fields.code' | transloco }}</label>
            <input id="fCode" class="form-control" formControlName="code" dir="ltr" /></div>
          <div><label class="form-label" for="fName">{{ 'academic.fields.name' | transloco }}</label>
            <input id="fName" class="form-control" formControlName="name" /></div>
          <div><label class="form-label" for="fNameAr">{{ 'academic.fields.nameAr' | transloco }}</label>
            <input id="fNameAr" class="form-control" formControlName="nameAr" dir="rtl" /></div>
          <button type="submit" class="btn btn-primary" [disabled]="busy() || facultyForm.invalid">{{ 'academic.add' | transloco }}</button>
        </form>
      </section>

      <!-- ============ filières ============ -->
      <section class="app-card p-4 mb-4">
        <h2 class="h5 app-page-title">{{ 'academic.programs' | transloco }}</h2>
        <ul class="list-group list-group-flush mb-3">
          @for (p of o.programs; track p.id) {
            <li class="list-group-item px-0">
              <ng-container *ngTemplateOutlet="row; context: { kind: 'programs', item: p, label: label(p), code: p.code, showAr: true }" />
            </li>
          } @empty {
            <li class="list-group-item px-0 text-body-secondary">{{ 'academic.none' | transloco }}</li>
          }
        </ul>
        <form class="app-inline-form" [formGroup]="programForm" (ngSubmit)="addProgram()" novalidate>
          <div><label class="form-label" for="pFaculty">{{ 'student.fields.faculty' | transloco }}</label>
            <select id="pFaculty" class="form-select" formControlName="facultyId">
              <option value="">{{ 'student.fields.choose' | transloco }}</option>
              @for (f of o.faculties; track f.id) { <option [value]="f.id">{{ label(f) }}</option> }
            </select></div>
          <div><label class="form-label" for="pCode">{{ 'academic.fields.code' | transloco }}</label>
            <input id="pCode" class="form-control" formControlName="code" dir="ltr" /></div>
          <div><label class="form-label" for="pName">{{ 'academic.fields.name' | transloco }}</label>
            <input id="pName" class="form-control" formControlName="name" /></div>
          <div><label class="form-label" for="pNameAr">{{ 'academic.fields.nameAr' | transloco }}</label>
            <input id="pNameAr" class="form-control" formControlName="nameAr" dir="rtl" /></div>
          <button type="submit" class="btn btn-primary" [disabled]="busy() || programForm.invalid">{{ 'academic.add' | transloco }}</button>
        </form>
      </section>

      <!-- ============ niveaux ============ -->
      <section class="app-card p-4 mb-4">
        <h2 class="h5 app-page-title">{{ 'academic.levels' | transloco }}</h2>
        <ul class="list-group list-group-flush mb-3">
          @for (l of o.levels; track l.id) {
            <li class="list-group-item px-0">
              <ng-container *ngTemplateOutlet="row; context: { kind: 'levels', item: l, label: label(l), code: l.code, showAr: true }" />
            </li>
          } @empty {
            <li class="list-group-item px-0 text-body-secondary">{{ 'academic.none' | transloco }}</li>
          }
        </ul>
        <form class="app-inline-form" [formGroup]="levelForm" (ngSubmit)="addLevel()" novalidate>
          <div><label class="form-label" for="lCode">{{ 'academic.fields.code' | transloco }}</label>
            <input id="lCode" class="form-control" formControlName="code" dir="ltr" /></div>
          <div><label class="form-label" for="lName">{{ 'academic.fields.name' | transloco }}</label>
            <input id="lName" class="form-control" formControlName="name" /></div>
          <div><label class="form-label" for="lNameAr">{{ 'academic.fields.nameAr' | transloco }}</label>
            <input id="lNameAr" class="form-control" formControlName="nameAr" dir="rtl" /></div>
          <div><label class="form-label" for="lRank">{{ 'academic.fields.rank' | transloco }}</label>
            <input id="lRank" type="number" min="0" max="100" class="form-control" formControlName="rank" dir="ltr" /></div>
          <button type="submit" class="btn btn-primary" [disabled]="busy() || levelForm.invalid">{{ 'academic.add' | transloco }}</button>
        </form>
      </section>

      <!-- ============ groupes ============ -->
      <section class="app-card p-4 mb-4">
        <h2 class="h5 app-page-title">{{ 'academic.groups' | transloco }}</h2>
        <ul class="list-group list-group-flush mb-3">
          @for (g of o.groups; track g.id) {
            <li class="list-group-item px-0">
              <ng-container *ngTemplateOutlet="row; context: { kind: 'groups', item: g, label: g.name, code: groupPath(o, g), showAr: false }" />
            </li>
          } @empty {
            <li class="list-group-item px-0 text-body-secondary">{{ 'academic.none' | transloco }}</li>
          }
        </ul>
        <form class="app-inline-form" [formGroup]="groupForm" (ngSubmit)="addGroup()" novalidate>
          <div><label class="form-label" for="gProgram">{{ 'student.fields.program' | transloco }}</label>
            <select id="gProgram" class="form-select" formControlName="programId">
              <option value="">{{ 'student.fields.choose' | transloco }}</option>
              @for (p of o.programs; track p.id) { <option [value]="p.id">{{ label(p) }}</option> }
            </select></div>
          <div><label class="form-label" for="gLevel">{{ 'student.fields.level' | transloco }}</label>
            <select id="gLevel" class="form-select" formControlName="levelId">
              <option value="">{{ 'student.fields.choose' | transloco }}</option>
              @for (l of o.levels; track l.id) { <option [value]="l.id">{{ label(l) }}</option> }
            </select></div>
          <div><label class="form-label" for="gYear">{{ 'academic.fields.year' | transloco }}</label>
            <select id="gYear" class="form-select" formControlName="academicYearId">
              <option value="">{{ 'student.fields.choose' | transloco }}</option>
              @for (y of o.years; track y.id) { <option [value]="y.id">{{ y.label }}</option> }
            </select></div>
          <div><label class="form-label" for="gName">{{ 'academic.fields.groupName' | transloco }}</label>
            <input id="gName" class="form-control" formControlName="name" /></div>
          <button type="submit" class="btn btn-primary" [disabled]="busy() || groupForm.invalid">{{ 'academic.add' | transloco }}</button>
        </form>
      </section>
    } @else if (!error()) {
      <p>{{ 'common.loading' | transloco }}</p>
    }

    <!-- Ligne d'une entité : affichage, ou édition du nom (et du nom arabe) -->
    <ng-template #row let-kind="kind" let-item="item" let-label="label" let-code="code" let-showAr="showAr">
      @if (isEditing(kind, item.id)) {
        <form class="app-inline-form" (ngSubmit)="saveEdit()" novalidate>
          <div><label class="form-label" [for]="'e-name-' + item.id">{{ 'academic.fields.name' | transloco }}</label>
            <input [id]="'e-name-' + item.id" class="form-control" [formControl]="editName" /></div>
          @if (showAr) {
            <div><label class="form-label" [for]="'e-ar-' + item.id">{{ 'academic.fields.nameAr' | transloco }}</label>
              <input [id]="'e-ar-' + item.id" class="form-control" [formControl]="editNameAr" dir="rtl" /></div>
          }
          <button type="submit" class="btn btn-primary" [disabled]="busy() || editName.invalid">{{ 'common.save' | transloco }}</button>
          <button type="button" class="btn btn-outline-primary" (click)="editing.set(null)">{{ 'common.cancel' | transloco }}</button>
        </form>
      } @else {
        <div class="d-flex flex-wrap align-items-center gap-2">
          <span class="fw-bold">{{ label }}</span>
          <span class="text-body-secondary small" dir="ltr">{{ code }}</span>
          <span class="ms-auto d-flex gap-2">
            <button type="button" class="btn btn-sm btn-outline-primary" [disabled]="busy()" (click)="startEdit(kind, item)">{{ 'academic.edit' | transloco }}</button>
            <ng-container *ngTemplateOutlet="deleteBtn; context: { kind: kind, id: item.id }" />
          </span>
        </div>
      }
    </ng-template>

    <!-- Suppression en deux clics -->
    <ng-template #deleteBtn let-kind="kind" let-id="id">
      @if (isConfirming(kind, id)) {
        <button type="button" class="btn btn-sm btn-danger" [disabled]="busy()" (click)="remove(kind, id)">{{ 'academic.confirmDelete' | transloco }}</button>
        <button type="button" class="btn btn-sm btn-outline-primary" (click)="confirming.set(null)">{{ 'common.cancel' | transloco }}</button>
      } @else {
        <button type="button" class="btn btn-sm btn-outline-primary" [disabled]="busy()" (click)="confirming.set({ kind: kind, id: id })">{{ 'academic.delete' | transloco }}</button>
      }
    </ng-template>
  `,
})
export class AcademicPage implements OnInit {
  private readonly api = inject(AcademicApi);
  private readonly auth = inject(AuthService);
  private readonly lang = inject(LanguageService);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly ov = signal<AcademicOverview | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly editing = signal<Target | null>(null);
  protected readonly confirming = signal<Target | null>(null);
  protected readonly editName = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(255)] });
  protected readonly editNameAr = new FormControl('', { nonNullable: true, validators: [Validators.maxLength(255)] });

  protected readonly yearForm = this.fb.group({
    label: ['', [Validators.required, Validators.pattern(/^\d{4}-\d{4}$/)]],
    startsOn: ['', [Validators.required]],
    endsOn: ['', [Validators.required]],
  });
  protected readonly facultyForm = this.fb.group({
    code: ['', [Validators.required, Validators.maxLength(32), Validators.pattern(CODE)]],
    name: ['', [Validators.required, Validators.maxLength(255)]],
    nameAr: ['', [Validators.maxLength(255)]],
  });
  protected readonly programForm = this.fb.group({
    facultyId: ['', [Validators.required]],
    code: ['', [Validators.required, Validators.maxLength(32), Validators.pattern(CODE)]],
    name: ['', [Validators.required, Validators.maxLength(255)]],
    nameAr: ['', [Validators.maxLength(255)]],
  });
  protected readonly levelForm = this.fb.group({
    code: ['', [Validators.required, Validators.maxLength(16), Validators.pattern(CODE)]],
    name: ['', [Validators.required, Validators.maxLength(100)]],
    nameAr: ['', [Validators.maxLength(100)]],
    rank: [1, [Validators.required, Validators.min(0), Validators.max(100)]],
  });
  protected readonly groupForm = this.fb.group({
    programId: ['', [Validators.required]],
    levelId: ['', [Validators.required]],
    academicYearId: ['', [Validators.required]],
    name: ['', [Validators.required, Validators.maxLength(32)]],
  });

  private institutionId = '';

  async ngOnInit(): Promise<void> {
    this.institutionId = this.auth.institutionIdFor('INSTITUTION_ADMIN') ?? '';
    if (!this.institutionId) {
      this.error.set('errors.forbidden');
      return;
    }
    await this.reload();
  }

  protected label(item: { name: string; nameAr?: string | null }): string {
    return localName(item, this.lang.current());
  }

  protected groupPath(o: AcademicOverview, g: { programId: string; levelId: string; academicYearId: string }): string {
    const program = o.programs.find((p) => p.id === g.programId);
    const level = o.levels.find((l) => l.id === g.levelId);
    const year = o.years.find((y) => y.id === g.academicYearId);
    return [program?.code, level?.code, year?.label].filter(Boolean).join(' · ');
  }

  protected isEditing(kind: AcademicKind, id: string): boolean {
    return same(this.editing(), kind, id);
  }
  protected isConfirming(kind: AcademicKind, id: string): boolean {
    return same(this.confirming(), kind, id);
  }

  protected startEdit(kind: AcademicKind, item: { id: string; name: string; nameAr?: string | null }): void {
    this.confirming.set(null);
    this.editName.setValue(item.name);
    this.editNameAr.setValue(item.nameAr ?? '');
    this.editing.set({ kind, id: item.id });
  }

  private async reload(): Promise<void> {
    try {
      this.ov.set(await this.api.overview(this.institutionId));
    } catch (e) {
      this.error.set(apiErrorKey(e));
    }
  }

  /** Exécute une écriture puis recharge la structure ; l'erreur éventuelle est affichée en haut de page. */
  private async run(action: () => Promise<unknown>): Promise<boolean> {
    if (this.busy()) return false;
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
      await this.reload();
      return true;
    } catch (e) {
      this.error.set(apiErrorKey(e));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  /** Retire les champs facultatifs vides : le serveur les refuserait ou les stockerait vides. */
  private clean<T extends Record<string, unknown>>(v: T): Record<string, unknown> {
    return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== ''));
  }

  protected async addYear(): Promise<void> {
    if (this.yearForm.invalid) return;
    if (await this.run(() => this.api.create(this.institutionId, 'years', this.yearForm.getRawValue()))) this.yearForm.reset();
  }
  protected async addFaculty(): Promise<void> {
    if (this.facultyForm.invalid) return;
    if (await this.run(() => this.api.create(this.institutionId, 'faculties', this.clean(this.facultyForm.getRawValue())))) this.facultyForm.reset();
  }
  protected async addProgram(): Promise<void> {
    if (this.programForm.invalid) return;
    if (await this.run(() => this.api.create(this.institutionId, 'programs', this.clean(this.programForm.getRawValue())))) this.programForm.reset();
  }
  protected async addLevel(): Promise<void> {
    if (this.levelForm.invalid) return;
    if (await this.run(() => this.api.create(this.institutionId, 'levels', this.clean(this.levelForm.getRawValue())))) this.levelForm.reset({ rank: 1 });
  }
  protected async addGroup(): Promise<void> {
    if (this.groupForm.invalid) return;
    if (await this.run(() => this.api.create(this.institutionId, 'groups', this.groupForm.getRawValue()))) this.groupForm.reset();
  }

  protected makeCurrent(id: string): Promise<boolean> {
    return this.run(() => this.api.setCurrentYear(this.institutionId, id));
  }

  protected async saveEdit(): Promise<void> {
    const target = this.editing();
    if (!target || this.editName.invalid) return;
    const body: Record<string, unknown> = { name: this.editName.value };
    if (target.kind !== 'groups') body['nameAr'] = this.editNameAr.value;
    if (await this.run(() => this.api.update(this.institutionId, target.kind, target.id, body))) this.editing.set(null);
  }

  protected async remove(kind: AcademicKind, id: string): Promise<void> {
    this.confirming.set(null);
    await this.run(() => this.api.remove(this.institutionId, kind, id));
  }
}
