import { HttpErrorResponse } from '@angular/common/http';

/** Messages de l'API (champ `message`) connus de l'interface, par statut → clé Transloco. */
const BY_MESSAGE: Record<string, string> = {
  invalid_credentials: 'errors.invalidCredentials',
  invalid_code: 'errors.invalidCode',
  invalid_institution: 'errors.invalidInstitution',
  step_up_required: 'errors.stepUpRequired',
  student_number_unavailable: 'errors.numberUnavailable',
  enrollment_verified_locked: 'errors.enrollmentLocked',
  enrollment_under_review: 'errors.enrollmentUnderReview',
  document_not_allowed: 'errors.documentNotAllowed',
  enrollment_required: 'errors.enrollmentRequired',
  no_current_year: 'errors.noCurrentYear',
  invalid_academic_choice: 'errors.invalidAcademicChoice',
  not_reviewable: 'errors.notReviewable',
  cannot_review_own_enrollment: 'errors.ownEnrollment',
  in_use: 'errors.inUse',
  already_exists: 'errors.alreadyExists',
  invalid_dates: 'errors.invalidDates',
  TOO_LARGE: 'errors.fileTooLarge',
  EMPTY: 'errors.fileEmpty',
};

/** Clé Transloco du message à afficher pour une erreur API (aucun texte en dur). */
export function apiErrorKey(err: unknown): string {
  if (!(err instanceof HttpErrorResponse)) return 'errors.generic';
  const message = Array.isArray(err.error?.message) ? err.error.message[0] : err.error?.message;
  if (err.status === 0) return 'errors.network';
  if (err.status === 429) return 'errors.tooMany';
  // 413 : réponse de l'API (TOO_LARGE) ou de nginx (même format JSON) ; 415 : type réel du fichier non accepté.
  if (err.status === 413) return 'errors.fileTooLarge';
  if (err.status === 415) return 'errors.fileType';
  if (typeof message === 'string' && BY_MESSAGE[message] && err.status !== 401) return BY_MESSAGE[message];
  if (err.status === 401 && message === 'invalid_credentials') return BY_MESSAGE['invalid_credentials'];
  if (err.status === 401 && message === 'step_up_required') return BY_MESSAGE['step_up_required'];
  if (err.status === 401) return 'errors.sessionExpired';
  if (err.status === 403) return 'errors.forbidden';
  if (err.status === 404) return 'errors.notFound';
  return 'errors.generic';
}

/** Vrai pour la réponse 401 « 2FA récente requise » (actions 🔐), qui n'est pas une session expirée. */
export function isStepUpRequired(err: unknown): boolean {
  return err instanceof HttpErrorResponse && err.status === 401 && err.error?.message === 'step_up_required';
}
