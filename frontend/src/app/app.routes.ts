import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login').then((m) => m.Login) },
  { path: '', canActivate: [authGuard()], loadComponent: () => import('./pages/home').then((m) => m.Home) },
  { path: '**', redirectTo: '' },
];
