import { BallotPosition } from '../../core/api/voting.api';
import { Answer, chooseBlank, emptyAnswer, isAnswered, toChoices, toggleCandidate } from './ballot-logic';

const position = (over: Partial<BallotPosition> = {}): BallotPosition => ({ id: 'p1', title: 'Président', titleAr: null, maxChoices: 1, allowBlank: true, candidates: [], ...over });

describe('logique du bulletin', () => {
  it('un seul choix : le candidat suivant remplace le précédent', () => {
    let a = toggleCandidate(emptyAnswer(), 'c1', 1);
    a = toggleCandidate(a, 'c2', 1);
    expect(a).toEqual({ ids: ['c2'], blank: false });
  });

  it('plusieurs choix : coche, décoche, et ne dépasse jamais le maximum', () => {
    let a: Answer = emptyAnswer();
    a = toggleCandidate(a, 'c1', 2);
    a = toggleCandidate(a, 'c2', 2);
    a = toggleCandidate(a, 'c3', 2); // plafond atteint
    expect(a.ids).toEqual(['c1', 'c2']);
    a = toggleCandidate(a, 'c1', 2); // décoche
    expect(a.ids).toEqual(['c2']);
    a = toggleCandidate(a, 'c3', 2);
    expect(a.ids).toEqual(['c2', 'c3']);
  });

  it('le vote blanc est exclusif, et choisir un candidat annule le vote blanc', () => {
    let a = toggleCandidate(emptyAnswer(), 'c1', 3);
    a = chooseBlank();
    expect(a).toEqual({ ids: [], blank: true });
    a = toggleCandidate(a, 'c2', 3);
    expect(a).toEqual({ ids: ['c2'], blank: false });
  });

  it('« rien choisi » n’est pas un vote blanc', () => {
    expect(isAnswered(emptyAnswer(), position())).toBeFalse();
    expect(isAnswered(chooseBlank(), position())).toBeTrue();
    expect(isAnswered(chooseBlank(), position({ allowBlank: false }))).toBeFalse(); // blanc interdit sur ce poste
    expect(isAnswered({ ids: ['c1'], blank: false }, position({ allowBlank: false }))).toBeTrue();
  });

  it('corps du bulletin : une entrée par poste, blanc = liste vide, ordre des postes conservé', () => {
    const positions = [position({ id: 'p1' }), position({ id: 'p2', maxChoices: 2 }), position({ id: 'p3' })];
    const answers: Record<string, Answer> = { p1: { ids: ['c1'], blank: false }, p2: { ids: ['c2', 'c3'], blank: false }, p3: chooseBlank() };
    expect(toChoices(positions, answers)).toEqual([
      { positionId: 'p1', candidateIds: ['c1'] },
      { positionId: 'p2', candidateIds: ['c2', 'c3'] },
      { positionId: 'p3', candidateIds: [] },
    ]);
  });
});
