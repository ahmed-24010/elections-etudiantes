import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ConflictPolicy } from './conflict.policy';

describe('ConflictPolicy (03 §5.2, §6)', () => {
  const p = new ConflictPolicy();

  it('personne ne s’attribue un rôle à lui-même', () => {
    expect(() => p.assertNotSelfAssignment('a', 'a')).toThrow(ForbiddenException);
    expect(() => p.assertNotSelfAssignment('a', 'b')).not.toThrow();
  });

  it('personne ne révoque son propre rôle d’admin s’il est le dernier de l’institution', () => {
    expect(() => p.assertNotLastOwnAdminRevocation('a', 'a', 0)).toThrow(ConflictException);
    expect(() => p.assertNotLastOwnAdminRevocation('a', 'a', 1)).not.toThrow();
    expect(() => p.assertNotLastOwnAdminRevocation('sa', 'a', 0)).not.toThrow();
  });

  it('le dernier SUPER_ADMIN ne peut pas être suspendu', () => {
    expect(() => p.assertNotLastSuperAdmin(0)).toThrow(ConflictException);
    expect(() => p.assertNotLastSuperAdmin(1)).not.toThrow();
  });

  it('on ne se suspend pas soi-même', () => {
    expect(() => p.assertNotSelfSuspension('a', 'a')).toThrow(ConflictException);
    expect(() => p.assertNotSelfSuspension('a', 'b')).not.toThrow();
  });
});
