import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ElectionsApi, ElectionSummary } from '../../core/api/elections.api';
import { apiErrorKey } from '../../core/auth/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { LanguageService } from '../../core/services/language.service';
import { electionTitle, statusClass } from './election-ui';

/**
 * Élections de l'institution (administrateur d'institution : toutes ; membre du comité : les siennes).
 * Seul l'administrateur crée une élection (03 §5.4) ; le serveur contrôle les droits.
 */
@Component({
  selector: 'app-elections-list-page',
  imports: [TranslocoPipe, RouterLink, DatePipe],
  template: `
    <header class="app-page-head">
      <h1>{{ 'elections.list.title' | transloco }}</h1>
      <p>{{ 'elections.list.subtitle' | transloco }}</p>
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
        <select class="form-select app-filter" [attr.aria-label]="'elections.list.allStatuses' | transloco" [value]="status()" (change)="status.set($any($event.target).value)">
          <option value="">{{ 'elections.list.allStatuses' | transloco }}</option>
          @for (s of statuses; track s) {
            <option [value]="s" [selected]="s === status()">{{ 'elections.status.' + s | transloco }}</option>
          }
        </select>
        <span class="app-count" role="status">{{ 'common.results' | transloco: { count: visible().length } }}</span>
        @if (isAdmin) {
          <a class="btn btn-primary" routerLink="/admin/elections/new">+ {{ 'elections.list.new' | transloco }}</a>
        }
      </div>

      @if (!items()) {
        <p>{{ 'common.loading' | transloco }}</p>
      } @else if (visible().length === 0) {
        <p class="text-body-secondary mb-0">{{ 'common.noResults' | transloco }}</p>
      } @else {
        <div class="table-responsive">
          <table class="table table-sm app-table align-middle mb-0">
            <thead>
              <tr>
                <th scope="col">{{ 'elections.fields.title' | transloco }}</th>
                <th scope="col">{{ 'elections.fields.status' | transloco }}</th>
                <th scope="col">{{ 'elections.fields.votingStartsAt' | transloco }}</th>
                <th scope="col"><span class="visually-hidden">{{ 'common.actions' | transloco }}</span></th>
              </tr>
            </thead>
            <tbody>
              @for (e of visible(); track e.id) {
                <tr>
                  <td>{{ title(e) }}</td>
                  <td><span class="badge" [class]="badge(e)">{{ 'elections.status.' + e.status | transloco }}</span></td>
                  <td><bdi dir="ltr">{{ e.votingStartsAt | date: 'yyyy-MM-dd HH:mm' }}</bdi></td>
                  <td class="app-actions">
                    <a class="btn btn-sm btn-outline-primary" [routerLink]="['/admin/elections', e.id]">{{ 'elections.list.open' | transloco }}</a>
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
export class ElectionsListPage implements OnInit {
  private readonly api = inject(ElectionsApi);
  private readonly auth = inject(AuthService);
  private readonly lang = inject(LanguageService);

  protected readonly statuses = ['DRAFT', 'CANDIDACY_OPEN', 'CANDIDACY_CLOSED', 'CANCELLED'] as const;
  protected readonly items = signal<ElectionSummary[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly status = signal('');
  protected readonly isAdmin = this.auth.hasRole('INSTITUTION_ADMIN');

  protected readonly visible = computed(() => {
    const needle = this.search().trim().toLowerCase();
    return (this.items() ?? []).filter(
      (e) => (!this.status() || e.status === this.status()) && (!needle || e.title.toLowerCase().includes(needle) || (e.titleAr ?? '').toLowerCase().includes(needle)),
    );
  });

  async ngOnInit(): Promise<void> {
    const institutionId = this.auth.institutionIdFor('INSTITUTION_ADMIN') ?? this.auth.institutionIdFor('ELECTION_COMMITTEE');
    if (!institutionId) {
      this.error.set('errors.forbidden');
      return;
    }
    try {
      this.items.set(await this.api.list(institutionId));
    } catch (e) {
      this.error.set(apiErrorKey(e));
    }
  }

  protected title(e: ElectionSummary): string {
    return electionTitle(e, this.lang.current());
  }
  protected badge(e: ElectionSummary): string {
    return statusClass(e.status);
  }
}
