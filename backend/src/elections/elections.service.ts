import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditResult, CandidateStatus, ElectionStatus, Prisma, Role, UserStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { RequestInfo } from '../auth/auth.service';
import type { AuthUser } from '../common/authz/auth-user';
import { AuthzService } from '../common/authz/authz.service';
import { ROLE_PERMISSIONS } from '../common/authz/permissions';
import { EligibilityService, isWholeInstitution, rulesMatch, RuleCriteria } from '../eligibility/eligibility.service';
import { PrismaService } from '../prisma/prisma.service';
import { STUDENT_VISIBLE } from './election-states';
import type { CreateElectionDto, PositionDto, SetRulesDto, UpdateElectionDto, UpdatePositionDto } from './elections.dto';

/** Un comité d'au moins 3 membres est exigé dès l'ouverture des candidatures (03 §6, D-03). */
export const MIN_COMMITTEE = 3;

/** 04 §4.6 : annulable depuis tout état sauf RESULTS_PUBLISHED (et CANCELLED). En vote, l'urne et la participation restent figées en base. */
const CANCELLABLE: readonly ElectionStatus[] = [ElectionStatus.DRAFT, ElectionStatus.CANDIDACY_OPEN, ElectionStatus.CANDIDACY_CLOSED, ElectionStatus.VOTING_OPEN, ElectionStatus.VOTING_CLOSED];
const DATE_FIELDS = ['candidacyStartsAt', 'candidacyEndsAt', 'votingStartsAt', 'votingEndsAt'] as const;

export interface ElectionView {
  election: Prisma.ElectionGetPayload<object>;
  /** IA de l'institution, comité de CETTE élection ou SUPER_ADMIN (lecture) : voit aussi brouillon, règles et rejets. */
  staff: boolean;
  /** Étudiant éligible qui consulte l'élection (jamais en même temps que `staff`). */
  studentId: string | null;
}

