import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { AcademicApi, AcademicOverview, localName } from '../../core/api/academic.api';
import { ACCEPTED_TYPES, AppNotification, EnrollmentApi, MAX_UPLOAD_BYTES, StudentMe } from '../../core/api/enrollment.api';
import { apiErrorKey } from '../../core/auth/api-error';
import { LanguageService } from '../../core/services/language.service';

/** Ce que voit l'étudiant : où il en est (cinq états), la suite à donner, et ses notifications. */
export type StudentState = 'NO_YEAR' | 'NOT_DECLARED' | 'NEEDS_DOCUMENT' | 'UNDER_REVIEW' | 'VERIFIED' | 'REJECTED';

export function studentState(me: StudentMe | null): StudentState {
  if (!me?.currentYear) return 'NO_YEAR';
  if (!me.enrollment) return 'NOT_DECLARED';
  if (me.enrollment.status === 'VERIFIED') return 'VERIFIED';
  if (me.enrollment.status === 'REJECTED') return 'REJECTED';
  return me.document?.status === 'UPLOADED' ? 'UNDER_REVIEW' : 'NEEDS_DOCUMENT';
}

@Component({
  selector: 'app-student-home',
  imports: [ReactiveFormsModule, TranslocoPipe, DatePipe],
  template: `
    <section class="app-card p-4 mb-4">
      <h1 class="h3 app-page-title">{{ 'student.welcome.title' | transloco }}</h1>
      <p class="lead mb-0">{{ 'student.welcome.text' | transloco }}</p>
    </section>

    @if (loadError(); as key) {
      <div class="alert alert-danger" role="alert">{{ key | transloco }}</div>
    } @else if (!me()) {
      <p>{{ 'common.loading' | transloco }}</p>
    } @else {
      <section class="app-card p-4 mb-4" aria-live="polite">
        <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
          <h2 class="h5 app-page-title mb-0">{{ 'student.status.title' | transloco }}</h2>
          <span class="badge" [class]="badgeClass()" data-testid="state">{{ 'student.status.' + state() | transloco }}</span>
        </div>
        <p class="mb-0">{{ 'student.status.help.' + state() | transloco }}</p>
        @if (me()?.currentYear; as year) {
          <p class="text-body-secondary small mb-0 mt-2">{{ 'student.year' | transloco }} : {{ year.label }}</p>
        }
        @if (state() === 'REJECTED' && me()?.enrollment; as e) {
          <div class="alert alert-danger mt-3 mb-0" role="alert">
            @if (e.rejectionCode) {
              <strong>{{ 'verification.codes.' + e.rejectionCode | transloco }}</strong>
            }
            @if (e.rejectionReason) {
              <div>{{ e.rejectionReason }}</div>
            }
          </div>
        }
      </section>

      @if (state() === 'VERIFIED' || state() === 'UNDER_REVIEW') {
        <section class="app-card p-4 mb-4">
          <h2 class="h5 app-page-title">{{ 'student.enrollment.summary' | transloco }}</h2>
          @if (me()?.student; as s) {
            <dl class="row mb-0">
              <dt class="col-sm-4">{{ 'student.fields.name' | transloco }}</dt>
              <dd class="col-sm-8">{{ s.firstName }} {{ s.lastName }}</dd>
              <dt class="col-sm-4">{{ 'student.fields.studentNumber' | transloco }}</dt>
              <dd class="col-sm-8"><bdi dir="ltr">{{ s.studentNumber }}</bdi></dd>
              @if (me()?.enrollment; as e) {
                <dt class="col-sm-4">{{ 'student.fields.faculty' | transloco }}</dt>
                <dd class="col-sm-8">{{ name(e.faculty) }}</dd>
                <dt class="col-sm-4">{{ 'student.fields.program' | transloco }}</dt>
                <dd class="col-sm-8">{{ name(e.program) }}</dd>
                <dt class="col-sm-4">{{ 'student.fields.level' | transloco }}</dt>
                <dd class="col-sm-8">{{ name(e.level) }}</dd>
                @if (e.group) {
                  <dt class="col-sm-4">{{ 'student.fields.group' | transloco }}</dt>
                  <dd class="col-sm-8">{{ e.group.name }}</dd>
                }
              }
            </dl>
          }
        </section>
      }

      @if (me()?.canEdit && overview(); as ov) {
        <section class="app-card p-4 mb-4">
          <h2 class="h5 app-page-title">{{ 'student.enrollment.title' | transloco }}</h2>
          <form [formGroup]="form" (ngSubmit)="save()" novalidate>
            <div class="row g-3">
              <div class="col-12 col-md-6">
                <label class="form-label" for="studentNumber">{{ 'student.fields.studentNumber' | transloco }}</label>
                <input id="studentNumber" class="form-control" formControlName="studentNumber" dir="ltr" autocomplete="off" />
                <div class="form-text">{{ 'student.fields.studentNumberHint' | transloco }}</div>
              </div>
              <div class="col-12 col-md-6"></div>
              <div class="col-12 col-md-6">
                <label class="form-label" for="firstName">{{ 'student.fields.firstName' | transloco }}</label>
                <input id="firstName" class="form-control" formControlName="firstName" autocomplete="given-name" />
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label" for="lastName">{{ 'student.fields.lastName' | transloco }}</label>
                <input id="lastName" class="form-control" formControlName="lastName" autocomplete="family-name" />
              </div>
              <div class="col-12">
                <label class="form-label" for="fullNameAr">{{ 'student.fields.fullNameAr' | transloco }}</label>
                <input id="fullNameAr" class="form-control" formControlName="fullNameAr" dir="rtl" />
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label" for="facultyId">{{ 'student.fields.faculty' | transloco }}</label>
                <select id="facultyId" class="form-select" formControlName="facultyId">
                  <option value="">{{ 'student.fields.choose' | transloco }}</option>
                  @for (f of ov.faculties; track f.id) {
                    <option [value]="f.id">{{ name(f) }}</option>
                  }
                </select>
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label" for="programId">{{ 'student.fields.program' | transloco }}</label>
                <select id="programId" class="form-select" formControlName="programId">
                  <option value="">{{ 'student.fields.choose' | transloco }}</option>
                  @for (p of programs(ov); track p.id) {
                    <option [value]="p.id">{{ name(p) }}</option>
                  }
                </select>
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label" for="levelId">{{ 'student.fields.level' | transloco }}</label>
                <select id="levelId" class="form-select" formControlName="levelId">
                  <option value="">{{ 'student.fields.choose' | transloco }}</option>
                  @for (l of ov.levels; track l.id) {
                    <option [value]="l.id">{{ name(l) }}</option>
                  }
                </select>
              </div>
              @if (groups(ov).length) {
                <div class="col-12 col-md-6">
                  <label class="form-label" for="groupId">{{ 'student.fields.group' | transloco }}</label>
                  <select id="groupId" class="form-select" formControlName="groupId">
                    <option value="">{{ 'student.fields.noGroup' | transloco }}</option>
                    @for (g of groups(ov); track g.id) {
                      <option [value]="g.id">{{ g.name }}</option>
                    }
                  </select>
                </div>
              }
            </div>
            @if (formError(); as key) {
              <div class="alert alert-danger mt-3 mb-0" role="alert">{{ key | transloco }}</div>
            }
            <button type="submit" class="btn btn-primary mt-3" [disabled]="busy() || form.invalid">{{ 'student.enrollment.save' | transloco }}</button>
          </form>
        </section>
      }

      @if (me()?.canUpload) {
        <section class="app-card p-4 mb-4">
          <h2 class="h5 app-page-title">{{ 'student.document.title' | transloco }}</h2>
          <p>{{ 'student.document.help' | transloco }}</p>
          <label class="form-label" for="document">{{ 'student.document.choose' | transloco }}</label>
          <input id="document" type="file" class="form-control" [accept]="accepted" (change)="pick($event)" />
          @if (uploadError(); as key) {
            <div class="alert alert-danger mt-3 mb-0" role="alert">{{ key | transloco }}</div>
          }
          <button type="button" class="btn btn-success mt-3" [disabled]="busy() || !file()" (click)="upload()">{{ 'student.document.send' | transloco }}</button>
        </section>
      }

      <section class="app-card p-4 mb-4">
        <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
          <h2 class="h5 app-page-title mb-0">{{ 'notifications.title' | transloco }}</h2>
          @if (unread() > 0) {
            <button type="button" class="btn btn-sm btn-outline-primary" (click)="readAll()">{{ 'notifications.markAllRead' | transloco }}</button>
          }
        </div>
        @if (notifications().length === 0) {
          <p class="text-body-secondary mb-0">{{ 'notifications.empty' | transloco }}</p>
        } @else {
          <ul class="list-group list-group-flush">
            @for (n of notifications(); track n.id) {
              <li class="list-group-item px-0" [class.fw-bold]="!n.readAt">
                <div>{{ 'notifications.types.' + n.type | transloco }}</div>
                @if (n.body) {
                  <div class="small text-body-secondary fw-normal">{{ n.body }}</div>
                }
                <div class="small text-body-secondary fw-normal" dir="ltr">{{ n.createdAt | date: 'yyyy-MM-dd HH:mm' }}</div>
              </li>
            }
          </ul>
        }
      </section>
    }
  `,
})
export class StudentHome implements OnInit {
  private readonly enrollments = inject(EnrollmentApi);
  private readonly academic = inject(AcademicApi);
  private readonly lang = inject(LanguageService);

