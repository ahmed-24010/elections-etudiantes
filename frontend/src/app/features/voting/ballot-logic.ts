import type { BallotChoice, BallotPosition } from '../../core/api/voting.api';

/**
 * Réponse de l'électeur à UN poste. « Rien choisi » (`ids` vide et `blank` faux) est distinct du vote blanc : on ne
 * transforme jamais un oubli en vote blanc (D-06).
 */
export interface Answer {
  ids: string[];
  blank: boolean;
}

export const emptyAnswer = (): Answer => ({ ids: [], blank: false });

/** Coche ou décoche un candidat. Un seul choix : il remplace le précédent. Plusieurs : jamais plus de `maxChoices`. */
export function toggleCandidate(answer: Answer, candidateId: string, maxChoices: number): Answer {
  if (maxChoices <= 1) return { ids: [candidateId], blank: false };
  if (answer.ids.includes(candidateId)) return { ids: answer.ids.filter((id) => id !== candidateId), blank: false };
  if (answer.ids.length >= maxChoices) return { ids: answer.ids, blank: false }; // plafond atteint : la case reste décochée
  return { ids: [...answer.ids, candidateId], blank: false };
}

/** Le vote blanc est exclusif : il efface les candidats cochés. */
export const chooseBlank = (): Answer => ({ ids: [], blank: true });

/** Un poste est répondu s'il a au moins un candidat, ou un vote blanc explicite sur un poste qui l'autorise. */
export function isAnswered(answer: Answer, position: Pick<BallotPosition, 'allowBlank'>): boolean {
  return answer.ids.length > 0 || (answer.blank && position.allowBlank);
}

/** Corps du bulletin : une entrée par poste, `candidateIds` vide pour le vote blanc. */
export function toChoices(positions: BallotPosition[], answers: Record<string, Answer>): BallotChoice[] {
  return positions.map((p) => ({ positionId: p.id, candidateIds: answers[p.id]?.blank ? [] : [...(answers[p.id]?.ids ?? [])] }));
}
