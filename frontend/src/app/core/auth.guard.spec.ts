import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthService } from './auth.service';

describe('authGuard', () => {
  function run(isAuth: boolean, role: string | null, ...roles: any[]) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { isAuthenticated: signal(isAuth), role: signal(role) } },
      ],
    });
    return TestBed.runInInjectionContext(() => authGuard(...roles)({} as any, {} as any));
  }

  it('redirige vers /login si non connecté', () => {
    const r = run(false, null) as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(r)).toBe('/login');
  });
  it('laisse passer un utilisateur connecté sans contrainte de rôle', () => {
    expect(run(true, 'STUDENT')).toBe(true);
  });
  it('refuse un étudiant sur une route admin', () => {
    const r = run(true, 'STUDENT', 'SUPER_ADMIN') as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(r)).toBe('/');
  });
});
