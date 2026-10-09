import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService, Role } from './auth.service';

/** Garde de route. Contrôle d'ergonomie uniquement : l'autorisation réelle est faite par le backend. */
export const authGuard = (...roles: Role[]): CanActivateFn => () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.isAuthenticated()) return router.createUrlTree(['/login']);
  const role = auth.role();
  if (roles.length && (!role || !roles.includes(role))) return router.createUrlTree(['/']);
  return true;
};
