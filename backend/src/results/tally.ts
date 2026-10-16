/** Voix d'un candidat à un poste. */
export interface CandidateVotes {
  candidateId: string;
  votes: number;
}

export interface PositionAnalysis {
  /** Rang « à égalité » : 1 + nombre de candidats strictement devant. Classement stable (voix décroissantes, puis id). */
  ranked: (CandidateVotes & { rank: number })[];
  /** Candidats élus sans ambiguïté. */
  winners: string[];
  /** Candidats à égalité pour le dernier siège (vide s'il n'y a pas d'égalité). */
  tiedIds: string[];
  tie: boolean;
}

/**
 * Classe un poste et désigne les élus (04 §8). Seuls les candidats qui ont reçu au moins une voix peuvent être élus.
 * Égalité (D-01) : le dernier siège est disputé par des candidats qui ont autant de voix : personne n'est élu pour ce siège,
 * mais ceux qui sont strictement devant restent élus (poste à plusieurs sièges).
 */
export function analyzePosition(rows: CandidateVotes[], seats: number): PositionAnalysis {
  const sorted = [...rows].sort((a, b) => b.votes - a.votes || a.candidateId.localeCompare(b.candidateId));
  const ranked = sorted.map((r) => ({ ...r, rank: 1 + sorted.filter((o) => o.votes > r.votes).length }));
  const voted = sorted.filter((r) => r.votes > 0);
  if (seats < 1 || voted.length <= seats) return { ranked, winners: voted.map((r) => r.candidateId), tiedIds: [], tie: false };
  const boundary = voted[seats - 1].votes;
  if (voted[seats].votes === boundary) {
    return {
      ranked,
      winners: voted.filter((r) => r.votes > boundary).map((r) => r.candidateId),
      tiedIds: voted.filter((r) => r.votes === boundary).map((r) => r.candidateId),
      tie: true,
    };
  }
  return { ranked, winners: voted.slice(0, seats).map((r) => r.candidateId), tiedIds: [], tie: false };
}

/** D-32 : en dessous de 3 votants pour un poste, le détail n'est pas publié (chacun saurait pour qui l'autre a voté). */
export const MIN_VOTERS_FOR_DETAIL = 3;
