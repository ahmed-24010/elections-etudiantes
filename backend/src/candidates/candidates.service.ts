import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { AuditResult, CandidateStatus, ElectionStatus, FilePurpose, Prisma, Role } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import type { RequestInfo } from '../auth/auth.service';
import type { AuthUser } from '../common/authz/auth-user';
import { STUDENT_VISIBLE } from '../elections/election-states';
import { ElectionsService } from '../elections/elections.service';
import { EligibilityService } from '../eligibility/eligibility.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { detectFile, FileRejected, sanitizeOriginalName } from '../storage/file-validator';
import { SignedUrlService } from '../storage/signed-url.service';
import { StorageService } from '../storage/storage.service';
import type { ApplyDto, UpdateCandidacyDto } from './candidates.dto';

export type FileKind = 'photo' | 'program';

/** On peut encore déposer, corriger ou retirer sa candidature tant que les candidatures sont ouvertes (et avant validation pour corriger). */
const REVIEWABLE: readonly ElectionStatus[] = [ElectionStatus.CANDIDACY_OPEN, ElectionStatus.CANDIDACY_CLOSED];
/** États d'une candidature que son auteur peut encore corriger (texte, poste, fichiers). */
const CORRECTABLE: readonly CandidateStatus[] = [CandidateStatus.PENDING, CandidateStatus.REJECTED];

