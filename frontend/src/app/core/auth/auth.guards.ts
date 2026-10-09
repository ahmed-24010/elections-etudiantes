import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
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
