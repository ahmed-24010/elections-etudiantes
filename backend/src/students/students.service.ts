import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import { AuditResult, DocumentStatus, EnrollmentStatus, FilePurpose, Prisma, Role } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import type { RequestInfo } from '../auth/auth.service';
import type { AuthUser } from '../common/authz/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { detectFile, FileRejected, sanitizeOriginalName } from '../storage/file-validator';
import { StorageService } from '../storage/storage.service';
import type { DeclareEnrollmentDto } from './students.dto';

/** Une réservation de numéro non confirmée expire au bout de 7 jours (D-22). */
export const NUMBER_CLAIM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Erreur « numéro indisponible » volontairement générique : elle ne dit pas qui détient le numéro (D-22). */
const NUMBER_UNAVAILABLE = 'student_number_unavailable';

const ENROLLMENT_INCLUDE = {
  faculty: { select: { id: true, code: true, name: true, nameAr: true } },
  program: { select: { id: true, code: true, name: true, nameAr: true } },
  level: { select: { id: true, code: true, name: true, nameAr: true } },
  group: { select: { id: true, name: true } },
  academicYear: { select: { id: true, label: true } },
  documents: { orderBy: { createdAt: 'desc' as const }, include: { file: { select: { mimeType: true, sizeBytes: true, originalName: true } } } },
};