@Injectable()
export class CandidatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly elections: ElectionsService,
    private readonly eligibility: EligibilityService,
    private readonly storage: StorageService,
    private readonly signer: SignedUrlService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------------ utilitaires

  private async election(electionId: string) {
    const election = await this.prisma.election.findUnique({ where: { id: electionId } });
    if (!election) throw new NotFoundException();
    return election;
  }

  /**
   * L'étudiant derrière la requête, pour agir sur SA candidature : rôle STUDENT dans l'institution de l'élection, élection
   * visible (jamais un brouillon) et étudiant éligible. Sinon 404 : l'existence de l'élection n'est pas révélée.
   */
  private async myStudent(user: AuthUser, election: { id: string; institutionId: string; academicYearId: string; status: ElectionStatus }) {
    const isStudent = user.roles.some((g) => g.role === Role.STUDENT && g.institutionId === election.institutionId);
    if (!isStudent || !STUDENT_VISIBLE.includes(election.status)) throw new NotFoundException();
    const student = await this.prisma.student.findUnique({ where: { userId: user.id } });
    if (!student || !(await this.eligibility.isEligible(election, student.id))) throw new NotFoundException();
    return student;
  }

  private async record(actor: AuthUser, election: { id: string; institutionId: string }, action: string, candidateId: string, info: RequestInfo, metadata?: Record<string, unknown>) {
    await this.audit.record({
      actorId: actor.id,
      institutionId: election.institutionId,
      action,
      resourceType: 'candidate',
      resourceId: candidateId,
      result: AuditResult.SUCCESS,
      ip: info.ip,
      requestId: info.requestId,
      metadata: { electionId: election.id, ...metadata },
    });
  }

  private async isCommitteeMember(userId: string, electionId: string): Promise<boolean> {
    return (await this.prisma.roleAssignment.count({ where: { userId, electionId, role: Role.ELECTION_COMMITTEE, revokedAt: null } })) > 0;
  }

  private assertWindow(e: { candidacyStartsAt: Date | null; candidacyEndsAt: Date | null }) {
    const now = Date.now();
    if (!e.candidacyStartsAt || !e.candidacyEndsAt || now < e.candidacyStartsAt.getTime() || now > e.candidacyEndsAt.getTime()) {
      throw new ConflictException('candidacy_window_closed');
    }
  }

  private async ownCandidate(electionId: string, studentId: string) {
    const c = await this.prisma.candidate.findFirst({ where: { electionId, studentId } });
    if (!c) throw new NotFoundException();
    return c;
  }

  private async assertPosition(electionId: string, positionId: string) {
    if (!(await this.prisma.position.findFirst({ where: { id: positionId, electionId } }))) throw new BadRequestException('invalid_position');
  }

  // ------------------------------------------------------------------ dépôt, correction, retrait

  async apply(user: AuthUser, electionId: string, dto: ApplyDto, info: RequestInfo) {
    const election = await this.election(electionId);
    const student = await this.myStudent(user, election);
    if (election.status !== ElectionStatus.CANDIDACY_OPEN) throw new ConflictException('candidacy_not_open');
    this.assertWindow(election);
    // 03 §6 : un membre du comité ne se porte pas candidat dans sa propre élection (il doit d'abord quitter le comité).
    if (await this.isCommitteeMember(user.id, electionId)) throw new ConflictException('committee_member_cannot_apply');
    await this.assertPosition(electionId, dto.positionId);

    const existing = await this.prisma.candidate.findFirst({ where: { electionId, studentId: student.id } });
    // Un étudiant = un seul poste par élection (D-05). Une candidature retirée peut être redéposée ; une candidature rejetée non.
    if (existing && existing.status !== CandidateStatus.WITHDRAWN) throw new ConflictException(existing.status === CandidateStatus.REJECTED ? 'candidacy_rejected' : 'already_candidate'); // rejetée : corriger puis « resubmit »

    let candidate;
    try {
      candidate = existing
        ? await this.prisma.candidate.update({
            where: { id: existing.id },
            data: { positionId: dto.positionId, statement: dto.statement ?? null, status: CandidateStatus.PENDING, reviewedById: null, reviewedAt: null, rejectionReason: null, photoFileId: null, programFileId: null },
          })
        : await this.prisma.candidate.create({ data: { electionId, positionId: dto.positionId, studentId: student.id, statement: dto.statement ?? null } });
    } catch (e) {
      // Deux dépôts simultanés : l'unicité (electionId, studentId) de la base en laisse passer un seul (D-05).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('already_candidate');
      throw e;
    }
    // Une candidature redéposée repart de zéro : les fichiers de la précédente sont retirés du stockage.
    for (const old of [existing?.photoFileId, existing?.programFileId]) if (old) await this.discard(old);
    await this.record(user, election, 'CANDIDATE_APPLIED', candidate.id, info, { positionId: dto.positionId });
    return this.ownView(candidate.id);
  }

  async update(user: AuthUser, electionId: string, dto: UpdateCandidacyDto, info: RequestInfo) {
    const election = await this.election(electionId);
    const student = await this.myStudent(user, election);
    const candidate = await this.ownCandidate(electionId, student.id);
    this.assertEditable(election, candidate);
    if (dto.positionId) await this.assertPosition(electionId, dto.positionId);
    const res = await this.prisma.candidate.updateMany({
      where: { id: candidate.id, status: { in: [...CORRECTABLE] } },
      data: { ...(dto.positionId ? { positionId: dto.positionId } : {}), ...(dto.statement !== undefined ? { statement: dto.statement } : {}) },
    });
    if (res.count !== 1) throw new ConflictException('candidacy_locked');
    await this.record(user, election, 'CANDIDATE_UPDATED', candidate.id, info);
    return this.ownView(candidate.id);
  }

  private assertEditable(election: { status: ElectionStatus }, candidate: { status: CandidateStatus }) {
    if (election.status !== ElectionStatus.CANDIDACY_OPEN) throw new ConflictException('candidacy_not_open');
    if (!CORRECTABLE.includes(candidate.status)) throw new ConflictException('candidacy_locked'); // « avant validation » ; une candidature rejetée se corrige
  }

  async withdraw(user: AuthUser, electionId: string, info: RequestInfo) {
    const election = await this.election(electionId);
    const student = await this.myStudent(user, election);
    const candidate = await this.ownCandidate(electionId, student.id);
    // 04 §10.5 : plus de retrait après la fermeture des candidatures.
    if (election.status !== ElectionStatus.CANDIDACY_OPEN) throw new ConflictException('candidacy_locked');
    const res = await this.prisma.candidate.updateMany({
      where: { id: candidate.id, status: { in: [CandidateStatus.PENDING, CandidateStatus.APPROVED] } },
      data: { status: CandidateStatus.WITHDRAWN },
    });
    if (res.count !== 1) throw new ConflictException('candidacy_locked');
    await this.record(user, election, 'CANDIDATE_WITHDRAWN', candidate.id, info);
    return this.ownView(candidate.id);
  }

  /**
   * Redépôt d'une candidature REJETÉE après correction (même principe que les attestations, D-21) : tant que les
   * candidatures sont ouvertes, elle repasse en PENDING pour un nouvel examen du comité.
   */
  async resubmit(user: AuthUser, electionId: string, info: RequestInfo) {
    const election = await this.election(electionId);
    const student = await this.myStudent(user, election);
    const candidate = await this.ownCandidate(electionId, student.id);
    if (election.status !== ElectionStatus.CANDIDACY_OPEN) throw new ConflictException('candidacy_not_open');
    this.assertWindow(election);
    if (await this.isCommitteeMember(user.id, electionId)) throw new ConflictException('committee_member_cannot_apply');
    const res = await this.prisma.candidate.updateMany({
      where: { id: candidate.id, status: CandidateStatus.REJECTED },
      data: { status: CandidateStatus.PENDING, reviewedById: null, reviewedAt: null, rejectionReason: null },
    });
    if (res.count !== 1) throw new ConflictException('candidacy_not_rejected');
    await this.record(user, election, 'CANDIDATE_RESUBMITTED', candidate.id, info);
    return this.ownView(candidate.id);
  }

  // ------------------------------------------------------------------ photo et programme (S3)

  async uploadFile(user: AuthUser, electionId: string, kind: FileKind, file: Express.Multer.File | undefined, info: RequestInfo) {
    if (!file) throw new BadRequestException('file_required');
    const election = await this.election(electionId);
    const student = await this.myStudent(user, election);
    const candidate = await this.ownCandidate(electionId, student.id);
    this.assertEditable(election, candidate);

    // Type RÉEL d'après le contenu (D-23). Photo : image seulement. Programme : PDF ou image.
    let detected;
    try {
      detected = detectFile(file.buffer);
    } catch (e) {
      if (!(e instanceof FileRejected)) throw e;
      if (e.reason === 'TOO_LARGE') throw new PayloadTooLargeException(e.reason);
      if (e.reason === 'EMPTY') throw new BadRequestException(e.reason);
      throw new UnsupportedMediaTypeException(kind === 'photo' && e.reason === 'UNSUPPORTED_TYPE' ? 'PHOTO_TYPE' : e.reason);
    }
    // Photo : JPEG ou PNG uniquement (liste blanche, d'après le contenu détecté).
    if (kind === 'photo' && detected.mime !== 'image/jpeg' && detected.mime !== 'image/png') throw new UnsupportedMediaTypeException('PHOTO_TYPE');

    const key = `candidates/${election.institutionId}/${election.id}/${randomUUID()}.${detected.ext}`; // nom généré par le serveur
    await this.storage.put(key, file.buffer, detected.mime);
    const column = kind === 'photo' ? 'photoFileId' : 'programFileId';
    const previous = candidate[column];
    try {
      await this.prisma.$transaction(async (tx) => {
        const stored = await tx.storedFile.create({
          data: {
            purpose: kind === 'photo' ? FilePurpose.CANDIDATE_PHOTO : FilePurpose.CANDIDATE_PROGRAM,
            storageKey: key,
            originalName: sanitizeOriginalName(file.originalname),
            mimeType: detected.mime,
            sizeBytes: file.buffer.length,
            sha256: createHash('sha256').update(file.buffer).digest('hex'),
            uploadedById: user.id,
          },
        });
        const res = await tx.candidate.updateMany({ where: { id: candidate.id, status: { in: [...CORRECTABLE] } }, data: { [column]: stored.id } });
        if (res.count !== 1) throw new ConflictException('candidacy_locked');
      });
    } catch (e) {
      await this.storage.delete(key).catch(() => undefined); // pas de fichier orphelin si la base échoue
      throw e;
    }
    if (previous) await this.discard(previous);
    await this.record(user, election, kind === 'photo' ? 'CANDIDATE_PHOTO_UPLOADED' : 'CANDIDATE_PROGRAM_UPLOADED', candidate.id, info, { mime: detected.mime, sizeBytes: file.buffer.length });
    return this.ownView(candidate.id);
  }

  /** Remplacement d'un fichier : l'ancien est marqué supprimé et retiré du stockage. */
  private async discard(fileId: string) {
    const old = await this.prisma.storedFile.findUnique({ where: { id: fileId } });
    if (!old) return;
    await this.prisma.storedFile.update({ where: { id: fileId }, data: { deletedAt: new Date() } });
    await this.storage.delete(old.storageKey).catch(() => undefined);
  }

  /** URL signée de 5 minutes vers la photo ou le programme d'un candidat visible (même mécanisme que les attestations, D-23). */
  async issueFileUrl(user: AuthUser, electionId: string, candidateId: string, kind: FileKind) {
    const { staff, studentId } = await this.elections.view(user, electionId);
    const candidate = await this.prisma.candidate.findFirst({ where: { id: candidateId, electionId } });
    if (!candidate) throw new NotFoundException();
    const own = !!studentId && candidate.studentId === studentId;
    if (!staff && !own && candidate.status !== CandidateStatus.APPROVED) throw new NotFoundException();
    const fileId = kind === 'photo' ? candidate.photoFileId : candidate.programFileId;
    if (!fileId) throw new NotFoundException();
    const file = await this.prisma.storedFile.findUnique({ where: { id: fileId } });
    if (!file || file.deletedAt) throw new NotFoundException();
    const { exp, sig } = this.signer.sign(fileId, user.id);
    return { url: `/api/v1/files/${fileId}?uid=${user.id}&exp=${exp}&sig=${sig}`, expiresAt: new Date(exp).toISOString() };
  }

  // ------------------------------------------------------------------ lecture

  private async studentLine(studentId: string) {
    const s = await this.prisma.student.findUnique({ where: { id: studentId } });
    return { firstName: s?.firstName ?? '', lastName: s?.lastName ?? '', fullNameAr: s?.fullNameAr ?? null };
  }

  private async ownView(candidateId: string) {
    const c = await this.prisma.candidate.findUnique({ where: { id: candidateId } });
    if (!c) throw new NotFoundException();
    return this.own(c);
  }

  private own(c: { id: string; positionId: string; status: CandidateStatus; statement: string | null; photoFileId: string | null; programFileId: string | null; rejectionReason: string | null }) {
    return {
      id: c.id,
      positionId: c.positionId,
      status: c.status,
      statement: c.statement,
      rejectionReason: c.rejectionReason,
      hasPhoto: !!c.photoFileId,
      hasProgram: !!c.programFileId,
    };
  }

  /** Ma candidature à cette élection (404 si je n'ai pas candidaté). */
  async mine(user: AuthUser, electionId: string) {
    const election = await this.election(electionId);
    const student = await this.myStudent(user, election);
    return this.own(await this.ownCandidate(electionId, student.id));
  }

  /** Liste publique : candidats VALIDÉS d'une élection que l'on peut voir (`candidate:read:approved`). */
  async listApproved(user: AuthUser, electionId: string) {
    const { election } = await this.elections.view(user, electionId);
    const rows = await this.prisma.candidate.findMany({ where: { electionId: election.id, status: CandidateStatus.APPROVED }, orderBy: { createdAt: 'asc' } });
    return Promise.all(rows.map(async (c) => ({ id: c.id, positionId: c.positionId, statement: c.statement, hasPhoto: !!c.photoFileId, hasProgram: !!c.programFileId, ...(await this.studentLine(c.studentId)) })));
  }

  /** `candidate:read:all` : le personnel voit tout, y compris rejets et motifs ; un étudiant ne voit que la sienne (👤). */
  async listAll(user: AuthUser, electionId: string) {
    const { election, staff, studentId } = await this.elections.view(user, electionId);
    if (!staff) {
      const mine = studentId ? await this.prisma.candidate.findFirst({ where: { electionId, studentId } }) : null;
      return mine ? [this.own(mine)] : [];
    }
    const rows = await this.prisma.candidate.findMany({ where: { electionId: election.id }, orderBy: { createdAt: 'asc' } });
    return Promise.all(
      rows.map(async (c) => {
        // « student:read:minimal » : nom et filière, jamais le numéro étudiant ni les documents.
        const enrollment = await this.prisma.studentEnrollment.findFirst({ where: { studentId: c.studentId, academicYearId: election.academicYearId } });
        return {
          ...this.own(c),
          reviewedAt: c.reviewedAt,
          ...(await this.studentLine(c.studentId)),
          enrollment: enrollment ? { programId: enrollment.programId, levelId: enrollment.levelId, groupId: enrollment.groupId } : null,
        };
      }),
    );
  }

  // ------------------------------------------------------------------ décision du comité 🔐

  async review(user: AuthUser, electionId: string, candidateId: string, decision: 'APPROVED' | 'REJECTED', reason: string | null, info: RequestInfo) {
    const election = await this.election(electionId);
    const candidate = await this.prisma.candidate.findFirst({ where: { id: candidateId, electionId } });
    if (!candidate) throw new NotFoundException();
    if (!REVIEWABLE.includes(election.status)) throw new ConflictException('election_not_reviewable');
    const student = await this.prisma.student.findUnique({ where: { id: candidate.studentId } });
    // 03 §6 : on ne décide pas de sa propre candidature (ni d'une demande que l'on a créée).
    if (!student || student.userId === user.id) throw new ForbiddenException('cannot_review_own_candidacy');
    if (candidate.status !== CandidateStatus.PENDING) throw new ConflictException('not_reviewable');
    if (decision === 'APPROVED') {
      // 02 §5 : le candidat doit être éligible au dépôt, puis à la validation.
      if (!(await this.eligibility.isEligible(election, candidate.studentId))) throw new ConflictException('candidate_not_eligible');
      if (await this.isCommitteeMember(student.userId, electionId)) throw new ConflictException('committee_member_cannot_apply');
    }
    const res = await this.prisma.candidate.updateMany({
      where: { id: candidate.id, status: CandidateStatus.PENDING }, // deux décisions simultanées : une seule passe
      data: { status: decision, reviewedById: user.id, reviewedAt: new Date(), rejectionReason: decision === 'REJECTED' ? reason : null },
    });
    if (res.count !== 1) throw new ConflictException('not_reviewable');
    await this.record(user, election, decision === 'APPROVED' ? 'CANDIDATE_APPROVED' : 'CANDIDATE_REJECTED', candidate.id, info);
    await this.notifications.notify(student.userId, decision === 'APPROVED' ? 'CANDIDACY_APPROVED' : 'CANDIDACY_REJECTED', decision === 'REJECTED' ? (reason ?? '') : '');
    return { id: candidate.id, status: decision };
  }
}
