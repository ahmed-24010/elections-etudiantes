import { ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { CandidateStatus, ElectionStatus, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomInt, randomUUID } from 'crypto';
import { LoginAttemptLimiter } from '../auth/login-attempt.limiter';
import type { AuthUser } from '../common/authz/auth-user';
import { STUDENT_VISIBLE } from '../elections/election-states';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CastBallotDto } from './voting.dto';

/** D-31 : sous ce nombre d'électeurs, la participation n'est mise à jour que par tranches de 15 minutes. */
export const SMALL_ELECTION_VOTERS = 50;
export const TURNOUT_SLOT_MS = 15 * 60_000;
const MAX_RETRIES = 3;

export type VoterState = 'NOT_ON_ROLL' | 'NOT_VOTED' | 'VOTED';

/** Mélange de Fisher-Yates avec un tirage cryptographique (D-35 : ordre aléatoire pour chaque électeur). */
function shuffled<T>(items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Vote secret (02 §6, 04 §6, CLAUDE.md « Règles absolues »). Ce service ne journalise jamais le corps d'un vote, n'écrit
 * aucun choix dans `audit_logs`, et aucune de ses réponses ne rapproche un identifiant d'étudiant d'un choix.
 */
@Injectable()
export class VotingService {
  private readonly logger = new Logger(VotingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly limiter: LoginAttemptLimiter,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------------ mot de passe (avant la transaction)

  /**
   * D-30 : le mot de passe est vérifié AVANT toute écriture dans l'urne. Chaque échec compte dans le blocage du compte
   * (5 échecs en 15 minutes, comme à la connexion) ; compte bloqué → 429, même avec le bon mot de passe.
   */
  private async checkPassword(userId: string, password: string) {
    if (this.limiter.isLocked(userId)) throw new HttpException('ACCOUNT_LOCKED', HttpStatus.TOO_MANY_REQUESTS);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    const ok = user ? await argon2.verify(user.passwordHash, password).catch(() => false) : false;
    if (!ok) {
      this.limiter.fail(userId);
      throw new UnauthorizedException('INVALID_PASSWORD');
    }
    this.limiter.reset(userId);
  }

  private async studentOf(user: AuthUser) {
    return this.prisma.student.findUnique({ where: { userId: user.id }, select: { id: true } });
  }

  // ------------------------------------------------------------------ le vote (04 §6.2)

  /**
   * Transaction de vote, exactement comme 04 §6.2 (isolation READ COMMITTED) :
   * 1. élection verrouillée en lecture partagée, état et fenêtre horaire de la BASE ;
   * 2. présence sur voter_roll ; 3. validation complète du bulletin AVANT toute écriture ;
   * 4. participation (la clé primaire garantit le vote unique, pas un « if (hasVoted) ») ;
   * 5. bulletin (UUID v4 aléatoire, sans identité ni date) ; 6. choix.
   * Tout ou rien. La réponse ne contient aucun identifiant de bulletin.
   */
  async cast(user: AuthUser, electionId: string, dto: CastBallotDto): Promise<{ status: 'recorded' }> {
    await this.checkPassword(user.id, dto.password);
    const student = await this.studentOf(user);
    if (!student) throw new ForbiddenException('NOT_ON_VOTER_ROLL');

    for (let attempt = 1; ; attempt++) {
      try {
        const election = await this.prisma.$transaction((tx) => this.castInTransaction(tx, electionId, student.id, dto), {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          // Délai pour DÉMARRER la transaction (2 s par défaut). Sous forte charge (un millier d'étudiants au même instant), 2 s ne
          // suffisent pas : le vote échouait en 500 « Unable to start a transaction in the given time » (P2028). Reproduit et
          // corrigé au Sprint 5 ; voir docs/SPRINT-EN-COURS.md.
          maxWait: 20_000,
          timeout: 15_000,
        });
        await this.notifyRecorded(user.id, election.title);
        return { status: 'recorded' };
      } catch (e) {
        // P2034 : interblocage entre transactions concurrentes. P2028 : la transaction n'a pas pu démarrer (ou a expiré) sous
        // forte charge. Dans les deux cas elle est annulée en entier, rien n'est écrit, et la clé primaire de voting_participations
        // garantit qu'un rejeu ne peut pas produire un second vote : on peut la rejouer.
        const retryable = e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2034' || e.code === 'P2028');
        if (!retryable || attempt >= MAX_RETRIES) throw e;
      }
    }
  }

  private async castInTransaction(tx: Prisma.TransactionClient, electionId: string, studentId: string, dto: CastBallotDto) {
    // 1. Verrou partagé : une clôture (écriture) attend les votes en cours ; un vote qui la suit voit VOTING_CLOSED.
    const rows = await tx.$queryRaw<{ status: string; inWindow: bigint | number }[]>`
      SELECT status, (UTC_TIMESTAMP(3) >= votingStartsAt AND UTC_TIMESTAMP(3) < votingEndsAt) AS inWindow
      FROM elections WHERE id = ${electionId} FOR SHARE`;
    if (rows.length === 0 || rows[0].status !== ElectionStatus.VOTING_OPEN || Number(rows[0].inWindow) !== 1) throw new ConflictException('ELECTION_NOT_OPEN');

    // 2.
    const onRoll = await tx.voterRollEntry.findUnique({ where: { electionId_studentId: { electionId, studentId } }, select: { studentId: true } });
    if (!onRoll) throw new ForbiddenException('NOT_ON_VOTER_ROLL');

    // 3. Chaque poste exactement une fois ; candidats APPROVED du bon poste ; 0 ≤ choix ≤ maxChoices, sans doublon ; 0 choix = blanc.
    const positions = await tx.position.findMany({ where: { electionId }, select: { id: true, maxChoices: true, allowBlank: true } });
    const approved = await tx.candidate.findMany({ where: { electionId, status: CandidateStatus.APPROVED }, select: { id: true, positionId: true } });
    const invalid = () => new UnprocessableEntityException('INVALID_BALLOT');
    if (dto.choices.length !== positions.length) throw invalid();
    const seen = new Set<string>();
    for (const choice of dto.choices) {
      const position = positions.find((p) => p.id === choice.positionId);
      if (!position || seen.has(position.id)) throw invalid();
      seen.add(position.id);
      const ids = choice.candidateIds;
      if (new Set(ids).size !== ids.length || ids.length > position.maxChoices) throw invalid();
      if (ids.length === 0 && !position.allowBlank) throw invalid();
      if (ids.some((id) => !approved.some((c) => c.id === id && c.positionId === position.id))) throw invalid();
    }

    // 4. La clé primaire (electionId, studentId) est la seule garantie du vote unique.
    try {
      await tx.votingParticipation.create({ data: { electionId, studentId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('ALREADY_VOTED');
      throw e;
    }

    // 5. et 6. Aucune colonne d'identité ni de date ; aucun lien avec la participation.
    const ballotId = randomUUID();
    await tx.ballot.create({ data: { id: ballotId, electionId } });
    const choiceRows: Prisma.BallotChoiceCreateManyInput[] = dto.choices.flatMap((c) =>
      (c.candidateIds.length === 0 ? [null] : c.candidateIds).map((candidateId) => ({ id: randomUUID(), ballotId, positionId: c.positionId, candidateId })),
    ); // aucun candidat = une ligne « blanc » (candidateId NULL)
    await tx.ballotChoice.createMany({ data: choiceRows });
    return tx.election.findUniqueOrThrow({ where: { id: electionId }, select: { title: true } });
  }

  /** D-36 : « Un vote a été enregistré pour vous… ». Aucun choix. Après le COMMIT, et sans jamais faire échouer un vote déjà enregistré. */
  private async notifyRecorded(userId: string, electionTitle: string) {
    try {
      await this.notifications.notify(userId, 'VOTE_RECORDED', electionTitle);
    } catch {
      this.logger.warn('Notification de vote non enregistrée'); // sans identifiant d'étudiant (04 §7.2)
    }
  }

  // ------------------------------------------------------------------ lecture pour l'étudiant

  private async election(electionId: string) {
    const election = await this.prisma.election.findUnique({ where: { id: electionId } });
    if (!election || !STUDENT_VISIBLE.includes(election.status)) throw new NotFoundException();
    return election;
  }

  private async isOpenNow(electionId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ open: bigint | number }[]>`
      SELECT (status = ${ElectionStatus.VOTING_OPEN} AND UTC_TIMESTAMP(3) >= votingStartsAt AND UTC_TIMESTAMP(3) < votingEndsAt) AS \`open\` FROM elections WHERE id = ${electionId}`;
    return rows.length > 0 && Number(rows[0].open) === 1;
  }

  /** Statut de l'étudiant lui-même (10.6) : inscrit ou non, a voté ou non. Jamais le contenu du vote. */
  async status(user: AuthUser, electionId: string) {
    const election = await this.election(electionId);
    const student = await this.studentOf(user);
    const entry = student ? await this.prisma.voterRollEntry.findUnique({ where: { electionId_studentId: { electionId, studentId: student.id } }, include: { participation: true } }) : null;
    const state: VoterState = !entry ? 'NOT_ON_ROLL' : entry.participation ? 'VOTED' : 'NOT_VOTED';
    return {
      state,
      electionStatus: election.status,
      open: await this.isOpenNow(electionId),
      votingStartsAt: election.votingStartsAt,
      votingEndsAt: election.votingEndsAt,
      votedAt: entry?.participation?.votedAt ?? null,
    };
  }

  /**
   * Bulletin vierge : postes et candidats validés, ordre des candidats aléatoire à chaque appel (D-35). Un bulletin ne se
   * relit jamais après le vote. Jamais d'identifiant d'étudiant (pas même celui des candidats).
   */
  async ballot(user: AuthUser, electionId: string) {
    const election = await this.election(electionId);
    const student = await this.studentOf(user);
    if (election.status !== ElectionStatus.VOTING_OPEN || !(await this.isOpenNow(electionId))) throw new ConflictException('ELECTION_NOT_OPEN');
    const entry = student ? await this.prisma.voterRollEntry.findUnique({ where: { electionId_studentId: { electionId, studentId: student.id } }, include: { participation: true } }) : null;
    if (!entry) throw new ForbiddenException('NOT_ON_VOTER_ROLL');
    if (entry.participation) throw new ConflictException('ALREADY_VOTED');

    const positions = await this.prisma.position.findMany({ where: { electionId }, orderBy: { displayOrder: 'asc' } });
    const candidates = await this.prisma.candidate.findMany({
      where: { electionId, status: CandidateStatus.APPROVED },
      select: { id: true, positionId: true, statement: true, photoFileId: true, programFileId: true, student: { select: { firstName: true, lastName: true, fullNameAr: true } } },
    });
    return {
      electionId,
      title: election.title,
      titleAr: election.titleAr,
      votingEndsAt: election.votingEndsAt,
      positions: positions.map((p) => ({
        id: p.id,
        title: p.title,
        titleAr: p.titleAr,
        maxChoices: p.maxChoices,
        allowBlank: p.allowBlank,
        candidates: shuffled(candidates.filter((c) => c.positionId === p.id)).map((c) => ({
          id: c.id,
          firstName: c.student.firstName,
          lastName: c.student.lastName,
          fullNameAr: c.student.fullNameAr,
          statement: c.statement,
          // Photo et programme se lisent par l'URL signée à la demande (POST /elections/:id/candidates/:cid/files/:kind/access) : une URL
          // émise ici expirerait (5 min) pendant que l'électeur remplit son bulletin.
          hasPhoto: !!c.photoFileId,
          hasProgram: !!c.programFileId,
        })),
      })),
    };
  }

  // ------------------------------------------------------------------ participation en chiffres (D-02, D-31)

  /**
   * « X votants sur Y inscrits », jamais une liste (D-02). Sous 50 électeurs, pendant le vote, le nombre de votants est
   * arrêté à la dernière tranche de 15 minutes écoulée (D-31) : on ne peut pas voir le compteur bouger quand quelqu'un vote.
   */
  async turnout(electionId: string, now = Date.now()) {
    const election = await this.prisma.election.findUnique({ where: { id: electionId } });
    if (!election) throw new NotFoundException();
    const registered = await this.prisma.voterRollEntry.count({ where: { electionId } });
    const sliced = election.status === ElectionStatus.VOTING_OPEN && registered < SMALL_ELECTION_VOTERS;
    const asOf = sliced ? new Date(Math.floor(now / TURNOUT_SLOT_MS) * TURNOUT_SLOT_MS) : new Date(now);
    const voted = await this.prisma.votingParticipation.count({ where: { electionId, ...(sliced ? { votedAt: { lt: asOf } } : {}) } });
    return { registered, voted, rate: registered === 0 ? 0 : Math.round((voted / registered) * 1000) / 10, asOf, sliced };
  }
}
