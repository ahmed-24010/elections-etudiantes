import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { Roles, RolesGuard } from './roles';

function ctx(handler: () => void, user?: { role: Role }): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  class T {
    @Roles(Role.SUPER_ADMIN) admin() {}
    open() {}
  }

  it('autorise une route sans @Roles', () => {
    expect(guard.canActivate(ctx(T.prototype.open, { role: Role.STUDENT }))).toBe(true);
  });
  it('autorise un rôle listé', () => {
    expect(guard.canActivate(ctx(T.prototype.admin, { role: Role.SUPER_ADMIN }))).toBe(true);
  });
  it('refuse un étudiant sur une route admin', () => {
    expect(() => guard.canActivate(ctx(T.prototype.admin, { role: Role.STUDENT }))).toThrow(ForbiddenException);
  });
});
