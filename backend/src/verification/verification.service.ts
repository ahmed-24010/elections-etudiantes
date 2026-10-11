import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditResult, DocumentStatus, EnrollmentStatus, RejectionCode } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { RequestInfo } from '../auth/auth.service';
import type { AuthUser } from '../common/authz/auth-user';
import { AuthzService } from '../common/authz/authz.service';
import { ConflictPolicy } from '../common/authz/conflict.policy';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const REVIEW_INCLUDE = {
  student: true,
  faculty: { select: { code: true, name: true, nameAr: true } },
  program: { select: { code: true, name: true, nameAr: true } },
  level: { select: { code: true, name: true, nameAr: true } },
  group: { select: { name: true } },
  academicYear: { select: { label: true } },
  documents: { orderBy: { createdAt: 'desc' as const }, take: 1, include: { file: true } },
};

/**
 * Vérification des inscriptions (03 §5.3). Réservée au VÉRIFICATEUR de l'institution : l'INSTITUTION_ADMIN n'a ni la file
 * d'attente ni les attestations. Valider ou rejeter est 🔐 (2FA récente + audit) et soumis aux conflits d'intérêts (03 §6).
 */
@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthzService,
    private readonly conflicts: ConflictPolicy,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** La route est ouverte à `document:read` (aussi détenu par les étudiants pour leurs propres fichiers) : on exige ici le rôle de vérificateur. */
  private assertReviewer(actor: AuthUser, institutionId: string) {
    if (!this.authz.can(actor, 'enrollment:review', { institutionIds: [institutionId] })) throw new ForbiddenException();
  }

  private shape(e: any) {
    const doc = e.documents[0] ?? null;
    return {
      id: e.id,
      status: e.status,
      submittedAt: doc?.createdAt ?? e.createdAt,
      student: { studentNumber: e.student.studentNumber, firstName: e.student.firstName, lastName: e.student.lastName, fullNameAr: e.student.fullNameAr },
      faculty: e.faculty,
      program: e.program,
      level: e.level,
      group: e.group,
      academicYear: e.academicYear,
      document: doc ? { id: doc.id, status: doc.status, mimeType: doc.file.mimeType, sizeBytes: doc.file.sizeBytes } : null,
    };
  }

  /** File d'attente : inscriptions en attente dont la dernière attestation a été déposée. */
  async queue(actor: AuthUser, institutionId: string) {
    this.assertReviewer(actor, institutionId);
    const rows = await this.prisma.studentEnrollment.findMany({
      where: { institutionId, status: EnrollmentStatus.PENDING, documents: { some: { status: DocumentStatus.UPLOADED } } },
      include: REVIEW_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    return rows.filter((e) => e.documents[0]?.status === DocumentStatus.UPLOADED).map((e) => this.shape(e));
  }

  async detail(actor: AuthUser, enrollmentId: string) {
    const e = await this.prisma.studentEnrollment.findUnique({ where: { id: enrollmentId }, include: REVIEW_INCLUDE });
    if (!e) throw new NotFoundException();
    this.assertReviewer(actor, e.institutionId);
    // `ownRequest` permet à l'interface de désactiver les boutons ; le serveur refuse de toute façon (03 §6).
    return { ...this.shape(e), ownRequest: e.student.userId === actor.id || e.documents[0]?.file.uploadedById === actor.id };
  }

  private async loadReviewable(actor: AuthUser, enrollmentId: string) {
    const e = await this.prisma.studentEnrollment.findUnique({ where: { id: enrollmentId }, include: REVIEW_INCLUDE });
    if (!e) throw new NotFoundException();
    this.assertReviewer(actor, e.institutionId);
    const doc = e.documents[0];
    // 03 §6 : un vérificateur ne valide pas sa propre inscription, ni un fichier qu'il a déposé lui-même.
    this.conflicts.assertNotOwnRequest(actor.id, e.student.userId, doc?.file.uploadedById ?? null);
    if (e.status !== EnrollmentStatus.PENDING || !doc || doc.status !== DocumentStatus.UPLOADED) throw new ConflictException('not_reviewable');
    return { e, doc };
  }

  async approve(actor: AuthUser, enrollmentId: string, info: RequestInfo) {
    const { e, doc } = await this.loadReviewable(actor, enrollmentId);
    await this.prisma.$transaction(async (tx) => {
      // Décision atomique : si deux vérificateurs décident en même temps, un seul passe (l'autre reçoit 409).
      const won = await tx.studentEnrollment.updateMany({
        where: { id: e.id, status: EnrollmentStatus.PENDING },
        data: { status: EnrollmentStatus.VERIFIED, reviewedById: actor.id, reviewedAt: new Date(), rejectionCode: null, rejectionReason: null },
      });
      if (won.count !== 1) throw new ConflictException('not_reviewable');
      await tx.registrationDocument.update({ where: { id: doc.id }, data: { status: DocumentStatus.APPROVED, reviewedById: actor.id, reviewedAt: new Date() } });
      await this.notifications.notify(e.student.userId, 'ENROLLMENT_VERIFIED', '', tx);
    });
    await this.log(actor, e.institutionId, 'ENROLLMENT_VERIFIED', e.id, info);
  }

  async reject(actor: AuthUser, enrollmentId: string, code: RejectionCode, reason: string, info: RequestInfo) {
    const { e, doc } = await this.loadReviewable(actor, enrollmentId);
    await this.prisma.$transaction(async (tx) => {
      const won = await tx.studentEnrollment.updateMany({
        where: { id: e.id, status: EnrollmentStatus.PENDING },
        data: { status: EnrollmentStatus.REJECTED, reviewedById: actor.id, reviewedAt: new Date(), rejectionCode: code, rejectionReason: reason },
      });
      if (won.count !== 1) throw new ConflictException('not_reviewable');
      await tx.registrationDocument.update({ where: { id: doc.id }, data: { status: DocumentStatus.REJECTED, reviewedById: actor.id, reviewedAt: new Date(), reviewNote: reason } });
      // D-22 : « numéro incorrect » libère le numéro, pour que son vrai titulaire puisse s'inscrire.
      if (code === RejectionCode.WRONG_STUDENT_NUMBER) await tx.student.update({ where: { id: e.studentId }, data: { studentNumber: null, numberClaimedAt: null } });
      await this.notifications.notify(e.student.userId, 'ENROLLMENT_REJECTED', reason, tx);
    });
    if (code === RejectionCode.WRONG_STUDENT_NUMBER) await this.log(actor, e.institutionId, 'STUDENT_NUMBER_RELEASED', e.studentId, info, { reason: 'REJECTED_WRONG_NUMBER' }, 'student');
    await this.log(actor, e.institutionId, 'ENROLLMENT_REJECTED', e.id, info, { code }); // le motif libre n'est pas recopié dans l'audit
  }

  private log(actor: AuthUser, institutionId: string, action: string, resourceId: string, info: RequestInfo, metadata?: Record<string, unknown>, resourceType = 'enrollment') {
    return this.audit.record({
      actorId: actor.id,
      actorRole: 'VERIFICATION_OFFICER',
      institutionId,
      action,
      resourceType,
      resourceId,
      result: AuditResult.SUCCESS,
      ip: info.ip,
      requestId: info.requestId,
      metadata: metadata ?? null,
    });
  }
}
