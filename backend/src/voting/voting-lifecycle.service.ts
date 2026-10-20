import { ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AuditResult, CandidateStatus, ElectionStatus, Prisma, Role, UserStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { RequestInfo } from '../auth/auth.service';
import type { AuthUser } from '../common/authz/auth-user';
import { MIN_COMMITTEE } from '../elections/elections.service';
import { eligibleWhere } from '../eligibility/eligibility.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ResultsService } from '../results/results.service';
import { extensionRefusal } from './voting-extension';
import type { ExtendVotingDto } from './voting.dto';

/** Qui a déclenché la transition : un membre du comité / l'admin (manuel), ou le système (tâche planifiée, `null`). */
type Actor = AuthUser | null;

/** Ouverture et clôture du vote (04 §4.3, §4.4). Chaque transition verrouille la ligne de l'élection dans une transaction. */
@Injectable()
export class VotingLifecycleService {
  private readonly logger = new Logger(VotingLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly results: ResultsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Verrou d'écriture sur la ligne de l'élection + heure de la BASE (UTC), jamais celle du serveur d'application. */
  private async lock(tx: Prisma.TransactionClient, electionId: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM elections WHERE id = ${electionId} FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundException();
    const election = await tx.election.findUniqueOrThrow({ where: { id: electionId } });
    const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT UTC_TIMESTAMP(3) AS now`;
    return { election, now: new Date(now) };
  }

  // ------------------------------------------------------------------ ouverture (étape sensible)

  /**
   * CANDIDACY_CLOSED → VOTING_OPEN. Dans UNE transaction : conditions, calcul de la liste des éligibles (02 §5), copie dans
   * `voter_roll`, `voterRollFrozenAt`, statut. Les règles, postes et candidats ne sont ensuite plus modifiables (leurs
   * routes exigent un brouillon ou des candidatures ouvertes). Si une condition manque : 409 avec TOUTES les conditions.
   */
  async open(actor: Actor, electionId: string, info?: RequestInfo) {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const { election, now } = await this.lock(tx, electionId);
        if (election.status !== ElectionStatus.CANDIDACY_CLOSED) throw new ConflictException('invalid_state');

        const missing: string[] = [];
        if ((await tx.candidate.count({ where: { electionId, status: CandidateStatus.PENDING } })) > 0) missing.push('candidacies_pending');
        const positions = await tx.position.findMany({ where: { electionId }, select: { id: true } });
        if (positions.length === 0) missing.push('positions_required');
        const covered = await tx.candidate.groupBy({ by: ['positionId'], where: { electionId, status: CandidateStatus.APPROVED } });
        if (positions.some((p) => !covered.some((c) => c.positionId === p.id))) missing.push('position_without_candidate');
        const committee = await tx.roleAssignment.count({ where: { electionId, role: Role.ELECTION_COMMITTEE, revokedAt: null, user: { status: UserStatus.ACTIVE } } });
        if (committee < MIN_COMMITTEE) missing.push('committee_incomplete');
        if (now < election.votingStartsAt) missing.push('voting_not_started');
        if (missing.length > 0) throw new ConflictException({ message: 'conditions_not_met', conditions: missing });

        const rules = await tx.eligibilityRule.findMany({ where: { electionId }, select: { facultyId: true, programId: true, levelId: true, groupId: true } });
        const where = eligibleWhere(election, rules);
        const enrollments = where ? await tx.studentEnrollment.findMany({ where, select: { id: true, studentId: true } }) : [];
        // Une inscription par étudiant et par année : la clé primaire (electionId, studentId) refuserait un doublon.
        await tx.voterRollEntry.createMany({ data: enrollments.map((e) => ({ electionId, studentId: e.studentId, enrollmentId: e.id })) });
        await tx.election.update({ where: { id: electionId }, data: { status: ElectionStatus.VOTING_OPEN, voterRollFrozenAt: now } });
        return { institutionId: election.institutionId, registered: enrollments.length };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 20_000, timeout: 60_000 },
    );
    await this.record(actor, result.institutionId, electionId, 'ELECTION_VOTING_OPENED', info, { registered: result.registered, automatic: actor === null });
    return { status: ElectionStatus.VOTING_OPEN };
  }

  // ------------------------------------------------------------------ clôture

  /**
   * VOTING_OPEN → VOTING_CLOSED, puis décompte immédiat (04 §4.4, §8). Le contrôle d'état d'un vote se fait DANS sa
   * transaction avec un verrou partagé sur l'élection : cette mise à jour attend les votes en cours, et tout vote suivant
   * voit VOTING_CLOSED. `reason` est obligatoire pour une clôture manuelle anticipée (vérifié par le DTO).
   */
  async close(actor: Actor, electionId: string, reason: string | null, info?: RequestInfo) {
    const institutionId = await this.prisma.$transaction(
      async (tx) => {
        const { election, now } = await this.lock(tx, electionId);
        if (election.status !== ElectionStatus.VOTING_OPEN) throw new ConflictException('invalid_state');
        if (actor === null && now < election.votingEndsAt) throw new ConflictException('invalid_state'); // la tâche planifiée ne devance jamais l'heure
        await tx.election.update({ where: { id: electionId }, data: { status: ElectionStatus.VOTING_CLOSED } });
        return election.institutionId;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 20_000, timeout: 30_000 },
    );
    await this.record(actor, institutionId, electionId, 'ELECTION_VOTING_CLOSED', info, { reason, automatic: actor === null });
    await this.results.compute(electionId);
    return { status: ElectionStatus.VOTING_CLOSED };
  }

  // ------------------------------------------------------------------ prolongation (D-33, D-38)

  /**
   * Prolongation UNIQUE après panne (04 §10.1). Seulement en VOTING_OPEN et AVANT l'heure de fin : une fois la clôture
   * faite, le décompte est lancé et on ne rouvre pas. Sous le verrou de la ligne, donc sans course avec la clôture
   * automatique ni avec une seconde prolongation ; la transaction de vote lit `votingEndsAt` en base, la nouvelle fin
   * s'applique donc immédiatement. Motif, panne déclarée, ancienne et nouvelle fin sont écrits dans `audit_logs`.
   */
  async extend(actor: AuthUser, electionId: string, dto: ExtendVotingDto, info?: RequestInfo) {
    const input = { outageStartedAt: new Date(dto.outageStartedAt), outageEndedAt: new Date(dto.outageEndedAt), newEndsAt: new Date(dto.newEndsAt) };
    const result = await this.prisma.$transaction(
      async (tx) => {
        const { election, now } = await this.lock(tx, electionId);
        if (election.status !== ElectionStatus.VOTING_OPEN || now >= election.votingEndsAt) throw new ConflictException('invalid_state');
        if (election.votingExtendedAt) throw new ConflictException('already_extended');
        const refusal = extensionRefusal(election, now, input);
        if (refusal) throw new UnprocessableEntityException(refusal);
        await tx.election.update({ where: { id: electionId }, data: { votingEndsAt: input.newEndsAt, votingExtendedAt: now, votingEndsAtOriginal: election.votingEndsAt } });
        return { institutionId: election.institutionId, previousEndsAt: election.votingEndsAt };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 20_000, timeout: 30_000 },
    );
    await this.record(actor, result.institutionId, electionId, 'ELECTION_VOTING_EXTENDED', info, {
      reason: dto.reason, outageStartedAt: input.outageStartedAt.toISOString(), outageEndedAt: input.outageEndedAt.toISOString(),
      previousEndsAt: result.previousEndsAt.toISOString(), newEndsAt: input.newEndsAt.toISOString(),
    });
    return { votingEndsAt: input.newEndsAt };
  }

  // ------------------------------------------------------------------ tâche planifiée

  private async due(status: ElectionStatus, column: 'candidacyEndsAt' | 'votingStartsAt' | 'votingEndsAt'): Promise<string[]> {
    // Heure de la base ; le nom de colonne vient d'une liste fermée (jamais d'une entrée utilisateur).
    const sql = Prisma.sql`SELECT id FROM elections WHERE status = ${status} AND ${Prisma.raw(`\`${column}\``)} <= UTC_TIMESTAMP(3)`;
    return (await this.prisma.$queryRaw<{ id: string }[]>(sql)).map((r) => r.id);
  }

  /**
   * Transitions dues à l'heure de la base : clôture des candidatures, ouverture du vote, clôture du vote, et décompte
   * des élections clôturées dont le décompte a échoué. Idempotent et sûr si plusieurs instances l'exécutent : chaque
   * transition verrouille la ligne et revérifie l'état.
   */
  async runDueTransitions(closeCandidacy: (id: string) => Promise<void>) {
    for (const id of await this.due(ElectionStatus.CANDIDACY_OPEN, 'candidacyEndsAt')) await this.attempt('candidacy-close', id, () => closeCandidacy(id));
    for (const id of await this.due(ElectionStatus.CANDIDACY_CLOSED, 'votingStartsAt')) {
      await this.attempt('open', id, async () => {
        try {
          await this.open(null, id);
        } catch (e) {
          if (e instanceof ConflictException) await this.notifyBlocked(id, e);
          else throw e;
        }
      });
    }
    for (const id of await this.due(ElectionStatus.VOTING_OPEN, 'votingEndsAt')) await this.attempt('close', id, () => this.close(null, id, null).then(() => undefined));
    const untallied = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT e.id FROM elections e LEFT JOIN election_tallies t ON t.electionId = e.id WHERE e.status = ${ElectionStatus.VOTING_CLOSED} AND t.electionId IS NULL`;
    for (const { id } of untallied) await this.attempt('tally', id, () => this.results.compute(id).then(() => undefined));
  }

  private async attempt(task: string, electionId: string, run: () => Promise<void>) {
    try {
      await run();
    } catch (e) {
      if (e instanceof ConflictException) return; // un autre processus a fait la transition, ou l'état a changé : rien à faire
      this.logger.error(`Transition automatique « ${task} » en échec pour l'élection ${electionId} : ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** 04 §4.3 : si une condition manque à l'heure prévue, l'ouverture n'a pas lieu et le comité est notifié (une fois par motif). */
  private async notifyBlocked(electionId: string, e: ConflictException) {
    const response = e.getResponse() as { message?: string; conditions?: string[] };
    if (response.message !== 'conditions_not_met' || !response.conditions) return;
    const body = JSON.stringify({ electionId, conditions: response.conditions });
    const members = await this.prisma.roleAssignment.findMany({ where: { electionId, role: Role.ELECTION_COMMITTEE, revokedAt: null }, select: { userId: true } });
    for (const { userId } of members) {
      if ((await this.prisma.notification.count({ where: { userId, type: 'VOTING_OPEN_BLOCKED', body } })) === 0) await this.notifications.notify(userId, 'VOTING_OPEN_BLOCKED', body);
    }
  }

  private record(actor: Actor, institutionId: string, electionId: string, action: string, info: RequestInfo | undefined, metadata: Record<string, unknown>) {
    return this.audit.record({ actorId: actor?.id ?? null, institutionId, action, resourceType: 'election', resourceId: electionId, result: AuditResult.SUCCESS, ip: info?.ip, requestId: info?.requestId, metadata });
  }
}
