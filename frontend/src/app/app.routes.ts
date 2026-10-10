import { Routes } from '@angular/router';
import { adminGuard, adminHomeGuard, guestGuard, roleGuard, studentGuard, twoFactorSetupGuard } from './core/auth/auth.guards';
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
  {
    path: 'student',
    component: StudentLayout,
    canActivate: [studentGuard],
    children: [{ path: '', pathMatch: 'full', loadComponent: () => import('./features/student/student-home').then((m) => m.StudentHome) }],
  },
  {
    path: 'admin',
    component: AdminLayout,
    canActivate: [adminGuard],
    children: [
      { path: '', pathMatch: 'full', canActivate: [adminHomeGuard], loadComponent: () => import('./features/admin/admin-home').then((m) => m.AdminHome) },
      {
        path: 'academic',
        canActivate: [roleGuard('INSTITUTION_ADMIN')],
        loadComponent: () => import('./features/admin/academic-page').then((m) => m.AcademicPage),
      },
      {
        path: 'verification',
        canActivate: [roleGuard('VERIFICATION_OFFICER')],
        loadComponent: () => import('./features/verification/queue-page').then((m) => m.QueuePage),
      },
      {
        path: 'verification/:id',
        canActivate: [roleGuard('VERIFICATION_OFFICER')],
        loadComponent: () => import('./features/verification/review-page').then((m) => m.ReviewPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
