import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditResult, CandidateStatus, ElectionStatus, Prisma, Role, StoredFile } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import type { RequestInfo } from '../auth/auth.service';
import type { AuthUser } from '../common/authz/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { tiedPositions } from '../results/tally';
import { StorageService } from '../storage/storage.service';
import type { SecondRoundDto } from './elections.dto';

/** Dates du second tour : le début est dans le futur, la fin est après le début. Fonction pure, testée seule. */
export function checkSecondRoundDates(startsAt: Date, endsAt: Date, now: Date): void {
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || startsAt.getTime() <= now.getTime() || endsAt.getTime() <= startsAt.getTime()) {
    throw new BadRequestException('invalid_dates');
  }
}

/**
 * Second tour (D-01, D-46) : en cas d'égalité pour le dernier siège, le comité crée EN UN CLIC une élection liée au premier tour
 * (`parentElectionId`, `round`), limitée aux ex-aequo, sur la même liste électorale. Le comité confirme les nouvelles dates.
 * Tout est copié dans UNE transaction ; les photos et programmes sont copiés dans le stockage avant, et supprimés si elle échoue.
 * Aucun vote, aucun bulletin, aucune participation n'est lu ni copié.
 */
@Injectable()
export class SecondRoundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async create(actor: AuthUser, parentId: string, dto: SecondRoundDto, info?: RequestInfo) {
    const startsAt = new Date(dto.votingStartsAt);
    const endsAt = new Date(dto.votingEndsAt);
    checkSecondRoundDates(startsAt, endsAt, new Date());

    // Lecture préalable (hors verrou) : quoi copier. Les conditions sont revérifiées sous verrou dans la transaction.
    const parent = await this.prisma.election.findUnique({ where: { id: parentId } });
    if (!parent) throw new NotFoundException();
    if (parent.status !== ElectionStatus.RESULTS_PUBLISHED) throw new ConflictException('invalid_state');
    const positions = await this.prisma.position.findMany({ where: { electionId: parentId }, orderBy: { displayOrder: 'asc' } });
    const results = await this.prisma.positionResult.findMany({ where: { electionId: parentId } });
    const tied = tiedPositions(positions, results);
    if (tied.length === 0) throw new ConflictException('no_tie');
    const candidates = await this.prisma.candidate.findMany({
      where: { electionId: parentId, status: CandidateStatus.APPROVED, id: { in: tied.flatMap((t) => t.tiedIds) } },
      include: { photoFile: true, programFile: true },
    });

