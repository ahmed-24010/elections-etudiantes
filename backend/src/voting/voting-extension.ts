/** Plafond d'une prolongation, quelle que soit la panne (D-38). */
export const MAX_EXTENSION_MS = 24 * 3_600_000;

export type ExtensionRefusal =
  | 'outage_invalid' // fenêtre de panne incohérente (fin ≤ début, hors du vote, dans le futur)
  | 'extension_not_after_current' // jamais de raccourcissement (D-33)
  | 'extension_exceeds_outage' // plus longue que la panne déclarée
  | 'extension_exceeds_24h';

export interface ExtensionInput {
  outageStartedAt: Date;
  outageEndedAt: Date;
  newEndsAt: Date;
}

/**
 * Règles de la prolongation (04 §10.1, D-33, D-38), sur des instants déjà lus en base :
 * la panne a eu lieu pendant la fenêtre de vote et est terminée ; la nouvelle fin est strictement postérieure à l'actuelle ;
 * la prolongation ne dépasse ni la durée de la panne déclarée ni 24 h. Renvoie le premier refus, ou `null`.
 */
export function extensionRefusal(
  election: { votingStartsAt: Date; votingEndsAt: Date },
  now: Date,
  input: ExtensionInput,
): ExtensionRefusal | null {
  const started = input.outageStartedAt.getTime();
  const ended = input.outageEndedAt.getTime();
  if (!Number.isFinite(started) || !Number.isFinite(ended) || !Number.isFinite(input.newEndsAt.getTime())) return 'outage_invalid';
  if (ended <= started || started < election.votingStartsAt.getTime() || ended > now.getTime()) return 'outage_invalid';
  const extension = input.newEndsAt.getTime() - election.votingEndsAt.getTime();
  if (extension <= 0) return 'extension_not_after_current';
  if (extension > ended - started) return 'extension_exceeds_outage';
  if (extension > MAX_EXTENSION_MS) return 'extension_exceeds_24h';
  return null;
}
