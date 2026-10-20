import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditResult, CandidateStatus, ElectionStatus, Prisma, Role } from '@prisma/client';
import { createHash } from 'crypto';
import { AuditService } from '../audit/audit.service';
import type { RequestInfo } from '../auth/auth.service';
import type { AuthUser } from '../common/authz/auth-user';
import { AuthzService } from '../common/authz/authz.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { analyzePosition, detailPublished } from './tally';

const DIGEST_PAGE = 2_000;

/**
 * Décompte (04 §8) et lecture des résultats (04 §7.2, §7.3, §9).
 * Aucune requête applicative ne compte les bulletins avant la clôture : `compute` refuse tout état autre que VOTING_CLOSED,
 * et la lecture refuse tout état antérieur, pour tous les rôles.
 */
@Injectable()
export class ResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly reports: ReportsService,
  ) {}

  // ------------------------------------------------------------------ décompte

  /** Empreinte SHA-256 de l'urne : bulletins triés par id, chacun avec ses choix triés. Stable tant que l'urne ne change pas. */
  private async digest(tx: Prisma.TransactionClient, electionId: string): Promise<string> {
    const hash = createHash('sha256').update(`election:${electionId}\n`);
    let after = '';
    for (;;) {
      const page = await tx.ballot.findMany({ where: { electionId, id: { gt: after } }, orderBy: { id: 'asc' }, take: DIGEST_PAGE, include: { choices: true } });
      if (page.length === 0) break;
      for (const b of page) {
        const choices = b.choices.map((c) => `${c.positionId}=${c.candidateId ?? '-'}`).sort();
        hash.update(`${b.id}:${choices.join(',')}\n`);
      }
      after = page[page.length - 1].id;
    }
    return hash.digest('hex');
  }

  /**
   * Compte les bulletins, contrôle l'intégrité, calcule l'empreinte et les résultats par poste, dans une transaction.
   * Idempotent : relancé, il remplace les lignes de `position_results` et le décompte par le même contenu.
   */
  async compute(electionId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const election = await tx.election.findUnique({ where: { id: electionId } });
        if (!election) throw new NotFoundException();
        if (election.status !== ElectionStatus.VOTING_CLOSED) throw new ConflictException('invalid_state');

        const [eligibleCount, participantCount, ballotCount] = await Promise.all([
          tx.voterRollEntry.count({ where: { electionId } }),
          tx.votingParticipation.count({ where: { electionId } }),
          tx.ballot.count({ where: { electionId } }),
        ]);
        const integrityOk = participantCount === ballotCount && participantCount <= eligibleCount;
        const ballotsDigest = await this.digest(tx, electionId);

        const positions = await tx.position.findMany({ where: { electionId } });
        const candidates = await tx.candidate.findMany({ where: { electionId, status: CandidateStatus.APPROVED }, select: { id: true, positionId: true } });
        const grouped = await tx.ballotChoice.groupBy({ by: ['positionId', 'candidateId'], where: { ballot: { electionId } }, _count: { _all: true } });
        const votesOf = (positionId: string, candidateId: string | null) => grouped.find((g) => g.positionId === positionId && g.candidateId === candidateId)?._count._all ?? 0;

        const rows: Prisma.PositionResultCreateManyInput[] = [];
        for (const p of positions) {
          const analysis = analyzePosition(candidates.filter((c) => c.positionId === p.id).map((c) => ({ candidateId: c.id, votes: votesOf(p.id, c.id) })), p.seats);
          for (const r of analysis.ranked) rows.push({ electionId, positionId: p.id, candidateId: r.candidateId, votes: r.votes, rank: r.rank, isWinner: analysis.winners.includes(r.candidateId) });
          rows.push({ electionId, positionId: p.id, candidateId: null, votes: votesOf(p.id, null), rank: null, isWinner: false }); // ligne « blancs »
        }
        await tx.positionResult.deleteMany({ where: { electionId } });
        await tx.positionResult.createMany({ data: rows });
        const data = { eligibleCount, participantCount, ballotCount, integrityOk, ballotsDigest };
        return tx.electionTally.upsert({ where: { electionId }, create: { electionId, ...data }, update: { ...data, computedAt: new Date() } });
      },
      { timeout: 120_000 },
    );
  }

  /** Relance du décompte par le comité (🔐) : même résultat, aucun doublon. */
  async recompute(actor: AuthUser, electionId: string, info: RequestInfo) {
    const election = await this.prisma.election.findUnique({ where: { id: electionId } });
    if (!election) throw new NotFoundException();
    const tally = await this.compute(electionId);
    await this.record(actor, election, 'RESULTS_RECOMPUTED', info, { integrityOk: tally.integrityOk });
    return { integrityOk: tally.integrityOk };
  }

  // ------------------------------------------------------------------ lecture

  /**
   * Qui lit quoi : le personnel (`results:read`) dès VOTING_CLOSED ; tous les autres (électeurs de la liste, vérificateur,
   * super-admin) seulement après RESULTS_PUBLISHED. Avant la clôture : refus pour tout le monde (04 §7.2).
   */
  private async access(user: AuthUser, electionId: string) {
    const election = await this.prisma.election.findUnique({ where: { id: electionId } });
    if (!election) throw new NotFoundException();
    const scope = { institutionIds: [election.institutionId], electionId: election.id };
    const staff = this.authz.can(user, 'results:read', scope);
    const available: ElectionStatus[] = staff ? [ElectionStatus.VOTING_CLOSED, ElectionStatus.RESULTS_PUBLISHED] : [ElectionStatus.RESULTS_PUBLISHED];
    if (!available.includes(election.status)) throw new ConflictException('RESULTS_NOT_AVAILABLE');
    if (!staff && user.roles.some((g) => g.role === Role.STUDENT)) {
      const student = await this.prisma.student.findUnique({ where: { userId: user.id } });
      const onRoll = student ? await this.prisma.voterRollEntry.findUnique({ where: { electionId_studentId: { electionId, studentId: student.id } } }) : null;
      if (!onRoll) throw new NotFoundException();
    }
    const tally = await this.prisma.electionTally.findUnique({ where: { electionId } });
    if (!tally) throw new ConflictException('RESULTS_NOT_READY');
    return { election, tally, staff };
  }

  private async names(candidateIds: string[]) {
    const rows = await this.prisma.candidate.findMany({ where: { id: { in: candidateIds } }, select: { id: true, student: { select: { firstName: true, lastName: true, fullNameAr: true } } } });
    return new Map(rows.map((r) => [r.id, { firstName: r.student.firstName, lastName: r.student.lastName, fullNameAr: r.student.fullNameAr }]));
  }

  /** Résultats par poste uniquement (D-12), détail masqué sous 3 votants (D-32). Aucun identifiant d'étudiant. */
  async get(user: AuthUser, electionId: string) {
    const { election, tally, staff } = await this.access(user, electionId);
    const positions = await this.prisma.position.findMany({ where: { electionId }, orderBy: { displayOrder: 'asc' } });
    const results = await this.prisma.positionResult.findMany({ where: { electionId } });
    const names = await this.names(results.flatMap((r) => (r.candidateId ? [r.candidateId] : [])));
    const person = (id: string) => ({ candidateId: id, ...(names.get(id) ?? { firstName: '', lastName: '', fullNameAr: null }) });

    return {
      electionId,
      status: election.status,
      registered: tally.eligibleCount,
      voters: tally.participantCount,
      participationRate: tally.eligibleCount === 0 ? 0 : Math.round((tally.participantCount / tally.eligibleCount) * 1000) / 10,
      ...(staff ? { integrityOk: tally.integrityOk } : {}),
      positions: positions.map((p) => {
        const mine = results.filter((r) => r.positionId === p.id);
        const analysis = analyzePosition(mine.filter((r) => r.candidateId).map((r) => ({ candidateId: r.candidateId as string, votes: r.votes })), p.seats);
        const blank = mine.find((r) => !r.candidateId)?.votes ?? 0;
        const head = { positionId: p.id, title: p.title, titleAr: p.titleAr, seats: p.seats, tie: analysis.tie, winners: analysis.winners.map(person) };
        if (!detailPublished(tally.participantCount)) return { ...head, detailPublished: false, note: 'DETAIL_WITHHELD_SMALL_TURNOUT' };
        return {
          ...head,
          detailPublished: true,
          candidates: analysis.ranked.map((r) => ({ ...person(r.candidateId), votes: r.votes, rank: r.rank, isWinner: analysis.winners.includes(r.candidateId) })),
          blank,
        };
      }),
    };
  }

  /** Pré-remplissage du second tour (D-01) : les seuls ex-aequo du dernier siège, poste par poste. Personnel seulement. */
  async secondRound(user: AuthUser, electionId: string) {
    const { election, staff } = await this.access(user, electionId);
    if (!staff) throw new NotFoundException();
    const positions = await this.prisma.position.findMany({ where: { electionId }, orderBy: { displayOrder: 'asc' } });
    const results = await this.prisma.positionResult.findMany({ where: { electionId, candidateId: { not: null } } });
    const tied = positions.flatMap((p) => {
      const analysis = analyzePosition(results.filter((r) => r.positionId === p.id).map((r) => ({ candidateId: r.candidateId as string, votes: r.votes })), p.seats);
      return analysis.tie ? [{ positionId: p.id, title: p.title, titleAr: p.titleAr, seats: p.seats - analysis.winners.length, candidateIds: analysis.tiedIds }] : [];
    });
    return { parentElectionId: election.id, round: election.round + 1, institutionId: election.institutionId, academicYearId: election.academicYearId, positions: tied };
  }

  // ------------------------------------------------------------------ publication 🔐

  /**
   * VOTING_CLOSED → RESULTS_PUBLISHED, comité seulement (D-41). Refusée (409, toutes les conditions listées) si le décompte
   * manque, si l'intégrité a échoué (votants ≠ bulletins ou > inscrits), si l'urne n'est plus celle du décompte (nombres de
   * votants et de bulletins, empreinte recalculée) ou si la chaîne d'audit est rompue. Le PV (fr et ar) est créé juste après ;
   * un échec de sa génération ne défait pas la publication : il se relance (`POST /elections/:id/report`).
   */
  async publish(actor: AuthUser, electionId: string, info: RequestInfo) {
    const election = await this.prisma.election.findUnique({ where: { id: electionId } });
    if (!election) throw new NotFoundException();
    if (election.status !== ElectionStatus.VOTING_CLOSED) throw new ConflictException('invalid_state');
    const tally = await this.prisma.electionTally.findUnique({ where: { electionId } });
    const missing: string[] = [];
    if (!tally) missing.push('tally_missing');
    else {
      if (!tally.integrityOk) missing.push('integrity_failed');
      // Ceinture de sécurité : après la clôture l'urne ne peut plus changer ; si elle a changé, le décompte n'est plus fiable.
      const [participantCount, ballotCount] = await Promise.all([this.prisma.votingParticipation.count({ where: { electionId } }), this.prisma.ballot.count({ where: { electionId } })]);
      if (participantCount !== tally.participantCount || ballotCount !== tally.ballotCount || (await this.digest(this.prisma, electionId)) !== tally.ballotsDigest) missing.push('tally_stale');
    }
    if (!(await this.audit.verifyChain()).valid) missing.push('audit_chain_broken');
    if (missing.length > 0) throw new ConflictException({ message: 'conditions_not_met', conditions: missing });
    const res = await this.prisma.election.updateMany({ where: { id: electionId, status: ElectionStatus.VOTING_CLOSED }, data: { status: ElectionStatus.RESULTS_PUBLISHED } });
    if (res.count !== 1) throw new ConflictException('invalid_state');
    await this.record(actor, election, 'ELECTION_RESULTS_PUBLISHED', info);
    const report = await this.reports.generateAfterPublication(actor, electionId, info);
    return { status: ElectionStatus.RESULTS_PUBLISHED, report };
  }

  /**
   * « Vérifier l'urne » (D-45) : recalcule l'empreinte SHA-256 des bulletins MAINTENANT et la compare à celle du décompte et à
   * celle imprimée sur le PV le plus récent. Lecture seule ; le résultat est tracé. Aucun bulletin, aucun choix n'est renvoyé.
   */
  async verifyUrn(user: AuthUser, electionId: string, info: RequestInfo) {
    const { election, tally } = await this.access(user, electionId);
    const computed = await this.digest(this.prisma, electionId);
    const report = await this.prisma.electionReport.findFirst({ where: { electionId, revokedAt: null }, orderBy: { generatedAt: 'desc' } });
    const result = {
      computedDigest: computed,
      tallyDigest: tally.ballotsDigest,
      reportDigest: report?.ballotsDigest ?? null,
      reportId: report?.reportId ?? null,
      matchesTally: computed === tally.ballotsDigest,
      matchesReport: report ? computed === report.ballotsDigest : null,
      checkedAt: new Date(),
    };
    await this.record(user, election, 'URN_VERIFIED', info, { matchesTally: result.matchesTally, matchesReport: result.matchesReport });
    return result;
  }

  private record(actor: AuthUser, election: { id: string; institutionId: string }, action: string, info: RequestInfo, metadata?: Record<string, unknown>) {
    return this.audit.record({ actorId: actor.id, institutionId: election.institutionId, action, resourceType: 'election', resourceId: election.id, result: AuditResult.SUCCESS, ip: info.ip, requestId: info.requestId, metadata });
  }
}
