import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditResult, ElectionStatus, Prisma, UserStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { RequestInfo } from '../auth/auth.service';
import type { AuthUser } from '../common/authz/auth-user';
import { rulesMatch } from '../eligibility/eligibility.service';
import { PrismaService } from '../prisma/prisma.service';

/** Réponse unique pour TOUT refus lié au matricule (D-39) : on ne révèle pas s'il existe, s'il est vérifié ou déjà inscrit. */
const notAddable = () => new NotFoundException('voter_not_addable');

/** Ce que la confirmation montre : la filière, le niveau et le groupe, jamais un nom (D-39). */
export interface VoterPreview {
  faculty: { name: string; nameAr: string | null };
  program: { name: string; nameAr: string | null };
  level: { name: string; nameAr: string | null };
  group: string | null;
}

type Db = Prisma.TransactionClient | PrismaService;
interface ElectionScope {
  id: string;
  institutionId: string;
  academicYearId: string;
}

/**
 * Ajout exceptionnel d'un électeur après le gel de la liste (04 §5.2, D-39). Comité seulement, 🔐, motif obligatoire,
 * pendant VOTING_OPEN. Aucune réponse ne contient de nom, de matricule ni d'identifiant d'étudiant.
 */
@Injectable()
export class VoterRollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Étudiant ajoutable : matricule connu dans l'institution, compte actif, inscription VERIFIED de l'année, éligible, pas déjà inscrit. */
  private async addable(db: Db, election: ElectionScope, studentNumber: string) {
    const student = await db.student.findUnique({
      where: { institutionId_studentNumber: { institutionId: election.institutionId, studentNumber: studentNumber.trim() } },
      select: { id: true, user: { select: { status: true } } },
    });
    if (!student || student.user.status !== UserStatus.ACTIVE) return null;
    const enrollment = await db.studentEnrollment.findFirst({
      where: { studentId: student.id, institutionId: election.institutionId, academicYearId: election.academicYearId, status: 'VERIFIED' },
      select: {
        id: true, facultyId: true, programId: true, levelId: true, groupId: true,
        faculty: { select: { name: true, nameAr: true } }, program: { select: { name: true, nameAr: true } },
        level: { select: { name: true, nameAr: true } }, group: { select: { name: true } },
      },
    });
    if (!enrollment) return null;
    const rules = await db.eligibilityRule.findMany({ where: { electionId: election.id }, select: { facultyId: true, programId: true, levelId: true, groupId: true } });
    if (!rulesMatch(rules, enrollment)) return null;
    if (await db.voterRollEntry.findUnique({ where: { electionId_studentId: { electionId: election.id, studentId: student.id } }, select: { studentId: true } })) return null;
    return { studentId: student.id, enrollment };
  }

  private async openElection(db: Db, electionId: string): Promise<ElectionScope> {
    const election = await db.election.findUnique({ where: { id: electionId }, select: { id: true, institutionId: true, academicYearId: true, status: true } });
    if (!election) throw new NotFoundException();
    if (election.status !== ElectionStatus.VOTING_OPEN) throw new ConflictException('invalid_state');
    return election;
  }

  /** Étape de confirmation : ne modifie rien. */
  async preview(electionId: string, studentNumber: string): Promise<VoterPreview> {
    const election = await this.openElection(this.prisma, electionId);
    const found = await this.addable(this.prisma, election, studentNumber);
    if (!found) throw notAddable();
    const { faculty, program, level, group } = found.enrollment;
    return { faculty, program, level, group: group?.name ?? null };
  }

  async add(actor: AuthUser, electionId: string, studentNumber: string, reason: string, info?: RequestInfo) {
    const { institutionId, enrollmentId, registered } = await this.prisma.$transaction(
      async (tx) => {
        // Même verrou que l'ouverture / la clôture / la prolongation : l'état est relu sous verrou.
        const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM elections WHERE id = ${electionId} FOR UPDATE`;
        if (locked.length === 0) throw new NotFoundException();
        const election = await this.openElection(tx, electionId);
        const found = await this.addable(tx, election, studentNumber);
        if (!found) throw notAddable();
        try {
          await tx.voterRollEntry.create({ data: { electionId, studentId: found.studentId, enrollmentId: found.enrollment.id, addedAfterFreeze: true } });
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw notAddable();
          throw e;
        }
        return { institutionId: election.institutionId, enrollmentId: found.enrollment.id, registered: await tx.voterRollEntry.count({ where: { electionId } }) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 20_000, timeout: 30_000 },
    );
    // La trace garde le motif et l'inscription (ni le nom, ni le matricule) : le comité ne lit pas de liste nominative (D-02).
    await this.audit.record({
      actorId: actor.id, institutionId, action: 'ELECTION_VOTER_ADDED', resourceType: 'election', resourceId: electionId,
      result: AuditResult.SUCCESS, ip: info?.ip, requestId: info?.requestId, metadata: { reason, enrollmentId },
    });
    return { registered };
  }
}
