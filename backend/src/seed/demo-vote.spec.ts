import { SeedRefusedError } from './seed';
import { assertDemoVoteAllowed, demoResults, formatResults, ResultsData } from './demo-vote';

const data = (rows: { c: string; v: number }[][]): ResultsData => ({
  title: 'Bureau', status: 'VOTING_CLOSED',
  tally: { eligibleCount: 3, participantCount: 2, ballotCount: 2, integrityOk: true, ballotsDigest: 'ab'.repeat(32) },
  positions: rows.map((r, i) => ({ title: `Poste ${i + 1}`, seats: 1, rows: r.map((x) => ({ candidateId: x.c === 'blanc' ? null : x.c, name: x.c, votes: x.v })) })),
});

describe('démonstration : second tour', () => {
  const prisma = (second: object | null) => ({
    election: { findFirst: jest.fn().mockResolvedValueOnce({ id: 'e1', title: 'Bureau du groupe A — L3 Droit public', status: 'RESULTS_PUBLISHED' }).mockResolvedValueOnce(second) },
    electionTally: { findUnique: jest.fn().mockResolvedValue(null) },
  });
  it('« second » sans second tour créé : message clair, rien n’est modifié', async () => {
    await expect(demoResults({ prisma: prisma(null) as never, target: 'second' })).rejects.toThrow(/Aucun second tour/);
  });
  it('« second » vise l’élection liée au premier tour (jamais le premier)', async () => {
    const p = prisma({ id: 'e2', title: 'Bureau — Tour 2', status: 'VOTING_OPEN' });
    await expect(demoResults({ prisma: p as never, target: 'second' })).rejects.toThrow(/Pas de décompte.*VOTING_OPEN/);
    expect(p.electionTally.findUnique).toHaveBeenCalledWith({ where: { electionId: 'e2' } });
  });
});

describe('commandes de démonstration du vote', () => {
  it('refusées en production, acceptées sinon', () => {
    expect(() => assertDemoVoteAllowed({ NODE_ENV: 'production' })).toThrow(SeedRefusedError);
    expect(() => assertDemoVoteAllowed({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertDemoVoteAllowed({})).not.toThrow();
  });

  it('résultats : sous 3 votants seuls les élus apparaissent (D-32), ni voix ni blancs', () => {
    const text = formatResults(data([[{ c: 'Aicha', v: 2 }, { c: 'Omar', v: 0 }, { c: 'blanc', v: 0 }]])).join('\n');
    expect(text).toContain('Élu(s) : Aicha');
    expect(text).toContain('Effectif trop faible');
    expect(text).not.toMatch(/voix|Votes blancs/);
    expect(text).toContain('Intégrité : OK');
  });

  it('résultats : à partir de 3 votants, le détail et les blancs sont affichés ; une égalité est signalée', () => {
    const text = formatResults(data([[{ c: 'Aicha', v: 2 }, { c: 'Omar', v: 1 }, { c: 'blanc', v: 1 }], [{ c: 'Ali', v: 2 }, { c: 'Sara', v: 2 }, { c: 'blanc', v: 0 }]])).join('\n');
    expect(text).toMatch(/Aicha\s+2 voix/);
    expect(text).toMatch(/Votes blancs\s+1/);
    expect(text).toContain('ÉGALITÉ');
  });
});
