import { Page } from '@playwright/test';

// API simulée de la page « élection » de l'étudiant, par phase (D-37). Sert aux tests d'interface et aux captures.
export type Phase = 'candidacy-none' | 'candidacy-mine' | 'candidacy-rejected' | 'review' | 'voting' | 'voted' | 'closed' | 'results';

const STATUS: Record<Phase, string> = {
  'candidacy-none': 'CANDIDACY_OPEN', 'candidacy-mine': 'CANDIDACY_OPEN', 'candidacy-rejected': 'CANDIDACY_OPEN', review: 'CANDIDACY_CLOSED',
  voting: 'VOTING_OPEN', voted: 'VOTING_OPEN', closed: 'VOTING_CLOSED', results: 'RESULTS_PUBLISHED',
};
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const DATES: Record<string, Record<string, string>> = {
  CANDIDACY_OPEN: { candidacyStartsAt: day(-3), candidacyEndsAt: day(4), votingStartsAt: day(6), votingEndsAt: day(7) },
  CANDIDACY_CLOSED: { candidacyStartsAt: day(-8), candidacyEndsAt: day(-1), votingStartsAt: day(1), votingEndsAt: day(2) },
  VOTING_OPEN: { candidacyStartsAt: day(-9), candidacyEndsAt: day(-3), votingStartsAt: day(-1), votingEndsAt: day(1) },
  VOTING_CLOSED: { candidacyStartsAt: day(-12), candidacyEndsAt: day(-6), votingStartsAt: day(-3), votingEndsAt: day(-1) },
  RESULTS_PUBLISHED: { candidacyStartsAt: day(-12), candidacyEndsAt: day(-6), votingStartsAt: day(-3), votingEndsAt: day(-1) },
};
const POSITIONS = [
  { id: 'p1', title: 'Président', titleAr: 'الرئيس', seats: 1, maxChoices: 1, allowBlank: true, displayOrder: 1 },
  { id: 'p2', title: 'Vice-président', titleAr: 'نائب الرئيس', seats: 1, maxChoices: 1, allowBlank: true, displayOrder: 2 },
  { id: 'p3', title: 'Secrétaire', titleAr: 'الكاتب', seats: 1, maxChoices: 1, allowBlank: true, displayOrder: 3 },
];
const person = (id: string, positionId: string, firstName: string, lastName: string, extra: object = {}) =>
  ({ id, positionId, firstName, lastName, fullNameAr: null, statement: 'Un programme court et clair pour le groupe.', hasPhoto: false, hasProgram: false, ...extra });
const CANDIDATES = [
  person('c1', 'p1', 'Omar', 'Diallo', { hasPhoto: true, hasProgram: true }),
  person('c2', 'p1', 'Aicha', 'Ba', { hasProgram: true }),
  person('c3', 'p2', 'Sara', 'Fall'),
  person('c4', 'p3', 'Ali', 'Ndiaye', { hasPhoto: true }),
];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

export interface Mock {
  unhandled: string[];
  mine: { id: string; positionId: string; status: string; statement: string | null; rejectionReason: string | null; hasPhoto: boolean; hasProgram: boolean } | null;
  /** Statut renvoyé par GET /elections/e1 (pour simuler un état qui change pendant que la page est ouverte). */
  status: string;
  /** Réponse forcée de POST/PATCH/withdraw sur la candidature (ex. 409 candidacy_not_open). */
  candidacyError: { status: number; message: string } | null;
  requests: string[];
  /** Remplace les dates renvoyées par GET /elections/e1 (ex. candidatures pas encore commencées). */
  datesOverride: Record<string, string> | null;
}

