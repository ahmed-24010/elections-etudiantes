import { analyzePosition, detailPublished } from './tally';

const rows = (...votes: number[]) => votes.map((v, i) => ({ candidateId: `c${i + 1}`, votes: v }));

describe('analyzePosition (04 §8)', () => {
  it('désigne l’élu quand il n’y a pas d’égalité', () => {
    const r = analyzePosition(rows(5, 8, 2), 1);
    expect(r.winners).toEqual(['c2']);
    expect(r.tie).toBe(false);
    expect(r.ranked.map((x) => [x.candidateId, x.rank])).toEqual([['c2', 1], ['c1', 2], ['c3', 3]]);
  });

  it('égalité pour l’unique siège : personne n’est élu, les ex-aequo sont listés', () => {
    const r = analyzePosition(rows(5, 5, 2), 1);
    expect(r.tie).toBe(true);
    expect(r.winners).toEqual([]);
    expect(r.tiedIds.sort()).toEqual(['c1', 'c2']);
    expect(r.ranked.filter((x) => x.rank === 1)).toHaveLength(2);
  });

  it('plusieurs sièges : ceux qui sont strictement devant restent élus, l’égalité ne porte que sur le dernier siège', () => {
    const r = analyzePosition(rows(10, 5, 5, 1), 2);
    expect(r.winners).toEqual(['c1']);
    expect(r.tiedIds.sort()).toEqual(['c2', 'c3']);
  });

  it('une égalité hors du dernier siège n’en est pas une', () => {
    const r = analyzePosition(rows(10, 10, 1), 2);
    expect(r.tie).toBe(false);
    expect(r.winners.sort()).toEqual(['c1', 'c2']);
  });

  it('moins de candidats que de sièges : tous ceux qui ont des voix sont élus ; zéro voix = pas élu', () => {
    expect(analyzePosition(rows(3, 0), 2).winners).toEqual(['c1']);
    expect(analyzePosition(rows(0, 0), 1)).toMatchObject({ winners: [], tie: false });
  });
});

describe('D-32 : le détail se juge sur les votants de l’élection', () => {
  it('moins de 3 votants → détail masqué ; 3 ou plus → publié', () => {
    expect(detailPublished(0)).toBe(false);
    expect(detailPublished(2)).toBe(false);
    expect(detailPublished(3)).toBe(true);
    expect(detailPublished(22)).toBe(true);
  });
});
