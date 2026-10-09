import { Routes } from '@angular/router';
import { AdminLayout } from './layout/admin/admin-layout';
import { PublicLayout } from './layout/public/public-layout';
import { StudentLayout } from './layout/student/student-layout';

// Les guards d'authentification arrivent au Sprint 2 ; les layouts student/admin sont vides.
export const routes: Routes = [
  {
    path: '',
    component: PublicLayout,
    children: [{ path: '', pathMatch: 'full', loadComponent: () => import('./features/home/home-page').then((m) => m.HomePage) }],
  },
  { path: 'student', component: StudentLayout },
  { path: 'admin', component: AdminLayout },
  { path: '**', redirectTo: '' },
];
