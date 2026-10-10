import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { localName } from '../../core/api/academic.api';
import { ReviewItem, VerificationApi } from '../../core/api/verification.api';
import { apiErrorKey } from '../../core/auth/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { LanguageService } from '../../core/services/language.service';

/** File d'attente du vérificateur : inscriptions dont l'attestation attend une décision. */
@Component({
  selector: 'app-queue-page',
  imports: [RouterLink, TranslocoPipe, DatePipe],
  template: `
    <section class="app-card p-4">
      <h1 class="h3 app-page-title">{{ 'verification.queue.title' | transloco }}</h1>
      @if (error(); as key) {
        <div class="alert alert-danger" role="alert">{{ key | transloco }}</div>
      } @else if (items() === null) {
        <p>{{ 'common.loading' | transloco }}</p>
      } @else if (items()!.length === 0) {
        <p class="text-body-secondary mb-0">{{ 'verification.queue.empty' | transloco }}</p>
      } @else {
        <div class="table-responsive">
          <table class="table align-middle mb-0">
            <thead>
              <tr>
                <th scope="col">{{ 'verification.queue.submitted' | transloco }}</th>
                <th scope="col">{{ 'student.fields.name' | transloco }}</th>
                <th scope="col">{{ 'student.fields.studentNumber' | transloco }}</th>
                <th scope="col">{{ 'student.fields.program' | transloco }}</th>
                <th scope="col">{{ 'student.fields.level' | transloco }}</th>
                <th scope="col"><span class="visually-hidden">{{ 'verification.queue.review' | transloco }}</span></th>
              </tr>
            </thead>
            <tbody>
              @for (e of items(); track e.id) {
                <tr>
                  <td><bdi dir="ltr">{{ e.submittedAt | date: 'yyyy-MM-dd HH:mm' }}</bdi></td>
                  <td>{{ e.student.firstName }} {{ e.student.lastName }}</td>
                  <td><bdi dir="ltr">{{ e.student.studentNumber }}</bdi></td>
                  <td>{{ name(e.program) }}</td>
                  <td>{{ name(e.level) }}</td>
                  <td class="text-end">
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

  async ngOnInit(): Promise<void> {
    const institutionId = this.auth.institutionIdFor('VERIFICATION_OFFICER');
    if (!institutionId) {
      this.error.set('errors.forbidden');
      return;
    }
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