@Injectable()
export class ElectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthzService,
    private readonly eligibility: EligibilityService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ visibilité

  /**
   * Qui voit quoi (03 §5.4) : le personnel (IA, comité de l'élection, SA) voit tout ; un étudiant ne voit que les
   * élections à partir de CANDIDACY_OPEN pour lesquelles il est éligible. Sinon 404 : l'existence n'est pas révélée.
   * Le guard a déjà vérifié la permission et l'appartenance à l'institution.
   */
  async view(user: AuthUser, electionId: string): Promise<ElectionView> {
    const election = await this.prisma.election.findUnique({ where: { id: electionId } });
    if (!election) throw new NotFoundException();
    const scope = { institutionIds: [election.institutionId], electionId: election.id };
    const staff = user.roles.some((g) => g.role !== Role.STUDENT && this.authz.grantCoversScope(g, scope) && ROLE_PERMISSIONS[g.role].includes('election:read'));
    if (staff) return { election, staff: true, studentId: null };

    const isStudentHere = user.roles.some((g) => g.role === Role.STUDENT && g.institutionId === election.institutionId);
    if (!isStudentHere || !STUDENT_VISIBLE.includes(election.status)) throw new NotFoundException();
    const student = await this.prisma.student.findUnique({ where: { userId: user.id } });
    if (!student) throw new NotFoundException();
    // Après le gel (04 §5.1), c'est la liste électorale qui fait foi : une inscription modifiée ensuite ne retire pas le droit de vote.
    const onRoll = election.voterRollFrozenAt ? await this.prisma.voterRollEntry.findUnique({ where: { electionId_studentId: { electionId: election.id, studentId: student.id } } }) : null;
    if (!onRoll && !(await this.eligibility.isEligible(election, student.id))) throw new NotFoundException();
    return { election, staff: false, studentId: student.id };
  }

  // ------------------------------------------------------------------ lecture

  private publicFields(e: ElectionView['election']) {
    return {
      id: e.id,
      institutionId: e.institutionId,
      academicYearId: e.academicYearId,
      title: e.title,
      titleAr: e.titleAr,
      description: e.description,
      status: e.status,
      candidacyStartsAt: e.candidacyStartsAt,
      candidacyEndsAt: e.candidacyEndsAt,
      votingStartsAt: e.votingStartsAt,
      votingEndsAt: e.votingEndsAt,
      // Second tour (D-01) : le tour de cette élection et l'élection du tour précédent.
      round: e.round,
      parentElectionId: e.parentElectionId,
    };
  }

  private positionFields(p: { id: string; title: string; titleAr: string | null; seats: number; maxChoices: number; allowBlank: boolean; displayOrder: number }) {
    return { id: p.id, title: p.title, titleAr: p.titleAr, seats: p.seats, maxChoices: p.maxChoices, allowBlank: p.allowBlank, displayOrder: p.displayOrder };
  }

  private positions(electionId: string) {
    return this.prisma.position.findMany({ where: { electionId }, orderBy: { displayOrder: 'asc' } });
  }

  async get(user: AuthUser, electionId: string) {
    const { election, staff } = await this.view(user, electionId);
    const positions = (await this.positions(election.id)).map((p) => this.positionFields(p));
    if (!staff) return { ...this.publicFields(election), positions, eligible: true };
    const rules = await this.prisma.eligibilityRule.findMany({ where: { electionId } });
    return {
      ...this.publicFields(election),
      createdAt: election.createdAt,
      positions,
      rules: {
        wholeInstitution: rules.some(isWholeInstitution),
        items: rules.filter((r) => !isWholeInstitution(r)).map((r) => ({ id: r.id, facultyId: r.facultyId, programId: r.programId, levelId: r.levelId, groupId: r.groupId })),
      },
      committeeCount: await this.committeeCount(electionId),
      minCommittee: MIN_COMMITTEE,
      // Le second tour actif de cette élection, s'il existe (le comité n'en crée qu'un à la fois, D-46).
      secondRound: await this.prisma.election.findFirst({ where: { parentElectionId: electionId, status: { not: ElectionStatus.CANCELLED } }, select: { id: true, status: true, round: true } }),
    };
  }

  /** Élections de l'institution pour le personnel : l'IA les voit toutes, un membre du comité seulement les siennes. */
  async listForStaff(user: AuthUser, institutionId: string) {
    const wholeInstitution = user.roles.some((g) => g.role === Role.INSTITUTION_ADMIN && g.institutionId === institutionId);
    const committeeOf = user.roles.filter((g) => g.role === Role.ELECTION_COMMITTEE && g.institutionId === institutionId && g.electionId).map((g) => g.electionId as string);
    const rows = await this.prisma.election.findMany({
      where: wholeInstitution ? { institutionId } : { institutionId, id: { in: committeeOf } },
      orderBy: { votingStartsAt: 'desc' },
    });
    return rows.map((e) => this.publicFields(e));
  }

  /** « Mes élections » : celles pour lesquelles l'étudiant est éligible, à partir de CANDIDACY_OPEN. */
  async mine(user: AuthUser) {
    const grant = user.roles.find((g) => g.role === Role.STUDENT && g.institutionId);
    if (!grant) throw new ForbiddenException();
    const student = await this.prisma.student.findUnique({ where: { userId: user.id } });
    if (!student) return [];
    const enrollments = await this.prisma.studentEnrollment.findMany({ where: { studentId: student.id, institutionId: grant.institutionId as string, status: 'VERIFIED' } });
    if (enrollments.length === 0) return [];
    const elections = await this.prisma.election.findMany({
      where: { institutionId: grant.institutionId as string, status: { in: [...STUDENT_VISIBLE] } },
      include: { rules: true },
      orderBy: { votingStartsAt: 'asc' },
    });
    const candidacies = await this.prisma.candidate.findMany({ where: { studentId: student.id } });
    const frozenIds = elections.filter((e) => e.voterRollFrozenAt).map((e) => e.id);
    const rolls = frozenIds.length === 0 ? [] : await this.prisma.voterRollEntry.findMany({ where: { studentId: student.id, electionId: { in: frozenIds } }, include: { participation: true } });
    return elections
      .filter((e) => {
        if (rolls.some((r) => r.electionId === e.id)) return true; // liste gelée : elle fait foi (04 §5.1)
        const enrollment = enrollments.find((x) => x.academicYearId === e.academicYearId);
        return !!enrollment && rulesMatch(e.rules as RuleCriteria[], enrollment);
      })
      .map((e) => {
        const roll = rolls.find((r) => r.electionId === e.id);
        // `hasVoted` : UN booléen (a voté / n'a pas voté), jamais un choix ni un identifiant de bulletin.
        return { ...this.publicFields(e), myCandidacy: candidacies.find((c) => c.electionId === e.id)?.status ?? null, hasVoted: !!roll?.participation };
      });
  }

  /** Nombre d'électeurs éligibles : un chiffre, jamais une liste nominative (D-02). */
  async eligibleCount(user: AuthUser, electionId: string) {
    const { election } = await this.view(user, electionId);
    return { count: await this.eligibility.countEligible(election) };
  }

  committeeCount(electionId: string): Promise<number> {
    return this.prisma.roleAssignment.count({ where: { electionId, role: Role.ELECTION_COMMITTEE, revokedAt: null, user: { status: UserStatus.ACTIVE } } });
  }

  // ------------------------------------------------------------------ écriture : utilitaires

  private async record(actor: AuthUser, election: { id: string; institutionId: string }, action: string, info: RequestInfo, metadata?: Record<string, unknown>) {
    await this.audit.record({
      actorId: actor.id,
      institutionId: election.institutionId,
      action,
      resourceType: 'election',
      resourceId: election.id,
      result: AuditResult.SUCCESS,
      ip: info.ip,
      requestId: info.requestId,
      metadata,
    });
  }

  /** Les dates se suivent : candidatures (début < fin) ≤ ouverture du vote < clôture du vote. */
  private checkCalendar(d: { candidacyStartsAt: Date | null; candidacyEndsAt: Date | null; votingStartsAt: Date; votingEndsAt: Date }) {
    const bad = () => new BadRequestException('invalid_dates');
    if (!!d.candidacyStartsAt !== !!d.candidacyEndsAt) throw bad();
    if (d.candidacyStartsAt && d.candidacyEndsAt) {
      if (!(d.candidacyStartsAt < d.candidacyEndsAt)) throw bad();
      if (!(d.candidacyEndsAt <= d.votingStartsAt)) throw bad();
    }
    if (!(d.votingStartsAt < d.votingEndsAt)) throw bad();
  }

  private async loadForUpdate(electionId: string) {
    const e = await this.prisma.election.findUnique({ where: { id: electionId } });
    if (!e) throw new NotFoundException();
    return e;
  }

  private assertDraft(e: { status: ElectionStatus }) {
    if (e.status !== ElectionStatus.DRAFT) throw new ConflictException('election_locked');
  }

  // ------------------------------------------------------------------ création et modification

  async create(actor: AuthUser, institutionId: string, dto: CreateElectionDto, info: RequestInfo) {
    const year = await this.prisma.academicYear.findFirst({ where: { id: dto.academicYearId, institutionId } });
    if (!year) throw new NotFoundException();
    const dates = {
      candidacyStartsAt: dto.candidacyStartsAt ? new Date(dto.candidacyStartsAt) : null,
      candidacyEndsAt: dto.candidacyEndsAt ? new Date(dto.candidacyEndsAt) : null,
      votingStartsAt: new Date(dto.votingStartsAt),
      votingEndsAt: new Date(dto.votingEndsAt),
    };
    this.checkCalendar(dates);
    const election = await this.prisma.election.create({
      data: { institutionId, academicYearId: year.id, title: dto.title, titleAr: dto.titleAr ?? null, description: dto.description ?? null, ...dates, createdById: actor.id },
    });
    await this.record(actor, election, 'ELECTION_CREATED', info);
    return this.publicFields(election);
  }

  /** Brouillon : tous les champs. Après l'ouverture des candidatures : les dates seulement. Jamais après. */
  async update(actor: AuthUser, electionId: string, dto: UpdateElectionDto, info: RequestInfo) {
    const current = await this.loadForUpdate(electionId);
    const editableStates: ElectionStatus[] = [ElectionStatus.DRAFT, ElectionStatus.CANDIDACY_OPEN, ElectionStatus.CANDIDACY_CLOSED];
    if (!editableStates.includes(current.status)) throw new ConflictException('election_locked');
    const onlyDates = Object.keys(dto).every((k) => (DATE_FIELDS as readonly string[]).includes(k));
    if (current.status !== ElectionStatus.DRAFT && !onlyDates) throw new ConflictException('election_locked');

    const data: Prisma.ElectionUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.titleAr !== undefined) data.titleAr = dto.titleAr;
    if (dto.description !== undefined) data.description = dto.description;
    const next = {
      candidacyStartsAt: dto.candidacyStartsAt !== undefined ? new Date(dto.candidacyStartsAt) : current.candidacyStartsAt,
      candidacyEndsAt: dto.candidacyEndsAt !== undefined ? new Date(dto.candidacyEndsAt) : current.candidacyEndsAt,
      votingStartsAt: dto.votingStartsAt !== undefined ? new Date(dto.votingStartsAt) : current.votingStartsAt,
      votingEndsAt: dto.votingEndsAt !== undefined ? new Date(dto.votingEndsAt) : current.votingEndsAt,
    };
    this.checkCalendar(next);
    Object.assign(data, next);
    // La mise à jour est conditionnée à l'état lu : une ouverture concurrente ne laisse pas passer une édition de brouillon.
    const res = await this.prisma.election.updateMany({ where: { id: electionId, status: current.status }, data });
    if (res.count !== 1) throw new ConflictException('election_locked');
    await this.record(actor, current, 'ELECTION_UPDATED', info, { fields: Object.keys(dto) });
    return this.publicFields((await this.loadForUpdate(electionId)));
  }

  // ------------------------------------------------------------------ règles d'éligibilité

  /** Remplace les règles (brouillon seulement). Tous les identifiants viennent de l'institution et de l'année de l'élection. */
  async setRules(actor: AuthUser, electionId: string, dto: SetRulesDto, info: RequestInfo) {
    const election = await this.loadForUpdate(electionId);
    this.assertDraft(election);
    const invalid = () => new BadRequestException('invalid_rule');
    if (dto.wholeInstitution && dto.rules.length > 0) throw invalid();
    if (!dto.wholeInstitution && dto.rules.some(isWholeInstitution)) throw invalid(); // « toute l'institution » se choisit, ne se déduit pas

    const { institutionId, academicYearId } = election;
    for (const r of dto.rules) {
      const [faculty, program, level, group] = await Promise.all([
        r.facultyId ? this.prisma.faculty.findFirst({ where: { id: r.facultyId, institutionId } }) : null,
        r.programId ? this.prisma.program.findFirst({ where: { id: r.programId, institutionId } }) : null,
        r.levelId ? this.prisma.level.findFirst({ where: { id: r.levelId, institutionId } }) : null,
        r.groupId ? this.prisma.group.findFirst({ where: { id: r.groupId, institutionId } }) : null,
      ]);
      if ((r.facultyId && !faculty) || (r.programId && !program) || (r.levelId && !level) || (r.groupId && !group)) throw new NotFoundException();
      // Une règle incohérente ne peut jamais rien sélectionner : on la refuse plutôt que de la laisser silencieusement vide.
      if (program && faculty && program.facultyId !== faculty.id) throw invalid();
      if (group && (group.academicYearId !== academicYearId || (program && group.programId !== program.id) || (level && group.levelId !== level.id))) throw invalid();
      if (group && faculty && (await this.prisma.program.findFirst({ where: { id: group.programId, facultyId: faculty.id } })) === null) throw invalid();
    }

    const rows = dto.wholeInstitution ? [{}] : dto.rules.map((r) => ({ facultyId: r.facultyId ?? null, programId: r.programId ?? null, levelId: r.levelId ?? null, groupId: r.groupId ?? null }));
    await this.prisma.$transaction(async (tx) => {
      await tx.eligibilityRule.deleteMany({ where: { electionId } });
      await tx.eligibilityRule.createMany({ data: rows.map((r) => ({ electionId, ...r })) });
    });
    await this.record(actor, election, 'ELECTION_RULES_SET', info, { count: rows.length, wholeInstitution: !!dto.wholeInstitution });
    return this.get(actor, electionId);
  }

  // ------------------------------------------------------------------ postes

  private async createOrConflict<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('already_exists');
      throw e;
    }
  }

  async addPosition(actor: AuthUser, electionId: string, dto: PositionDto, info: RequestInfo) {
    const election = await this.loadForUpdate(electionId);
    this.assertDraft(election);
    const position = await this.createOrConflict(() => this.prisma.position.create({ data: { ...dto, electionId } }));
    await this.record(actor, election, 'ELECTION_POSITION_ADDED', info, { positionId: position.id });
    return this.positionFields(position);
  }

  async updatePosition(actor: AuthUser, electionId: string, positionId: string, dto: UpdatePositionDto, info: RequestInfo) {
    const election = await this.loadForUpdate(electionId);
    this.assertDraft(election);
    if (!(await this.prisma.position.findFirst({ where: { id: positionId, electionId } }))) throw new NotFoundException();
    const position = await this.createOrConflict(() => this.prisma.position.update({ where: { id: positionId }, data: dto }));
    await this.record(actor, election, 'ELECTION_POSITION_UPDATED', info, { positionId });
    return this.positionFields(position);
  }

  async removePosition(actor: AuthUser, electionId: string, positionId: string, info: RequestInfo) {
    const election = await this.loadForUpdate(electionId);
    this.assertDraft(election);
    if (!(await this.prisma.position.findFirst({ where: { id: positionId, electionId } }))) throw new NotFoundException();
    await this.prisma.position.delete({ where: { id: positionId } });
    await this.record(actor, election, 'ELECTION_POSITION_REMOVED', info, { positionId });
  }

  // ------------------------------------------------------------------ états

  /** Transition atomique : la mise à jour est conditionnée à l'état de départ lu (deux requêtes concurrentes : une seule passe). */
  private async transition(electionId: string, from: readonly ElectionStatus[], to: ElectionStatus) {
    const res = await this.prisma.election.updateMany({ where: { id: electionId, status: { in: [...from] } }, data: { status: to } });
    if (res.count !== 1) throw new ConflictException('invalid_state');
  }

  /** DRAFT → CANDIDACY_OPEN. Exige des postes, des règles explicites, un calendrier de candidatures et 3 membres de comité. */
  async openCandidacy(actor: AuthUser, electionId: string, info: RequestInfo) {
    const election = await this.loadForUpdate(electionId);
    if (election.status !== ElectionStatus.DRAFT) throw new ConflictException('invalid_state');
    // 04 §4.1 : toutes les conditions sont vérifiées et la réponse les liste TOUTES (pas seulement la première).
    const missing: string[] = [];
    if (!election.candidacyStartsAt || !election.candidacyEndsAt) missing.push('candidacy_dates_required');
    if ((await this.prisma.position.count({ where: { electionId } })) === 0) missing.push('positions_required');
    const hasRules = (await this.prisma.eligibilityRule.count({ where: { electionId } })) > 0;
    if (!hasRules) missing.push('rules_required');
    if ((await this.committeeCount(electionId)) < MIN_COMMITTEE) missing.push('committee_incomplete');
    // Une élection qui ne concerne personne n'a pas de sens (zéro éligible).
    if (hasRules && (await this.eligibility.countEligible(election)) === 0) missing.push('no_eligible_voters');
    if (missing.length > 0) throw new ConflictException({ message: 'conditions_not_met', conditions: missing });
    await this.transition(electionId, [ElectionStatus.DRAFT], ElectionStatus.CANDIDACY_OPEN);
    await this.record(actor, election, 'ELECTION_CANDIDACY_OPENED', info);
    return this.get(actor, electionId);
  }

  /** CANDIDACY_OPEN → CANDIDACY_CLOSED. Le comité peut encore examiner les candidatures déposées. */
  async closeCandidacy(actor: AuthUser, electionId: string, info: RequestInfo) {
    const election = await this.loadForUpdate(electionId);
    await this.transition(electionId, [ElectionStatus.CANDIDACY_OPEN], ElectionStatus.CANDIDACY_CLOSED);
    await this.record(actor, election, 'ELECTION_CANDIDACY_CLOSED', info);
    return this.get(actor, electionId);
  }

  /** CANDIDACY_OPEN → CANDIDACY_CLOSED à `candidacyEndsAt` (tâche planifiée, 04 §4.2). Même transition que la clôture manuelle, sans acteur. */
  async closeCandidacyAutomatically(electionId: string) {
    const election = await this.loadForUpdate(electionId);
    await this.transition(electionId, [ElectionStatus.CANDIDACY_OPEN], ElectionStatus.CANDIDACY_CLOSED);
    await this.audit.record({ actorId: null, institutionId: election.institutionId, action: 'ELECTION_CANDIDACY_CLOSED', resourceType: 'election', resourceId: election.id, result: AuditResult.SUCCESS, metadata: { automatic: true } });
  }

  /** 🔐 IA seulement (le comité n'annule pas sa propre élection). Les candidatures en cours sont conservées pour l'historique. */
  async cancel(actor: AuthUser, electionId: string, reason: string, info: RequestInfo) {
    const election = await this.loadForUpdate(electionId);
    await this.transition(electionId, CANCELLABLE, ElectionStatus.CANCELLED);
    await this.record(actor, election, 'ELECTION_CANCELLED', info, { from: election.status, reason }); // motif obligatoire (04 §4.6)
    return this.get(actor, electionId);
  }

  /** Candidatures qui comptent (en cours ou retenues) : sert au conflit « membre du comité ≠ candidat ». */
  static readonly ACTIVE_CANDIDACY: readonly CandidateStatus[] = [CandidateStatus.PENDING, CandidateStatus.APPROVED];
}
