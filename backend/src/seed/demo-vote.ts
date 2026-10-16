import { ConflictException } from '@nestjs/common';
import { ElectionStatus } from '@prisma/client';
import type { ElectionsService } from '../elections/elections.service';
import type { PrismaService } from '../prisma/prisma.service';
import { analyzePosition, MIN_VOTERS_FOR_DETAIL } from '../results/tally';
import type { VotingLifecycleService } from '../voting/voting-lifecycle.service';
import { SEED_ELECTION, SeedRefusedError } from './seed';

/**
 * Commandes de DÉMONSTRATION du vote (`npm run demo:open-vote | demo:close-vote | demo:results`) : elles avancent les dates de
 * l'élection de démo et appellent le vrai code (mêmes conditions, même transaction, même décompte). Jamais en production.
 */
export function assertDemoVoteAllowed(env: Record<string, string | undefined>): void {
  if (env.NODE_ENV === 'production') throw new SeedRefusedError('Commande de démonstration refusée : NODE_ENV=production.');
}

export interface DemoVoteDeps {
  prisma: PrismaService;
  lifecycle: VotingLifecycleService;
  elections: ElectionsService;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const CONDITION_TEXT: Record<string, string> = {
  candidacies_pending: 'une candidature est encore en attente : un membre du comité doit la valider ou la rejeter',
  position_without_candidate: 'un poste n’a aucun candidat validé (D-34) : il faut au moins une candidature validée par poste',
  committee_incomplete: 'le comité a moins de 3 membres actifs (D-03)',
  positions_required: 'l’élection n’a aucun poste',
  voting_not_started: 'l’heure de début du vote n’est pas atteinte',
};

async function demoElection(prisma: PrismaService) {
  const election = await prisma.election.findFirst({ where: { title: SEED_ELECTION.title } });
  if (!election) throw new SeedRefusedError(`Élection de démo « ${SEED_ELECTION.title} » introuvable : lancez d’abord « npm run seed » puis « npm run seed:demo ».`);
  return election;
}

/** Avance les dates, ferme les candidatures et ouvre le vote par le code de l'application (liste électorale gelée). */
export async function demoOpenVote({ prisma, lifecycle, elections }: DemoVoteDeps, now = Date.now()): Promise<string[]> {
  const election = await demoElection(prisma);
  const out: string[] = [];
  if (election.status === ElectionStatus.VOTING_OPEN) return ['Le vote est déjà ouvert.'];
  if (election.status !== ElectionStatus.CANDIDACY_OPEN && election.status !== ElectionStatus.CANDIDACY_CLOSED) {
    throw new SeedRefusedError(`L’élection de démo est « ${election.status} » : seules CANDIDACY_OPEN et CANDIDACY_CLOSED peuvent être ouvertes au vote.`);
  }
  await prisma.election.update({
    where: { id: election.id },
    data: { candidacyEndsAt: new Date(now - 10 * MINUTE), votingStartsAt: new Date(now - MINUTE), votingEndsAt: new Date(now + 2 * HOUR) },
  });
  out.push('Dates avancées : le vote est prévu depuis 1 minute et dure 2 heures.');
  // Le seed de démo a 3 postes pour 2 étudiants éligibles. D-34 bloque l'ouverture tant qu'un poste n'a aucun candidat : en démo,
  // les postes qui n'ont reçu AUCUNE candidature sont retirés (en production, c'est une décision du comité).
  const empty = await prisma.position.findMany({ where: { electionId: election.id, candidates: { none: {} } }, select: { id: true, title: true } });
  const total = await prisma.position.count({ where: { electionId: election.id } });
  if (empty.length === total) throw new SeedRefusedError('Aucune candidature : déposez et faites valider au moins une candidature (Aïcha, Omar) avant d’ouvrir le vote.');
  for (const p of empty) {
    await prisma.position.delete({ where: { id: p.id } });
    out.push(`Poste « ${p.title} » retiré : aucune candidature (D-34).`);
  }
  if (election.status === ElectionStatus.CANDIDACY_OPEN) {
    await elections.closeCandidacyAutomatically(election.id);
    out.push('Candidatures fermées.');
  }
  try {
    await lifecycle.open(null, election.id);
  } catch (e) {
    if (e instanceof ConflictException) {
      const conditions = (e.getResponse() as { conditions?: string[] }).conditions ?? [];
      const lines = conditions.map((c) => `  - ${CONDITION_TEXT[c] ?? c}`);
      throw new SeedRefusedError(`Le vote ne peut pas encore s’ouvrir :\n${lines.join('\n') || '  - ' + e.message}`);
    }
    throw e;
  }
  const registered = await prisma.voterRollEntry.count({ where: { electionId: election.id } });
  out.push(`Vote OUVERT. Liste électorale gelée : ${registered} électeur(s). Il reste 2 heures.`);
  return out;
}

/** Ferme le vote (la fin est ramenée à maintenant) : l'application clôt et lance le décompte. */
export async function demoCloseVote({ prisma, lifecycle }: DemoVoteDeps, now = Date.now()): Promise<string[]> {
  const election = await demoElection(prisma);
  if (election.status !== ElectionStatus.VOTING_OPEN) throw new SeedRefusedError(`Le vote n’est pas ouvert (état « ${election.status} »).`);
  await prisma.election.update({ where: { id: election.id }, data: { votingEndsAt: new Date(now - MINUTE) } });
  await lifecycle.close(null, election.id, null);
  const tally = await prisma.electionTally.findUnique({ where: { electionId: election.id } });
  return [`Vote CLOS. Décompte : ${tally?.participantCount ?? '?'} votant(s), ${tally?.ballotCount ?? '?'} bulletin(s), intégrité ${tally?.integrityOk ? 'OK' : 'ÉCHEC'}.`, 'Lisez les résultats avec « npm run demo:results ».'];
}

export interface ResultsData {
  title: string;
  status: string;
  tally: { eligibleCount: number; participantCount: number; ballotCount: number; integrityOk: boolean; ballotsDigest: string };
  positions: { title: string; seats: number; rows: { candidateId: string | null; name: string; votes: number }[] }[];
}

/** Mise en forme des résultats : mêmes règles que l'API (D-32 : sous 3 votants, ni voix ni blancs, seulement les élus). */
export function formatResults(d: ResultsData): string[] {
  const rate = d.tally.eligibleCount === 0 ? 0 : Math.round((d.tally.participantCount / d.tally.eligibleCount) * 1000) / 10;
  const out = [
    `${d.title} — ${d.status}`,
    `Inscrits : ${d.tally.eligibleCount} · Votants : ${d.tally.participantCount} · Bulletins : ${d.tally.ballotCount} · Participation : ${rate} %`,
    `Intégrité : ${d.tally.integrityOk ? 'OK (votants = bulletins)' : 'ÉCHEC'} · Empreinte de l’urne : ${d.tally.ballotsDigest}`,
  ];
  for (const p of d.positions) {
    const candidates = p.rows.filter((r) => r.candidateId);
    const analysis = analyzePosition(candidates.map((r) => ({ candidateId: r.candidateId as string, votes: r.votes })), p.seats);
    const name = (id: string) => candidates.find((r) => r.candidateId === id)?.name ?? id;
    const voters = p.rows.reduce((sum, r) => sum + r.votes, 0);
    out.push('', `${p.title} (${p.seats} siège${p.seats > 1 ? 's' : ''})`);
    if (analysis.tie) out.push(`  ÉGALITÉ pour le dernier siège : ${analysis.tiedIds.map(name).join(', ')} (second tour)`);
    if (analysis.winners.length > 0) out.push(`  Élu(s) : ${analysis.winners.map(name).join(', ')}`);
    if (voters < MIN_VOTERS_FOR_DETAIL) {
      out.push(`  Effectif trop faible pour publier le détail (${voters} votant(s), minimum ${MIN_VOTERS_FOR_DETAIL}, D-32).`);
      continue;
    }
    for (const r of p.rows.filter((x) => x.candidateId).sort((a, b) => b.votes - a.votes)) out.push(`  ${r.name.padEnd(28)} ${String(r.votes).padStart(4)} voix`);
    out.push(`  ${'Votes blancs'.padEnd(28)} ${String(p.rows.find((r) => !r.candidateId)?.votes ?? 0).padStart(4)}`);
  }
  return out;
}

export async function demoResults({ prisma }: Pick<DemoVoteDeps, 'prisma'>): Promise<string[]> {
  const election = await demoElection(prisma);
  const tally = await prisma.electionTally.findUnique({ where: { electionId: election.id } });
  if (!tally) throw new SeedRefusedError(`Pas de décompte : l’élection est « ${election.status} ». Fermez le vote avec « npm run demo:close-vote ».`);
  const positions = await prisma.position.findMany({ where: { electionId: election.id }, orderBy: { displayOrder: 'asc' } });
  const results = await prisma.positionResult.findMany({ where: { electionId: election.id }, include: { candidate: { include: { student: true } } } });
  return formatResults({
    title: election.title,
    status: election.status,
    tally,
    positions: positions.map((p) => ({
      title: p.title,
      seats: p.seats,
      rows: results.filter((r) => r.positionId === p.id).map((r) => ({ candidateId: r.candidateId, name: r.candidate ? `${r.candidate.student.firstName} ${r.candidate.student.lastName}` : 'Votes blancs', votes: r.votes })),
    })),
  });
}
