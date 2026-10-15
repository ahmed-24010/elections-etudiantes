import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ElectionsApi, ElectionSummary } from '../../core/api/elections.api';
import { apiErrorKey } from '../../core/auth/api-error';
import { LanguageService } from '../../core/services/language.service';
import { candidacyClass, electionTitle, statusClass } from './election-ui';

/** « Mes élections » : exactement celles qui concernent l'étudiant (éligible, à partir de l'ouverture des candidatures). */
@Component({
  selector: 'app-my-elections-page',
  imports: [TranslocoPipe, RouterLink, DatePipe],
  template: `
    <p><a routerLink="/student">{{ backArrow() }} {{ 'elections.student.backHome' | transloco }}</a></p>
    <header class="app-page-head">
      <h1>{{ 'elections.student.title' | transloco }}</h1>
      <p>{{ 'elections.student.subtitle' | transloco }}</p>
    </header>

    @if (error(); as key) {
      <div class="alert alert-danger" role="alert">{{ key | transloco }}</div>
    } @else if (!items()) {
      <p>{{ 'common.loading' | transloco }}</p>
    } @else if (items()!.length === 0) {
      <section class="app-card p-4"><p class="mb-0 text-body-secondary">{{ 'elections.student.empty' | transloco }}</p></section>
    } @else {
      <div class="row g-3">
        @for (e of items(); track e.id) {
          <div class="col-12 col-md-6">
            <article class="app-card p-3 p-md-4 h-100" [attr.data-testid]="'election-' + e.id">
              <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
                <h2 class="h5 app-page-title mb-0">{{ title(e) }}</h2>
                <span class="badge" [class]="badge(e)">{{ 'elections.status.' + e.status | transloco }}</span>
              </div>
              @if (e.candidacyStartsAt && e.candidacyEndsAt) {
                <p class="small text-body-secondary mb-1">
                  {{ 'elections.fields.candidacyPeriod' | transloco }} :
                  <bdi dir="ltr">{{ e.candidacyStartsAt | date: 'yyyy-MM-dd' }}</bdi> → <bdi dir="ltr">{{ e.candidacyEndsAt | date: 'yyyy-MM-dd' }}</bdi>
                </p>
              }
              <p class="small text-body-secondary mb-2">
                {{ 'elections.fields.votingPeriod' | transloco }} :
                <bdi dir="ltr">{{ e.votingStartsAt | date: 'yyyy-MM-dd' }}</bdi> → <bdi dir="ltr">{{ e.votingEndsAt | date: 'yyyy-MM-dd' }}</bdi>
              </p>
              @if (e.myCandidacy) {
                <p class="mb-2">
                  {{ 'elections.student.myCandidacy' | transloco }} :
                  <span class="badge" [class]="candidacy(e.myCandidacy)">{{ 'elections.candidate.status.' + e.myCandidacy | transloco }}</span>
                </p>
              }
              <div class="d-grid gap-2 d-sm-flex align-items-sm-center">
                @if (e.status === 'VOTING_OPEN') {
                  @switch (e.myVote) {
                    @case ('NOT_VOTED') {
                      <a class="btn btn-primary" [routerLink]="['/student/elections', e.id, 'vote']" data-testid="vote-link">{{ 'voting.panel.vote' | transloco }}</a>
                    }
                    @case ('VOTED') {
                      <span class="badge text-bg-success align-self-start" data-testid="voted-badge">{{ 'voting.panel.votedBadge' | transloco }}</span>
                    }
                    @case ('NOT_ON_ROLL') {
                      <span class="small text-body-secondary" data-testid="not-on-roll">{{ 'voting.panel.notOnRoll' | transloco }}</span>
                    }
                  }
                }
                <a class="btn btn-outline-primary btn-sm" [routerLink]="['/student/elections', e.id]">{{ 'elections.student.open' | transloco }}</a>
              </div>
            </article>
          </div>
        }
      </div>
    }
  `,
})
export class MyElectionsPage implements OnInit {
  private readonly api = inject(ElectionsApi);
  private readonly lang = inject(LanguageService);

  protected readonly items = signal<ElectionSummary[] | null>(null);
  protected readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      this.items.set(await this.api.mine());
    } catch (e) {
      this.error.set(apiErrorKey(e));
    }
  }

  protected backArrow(): string {
    return this.lang.dir() === 'rtl' ? '→' : '←';
  }
  protected title(e: ElectionSummary): string {
    return electionTitle(e, this.lang.current());
  }
  protected badge(e: ElectionSummary): string {
    return statusClass(e.status);
  }
  protected candidacy(status: string): string {
    return candidacyClass(status);
  }
}
