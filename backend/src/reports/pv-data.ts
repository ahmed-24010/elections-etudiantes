export type PvLang = 'fr' | 'ar';

export interface PvPerson {
  name: string;
  nameAr: string | null;
}

export interface PvPosition {
  title: string;
  titleAr: string | null;
  seats: number;
  /** Faux sous 3 votants (D-32) : seuls les élus figurent alors, jamais les voix ni les barres. */
  detailPublished: boolean;
  candidates: { person: PvPerson; votes: number; rank: number; isWinner: boolean }[];
  blank: number | null;
  winners: PvPerson[];
  /** Égalité pour le dernier siège (D-01) : les ex-aequo et le nombre de sièges à pourvoir. */
  tie: { tied: PvPerson[]; seatsLeft: number } | null;
}

/**
 * Tout ce que le procès-verbal contient : des agrégats et des identités publiques de candidats. Jamais un identifiant
 * d'étudiant, jamais l'e-mail d'un membre du comité (les lignes de signature restent à remplir à la main, D-42).
 */
export interface PvData {
  institution: { name: string; nameAr: string | null };
  election: { title: string; titleAr: string | null; round: number };
  votingStartsAt: Date;
  votingEndsAt: Date;
  publishedAt: Date | null;
  registered: number;
  addedAfterFreeze: number;
  voters: number;
  ballots: number;
  turnoutRate: number;
  extension: { originalEndsAt: Date; outageStartedAt: Date; outageEndedAt: Date; newEndsAt: Date; reason: string } | null;
  positions: PvPosition[];
  ballotsDigest: string;
  /** Identique dans les deux langues : les deux versions sont un seul rapport. */
  reportId: string;
  verificationCode: string;
  generatedAt: Date;
  /** Nombre de membres du comité : autant de lignes de signature. */
  committeeSize: number;
}
