import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AuditResult, Role, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuditService } from '../audit/audit.service';
import { RequestInfo } from '../auth/auth.service';
import type { AuthUser } from '../common/authz/auth-user';
import { ConflictPolicy } from '../common/authz/conflict.policy';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly conflicts: ConflictPolicy,
  ) {}

  async getMe(actor: AuthUser) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: { id: true, email: true, phone: true, twoFactorEnabled: true, lastLoginAt: true },
    });
    return {
      ...user,
      roles: actor.roles.map((r) => ({ role: r.role, institutionId: r.institutionId, electionId: r.electionId })),
    };
  }

  /** Change le mot de passe et ferme toutes les AUTRES sessions (la session courante reste ouverte). */
  async changePassword(actor: AuthUser, currentPassword: string, newPassword: string, info: RequestInfo): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { passwordHash: true } });
    if (!(await argon2.verify(user.passwordHash, currentPassword).catch(() => false))) {
      await this.audit.record({
        actorId: actor.id,
        action: 'PASSWORD_CHANGE',
        resourceType: 'user',
        resourceId: actor.id,
        result: AuditResult.FAILURE,
        ip: info.ip,
        requestId: info.requestId,
      });
      throw new UnauthorizedException('invalid_credentials');
    }
    if (currentPassword === newPassword) throw new BadRequestException('password_unchanged');
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.prisma.user.update({ where: { id: actor.id }, data: { passwordHash } });
    await this.prisma.refreshToken.updateMany({
      where: { userId: actor.id, familyId: { not: actor.sessionId }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      actorId: actor.id,
      action: 'PASSWORD_CHANGE',
      resourceType: 'user',
      resourceId: actor.id,
      result: AuditResult.SUCCESS,
      ip: info.ip,
      requestId: info.requestId,
    });
  }

  /** Suspend un compte et ferme toutes ses sessions. Actif dès la requête suivante (les sessions sont relues en base). */
  async suspend(actor: AuthUser, targetId: string, info: RequestInfo): Promise<void> {
    this.conflicts.assertNotSelfSuspension(actor.id, targetId);
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      include: { roles: { where: { revokedAt: null } } },
    });
    if (!target) throw new NotFoundException();

    const actorIsSuperAdmin = actor.roles.some((r) => r.role === Role.SUPER_ADMIN);
    if (!actorIsSuperAdmin) {
      // Un admin d'institution ne suspend que des comptes entièrement rattachés à ses institutions, jamais un SUPER_ADMIN.
      const mine = new Set(actor.roles.filter((r) => r.role === Role.INSTITUTION_ADMIN).map((r) => r.institutionId));
      const outside = target.roles.some((r) => r.role === Role.SUPER_ADMIN || !r.institutionId || !mine.has(r.institutionId));
      if (outside) throw new ForbiddenException();
    }
    if (target.roles.some((r) => r.role === Role.SUPER_ADMIN) && target.status === UserStatus.ACTIVE) {
      const others = await this.prisma.user.count({
        where: { id: { not: target.id }, status: UserStatus.ACTIVE, roles: { some: { role: Role.SUPER_ADMIN, revokedAt: null } } },
      });
      this.conflicts.assertNotLastSuperAdmin(others);
    }

    await this.prisma.user.update({ where: { id: target.id }, data: { status: UserStatus.SUSPENDED } });
    await this.prisma.refreshToken.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.record({
      actorId: actor.id,
      action: 'USER_SUSPENDED',
      resourceType: 'user',
      resourceId: target.id,
      result: AuditResult.SUCCESS,
      ip: info.ip,
      requestId: info.requestId,
    });
  }
}
