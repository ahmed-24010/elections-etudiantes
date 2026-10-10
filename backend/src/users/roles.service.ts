import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditResult, Role, UserStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { RequestInfo } from '../auth/auth.service';
import type { AuthUser } from '../common/authz/auth-user';
import { AuthzService } from '../common/authz/authz.service';
import { ConflictPolicy } from '../common/authz/conflict.policy';
import type { Permission } from '../common/authz/permissions';
import { PrismaService } from '../prisma/prisma.service';
import type { AssignRoleDto } from './dto/users.dto';

/** Rôles attribuables par l'API ; STUDENT vient de l'inscription, SUPER_ADMIN du seed. */
const ASSIGNABLE: readonly Role[] = [Role.INSTITUTION_ADMIN, Role.VERIFICATION_OFFICER, Role.ELECTION_COMMITTEE];
const assignPermission = (role: Role) => `role:assign:${role}` as Permission;

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthzService,
    private readonly conflicts: ConflictPolicy,
    private readonly audit: AuditService,
  ) {}

  /** Personnel de l'institution : titulaires actifs des rôles administratifs. */
  async listStaff(institutionId: string) {
    const grants = await this.prisma.roleAssignment.findMany({
      where: { institutionId, revokedAt: null, role: { in: [...ASSIGNABLE] } },
      include: { user: { select: { id: true, email: true, phone: true, status: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return grants.map((g) => ({ assignmentId: g.id, role: g.role, electionId: g.electionId, user: g.user }));
  }

  async assign(actor: AuthUser, institutionId: string, dto: AssignRoleDto, info: RequestInfo) {
    if (!ASSIGNABLE.includes(dto.role)) throw new BadRequestException('role_not_assignable');
    // Le guard a accepté « l'un des trois » ; la permission précise dépend du rôle demandé.
    if (!this.authz.can(actor, assignPermission(dto.role), { institutionIds: [institutionId] })) throw new ForbiddenException();

    if (dto.role === Role.ELECTION_COMMITTEE && !dto.electionId) throw new BadRequestException('election_required');
    if (dto.role !== Role.ELECTION_COMMITTEE && dto.electionId) throw new BadRequestException('election_not_allowed');

    const target = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { roles: { where: { revokedAt: null }, select: { institutionId: true } } },
    });
    const actorIsSuperAdmin = actor.roles.some((r) => r.role === Role.SUPER_ADMIN);
    // Hors SUPER_ADMIN, seuls les comptes déjà rattachés à l'institution sont visibles : pas de sondage d'e-mails.
    if (!target || (!actorIsSuperAdmin && !target.roles.some((r) => r.institutionId === institutionId))) {
      throw new NotFoundException();
    }
    this.conflicts.assertNotSelfAssignment(actor.id, target.id);
    if (target.status !== UserStatus.ACTIVE) throw new ConflictException('user_not_active');

    if (dto.electionId) {
      // L'institution de l'élection vient de la base ; une élection d'une autre institution reste invisible.
      const election = await this.prisma.election.findUnique({ where: { id: dto.electionId }, select: { institutionId: true } });
      if (!election || election.institutionId !== institutionId) throw new NotFoundException();
    }

    const existing = await this.prisma.roleAssignment.findFirst({
      where: { userId: target.id, role: dto.role, institutionId, electionId: dto.electionId ?? null, revokedAt: null },
      select: { id: true },
    });
    if (existing) throw new ConflictException('role_already_assigned');

    const created = await this.prisma.roleAssignment.create({
      data: { userId: target.id, role: dto.role, institutionId, electionId: dto.electionId ?? null, grantedById: actor.id },
    });
    await this.audit.record({
      actorId: actor.id,
      institutionId,
      action: 'ROLE_ASSIGNED',
      resourceType: 'role_assignment',
      resourceId: created.id,
      result: AuditResult.SUCCESS,
      ip: info.ip,
      requestId: info.requestId,
      metadata: { targetUserId: target.id, role: dto.role, electionId: dto.electionId ?? null },
    });
    return { assignmentId: created.id, userId: target.id, role: created.role, institutionId, electionId: created.electionId };
  }

  async revoke(actor: AuthUser, institutionId: string, assignmentId: string, info: RequestInfo): Promise<void> {
    const grant = await this.prisma.roleAssignment.findFirst({ where: { id: assignmentId, institutionId, revokedAt: null } });
    if (!grant) throw new NotFoundException();
    // « Rôles qu'il peut attribuer » (03 §5.2) : on ne révoque que ce qu'on pourrait attribuer.
    if (!ASSIGNABLE.includes(grant.role) || !this.authz.can(actor, assignPermission(grant.role), { institutionIds: [institutionId] })) {
      throw new ForbiddenException();
    }
    if (grant.role === Role.INSTITUTION_ADMIN) {
      const others = await this.prisma.roleAssignment.count({
        where: { institutionId, role: Role.INSTITUTION_ADMIN, revokedAt: null, id: { not: grant.id }, user: { status: UserStatus.ACTIVE } },
      });
      this.conflicts.assertNotLastOwnAdminRevocation(actor.id, grant.userId, others);
    }
    await this.prisma.roleAssignment.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
    await this.audit.record({
      actorId: actor.id,
      institutionId,
      action: 'ROLE_REVOKED',
      resourceType: 'role_assignment',
      resourceId: grant.id,
      result: AuditResult.SUCCESS,
      ip: info.ip,
      requestId: info.requestId,
      metadata: { targetUserId: grant.userId, role: grant.role, electionId: grant.electionId },
    });
  }
}
