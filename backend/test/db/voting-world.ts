import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { CandidateStatus, ElectionStatus, PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { MemoryStorageService } from '../../src/storage/memory-storage.service';
import { StorageService } from '../../src/storage/storage.service';

// Décor commun aux tests du Sprint 5 (04 §11) : vraie base MySQL, vraie application Nest, comptes créés en masse.
// Ces tests décrivent le CONTRAT du module `voting` avant son écriture ; ils échouent tant qu'il n'existe pas.
//
// Contrat HTTP supposé (à confirmer, voir le compte rendu de fin de tâche) :
//   POST /voting/:electionId/ballot              { choices: [{ positionId, candidateIds[] }], password }  → 201 { status: 'recorded' }
//   POST /elections/:id/voting/open | /close     comité 🔐 (step-up) → 200 { status }
//   GET  /results/:electionId                    résultats par poste (refus avant VOTING_CLOSED)
//   GET  /results/:electionId/second-round       pré-remplissage du second tour (ex-aequo seulement)
// Les erreurs portent le code de 04 §6.2 dans `message` (ex. 'ALREADY_VOTED').

export const PASSWORD = 'Un-mot-de-passe-solide-1';
const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export interface Voter {
  userId: string;
  studentId: string;
  token: string;
}
export interface PositionSpec {
  title: string;
  seats?: number;
  maxChoices?: number;
  allowBlank?: boolean;
  /** Nombre de candidats APPROVED créés pour ce poste (défaut 2). */
  candidates?: number;
}
export interface ElectionSpec {
  status?: ElectionStatus;
  /** Décalages (ms) par rapport à maintenant. Défaut : vote commencé il y a 1 h, fini dans 1 jour. */
  startsIn?: number;
  endsIn?: number;
  positions?: PositionSpec[];
  voters?: number;
  /** Ajoute une règle « programme + niveau » pour que l'ouverture calcule la liste (cycle de vie). */
  withRule?: boolean;
  /** Remplit voter_roll directement (défaut : oui si l'élection est déjà VOTING_OPEN/VOTING_CLOSED). */
  fillRoll?: boolean;
}
export interface World {
  electionId: string;
  institutionId: string;
  positions: { id: string; candidateIds: string[]; candidateStudentIds: string[] }[];
  voters: Voter[];
  committee: Voter[];
}

export class VotingWorld {
  readonly run = Math.random().toString(36).slice(2, 8);
  readonly prisma = new PrismaClient();
  app!: NestExpressApplication;
  jwt!: JwtService;
  institutionId!: string;
  yearId!: string;
  facultyId!: string;
  programId!: string;
  levelId!: string;
  admin!: Voter;
  private n = 0;
  private studentSeq = 0;
  private hash!: string;

  async start(opts: { logLevel?: string } = {}) {
    if (opts.logLevel) process.env.LOG_LEVEL = opts.logLevel;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(StorageService).useClass(MemoryStorageService).compile();
    this.app = mod.createNestApplication<NestExpressApplication>();
    configureApp(this.app, { trustProxy: 1 });
    await this.app.init();
    this.jwt = this.app.get(JwtService);
    // Hash bon marché : ces tests portent sur la concurrence, pas sur le coût du hash. Avec les paramètres de production (64 Mo, t=3),
    // la vérification du mot de passe à chaque vote (D-30) coûte ~50 ms de CPU et 2 000 votes dépasseraient le délai du test 2.
    this.hash = await argon2.hash(PASSWORD, { type: argon2.argon2id, memoryCost: 1024, timeCost: 1, parallelism: 1 });
    const inst = await this.prisma.institution.create({ data: { code: `V${this.run}`.toUpperCase(), name: `Institution V ${this.run}` } });
    this.institutionId = inst.id;
    this.facultyId = (await this.prisma.faculty.create({ data: { institutionId: inst.id, code: 'F', name: 'Faculté' } })).id;
    this.programId = (await this.prisma.program.create({ data: { institutionId: inst.id, facultyId: this.facultyId, code: 'P', name: 'Programme' } })).id;
    this.levelId = (await this.prisma.level.create({ data: { institutionId: inst.id, code: 'L3', name: 'L3', rank: 3 } })).id;
    this.yearId = (await this.prisma.academicYear.create({ data: { institutionId: inst.id, label: '2026-2027', startsOn: new Date('2026-09-01'), endsOn: new Date('2027-07-15'), isCurrent: true } })).id;
    this.admin = (await this.users(1, Role.INSTITUTION_ADMIN, 'admin'))[0];
  }

  async stop() {
    await this.app.close();
    await this.prisma.$disconnect();
  }

  /** Requête depuis une IP distincte à chaque appel (le rate limiting est par IP, derrière un proxy de confiance). */
  api(method: 'get' | 'post', path: string, token?: string) {
    const k = ++this.n;
    const r = request(this.app.getHttpServer())[method](`/api/v1${path}`).set('x-forwarded-for', `10.${Math.floor(k / 65_025) % 250}.${Math.floor(k / 255) % 255}.${(k % 254) + 1}`).set('x-requested-with', 'XMLHttpRequest');
    return token ? r.set('authorization', `Bearer ${token}`) : r;
  }

  vote(voter: Voter | string, electionId: string, choices: { positionId: string; candidateIds: string[] }[], password = PASSWORD) {
    const token = typeof voter === 'string' ? voter : voter.token;
    return this.api('post', `/voting/${electionId}/ballot`, token).send({ choices, password });
  }

  /** Un candidat par poste (le premier), sans vote blanc : bulletin valide le plus simple. */
  firstChoices(w: World) {
    return w.positions.map((p) => ({ positionId: p.id, candidateIds: [p.candidateIds[0]] }));
  }

  private async users(count: number, role: Role, tag: string): Promise<Voter[]> {
    const admin = role !== Role.STUDENT;
    const rows = Array.from({ length: count }, () => ({ userId: randomUUID(), studentId: randomUUID(), familyId: randomUUID(), i: ++this.studentSeq }));
    await this.prisma.user.createMany({ data: rows.map((r) => ({ id: r.userId, email: `${tag}-${r.i}-${this.run}@example.test`, passwordHash: this.hash, twoFactorEnabled: admin })) });
    await this.prisma.roleAssignment.createMany({ data: rows.map((r) => ({ userId: r.userId, role, institutionId: this.institutionId })) });
    await this.prisma.refreshToken.createMany({
      data: rows.map((r) => ({ userId: r.userId, familyId: r.familyId, tokenHash: createHash('sha256').update(randomBytes(16)).digest('hex'), expiresAt: new Date(Date.now() + DAY), twoFactorVerifiedAt: admin ? new Date() : null })),
    });
    return rows.map((r) => ({ userId: r.userId, studentId: r.studentId, token: this.jwt.sign({ sub: r.userId, sid: r.familyId, typ: 'access' }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '60m' }) }));
  }

  /** Étudiants vérifiés (programme + niveau de la fixture). `enrolled` = fiche étudiant + inscription VERIFIED. */
  async students(count: number, tag = 's'): Promise<(Voter & { enrollmentId: string })[]> {
    const list = await this.users(count, Role.STUDENT, tag);
    const out = list.map((v) => ({ ...v, enrollmentId: randomUUID() }));
    await this.prisma.student.createMany({ data: out.map((v, i) => ({ id: v.studentId, userId: v.userId, institutionId: this.institutionId, studentNumber: `${tag}${this.run}${this.studentSeq}-${i}`, firstName: tag, lastName: 'Test' })) });
    await this.prisma.studentEnrollment.createMany({
      data: out.map((v) => ({ id: v.enrollmentId, studentId: v.studentId, institutionId: this.institutionId, academicYearId: this.yearId, facultyId: this.facultyId, programId: this.programId, levelId: this.levelId, status: 'VERIFIED' as const })),
    });
    return out;
  }

  async addToRoll(electionId: string, list: { studentId: string; enrollmentId: string }[]) {
    await this.prisma.voterRollEntry.createMany({ data: list.map((v) => ({ electionId, studentId: v.studentId, enrollmentId: v.enrollmentId })) });
  }

  /** Crée une élection complète directement en base (aucune route du Sprint 5 n'est utilisée pour préparer le décor). */
  async election(spec: ElectionSpec = {}): Promise<World> {
    const status = spec.status ?? ElectionStatus.VOTING_OPEN;
    const e = await this.prisma.election.create({
      data: {
        institutionId: this.institutionId,
        academicYearId: this.yearId,
        title: `Élection ${this.run}-${++this.n}`,
        status,
        candidacyStartsAt: new Date(Date.now() - 10 * DAY),
        candidacyEndsAt: new Date(Date.now() - 2 * DAY),
        votingStartsAt: new Date(Date.now() + (spec.startsIn ?? -HOUR)),
        votingEndsAt: new Date(Date.now() + (spec.endsIn ?? DAY)),
        createdById: this.admin.userId,
      },
    });
    const positions: World['positions'] = [];
    const specs = spec.positions ?? [{ title: 'Président' }];
    for (const [i, p] of specs.entries()) {
      const pos = await this.prisma.position.create({ data: { electionId: e.id, title: p.title, seats: p.seats ?? 1, maxChoices: p.maxChoices ?? 1, allowBlank: p.allowBlank ?? true, displayOrder: i } });
      const cands = await this.students(p.candidates ?? 2, 'cand');
      await this.prisma.candidate.createMany({ data: cands.map((c) => ({ electionId: e.id, positionId: pos.id, studentId: c.studentId, status: CandidateStatus.APPROVED })) });
      const rows = await this.prisma.candidate.findMany({ where: { positionId: pos.id }, orderBy: { createdAt: 'asc' } });
      positions.push({ id: pos.id, candidateIds: rows.map((r) => r.id), candidateStudentIds: cands.map((c) => c.studentId) });
    }
    if (spec.withRule) await this.prisma.eligibilityRule.create({ data: { electionId: e.id, programId: this.programId, levelId: this.levelId } });
    const voters = await this.students(spec.voters ?? 3, 'voter');
    const frozen = status === ElectionStatus.VOTING_OPEN || status === ElectionStatus.VOTING_CLOSED;
    if (spec.fillRoll ?? frozen) {
      await this.addToRoll(e.id, voters);
      if (frozen) await this.prisma.election.update({ where: { id: e.id }, data: { voterRollFrozenAt: new Date() } });
    }
    const committee = await this.users(3, Role.STUDENT, 'comite'); // comptes à 2FA récente, rôle posé juste après
    await this.prisma.roleAssignment.deleteMany({ where: { userId: { in: committee.map((c) => c.userId) } } });
    await this.prisma.roleAssignment.createMany({ data: committee.map((c) => ({ userId: c.userId, role: Role.ELECTION_COMMITTEE, institutionId: this.institutionId, electionId: e.id })) });
    await this.prisma.user.updateMany({ where: { id: { in: committee.map((c) => c.userId) } }, data: { twoFactorEnabled: true } });
    await this.prisma.refreshToken.updateMany({ where: { userId: { in: committee.map((c) => c.userId) } }, data: { twoFactorVerifiedAt: new Date() } });
    return { electionId: e.id, institutionId: this.institutionId, positions, voters, committee };
  }

  /**
   * Simule des votes déjà exprimés sans passer par l'API (décompte, égalité, effectifs) : une participation pour le
   * i-ème électeur, un bulletin et un choix par poste. `plans[i][p]` = candidat choisi pour le poste p (null = blanc).
   */
  async simulateVotes(w: World, plans: (string | null)[][]) {
    if (plans.length > w.voters.length) throw new Error('Pas assez d’électeurs dans le décor');
    const ballotIds = plans.map(() => randomUUID());
    await this.prisma.votingParticipation.createMany({ data: plans.map((_, i) => ({ electionId: w.electionId, studentId: w.voters[i].studentId })) });
    await this.prisma.ballot.createMany({ data: ballotIds.map((id) => ({ id, electionId: w.electionId })) });
    await this.prisma.ballotChoice.createMany({
      data: plans.flatMap((plan, i) => plan.map((candidateId, p) => ({ id: randomUUID(), ballotId: ballotIds[i], positionId: w.positions[p].id, candidateId }))),
    });
  }

  async counts(electionId: string) {
    const [participations, ballots, choices] = await Promise.all([
      this.prisma.votingParticipation.count({ where: { electionId } }),
      this.prisma.ballot.count({ where: { electionId } }),
      this.prisma.ballotChoice.count({ where: { ballot: { electionId } } }),
    ]);
    return { participations, ballots, choices };
  }

  /** Dépouille directement l'urne pour vérifier des résultats : voix par candidat (null = blanc). */
  async urn(electionId: string): Promise<Map<string | null, number>> {
    const rows = await this.prisma.ballotChoice.groupBy({ by: ['candidateId'], where: { ballot: { electionId } }, _count: { _all: true } });
    return new Map(rows.map((r) => [r.candidateId, r._count._all]));
  }
}

/** Exécute `fn` sur chaque élément avec au plus `limit` appels en vol : évite d'ouvrir 2 000 connexions d'un coup. */
export async function inBatches<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) out.push(...(await Promise.all(items.slice(i, i + limit).map(fn))));
  return out;
}
