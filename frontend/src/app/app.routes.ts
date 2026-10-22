import { Routes } from '@angular/router';
import { adminGuard, adminHomeGuard, anyRoleGuard, guestGuard, roleGuard, studentGuard, twoFactorSetupGuard } from './core/auth/auth.guards';
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
    children: [
      { path: '', pathMatch: 'full', loadComponent: () => import('./features/student/student-home').then((m) => m.StudentHome) },
      { path: 'elections', pathMatch: 'full', loadComponent: () => import('./features/elections/my-elections-page').then((m) => m.MyElectionsPage) },
      { path: 'elections/:id', loadComponent: () => import('./features/elections/my-election-page').then((m) => m.MyElectionPage) },
      { path: 'elections/:id/vote', loadComponent: () => import('./features/voting/vote-page').then((m) => m.VotePage) },
    ],
  },
  {
    path: 'admin',
    component: AdminLayout,
    canActivate: [adminGuard],
    children: [
      { path: '', pathMatch: 'full', canActivate: [adminHomeGuard], loadComponent: () => import('./features/admin/admin-home').then((m) => m.AdminHome) },
      { path: 'academic', pathMatch: 'full', redirectTo: 'academic/years' },
      ...(['years', 'faculties', 'programs', 'levels', 'groups'] as const).map((kind) => ({
        path: 'academic/' + kind,
        canActivate: [roleGuard('INSTITUTION_ADMIN')],
        data: { kind },
        loadComponent: () => import('./features/admin/academic-list-page').then((m) => m.AcademicListPage),
      })),
      {
        path: 'dashboard',
        canActivate: [roleGuard('INSTITUTION_ADMIN')],
        loadComponent: () => import('./features/admin/dashboard-page').then((m) => m.DashboardPage),
      },
      {
        path: 'elections',
        pathMatch: 'full',
        canActivate: [anyRoleGuard('INSTITUTION_ADMIN', 'ELECTION_COMMITTEE')],
        loadComponent: () => import('./features/elections/elections-list-page').then((m) => m.ElectionsListPage),
      },
      {
        path: 'elections/new',
        canActivate: [roleGuard('INSTITUTION_ADMIN')],
        loadComponent: () => import('./features/elections/election-wizard-page').then((m) => m.ElectionWizardPage),
      },
      {
        path: 'elections/:id/edit',
        canActivate: [anyRoleGuard('INSTITUTION_ADMIN', 'ELECTION_COMMITTEE')],
        loadComponent: () => import('./features/elections/election-wizard-page').then((m) => m.ElectionWizardPage),
      },
      {
        path: 'elections/:id/candidates',
        canActivate: [anyRoleGuard('INSTITUTION_ADMIN', 'ELECTION_COMMITTEE')],
        loadComponent: () => import('./features/elections/candidates-review-page').then((m) => m.CandidatesReviewPage),
      },
      {
        path: 'elections/:id/results',
        canActivate: [anyRoleGuard('INSTITUTION_ADMIN', 'ELECTION_COMMITTEE')],
        loadComponent: () => import('./features/elections/committee-results-page').then((m) => m.CommitteeResultsPage),
      },
      {
        path: 'elections/:id/vote',
        canActivate: [anyRoleGuard('INSTITUTION_ADMIN', 'ELECTION_COMMITTEE')],
        loadComponent: () => import('./features/elections/committee-vote-page').then((m) => m.CommitteeVotePage),
      },
      {
        path: 'elections/:id',
        canActivate: [anyRoleGuard('INSTITUTION_ADMIN', 'ELECTION_COMMITTEE')],
        loadComponent: () => import('./features/elections/election-detail-page').then((m) => m.ElectionDetailPage),
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
