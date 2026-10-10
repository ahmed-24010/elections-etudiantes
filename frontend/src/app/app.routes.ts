import { Routes } from '@angular/router';
import { adminGuard, guestGuard, studentGuard, twoFactorSetupGuard } from './core/auth/auth.guards';
import { AdminLayout } from './layout/admin/admin-layout';
import { PublicLayout } from './layout/public/public-layout';
import { StudentLayout } from './layout/student/student-layout';

// Les guards sont un confort d'affichage : la vraie protection est dans le backend.
export const routes: Routes = [
  {
    path: '',
    component: PublicLayout,
    children: [
      { path: '', pathMatch: 'full', loadComponent: () => import('./features/home/home-page').then((m) => m.HomePage) },
      { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./features/auth/login-page').then((m) => m.LoginPage) },
      { path: 'register', canActivate: [guestGuard], loadComponent: () => import('./features/auth/register-page').then((m) => m.RegisterPage) },
      {
        path: '2fa-setup',
        canActivate: [twoFactorSetupGuard],
        loadComponent: () => import('./features/auth/two-factor-setup-page').then((m) => m.TwoFactorSetupPage),
      },
    ],
  },
  { path: 'student', component: StudentLayout, canActivate: [studentGuard] },
  { path: 'admin', component: AdminLayout, canActivate: [adminGuard] },
  { path: '**', redirectTo: '' },
];
