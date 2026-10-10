import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, CanActivateFn, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { CurrentUser, Role } from './auth.models';
import { adminGuard, authGuard, guestGuard, studentGuard, twoFactorSetupGuard } from './auth.guards';
import { AuthService } from './auth.service';

const userWith = (...roles: Role[]): CurrentUser => ({
  id: 'u', email: 'a@example.test', phone: null, twoFactorEnabled: true,
  roles: roles.map((role) => ({ role, institutionId: 'i1', electionId: null })),
});

function run(guard: CanActivateFn, url = '/x'): boolean | UrlTree {
  return TestBed.runInInjectionContext(() => guard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot)) as boolean | UrlTree;
}

describe('guards (confort d’affichage ; la sécurité est dans le backend)', () => {
  let auth: AuthService;
  let router: Router;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    auth = TestBed.inject(AuthService);
    router = TestBed.inject(Router);
  });

  const redirect = (r: boolean | UrlTree) => (r instanceof UrlTree ? router.serializeUrl(r) : r);

  it('authGuard : visiteur renvoyé à la connexion avec la page demandée', () => {
    expect(redirect(run(authGuard, '/student/profil'))).toBe('/login?returnUrl=%2Fstudent%2Fprofil');
    auth.user.set(userWith('STUDENT'));
    expect(run(authGuard)).toBeTrue();
  });

  it('guestGuard : un utilisateur connecté quitte /login vers son espace', () => {
    expect(run(guestGuard)).toBeTrue();
    auth.user.set(userWith('STUDENT'));
    expect(redirect(run(guestGuard))).toBe('/student');
    auth.user.set(userWith('INSTITUTION_ADMIN'));
    expect(redirect(run(guestGuard))).toBe('/admin');
  });

  it('adminGuard : réservé aux rôles administratifs', () => {
    expect(redirect(run(adminGuard))).toBe('/login');
    auth.user.set(userWith('STUDENT'));
    expect(redirect(run(adminGuard))).toBe('/student');
    for (const role of ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'VERIFICATION_OFFICER', 'ELECTION_COMMITTEE'] as Role[]) {
      auth.user.set(userWith(role));
      expect(run(adminGuard)).toBeTrue();
    }
  });

  it('studentGuard : réservé aux étudiants ; un étudiant membre du comité y accède aussi', () => {
    expect(redirect(run(studentGuard))).toBe('/login');
    auth.user.set(userWith('SUPER_ADMIN'));
    expect(redirect(run(studentGuard))).toBe('/admin');
    auth.user.set(userWith('STUDENT', 'ELECTION_COMMITTEE'));
    expect(run(studentGuard)).toBeTrue();
  });

  it('twoFactorSetupGuard : seulement après une connexion qui a demandé la configuration (ou connecté)', () => {
    expect(redirect(run(twoFactorSetupGuard))).toBe('/login');
    auth.needsTwoFactorSetup.set(true);
    expect(run(twoFactorSetupGuard)).toBeTrue();
    auth.needsTwoFactorSetup.set(false);
    auth.user.set(userWith('STUDENT'));
    expect(run(twoFactorSetupGuard)).toBeTrue();
  });
});