    const childId = randomUUID();
    const copies = new Map<string, StoredFile & { newKey: string }>(); // ancien fichier → copie
    const copyFile = async (file: StoredFile | null): Promise<string | null> => {
      if (!file || file.deletedAt) return null;
      const known = copies.get(file.id);
      if (known) return known.id;
      const ext = file.storageKey.includes('.') ? file.storageKey.slice(file.storageKey.lastIndexOf('.')) : '';
      const newKey = `candidates/${parent.institutionId}/${childId}/${randomUUID()}${ext}`;
      await this.storage.put(newKey, await this.storage.get(file.storageKey), file.mimeType);
      const id = randomUUID();
      copies.set(file.id, { ...file, id, storageKey: newKey, newKey, uploadedById: actor.id, createdAt: new Date() });
      return id;
    };
    const fileIds = new Map<string, { photo: string | null; program: string | null }>();
    let child: Awaited<ReturnType<typeof this.prisma.election.findUniqueOrThrow>>;
    try {
      for (const c of candidates) fileIds.set(c.id, { photo: await copyFile(c.photoFile), program: await copyFile(c.programFile) });
      child = await this.prisma.$transaction(
        async (tx) => {
          const locked = await tx.$queryRaw<{ id: string; status: string }[]>`SELECT id, status FROM elections WHERE id = ${parentId} FOR UPDATE`;
          if (locked.length === 0) throw new NotFoundException();
          if (locked[0].status !== ElectionStatus.RESULTS_PUBLISHED) throw new ConflictException('invalid_state');
          // Un seul second tour actif par élection ; un second tour annulé peut être recréé.
          if ((await tx.election.count({ where: { parentElectionId: parentId, status: { not: ElectionStatus.CANCELLED } } })) > 0) throw new ConflictException('second_round_exists');

          await tx.election.create({
            data: {
              id: childId,
              institutionId: parent.institutionId,
              academicYearId: parent.academicYearId,
              title: `${parent.title} — Tour ${parent.round + 1}`,
              titleAr: parent.titleAr ? `${parent.titleAr} — الدور ${parent.round + 1 === 2 ? 'الثاني' : parent.round + 1}` : null,
              description: parent.description,
              // Pas de phase de candidatures : les candidats sont les ex-aequo, déjà validés (D-46).
              status: ElectionStatus.CANDIDACY_CLOSED,
              votingStartsAt: startsAt,
              votingEndsAt: endsAt,
              parentElectionId: parentId,
              round: parent.round + 1,
              createdById: actor.id,
            },
          });
          for (const r of await tx.eligibilityRule.findMany({ where: { electionId: parentId } })) {
            await tx.eligibilityRule.create({ data: { electionId: childId, facultyId: r.facultyId, programId: r.programId, levelId: r.levelId, groupId: r.groupId } });
          }
          for (const t of tied) {
            const position = await tx.position.create({
              data: { electionId: childId, title: t.position.title, titleAr: t.position.titleAr, seats: t.remainingSeats, maxChoices: Math.max(1, t.remainingSeats), allowBlank: t.position.allowBlank, displayOrder: t.position.displayOrder },
            });
            for (const c of candidates.filter((x) => t.tiedIds.includes(x.id))) {
              const files = fileIds.get(c.id)!;
              for (const [source, newId] of [[c.photoFile, files.photo], [c.programFile, files.program]] as const) {
                const copy = source && copies.get(source.id);
                if (copy && newId) {
                  await tx.storedFile.create({
                    data: { id: copy.id, purpose: copy.purpose, storageKey: copy.storageKey, originalName: copy.originalName, mimeType: copy.mimeType, sizeBytes: copy.sizeBytes, sha256: copy.sha256, uploadedById: actor.id },
                  });
                }
              }
              await tx.candidate.create({
                data: {
                  electionId: childId, positionId: position.id, studentId: c.studentId, status: CandidateStatus.APPROVED, statement: c.statement,
                  photoFileId: files.photo, programFileId: files.program, reviewedById: actor.id, reviewedAt: new Date(),
                },
              });
            }
          }
          // Le même comité conduit le second tour (3 membres actifs exigés à l'ouverture, D-03).
          for (const g of await tx.roleAssignment.findMany({ where: { electionId: parentId, role: Role.ELECTION_COMMITTEE, revokedAt: null } })) {
            await tx.roleAssignment.create({ data: { userId: g.userId, role: Role.ELECTION_COMMITTEE, institutionId: g.institutionId, electionId: childId, grantedById: actor.id } });
          }
          return tx.election.findUniqueOrThrow({ where: { id: childId } });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 20_000, timeout: 60_000 },
      );
    } catch (e) {
      // La transaction a échoué : les copies de fichiers n'ont aucune ligne, on les supprime du stockage.
      await Promise.all([...copies.values()].map((c) => this.storage.delete(c.newKey).catch(() => undefined)));
      throw e;
    }
    await this.audit.record({
      actorId: actor.id, institutionId: parent.institutionId, action: 'ELECTION_SECOND_ROUND_CREATED', resourceType: 'election', resourceId: parentId, result: AuditResult.SUCCESS,
      ip: info?.ip, requestId: info?.requestId, metadata: { secondRoundId: childId, round: child.round, positions: tied.length, candidates: candidates.length },
    });
    return { id: child.id, round: child.round, status: child.status, parentElectionId: parentId, votingStartsAt: child.votingStartsAt, votingEndsAt: child.votingEndsAt };
  }
}
