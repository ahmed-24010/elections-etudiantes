import { HttpErrorResponse } from '@angular/common/http';

/** Clé Transloco du message à afficher pour une erreur API (aucun texte en dur). */
export function apiErrorKey(err: unknown): string {
  if (!(err instanceof HttpErrorResponse)) return 'errors.generic';
  const message = Array.isArray(err.error?.message) ? err.error.message[0] : err.error?.message;
  if (err.status === 0) return 'errors.network';
  if (err.status === 429) return 'errors.tooMany';
  if (err.status === 401 && message === 'invalid_credentials') return 'errors.invalidCredentials';
  if (err.status === 400 && message === 'invalid_code') return 'errors.invalidCode';
  if (err.status === 400 && message === 'invalid_institution') return 'errors.invalidInstitution';
  if (err.status === 401) return 'errors.sessionExpired';
  return 'errors.generic';
}
