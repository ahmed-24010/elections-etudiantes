import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

/** Routes d'authentification : jamais de jeton ajouté, jamais de renouvellement en cas de 401. */
const AUTH_PATHS = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'];
const isApi = (url: string) => url.startsWith(`${environment.apiUrl}/`);
const isAuthPath = (url: string) => AUTH_PATHS.some((p) => url.startsWith(`${environment.apiUrl}${p}`));

const withToken = (req: HttpRequest<unknown>, token: string | null) =>
  token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

/**
 * Ajoute le jeton d'accès (en mémoire) aux appels API. Sur 401, renouvelle le jeton UNE fois (coordonné entre
 * onglets) et rejoue la requête ; si le renouvellement échoue, la session est terminée.
 * Un 401 « step_up_required » n'est pas une session expirée : il est transmis tel quel à l'appelant.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // Hors API, routes d'auth, ou en-tête déjà posé explicitement (jeton de configuration 2FA) : on ne touche à rien.
  if (!isApi(req.url) || isAuthPath(req.url) || req.headers.has('Authorization')) return next(req);

  const auth = inject(AuthService);
  return next(withToken(req, auth.accessToken())).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse) || err.status !== 401 || err.error?.message === 'step_up_required') {
        return throwError(() => err);
      }
      return from(auth.refreshAccessToken()).pipe(
        catchError((refreshErr) => {
          auth.sessionExpired();
          return throwError(() => refreshErr);
        }),
        switchMap((token) => next(withToken(req, token))),
      );
    }),
  );
};
