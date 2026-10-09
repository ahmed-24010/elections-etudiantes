import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { HealthStatus } from '../models/health.model';

@Injectable({ providedIn: 'root' })
export class HealthService {
  private readonly http = inject(HttpClient);

  /** Renvoie l'état, ou null si le serveur est injoignable. Un 503 (base down) porte quand même un état. */
  status(): Observable<HealthStatus | null> {
    return this.http.get<HealthStatus>(`${environment.apiUrl}/health`).pipe(
      catchError((err: HttpErrorResponse) => of(err.status === 503 && err.error?.api ? (err.error as HealthStatus) : null)),
    );
  }
}
