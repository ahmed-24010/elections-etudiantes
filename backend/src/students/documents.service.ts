import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditResult, Role, UserStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { RequestInfo } from '../auth/auth.service';
import type { RoleGrant } from '../common/authz/auth-user';
import { ADMIN_ROLES } from '../common/authz/permissions';
import { canViewCandidateFile } from '../candidates/candidate-access';
import { PrismaService } from '../prisma/prisma.service';
import { SignedUrlService } from '../storage/signed-url.service';
import { StorageService } from '../storage/storage.service';

export interface DocumentViewer {
  id: string;
  roles: Pick<RoleGrant, 'role' | 'institutionId'>[];
}

type ServedFile = { body: Buffer; mimeType: string; filename: string };

/**
 * Qui peut lire une attestation (03 §5.3) : l'étudiant pour la SIENNE, et le VÉRIFICATEUR de l'institution. Personne
 * d'autre : ni l'INSTITUTION_ADMIN, ni le comité, ni le SUPER_ADMIN.
 */
export function canViewDocument(viewer: DocumentViewer, enrollment: { institutionId: string; student: { userId: string } }): boolean {
  const owner = enrollment.student.userId === viewer.id && viewer.roles.some((r) => r.role === Role.STUDENT && r.institutionId === enrollment.institutionId);
  const reviewer = viewer.roles.some((r) => r.role === Role.VERIFICATION_OFFICER && r.institutionId === enrollment.institutionId);
  return owner || reviewer;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly signer: SignedUrlService,
    private readonly audit: AuditService,
  ) {}

  /** Émet une URL signée de 5 minutes vers l'attestation la plus récente de l'inscription. */
  async issueUrl(viewer: DocumentViewer, enrollmentId: string) {
    const enrollment = await this.prisma.studentEnrollment.findUnique({
      where: { id: enrollmentId },
      include: { student: true, documents: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!enrollment) throw new NotFoundException();
    if (!canViewDocument(viewer, enrollment)) throw new ForbiddenException();
    const document = enrollment.documents[0];
    if (!document) throw new NotFoundException();
    const { exp, sig } = this.signer.sign(document.fileId, viewer.id);
    return { url: `/api/v1/files/${document.fileId}?uid=${viewer.id}&exp=${exp}&sig=${sig}`, expiresAt: new Date(exp).toISOString() };
  }

  /**
   * Sert le fichier si la signature est valide ET que l'utilisateur est toujours autorisé (compte actif, rôle non révoqué,
   * 2FA active pour un rôle administratif). Toute erreur renvoie 403 sans préciser la raison.
   */
  async serve(fileId: string, uid: string, exp: number, sig: string, info: RequestInfo): Promise<ServedFile> {
    if (!this.signer.verify(fileId, uid, exp, sig)) throw new ForbiddenException();
    const user = await this.prisma.user.findUnique({ where: { id: uid }, include: { roles: { where: { revokedAt: null } } } });
    if (!user || user.status !== UserStatus.ACTIVE) throw new ForbiddenException();
    const roles = user.twoFactorEnabled ? user.roles : user.roles.filter((r) => !ADMIN_ROLES.includes(r.role));

    const document = await this.prisma.registrationDocument.findFirst({
      where: { fileId },
      include: { file: true, enrollment: { include: { student: true } } },
    });
    // Pas une attestation : peut-être la photo ou le programme d'un candidat (même URL signée, autres règles d'accès).
    if (!document) return this.serveCandidateFile(fileId, user.id, roles);
    if (document.file.deletedAt || !canViewDocument({ id: user.id, roles }, document.enrollment)) throw new ForbiddenException();

    const body = await this.storage.get(document.file.storageKey);
    await this.audit.record({
      actorId: user.id,
      institutionId: document.enrollment.institutionId,
      action: 'DOCUMENT_VIEWED',
      resourceType: 'document',
      resourceId: document.id,
      result: AuditResult.SUCCESS,
      ip: info.ip,
      requestId: info.requestId,
    });
    const ext = document.file.mimeType === 'application/pdf' ? 'pdf' : document.file.mimeType === 'image/png' ? 'png' : 'jpg';
    return { body, mimeType: document.file.mimeType, filename: `attestation.${ext}` };
  }

  /** Photo ou programme d'un candidat (03 §5.5) : lisibles par le candidat, le personnel de l'élection, ou les étudiants pour un candidat validé. */
  private async serveCandidateFile(fileId: string, userId: string, activeRoles: Pick<RoleGrant, 'role' | 'institutionId' | 'electionId'>[]): Promise<ServedFile> {
    const candidate = await this.prisma.candidate.findFirst({
      where: { OR: [{ photoFileId: fileId }, { programFileId: fileId }] },
      include: { student: true, election: true, photoFile: true, programFile: true },
    });
    const file = candidate && (candidate.photoFileId === fileId ? candidate.photoFile : candidate.programFile);
    if (!candidate || !file || file.deletedAt) throw new ForbiddenException();
    if (!canViewCandidateFile({ id: userId, roles: activeRoles }, candidate, candidate.election)) throw new ForbiddenException();
    const body = await this.storage.get(file.storageKey);
    const isPhoto = candidate.photoFileId === fileId;
    const ext = file.mimeType === 'application/pdf' ? 'pdf' : file.mimeType === 'image/png' ? 'png' : 'jpg';
    return { body, mimeType: file.mimeType, filename: `${isPhoto ? 'photo' : 'programme'}.${ext}` };
  }
}
