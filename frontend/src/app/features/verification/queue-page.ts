import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { localName } from '../../core/api/academic.api';
import { ReviewItem, VerificationApi } from '../../core/api/verification.api';
import { apiErrorKey } from '../../core/auth/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { LanguageService } from '../../core/services/language.service';

/** Inscriptions dont l'attestation attend une décision : recherche, filtre par filière, nombre de résultats. */
@Component({
  selector: 'app-queue-page',
  imports: [RouterLink, TranslocoPipe, DatePipe],
  template: `
    <header class="app-page-head">
      <h1>{{ 'verification.queue.title' | transloco }}</h1>
      <p>{{ 'verification.queue.subtitle' | transloco }}</p>
    </header>

    <section class="app-card p-3 p-md-4">
      <div class="app-toolbar">
        <input
          class="form-control app-search"
          type="search"
          [value]="search()"
          (input)="search.set($any($event.target).value)"
          [placeholder]="'verification.queue.searchPlaceholder' | transloco"
          [attr.aria-label]="'common.search' | transloco"
        />
        <select class="form-select app-filter" [attr.aria-label]="'academic.filters.allPrograms' | transloco" [value]="program()" (change)="program.set($any($event.target).value)">
          <option value="">{{ 'academic.filters.allPrograms' | transloco }}</option>
          @for (p of programs(); track p) {
            <option [value]="p">{{ p }}</option>
          }
        </select>
        <span class="app-count" role="status">{{ 'common.results' | transloco: { count: visible().length } }}</span>
        <button type="button" class="btn btn-outline-primary" (click)="load()" [attr.aria-label]="'common.refresh' | transloco">↻</button>
      </div>

      @if (error(); as key) {
        <div class="alert alert-danger" role="alert">{{ key | transloco }}</div>
      } @else if (items() === null) {
        <p>{{ 'common.loading' | transloco }}</p>
      } @else if (visible().length === 0) {
        <p class="text-body-secondary mb-0">{{ (items()!.length === 0 ? 'verification.queue.empty' : 'common.noResults') | transloco }}</p>
      } @else {
        <div class="table-responsive">
          <table class="table app-table align-middle mb-0">
            <thead>
              <tr>
                <th scope="col">{{ 'verification.queue.submitted' | transloco }}</th>
                <th scope="col">{{ 'student.fields.name' | transloco }}</th>
                <th scope="col">{{ 'student.fields.studentNumber' | transloco }}</th>
                <th scope="col">{{ 'student.fields.program' | transloco }}</th>
                <th scope="col">{{ 'student.fields.level' | transloco }}</th>
                <th scope="col"><span class="visually-hidden">{{ 'common.actions' | transloco }}</span></th>
              </tr>
            </thead>
            <tbody>
              @for (e of visible(); track e.id) {
                <tr>
                  <td><bdi dir="ltr">{{ e.submittedAt | date: 'yyyy-MM-dd HH:mm' }}</bdi></td>
                  <td>{{ e.student.firstName }} {{ e.student.lastName }}</td>
                  <td><bdi dir="ltr">{{ e.student.studentNumber }}</bdi></td>
                  <td>{{ name(e.program) }}</td>
                  <td>{{ name(e.level) }}</td>
                  <td class="app-actions">
                    <a class="btn btn-sm btn-primary" [routerLink]="['/admin/verification', e.id]">{{ 'verification.queue.review' | transloco }}</a>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
})
export class QueuePage implements OnInit {
  private readonly api = inject(VerificationApi);
  private readonly auth = inject(AuthService);
  private readonly lang = inject(LanguageService);

  protected readonly items = signal<ReviewItem[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly program = signal('');

  /** Filières présentes dans la file (nom affiché dans la langue courante). */
  protected readonly programs = computed(() => [...new Set((this.items() ?? []).map((e) => this.name(e.program)))].sort());

  protected readonly visible = computed(() => {
    const needle = this.search().trim().toLowerCase();
    return (this.items() ?? []).filter(
      (e) =>
        (!this.program() || this.name(e.program) === this.program()) &&
        (!needle || `${e.student.firstName} ${e.student.lastName} ${e.student.studentNumber ?? ''}`.toLowerCase().includes(needle)),
    );
  });

  ngOnInit(): Promise<void> {
    return this.load();
  }

  protected async load(): Promise<void> {
    const institutionId = this.auth.institutionIdFor('VERIFICATION_OFFICER');
    if (!institutionId) {
      this.error.set('errors.forbidden');
      return;
    }
    this.error.set(null);
    try {
      this.items.set(await this.api.queue(institutionId));
    } catch (e) {
      this.error.set(apiErrorKey(e));
    }
  }

  protected name(item: { name: string; nameAr?: string | null }): string {
    return localName(item, this.lang.current());
  }
}
