import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ResourceScope } from './auth-user';
import type { ScopeKind } from './decorators';

/** Lit la portée d'une ressource en base : jamais depuis un paramètre envoyé par le client (03 §4). */
@Injectable()
export class ScopeResolver {
  constructor(private readonly prisma: PrismaService) {}

  /** null = la ressource n'existe pas (→ 404). */
  async resolve(kind: ScopeKind, id: string | undefined): Promise<ResourceScope | null> {
    if (!id) return null;
    switch (kind) {
      case 'institution': {
        const inst = await this.prisma.institution.findUnique({ where: { id }, select: { id: true } });
        return inst ? { institutionIds: [inst.id] } : null;
      }
      case 'election': {
        const el = await this.prisma.election.findUnique({ where: { id }, select: { id: true, institutionId: true } });
        return el ? { institutionIds: [el.institutionId], electionId: el.id } : null;
      }
      case 'enrollment': {
        const en = await this.prisma.studentEnrollment.findUnique({ where: { id }, select: { institutionId: true } });
        return en ? { institutionIds: [en.institutionId] } : null;
      }
      case 'user': {
        const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
        if (!user) return null;
        const grants = await this.prisma.roleAssignment.findMany({
          where: { userId: id, revokedAt: null, institutionId: { not: null } },
          select: { institutionId: true },
        });
        return { institutionIds: [...new Set(grants.map((g) => g.institutionId as string))] };
      }
    }
  }
}
