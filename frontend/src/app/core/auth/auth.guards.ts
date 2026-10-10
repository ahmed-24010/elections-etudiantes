import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Role } from './auth.models';
import { AuthService } from './auth.service';

// Les guards ne sont qu'un confort d'affichage : la vraie protection est dans le backend (CLAUDE.md).

/** Réservé aux utilisateurs connectés ; sinon retour à la connexion en mémorisant la page demandée. */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  return auth.isAuthenticated() || inject(Router).createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

/** Réservé aux visiteurs (connexion, inscription) : un utilisateur connecté est renvoyé vers son espace. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return !auth.isAuthenticated() || inject(Router).createUrlTree([auth.homeUrl()]);
};

/** Espace administration : au moins un rôle administratif. */
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  if (!auth.isAuthenticated()) return inject(Router).createUrlTree(['/login']);
  return auth.isAdmin() || inject(Router).createUrlTree([auth.homeUrl()]);
};

/** Écran réservé à un rôle précis (ex. la file du vérificateur) ; un autre administrateur revient à l'accueil de l'administration. */
export const roleGuard =
  (role: Role): CanActivateFn =>
  () => {
    const auth = inject(AuthService);
    if (!auth.isAuthenticated()) return inject(Router).createUrlTree(['/login']);
    return auth.hasRole(role) || inject(Router).createUrlTree(['/admin']);
  };

/** Accueil de l'administration : renvoie vers l'écran du rôle (vérificateur, puis administrateur d'institution). */
export const adminHomeGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.hasRole('VERIFICATION_OFFICER')) return router.createUrlTree(['/admin/verification']);
  if (auth.hasRole('INSTITUTION_ADMIN')) return router.createUrlTree(['/admin/academic']);
  return true;
};

/** Espace étudiant : rôle STUDENT. */
export const studentGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  if (!auth.isAuthenticated()) return inject(Router).createUrlTree(['/login']);
  return auth.isStudent() || inject(Router).createUrlTree([auth.homeUrl()]);
};

/** Page de configuration 2FA : uniquement après une connexion qui a renvoyé un jeton de configuration (ou connecté). */
export const twoFactorSetupGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.needsTwoFactorSetup() || auth.isAuthenticated() || inject(Router).createUrlTree(['/login']);
};