  protected readonly accepted = ACCEPTED_TYPES;
  protected readonly me = signal<StudentMe | null>(null);
  protected readonly overview = signal<AcademicOverview | null>(null);
  protected readonly notifications = signal<AppNotification[]>([]);
  protected readonly unread = signal(0);
  protected readonly loadError = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly uploadError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly file = signal<File | null>(null);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    studentNumber: ['', [Validators.required, Validators.pattern(/^[A-Za-z0-9/_-]{3,64}$/)]],
    firstName: ['', [Validators.required, Validators.maxLength(100)]],
    lastName: ['', [Validators.required, Validators.maxLength(100)]],
    fullNameAr: ['', [Validators.maxLength(255)]],
    facultyId: ['', [Validators.required]],
    programId: ['', [Validators.required]],
    levelId: ['', [Validators.required]],
    groupId: [''],
  });

  async ngOnInit(): Promise<void> {
    this.form.controls.facultyId.valueChanges.subscribe(() => {
      this.form.controls.programId.setValue('');
      this.form.controls.groupId.setValue('');
    });
    this.form.controls.programId.valueChanges.subscribe(() => this.form.controls.groupId.setValue(''));
    this.form.controls.levelId.valueChanges.subscribe(() => this.form.controls.groupId.setValue(''));
    await this.refresh();
  }

  protected state(): StudentState {
    return studentState(this.me());
  }

  protected badgeClass(): string {
    const s = this.state();
    return s === 'VERIFIED' ? 'text-bg-success' : s === 'REJECTED' ? 'text-bg-danger' : 'text-bg-primary';
  }

  protected name(item: { name: string; nameAr?: string | null }): string {
    return localName(item, this.lang.current());
  }

  protected programs(ov: AcademicOverview) {
    const faculty = this.form.controls.facultyId.value;
    return ov.programs.filter((p) => p.facultyId === faculty);
  }

  /** Groupes de la filière, du niveau et de l'année courante choisis (le serveur revérifie la cohérence). */
  protected groups(ov: AcademicOverview) {
    const { programId, levelId } = this.form.getRawValue();
    const year = this.me()?.currentYear?.id;
    return ov.groups.filter((g) => g.programId === programId && g.levelId === levelId && g.academicYearId === year);
  }

  private async refresh(): Promise<void> {
    try {
      const me = await this.enrollments.me();
      this.me.set(me);
      if (me.canEdit) {
        const ov = await this.academic.overview(me.institutionId);
        this.overview.set(ov);
        this.prefill(me, ov);
      }
      await this.loadNotifications();
    } catch (e) {
      this.loadError.set(apiErrorKey(e));
    }
  }

  private prefill(me: StudentMe, ov: AcademicOverview): void {
    const s = me.student;
    const e = me.enrollment;
    this.form.patchValue({
      studentNumber: s?.studentNumber ?? '',
      firstName: s?.firstName ?? '',
      lastName: s?.lastName ?? '',
      fullNameAr: s?.fullNameAr ?? '',
    }, { emitEvent: false });
    // Un seul choix possible (cas d'une faculté unique) : on le sélectionne d'avance.
    const facultyId = e?.faculty.id ?? (ov.faculties.length === 1 ? ov.faculties[0].id : '');
    this.form.controls.facultyId.setValue(facultyId, { emitEvent: false });
    this.form.patchValue({ programId: e?.program.id ?? '', levelId: e?.level.id ?? '', groupId: e?.group?.id ?? '' }, { emitEvent: false });
  }

  private async loadNotifications(): Promise<void> {
    const list = await this.enrollments.notifications();
    this.notifications.set(list.items);
    this.unread.set(list.unread);
  }

  protected async readAll(): Promise<void> {
    await this.enrollments.readAll();
    await this.loadNotifications();
  }

  protected async save(): Promise<void> {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.formError.set(null);
    const v = this.form.getRawValue();
    try {
      const me = await this.enrollments.declare({
        studentNumber: v.studentNumber,
        firstName: v.firstName,
        lastName: v.lastName,
        ...(v.fullNameAr ? { fullNameAr: v.fullNameAr } : {}),
        facultyId: v.facultyId,
        programId: v.programId,
        levelId: v.levelId,
        ...(v.groupId ? { groupId: v.groupId } : {}),
      });
      this.me.set(me);
    } catch (e) {
      this.formError.set(apiErrorKey(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected pick(event: Event): void {
    const picked = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.uploadError.set(null);
    // Confort seulement : le serveur vérifie la taille et le VRAI type du fichier.
    if (picked && picked.size > MAX_UPLOAD_BYTES) {
      this.file.set(null);
      this.uploadError.set('errors.fileTooLarge');
      return;
    }
    this.file.set(picked);
  }

  protected async upload(): Promise<void> {
    const file = this.file();
    if (!file || this.busy()) return;
    this.busy.set(true);
    this.uploadError.set(null);
    try {
      await this.enrollments.upload(file);
      this.file.set(null);
      this.me.set(await this.enrollments.me());
    } catch (e) {
      this.uploadError.set(apiErrorKey(e));
    } finally {
      this.busy.set(false);
    }
  }
}
