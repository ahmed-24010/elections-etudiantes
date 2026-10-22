import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditResult, ElectionStatus, FilePurpose, ReportLanguage, Role } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import type { RequestInfo } from '../auth/auth.service';
import type { AuthUser } from '../common/authz/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { analyzePosition, detailPublished } from '../results/tally';
import { StorageService } from '../storage/storage.service';
import { PvData, PvLang, PvPerson, PvPosition } from './pv-data';
import { renderPvHtml } from './pv-html';
import { PvPdfService } from './pv-pdf';

export const PV_LANGS: readonly PvLang[] = ['fr', 'ar'];
const toEnum = (lang: PvLang): ReportLanguage => (lang === 'ar' ? ReportLanguage.AR : ReportLanguage.FR);

/**
 * Procès-verbal (04 §9, D-41 à D-45). Un rapport = un PV par langue, créés ensemble : même identifiant, même code de
 * vérification, mêmes chiffres, chacun avec son PDF et son SHA-256. Les noms de postes viennent de la base, comme sur le site.
 * Le PV ne contient que des agrégats et l'identité publique des candidats ; il n'est lisible que par le personnel (`report:read`).
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly pdf: PvPdfService,
  ) {}

  // ------------------------------------------------------------------ données

  private name(s: { firstName: string; lastName: string; fullNameAr: string | null }): PvPerson {
    return { name: `${s.firstName} ${s.lastName}`.trim(), nameAr: s.fullNameAr };
  }

  /** Lit tout ce que le PV imprime. Même source que l'écran des résultats ; D-32 se juge sur les votants de l'ÉLECTION. */
  async buildData(electionId: string, ids: { reportId: string; verificationCode: string; generatedAt: Date }): Promise<PvData> {
    const election = await this.prisma.election.findUnique({ where: { id: electionId }, include: { institution: true } });
    if (!election) throw new NotFoundException();
    const tally = await this.prisma.electionTally.findUnique({ where: { electionId } });
    if (!tally) throw new ConflictException('RESULTS_NOT_READY');

    const positions = await this.prisma.position.findMany({ where: { electionId }, orderBy: { displayOrder: 'asc' } });
    const results = await this.prisma.positionResult.findMany({ where: { electionId } });
    const candidateIds = [...new Set(results.flatMap((r) => (r.candidateId ? [r.candidateId] : [])))];
    const people = await this.prisma.candidate.findMany({ where: { id: { in: candidateIds } }, select: { id: true, student: { select: { firstName: true, lastName: true, fullNameAr: true } } } });
    const person = new Map(people.map((c) => [c.id, this.name(c.student)]));

    const published = detailPublished(tally.participantCount);
    const views: PvPosition[] = positions.map((p) => {
      const mine = results.filter((r) => r.positionId === p.id);
      const analysis = analyzePosition(mine.filter((r) => r.candidateId).map((r) => ({ candidateId: r.candidateId as string, votes: r.votes })), p.seats);
      const who = (id: string): PvPerson => person.get(id) ?? { name: '', nameAr: null };
      return {
        title: p.title,
        titleAr: p.titleAr,
        seats: p.seats,
        detailPublished: published,
        candidates: published ? analysis.ranked.map((r) => ({ person: who(r.candidateId), votes: r.votes, rank: r.rank, isWinner: analysis.winners.includes(r.candidateId) })) : [],
        blank: published ? (mine.find((r) => !r.candidateId)?.votes ?? 0) : null,
        winners: analysis.winners.map(who),
        tie: analysis.tie ? { tied: analysis.tiedIds.map(who), seatsLeft: p.seats - analysis.winners.length } : null,
      };
    });

    const addedAfterFreeze = await this.prisma.voterRollEntry.count({ where: { electionId, addedAfterFreeze: true } });
    const committeeSize = await this.prisma.roleAssignment.count({ where: { electionId, role: Role.ELECTION_COMMITTEE, revokedAt: null } });

    // La panne et le motif ne sont qu'au journal d'audit (la table elections ne garde que les dates) : lecture, jamais d'écriture.
    let extension: PvData['extension'] = null;
    if (election.votingExtendedAt && election.votingEndsAtOriginal) {
      const entry = await this.prisma.auditLog.findFirst({ where: { resourceId: electionId, action: 'ELECTION_VOTING_EXTENDED' }, orderBy: { id: 'desc' } });
      const m = (entry?.metadata ?? {}) as { reason?: string; outageStartedAt?: string; outageEndedAt?: string };
      extension = {
        originalEndsAt: election.votingEndsAtOriginal,
        newEndsAt: election.votingEndsAt,
        outage: m.outageStartedAt && m.outageEndedAt ? { from: new Date(m.outageStartedAt), to: new Date(m.outageEndedAt) } : null,
        reason: m.reason ?? null,
      };
    }
    const publication = await this.prisma.auditLog.findFirst({ where: { resourceId: electionId, action: 'ELECTION_RESULTS_PUBLISHED' }, orderBy: { id: 'desc' } });

    return {
      institution: { name: election.institution.name, nameAr: election.institution.nameAr },
      election: { title: election.title, titleAr: election.titleAr, round: election.round },
      votingStartsAt: election.votingStartsAt,
      votingEndsAt: election.votingEndsAt,
      publishedAt: publication?.createdAt ?? null,
      registered: tally.eligibleCount,
      addedAfterFreeze,
      voters: tally.participantCount,
      ballots: tally.ballotCount,
      turnoutRate: tally.eligibleCount === 0 ? 0 : Math.round((tally.participantCount / tally.eligibleCount) * 1000) / 10,
      extension,
      positions: views,
      ballotsDigest: tally.ballotsDigest,
      committeeSize,
      ...ids,
    };
  }

  // ------------------------------------------------------------------ génération

  /**
   * Crée les deux versions du PV (fr et ar) : mêmes données, même identifiant, même code, un SHA-256 chacune. Seulement une fois
   * les résultats publiés. Chaque appel crée un NOUVEAU rapport ; l'ancien n'est pas supprimé (la révocation est une autre action).
   */
  async generate(actor: AuthUser, electionId: string, info?: RequestInfo) {
    const election = await this.prisma.election.findUnique({ where: { id: electionId } });
    if (!election) throw new NotFoundException();
    if (election.status !== ElectionStatus.RESULTS_PUBLISHED) throw new ConflictException('invalid_state');

    const reportId = randomUUID();
    const generatedAt = new Date();
    const data = await this.buildData(electionId, { reportId, verificationCode: `PV-${reportId.replace(/-/g, '').slice(0, 12).toUpperCase()}`, generatedAt });

    const files = await Promise.all(
      PV_LANGS.map(async (lang) => {
        const buffer = await this.pdf.pdf(renderPvHtml(data, lang));
        return { lang, buffer, sha256: createHash('sha256').update(buffer).digest('hex'), key: `reports/${election.institutionId}/${electionId}/${reportId}-${lang}.pdf` };
      }),
    );
    for (const f of files) await this.storage.put(f.key, f.buffer, 'application/pdf');
    try {
      await this.prisma.$transaction(async (tx) => {
        for (const f of files) {
          const stored = await tx.storedFile.create({
            data: { purpose: FilePurpose.ELECTION_REPORT, storageKey: f.key, originalName: `${data.verificationCode}-${f.lang}.pdf`, mimeType: 'application/pdf', sizeBytes: f.buffer.length, sha256: f.sha256, uploadedById: actor.id },
          });
          await tx.electionReport.create({
            data: { electionId, reportId, language: toEnum(f.lang), fileId: stored.id, verificationCode: data.verificationCode, ballotsDigest: data.ballotsDigest, sha256: f.sha256, generatedById: actor.id, generatedAt },
          });
        }
      });
    } catch (e) {
      await Promise.all(files.map((f) => this.storage.delete(f.key).catch(() => undefined)));
      throw e;
    }
    await this.record(actor.id, election.institutionId, electionId, 'REPORT_GENERATED', AuditResult.SUCCESS, info, {
      reportId, verificationCode: data.verificationCode, ballotsDigest: data.ballotsDigest, sha256: Object.fromEntries(files.map((f) => [f.lang, f.sha256])),
    });
    return this.summary(reportId, data.verificationCode, generatedAt, data.ballotsDigest, Object.fromEntries(files.map((f) => [f.lang, f.sha256])) as Record<PvLang, string>, null);
  }

  /** Appelée à la publication : un échec de génération (Chromium absent, S3 en panne) ne défait jamais la publication. */
  async generateAfterPublication(actor: AuthUser, electionId: string, info?: RequestInfo): Promise<'generated' | 'failed'> {
    try {
      await this.generate(actor, electionId, info);
      return 'generated';
    } catch (e) {
      this.logger.error(`PV non généré pour l'élection ${electionId} : ${e instanceof Error ? e.message : String(e)}`);
      const election = await this.prisma.election.findUnique({ where: { id: electionId }, select: { institutionId: true } });
      if (election) await this.record(actor.id, election.institutionId, electionId, 'REPORT_GENERATION_FAILED', AuditResult.FAILURE, info, {}).catch(() => undefined);
      return 'failed';
    }
  }

  // ------------------------------------------------------------------ lecture

  private summary(reportId: string, verificationCode: string, generatedAt: Date, ballotsDigest: string, sha256: Record<PvLang, string>, revokedAt: Date | null, signedAt: Date | null = null) {
    return { reportId, verificationCode, generatedAt, ballotsDigest, sha256, revoked: revokedAt !== null, signedAt };
  }

  /** Les rapports de l'élection, le plus récent d'abord : une entrée par rapport (avec le SHA-256 de chaque langue). */
  async list(electionId: string) {
    const rows = await this.prisma.electionReport.findMany({ where: { electionId }, orderBy: { generatedAt: 'desc' } });
    const groups = new Map<string, typeof rows>();
    for (const r of rows) groups.set(r.reportId, [...(groups.get(r.reportId) ?? []), r]);
    return [...groups.values()].map((g) => {
      const sha = Object.fromEntries(g.map((r) => [r.language === ReportLanguage.AR ? 'ar' : 'fr', r.sha256])) as Record<PvLang, string>;
      return this.summary(g[0].reportId, g[0].verificationCode, g[0].generatedAt, g[0].ballotsDigest, sha, g.every((r) => r.revokedAt) ? g[0].revokedAt : null, g.every((r) => r.signedAt) ? g[0].signedAt : null);
    });
  }

  /** Le PV non révoqué le plus récent dans la langue demandée (la langue du site de l'utilisateur, D-42). */
  async download(user: AuthUser, electionId: string, lang: PvLang, info?: RequestInfo) {
    const election = await this.prisma.election.findUnique({ where: { id: electionId }, select: { institutionId: true } });
    if (!election) throw new NotFoundException();
    const report = await this.prisma.electionReport.findFirst({ where: { electionId, language: toEnum(lang), revokedAt: null }, orderBy: { generatedAt: 'desc' }, include: { file: true } });
    if (!report || report.file.deletedAt) throw new NotFoundException('report_not_found');
    const buffer = await this.storage.get(report.file.storageKey);
    // Le fichier relu doit être celui dont le SHA-256 a été enregistré à la génération.
    if (createHash('sha256').update(buffer).digest('hex') !== report.sha256) throw new ConflictException('report_corrupted');
    await this.record(user.id, election.institutionId, electionId, 'REPORT_DOWNLOADED', AuditResult.SUCCESS, info, { reportId: report.reportId, language: lang });
    return { buffer, filename: `${report.verificationCode}-${lang}.pdf` };
  }

  /**
   * « PV signé » (D-47) : le comité atteste que l'exemplaire imprimé du rapport le plus récent (non révoqué) a été signé. Pose la date
   * sur les deux langues. Une régénération crée un NOUVEAU rapport, à faire signer de nouveau. Audité.
   */
  async markSigned(actor: AuthUser, electionId: string, info?: RequestInfo) {
    const election = await this.prisma.election.findUnique({ where: { id: electionId }, select: { institutionId: true, status: true } });
    if (!election) throw new NotFoundException();
    const latest = await this.prisma.electionReport.findFirst({ where: { electionId, revokedAt: null }, orderBy: { generatedAt: 'desc' } });
    if (!latest) throw new NotFoundException('report_not_found');
    if (latest.signedAt) throw new ConflictException('already_signed');
    const now = new Date();
    const res = await this.prisma.electionReport.updateMany({ where: { electionId, reportId: latest.reportId, revokedAt: null, signedAt: null }, data: { signedAt: now, signedById: actor.id } });
    if (res.count === 0) throw new ConflictException('already_signed');
    await this.record(actor.id, election.institutionId, electionId, 'REPORT_SIGNED', AuditResult.SUCCESS, info, { reportId: latest.reportId, verificationCode: latest.verificationCode });
    return { reportId: latest.reportId, signedAt: now };
  }

  private record(actorId: string, institutionId: string, electionId: string, action: string, result: AuditResult, info: RequestInfo | undefined, metadata: Record<string, unknown>) {
    return this.audit.record({ actorId, institutionId, action, resourceType: 'election', resourceId: electionId, result, ip: info?.ip, requestId: info?.requestId, metadata });
  }
}
