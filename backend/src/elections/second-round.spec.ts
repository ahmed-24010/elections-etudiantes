import { BadRequestException } from '@nestjs/common';
import { tiedPositions } from '../results/tally';
import { checkSecondRoundDates } from './second-round.service';

const H = 3_600_000;
const now = new Date('2026-11-05T09:00:00Z');
const at = (h: number) => new Date(now.getTime() + h * H);
const pos = (id: string, seats: number, over: Record<string, unknown> = {}) => ({ id, title: `P${id}`, titleAr: null, seats, maxChoices: 1, allowBlank: true, displayOrder: 0, ...over });
const rows = (positionId: string, ...votes: number[]) => votes.map((v, i) => ({ positionId, candidateId: `${positionId}c${i + 1}`, votes: v }));

describe('Second tour : dates (D-46)', () => {
  it('début dans le futur et fin après le début', () => {
    expect(() => checkSecondRoundDates(at(24), at(48), now)).not.toThrow();
  });
  it.each([
    ['début dans le passé', at(-1), at(24)],
    ['début = maintenant', at(0), at(24)],
    ['fin avant le début', at(48), at(24)],
    ['fin = début', at(24), at(24)],
    ['date invalide', new Date('x'), at(24)],
  ])('refuse : %s (400 invalid_dates)', (_n, a, b) => {
    expect(() => checkSecondRoundDates(a, b, now)).toThrow(BadRequestException);
  });
});

describe('tiedPositions : quels postes vont au second tour (D-01)', () => {
  it('seuls les postes à égalité pour le dernier siège, avec les ex-aequo et les sièges restants', () => {
    const positions = [pos('1', 1), pos('2', 1)];
    const results = [...rows('1', 12, 8), ...rows('2', 5, 5, 2)];
    const tied = tiedPositions(positions, results);
    expect(tied).toHaveLength(1);
    expect(tied[0]).toMatchObject({ remainingSeats: 1, tiedIds: ['2c1', '2c2'] });
    expect(tied[0].position.id).toBe('2');
  });

  it('plusieurs sièges : les candidats nettement devant restent élus, les ex-aequo se disputent les sièges restants', () => {
    // 3 sièges : 10 voix (élu), puis trois candidats à 6 voix pour 2 sièges restants.
    const tied = tiedPositions([pos('1', 3, { maxChoices: 3 })], rows('1', 10, 6, 6, 6, 1));
    expect(tied[0].remainingSeats).toBe(2);
    expect(tied[0].tiedIds).toEqual(['1c2', '1c3', '1c4']);
  });

  it('aucune égalité → aucun second tour ; les lignes « blancs » sont ignorées', () => {
    const results = [...rows('1', 12, 8), { positionId: '1', candidateId: null, votes: 9 }];
    expect(tiedPositions([pos('1', 1)], results)).toEqual([]);
  });

  it('égalité sans voix (0-0) : pas de second tour', () => {
    expect(tiedPositions([pos('1', 1)], rows('1', 0, 0))).toEqual([]);
  });
});
