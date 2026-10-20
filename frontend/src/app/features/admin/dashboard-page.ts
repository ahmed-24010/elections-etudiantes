import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Dashboard, DashboardApi, DashboardElection, DashboardReport } from '../../core/api/dashboard.api';
import { apiErrorKey } from '../../core/auth/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { LanguageService } from '../../core/services/language.service';
import { statusClass } from '../elections/election-ui';

/**
 * Tableau de bord de l'administrateur d'institution (D-48), mobile d'abord (D-37) : élections en cours et à venir, inscriptions à
 * vérifier, PV à signer. Des CHIFFRES seulement (D-02) : jamais un nom d'étudiant ni une liste de votants. En lecture seule.
 */
@Component({
  selector: 'app-dashboard-page',
  imports: [TranslocoPipe, RouterLink, DatePipe],
  template: `
    <header class="app-page-head">
      <h1>{{ 'dashboard.title' | transloco }}</h1>
      <p>{{ 'dashboard.subtitle' | transloco }}</p>
    </header>

    @if (error(); as key) {
      <div class="alert alert-danger" role="alert" data-testid="error">{{ key | transloco }}</div>
    } @else if (!data()) {
      <p>{{ 'common.loading' | transloco }}</p>
    } @else {
      @let d = data()!;
      <dl class="app-stats app-stats-4 mb-3" data-testid="counts">
        <div><dt>{{ 'dashboard.counts.votingOpen' | transloco }}</dt><dd data-testid="count-voting"><bdi dir="ltr">{{ d.counts.votingOpen }}</bdi></dd></div>
        <div><dt>{{ 'dashboard.counts.upcoming' | transloco }}</dt><dd data-testid="count-upcoming"><bdi dir="ltr">{{ d.counts.upcoming }}</bdi></dd></div>
        <div><dt>{{ 'dashboard.counts.verifications' | transloco }}</dt><dd data-testid="count-verifications"><bdi dir="ltr">{{ d.pendingVerifications }}</bdi></dd></div>
        <div><dt>{{ 'dashboard.counts.reports' | transloco }}</dt><dd data-testid="count-reports"><bdi dir="ltr">{{ d.reportsToSign.count }}</bdi></dd></div>
      </dl>

      <section class="app-card p-3 mb-3" data-testid="in-progress">
        <h2 class="h5 app-page-title">{{ 'dashboard.inProgress' | transloco }}</h2>
        @for (e of d.inProgress; track e.id) {
          <article class="app-dash-item" [attr.data-testid]="'election-' + e.id">
            <div class="d-flex flex-wrap align-items-center gap-2">
              <a class="fw-semibold" [routerLink]="['/admin/elections', e.id]">{{ title(e) }}</a>
              @if (e.round > 1) {
                <span class="badge text-bg-warning">{{ 'dashboard.round' | transloco: { round: e.round } }}</span>
              }
              <span class="badge" [class]="badge(e)">{{ 'elections.status.' + e.status | transloco }}</span>
            </div>
            <p class="small text-body-secondary mb-1"><bdi dir="ltr">{{ e.votingStartsAt | date: 'yyyy-MM-dd HH:mm' }}</bdi> → <bdi dir="ltr">{{ e.votingEndsAt | date: 'yyyy-MM-dd HH:mm' }}</bdi></p>
            @if (e.participation; as p) {
              <p class="mb-0" data-testid="participation">
                <bdi dir="ltr"><strong>{{ p.voted }}</strong> / {{ p.registered }}</bdi> · <bdi dir="ltr">{{ p.rate }} %</bdi>
                @if (p.sliced) {
                  <span class="small text-body-secondary"> · {{ 'dashboard.asOf' | transloco: { time: (p.asOf | date: 'HH:mm') } }}</span>
                }
              </p>
            }
          </article>
        } @empty {
          <p class="text-body-secondary mb-0" data-testid="none-in-progress">{{ 'dashboard.noneInProgress' | transloco }}</p>
        }
      </section>

      <section class="app-card p-3 mb-3" data-testid="upcoming">
        <h2 class="h5 app-page-title">{{ 'dashboard.upcoming' | transloco }}</h2>
        @for (e of d.upcoming; track e.id) {
          <article class="app-dash-item">
            <a class="fw-semibold" [routerLink]="['/admin/elections', e.id]">{{ title(e) }}</a>
            <p class="small text-body-secondary mb-0">{{ 'dashboard.startsAt' | transloco }} <bdi dir="ltr">{{ e.votingStartsAt | date: 'yyyy-MM-dd HH:mm' }}</bdi></p>
          </article>
        } @empty {
          <p class="text-body-secondary mb-0">{{ 'dashboard.noneUpcoming' | transloco }}</p>
        }
      </section>

      <section class="app-card p-3 mb-3" data-testid="verifications">
        <h2 class="h5 app-page-title">{{ 'dashboard.verificationsTitle' | transloco }}</h2>
        <p class="mb-0">{{ 'dashboard.verificationsText' | transloco: { count: d.pendingVerifications } }}</p>
      </section>

      <section class="app-card p-3 mb-3" data-testid="reports">
        <h2 class="h5 app-page-title">{{ 'dashboard.reportsTitle' | transloco }}</h2>
        @for (r of d.reportsToSign.items; track r.electionId) {
          <article class="app-dash-item" [attr.data-testid]="'report-' + r.electionId">
            <a class="fw-semibold" [routerLink]="['/admin/elections', r.electionId, 'results']">{{ reportTitle(r) }}</a>
            @if (r.verificationCode) {
              <code class="app-code ms-1" dir="ltr">{{ r.verificationCode }}</code>
            }
          </article>
        } @empty {
          <p class="text-body-secondary mb-0" data-testid="none-to-sign">{{ 'dashboard.noReportToSign' | transloco }}</p>
        }
        @if (d.publishedWithoutReport.count > 0) {
          <div class="alert alert-warning mt-2 mb-0" role="status" data-testid="without-report">
            {{ 'dashboard.withoutReport' | transloco: { count: d.publishedWithoutReport.count } }}
            <ul class="mb-0">
              @for (r of d.publishedWithoutReport.items; track r.electionId) {
                <li><a [routerLink]="['/admin/elections', r.electionId, 'results']">{{ reportTitle(r) }}</a></li>
              }
            </ul>
          </div>
        }
      </section>
    }
  `,
})
export class DashboardPage implements OnInit {
  private readonly api = inject(DashboardApi);
  private readonly auth = inject(AuthService);
  private readonly lang = inject(LanguageService);

  protected readonly data = signal<Dashboard | null>(null);
  protected readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    const institutionId = this.auth.institutionIdFor('INSTITUTION_ADMIN');
    if (!institutionId) {
      this.error.set('errors.forbidden');
      return;
    }
    try {
      this.data.set(await this.api.get(institutionId));
    } catch (err) {
      this.error.set(apiErrorKey(err));
    }
  }

  protected title(e: { title: string; titleAr: string | null }): string {
    return this.lang.current() === 'ar' && e.titleAr ? e.titleAr : e.title;
  }
  protected reportTitle(r: DashboardReport): string {
    return this.title(r);
  }
  protected badge(e: DashboardElection): string {
    return statusClass(e.status);
  }
}
