import { Injectable } from '@nestjs/common';
import { DocumentStatus, ElectionStatus, EnrollmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SMALL_ELECTION_VOTERS, TURNOUT_SLOT_MS } from '../voting/voting.service';

const IN_PROGRESS: ElectionStatus[] = [ElectionStatus.CANDIDACY_OPEN, ElectionStatus.CANDIDACY_CLOSED, ElectionStatus.VOTING_OPEN, ElectionStatus.VOTING_CLOSED];

interface ElectionRow {
  id: string;
  title: string;
  titleAr: string | null;
  round: number;
  status: ElectionStatus;
  votingStartsAt: Date;
  votingEndsAt: Date;
}
const head = (e: ElectionRow) => ({ id: e.id, title: e.title, titleAr: e.titleAr, round: e.round, status: e.status, votingStartsAt: e.votingStartsAt, votingEndsAt: e.votingEndsAt });

/**
 * Tableau de bord de l'administrateur d'institution (D-48) : des CHIFFRES seulement (D-02) — jamais un nom d'étudiant, jamais une liste
 * de votants. En lecture seule ; les petites élections suivent la règle des tranches de 15 minutes (D-31), comme le suivi du comité.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** Participation d'une élection : même règle que `VotingService.turnout` (tranches de 15 min sous 50 électeurs, D-31). */
  private async participation(e: ElectionRow, now: number) {
    const registered = await this.prisma.voterRollEntry.count({ where: { electionId: e.id } });
    const sliced = e.status === ElectionStatus.VOTING_OPEN && registered < SMALL_ELECTION_VOTERS;
    const asOf = sliced ? new Date(Math.floor(now / TURNOUT_SLOT_MS) * TURNOUT_SLOT_MS) : new Date(now);
    const voted = await this.prisma.votingParticipation.count({ where: { electionId: e.id, ...(sliced ? { votedAt: { lt: asOf } } : {}) } });
    return { registered, voted, rate: registered === 0 ? 0 : Math.round((voted / registered) * 1000) / 10, sliced, asOf };
  }

  /** Inscriptions dont la dernière attestation attend le vérificateur : la définition de sa file d'attente. */
  private async pendingVerifications(institutionId: string): Promise<number> {
    const rows = await this.prisma.studentEnrollment.findMany({
      where: { institutionId, status: EnrollmentStatus.PENDING, documents: { some: { status: DocumentStatus.UPLOADED } } },
      select: { documents: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true } } },
    });
    return rows.filter((r) => r.documents[0]?.status === DocumentStatus.UPLOADED).length;
  }

  /** PV publiés non marqués signés (D-47) et publications sans PV (génération échouée), par élection. */
  private async reports(institutionId: string) {
    const published = await this.prisma.election.findMany({ where: { institutionId, status: ElectionStatus.RESULTS_PUBLISHED }, orderBy: { votingEndsAt: 'desc' }, select: { id: true, title: true, titleAr: true, round: true } });
    const rows = await this.prisma.electionReport.findMany({ where: { election: { institutionId, status: ElectionStatus.RESULTS_PUBLISHED }, revokedAt: null }, orderBy: { generatedAt: 'desc' } });
    const toSign: { electionId: string; title: string; titleAr: string | null; round: number; verificationCode: string; generatedAt: Date }[] = [];
    const without: { electionId: string; title: string; titleAr: string | null; round: number }[] = [];
    for (const e of published) {
      const mine = rows.filter((r) => r.electionId === e.id);
      if (mine.length === 0) {
        without.push({ electionId: e.id, title: e.title, titleAr: e.titleAr, round: e.round });
        continue;
      }
      const latest = mine.filter((r) => r.reportId === mine[0].reportId); // le rapport le plus récent, dans ses deux langues
      if (!latest.every((r) => r.signedAt)) toSign.push({ electionId: e.id, title: e.title, titleAr: e.titleAr, round: e.round, verificationCode: latest[0].verificationCode, generatedAt: latest[0].generatedAt });
    }
    return { toSign, without };
  }

  async get(institutionId: string) {
    const now = Date.now();
    const elections = await this.prisma.election.findMany({
      where: { institutionId, status: { in: [ElectionStatus.DRAFT, ...IN_PROGRESS] } },
      orderBy: { votingStartsAt: 'asc' },
      select: { id: true, title: true, titleAr: true, round: true, status: true, votingStartsAt: true, votingEndsAt: true },
    });
    const inProgress = await Promise.all(
      elections.filter((e) => IN_PROGRESS.includes(e.status)).map(async (e) => ({
        ...head(e),
        participation: e.status === ElectionStatus.VOTING_OPEN || e.status === ElectionStatus.VOTING_CLOSED ? await this.participation(e, now) : null,
      })),
    );
    const upcoming = elections.filter((e) => e.status === ElectionStatus.DRAFT).map(head);
    const { toSign, without } = await this.reports(institutionId);
    const count = (s: ElectionStatus) => elections.filter((e) => e.status === s).length;
    return {
      generatedAt: new Date(now),
      counts: {
        candidacyOpen: count(ElectionStatus.CANDIDACY_OPEN),
        awaitingVote: count(ElectionStatus.CANDIDACY_CLOSED),
        votingOpen: count(ElectionStatus.VOTING_OPEN),
        awaitingPublication: count(ElectionStatus.VOTING_CLOSED),
        upcoming: upcoming.length,
      },
      inProgress,
      upcoming,
      pendingVerifications: await this.pendingVerifications(institutionId),
      reportsToSign: { count: toSign.length, items: toSign },
      publishedWithoutReport: { count: without.length, items: without },
    };
  }
}