@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /** Institution de l'étudiant : lue dans son rôle STUDENT en base, jamais envoyée par le client. */
  private studentInstitution(actor: AuthUser): string {
    const grant = actor.roles.find((r) => r.role === Role.STUDENT && r.institutionId);
    if (!grant) throw new ForbiddenException();
    return grant.institutionId as string;
  }

  // ------------------------------------------------------------------ lecture

  async getMe(actor: AuthUser) {
    const institutionId = this.studentInstitution(actor);
    const year = await this.prisma.academicYear.findFirst({ where: { institutionId, isCurrent: true } });
    const student = await this.prisma.student.findUnique({ where: { userId: actor.id } });
    const enrollment =
      student && year
        ? await this.prisma.studentEnrollment.findFirst({ where: { studentId: student.id, academicYearId: year.id }, include: ENROLLMENT_INCLUDE })
        : null;
    const latest = enrollment?.documents[0] ?? null;
    return {
      institutionId,
      currentYear: year ? { id: year.id, label: year.label } : null,
      student: student ? { id: student.id, studentNumber: student.studentNumber, firstName: student.firstName, lastName: student.lastName, fullNameAr: student.fullNameAr } : null,
      enrollment: enrollment
        ? {
            id: enrollment.id,
            status: enrollment.status,
            rejectionCode: enrollment.rejectionCode,
            rejectionReason: enrollment.rejectionReason,
            faculty: enrollment.faculty,
            program: enrollment.program,
            level: enrollment.level,
            group: enrollment.group,
            academicYear: enrollment.academicYear,
          }
        : null,
      document: latest ? { id: latest.id, status: latest.status, createdAt: latest.createdAt, mimeType: latest.file.mimeType, sizeBytes: latest.file.sizeBytes } : null,
      // D-21 : verrouillée une fois vérifiée, ou pendant l'examen d'une attestation déposée.
      canEdit: !enrollment || enrollment.status === EnrollmentStatus.REJECTED || (enrollment.status === EnrollmentStatus.PENDING && latest?.status !== DocumentStatus.UPLOADED),
      canUpload: !!enrollment && enrollment.status === EnrollmentStatus.PENDING && latest?.status !== DocumentStatus.UPLOADED,
    };
  }

  // ------------------------------------------------------------------ déclaration d'inscription

  /** Crée ou met à jour le profil et l'inscription de l'année courante (D-21 : année courante seulement). */
  async declare(actor: AuthUser, dto: DeclareEnrollmentDto, info: RequestInfo) {
    const institutionId = this.studentInstitution(actor);
    const year = await this.prisma.academicYear.findFirst({ where: { institutionId, isCurrent: true } });
    if (!year) throw new ConflictException('no_current_year');

    // Cohérence de la filière, du niveau et du groupe, tous relus en base dans CETTE institution.
    const [faculty, program, level] = await Promise.all([
      this.prisma.faculty.findFirst({ where: { id: dto.facultyId, institutionId } }),
      this.prisma.program.findFirst({ where: { id: dto.programId, institutionId } }),
      this.prisma.level.findFirst({ where: { id: dto.levelId, institutionId } }),
    ]);
    if (!faculty || !program || !level) throw new BadRequestException('invalid_academic_choice');
    if (program.facultyId !== faculty.id) throw new BadRequestException('invalid_academic_choice');
    if (dto.groupId) {
      const group = await this.prisma.group.findFirst({ where: { id: dto.groupId, institutionId } });
      if (!group || group.programId !== program.id || group.levelId !== level.id || group.academicYearId !== year.id) {
        throw new BadRequestException('invalid_academic_choice');
      }
    }

    const existing = await this.prisma.student.findUnique({ where: { userId: actor.id } });
    const enrollment = existing ? await this.prisma.studentEnrollment.findFirst({ where: { studentId: existing.id, academicYearId: year.id }, include: { documents: { orderBy: { createdAt: 'desc' }, take: 1 } } }) : null;
    if (enrollment) {
      // D-21 : plus aucune modification d'une inscription vérifiée ou en cours d'examen.
      if (enrollment.status === EnrollmentStatus.VERIFIED) throw new ConflictException('enrollment_verified_locked');
      if (enrollment.status === EnrollmentStatus.PENDING && enrollment.documents[0]?.status === DocumentStatus.UPLOADED) {
        throw new ConflictException('enrollment_under_review');
      }
    }

    let saved: { studentId: string; enrollmentId: string };
    try {
      saved = await this.prisma.$transaction(async (tx) => {
        const studentId = await this.saveStudent(tx, actor, institutionId, existing?.id ?? null, existing?.studentNumber ?? null, dto, info);
        const data = { facultyId: faculty.id, programId: program.id, levelId: level.id, groupId: dto.groupId ?? null, status: EnrollmentStatus.PENDING, rejectionCode: null, rejectionReason: null, reviewedById: null, reviewedAt: null };
        const row = enrollment
          ? await tx.studentEnrollment.update({ where: { id: enrollment.id }, data })
          : await tx.studentEnrollment.create({ data: { ...data, studentId, institutionId, academicYearId: year.id } });
        return { studentId, enrollmentId: row.id };
      });
    } catch (e) {
      // Deux étudiants qui réservent le même numéro en même temps : l'index unique en laisse passer un seul.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(NUMBER_UNAVAILABLE);
      throw e;
    }
    await this.audit.record({
      actorId: actor.id,
      institutionId,
      action: 'ENROLLMENT_DECLARED',
      resourceType: 'enrollment',
      resourceId: saved.enrollmentId,
      result: AuditResult.SUCCESS,
      ip: info.ip,
      requestId: info.requestId,
    });
    return this.getMe(actor);
  }

  /** Crée ou met à jour l'identité et réserve le numéro étudiant selon D-22. Renvoie l'id de l'étudiant. */
  private async saveStudent(
    tx: Prisma.TransactionClient,
    actor: AuthUser,
    institutionId: string,
    studentId: string | null,
    currentNumber: string | null,
    dto: DeclareEnrollmentDto,
    info: RequestInfo,
  ): Promise<string> {
    const numberChanged = currentNumber !== dto.studentNumber;
    if (numberChanged) await this.freeNumberIfExpired(tx, actor, institutionId, dto.studentNumber, info);
    const identity = { firstName: dto.firstName, lastName: dto.lastName, fullNameAr: dto.fullNameAr ?? null };
    if (studentId) {
      const data = numberChanged ? { ...identity, studentNumber: dto.studentNumber, numberClaimedAt: new Date() } : identity;
      await tx.student.update({ where: { id: studentId }, data });
      return studentId;
    }
    const created = await tx.student.create({
      data: { ...identity, userId: actor.id, institutionId, studentNumber: dto.studentNumber, numberClaimedAt: new Date() },
    });
    return created.id;
  }

  /**
   * D-22 : un numéro n'est définitivement réservé que par une inscription vérifiée. Si un autre étudiant le détient sans
   * vérification, sans attestation en cours d'examen et depuis plus de 7 jours, la réservation est libérée.
   */
  private async freeNumberIfExpired(tx: Prisma.TransactionClient, actor: AuthUser, institutionId: string, studentNumber: string, info: RequestInfo) {
    const holder = await tx.student.findFirst({
      where: { institutionId, studentNumber },
      include: { enrollments: { include: { documents: { orderBy: { createdAt: 'desc' }, take: 1 } } } },
    });
    if (!holder) return;
    if (holder.userId === actor.id) return;
    const verified = holder.enrollments.some((e) => e.status === EnrollmentStatus.VERIFIED);
    const underReview = holder.enrollments.some((e) => e.status === EnrollmentStatus.PENDING && e.documents[0]?.status === DocumentStatus.UPLOADED);
    const claimedAt = (holder.numberClaimedAt ?? holder.createdAt).getTime();
    if (verified || underReview || Date.now() - claimedAt <= NUMBER_CLAIM_TTL_MS) throw new ConflictException(NUMBER_UNAVAILABLE);
    await tx.student.update({ where: { id: holder.id }, data: { studentNumber: null, numberClaimedAt: null } });
    await this.audit.record({
      actorId: actor.id,
      institutionId,
      action: 'STUDENT_NUMBER_RELEASED',
      resourceType: 'student',
      resourceId: holder.id,
      result: AuditResult.SUCCESS,
      ip: info.ip,
      requestId: info.requestId,
      metadata: { reason: 'EXPIRED_CLAIM' }, // jamais le numéro lui-même
    });
  }

  // ------------------------------------------------------------------ dépôt de l'attestation

  async uploadDocument(actor: AuthUser, file: Express.Multer.File | undefined, info: RequestInfo) {
    if (!file) throw new BadRequestException('file_required');
    const institutionId = this.studentInstitution(actor);
    const student = await this.prisma.student.findUnique({ where: { userId: actor.id } });
    const year = await this.prisma.academicYear.findFirst({ where: { institutionId, isCurrent: true } });
    const enrollment =
      student && year
        ? await this.prisma.studentEnrollment.findFirst({ where: { studentId: student.id, academicYearId: year.id }, include: { documents: { orderBy: { createdAt: 'desc' }, take: 1 } } })
        : null;
    if (!enrollment) throw new ConflictException('enrollment_required');
    if (enrollment.status !== EnrollmentStatus.PENDING || enrollment.documents[0]?.status === DocumentStatus.UPLOADED) {
      throw new ConflictException('document_not_allowed'); // D-21 : vérifiée, ou déjà déposée et en cours d'examen
    }

    // Type RÉEL d'après le contenu : le nom et le Content-Type envoyés par le client ne comptent pas.
    let detected;
    try {
      detected = detectFile(file.buffer);
    } catch (e) {
      if (!(e instanceof FileRejected)) throw e;
      if (e.reason === 'TOO_LARGE') throw new PayloadTooLargeException(e.reason);
      if (e.reason === 'EMPTY') throw new BadRequestException(e.reason);
      throw new UnsupportedMediaTypeException(e.reason);
    }

    const key = `registration-documents/${institutionId}/${enrollment.id}/${randomUUID()}.${detected.ext}`; // nom généré par le serveur
    await this.storage.put(key, file.buffer, detected.mime);
    try {
      const document = await this.prisma.$transaction(async (tx) => {
        const stored = await tx.storedFile.create({
          data: {
            purpose: FilePurpose.REGISTRATION_DOCUMENT,
            storageKey: key,
            originalName: sanitizeOriginalName(file.originalname),
            mimeType: detected.mime,
            sizeBytes: file.buffer.length,
            sha256: createHash('sha256').update(file.buffer).digest('hex'),
            uploadedById: actor.id,
          },
        });
        return tx.registrationDocument.create({ data: { enrollmentId: enrollment.id, fileId: stored.id } });
      });
      await this.audit.record({
        actorId: actor.id,
        institutionId,
        action: 'DOCUMENT_UPLOADED',
        resourceType: 'document',
        resourceId: document.id,
        result: AuditResult.SUCCESS,
        ip: info.ip,
        requestId: info.requestId,
        metadata: { mime: detected.mime, sizeBytes: file.buffer.length },
      });
      return { id: document.id, status: document.status };
    } catch (e) {
      await this.storage.delete(key).catch(() => undefined); // pas de fichier orphelin si la base échoue
      throw e;
    }
  }

  /** Utilitaire de lecture pour les autres services : l'inscription ou 404. */
  async enrollmentOrThrow(id: string) {
    const e = await this.prisma.studentEnrollment.findUnique({ where: { id } });
    if (!e) throw new NotFoundException();
    return e;
  }
}
