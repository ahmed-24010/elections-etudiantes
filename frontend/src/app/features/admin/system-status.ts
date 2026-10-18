import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe } from '@jsverse/transloco';
import { map, startWith } from 'rxjs';
import { HealthService } from '../../core/services/health.service';

/** État du système (API + base), réservé au SUPER_ADMIN. La route publique /api/v1/health reste disponible pour la surveillance. */
@Component({
  selector: 'app-system-status',
  imports: [TranslocoPipe],
  template: `
    <section class="card app-status" aria-live="polite">
      <div class="card-header">{{ 'health.title' | transloco }}</div>
      <ul class="list-group list-group-flush">
        @if (state(); as s) {
          @if (s === 'checking') {
            <li class="list-group-item">{{ 'health.checking' | transloco }}</li>
          } @else if (s === 'unreachable') {
            <li class="list-group-item text-danger">{{ 'health.unreachable' | transloco }}</li>
          } @else {
            <li class="list-group-item d-flex justify-content-between">
              <span>{{ 'health.api' | transloco }}</span>
              <span class="badge text-bg-success">{{ 'health.ok' | transloco }}</span>
            </li>
            <li class="list-group-item d-flex justify-content-between">
              <span>{{ 'health.database' | transloco }}</span>
              <span class="badge" [class.text-bg-success]="s.database === 'ok'" [class.text-bg-danger]="s.database !== 'ok'">
                {{ (s.database === 'ok' ? 'health.ok' : 'health.down') | transloco }}
              </span>
            </li>
          }
        }
      </ul>
    </section>
  `,
})
export class SystemStatus {
  protected readonly state = toSignal(
    inject(HealthService).status().pipe(
      map((s) => s ?? ('unreachable' as const)),
      startWith('checking' as const),
    ),
  );
}