export async function mockElectionApi(page: Page, phase: Phase, lang: 'ar' | 'fr'): Promise<Mock> {
  const mock: Mock = {
    unhandled: [], status: STATUS[phase], candidacyError: null, requests: [], datesOverride: null,
    mine: phase === 'candidacy-mine' || phase === 'review'
      ? { id: 'm1', positionId: 'p1', status: phase === 'review' ? 'APPROVED' : 'PENDING', statement: 'Mon programme pour le groupe A.', rejectionReason: null, hasPhoto: true, hasProgram: false }
      : phase === 'candidacy-rejected'
        ? { id: 'm1', positionId: 'p2', status: 'REJECTED', statement: 'Mon programme.', rejectionReason: 'Photo illisible, merci de la remplacer.', hasPhoto: false, hasProgram: false }
        : null,
  };
  await page.addInitScript((l) => localStorage.setItem('lang', l), lang);
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace('/api/v1', '');
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    mock.requests.push(`${req.method()} ${path}`);
    const voted = phase === 'voted';
    if (req.method() === 'POST' && path === '/auth/refresh') return json(200, { status: 'authenticated', accessToken: 'token' });
    if (path === '/users/me') return json(200, { id: 'u1', email: 'aicha@example.test', phone: null, twoFactorEnabled: false, roles: [{ role: 'STUDENT', institutionId: 'i1', electionId: null }] });
    if (path === '/elections/e1') {
      return json(200, { id: 'e1', institutionId: 'i1', academicYearId: 'y1', title: 'Bureau du groupe A — L3 Droit public', titleAr: 'مكتب المجموعة أ — السنة الثالثة قانون عام', description: 'Élection du bureau du groupe A.', status: mock.status, ...(mock.datesOverride ?? DATES[mock.status]), positions: POSITIONS, eligible: true });
    }
    if (path === '/elections/e1/candidates/me') {
      if (req.method() === 'GET') return mock.mine ? json(200, mock.mine) : json(404, { message: 'Not Found' });
      if (mock.candidacyError) return json(mock.candidacyError.status, { statusCode: mock.candidacyError.status, message: mock.candidacyError.message });
      return json(200, mock.mine);
    }
    if (path === '/elections/e1/candidates' && req.method() === 'POST') {
      if (mock.candidacyError) return json(mock.candidacyError.status, { statusCode: mock.candidacyError.status, message: mock.candidacyError.message });
      mock.mine = { id: 'm1', positionId: 'p1', status: 'PENDING', statement: null, rejectionReason: null, hasPhoto: false, hasProgram: false };
      return json(201, mock.mine);
    }
    if (path === '/elections/e1/candidates/me/withdraw') {
      if (mock.candidacyError) return json(mock.candidacyError.status, { statusCode: mock.candidacyError.status, message: mock.candidacyError.message });
      mock.mine = { ...(mock.mine as NonNullable<Mock['mine']>), status: 'WITHDRAWN' };
      return json(200, mock.mine);
    }
    if (path === '/elections/e1/candidates' && req.method() === 'GET') return json(200, mock.status === 'CANDIDACY_OPEN' && phase === 'candidacy-none' ? CANDIDATES.slice(0, 2) : CANDIDATES);
    if (path === '/voting/e1/status') {
      return json(200, { state: voted ? 'VOTED' : 'NOT_VOTED', electionStatus: mock.status, open: true, votingStartsAt: DATES.VOTING_OPEN['votingStartsAt'], votingEndsAt: DATES.VOTING_OPEN['votingEndsAt'], votedAt: voted ? '2026-10-15T09:41:00.000Z' : null });
    }
    if (path === '/results/e1') {
      const winner = (c: (typeof CANDIDATES)[number]) => ({ candidateId: c.id, firstName: c.firstName, lastName: c.lastName, fullNameAr: null });
      return json(200, {
        electionId: 'e1', status: 'RESULTS_PUBLISHED', registered: 30, voters: 22, participationRate: 73.3,
        positions: [
          { positionId: 'p1', title: 'Président', titleAr: 'الرئيس', seats: 1, tie: false, winners: [winner(CANDIDATES[0])], detailPublished: true, blank: 2,
            candidates: [{ ...winner(CANDIDATES[0]), votes: 12, rank: 1, isWinner: true }, { ...winner(CANDIDATES[1]), votes: 8, rank: 2, isWinner: false }] },
          { positionId: 'p2', title: 'Vice-président', titleAr: 'نائب الرئيس', seats: 1, tie: false, winners: [winner(CANDIDATES[2])], detailPublished: false, note: 'DETAIL_WITHHELD_SMALL_TURNOUT' },
        ],
      });
    }
    if (req.method() === 'POST' && /\/candidates\/c\d\/files\/(photo|program)\/access$/.test(path)) return json(200, { url: '/api/v1/files/f1?uid=u1&exp=1&sig=x' });
    if (path === '/files/f1') return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    mock.unhandled.push(`${req.method()} ${path}`);
    return json(404, { message: 'non simulé' });
  });
  return mock;
}
