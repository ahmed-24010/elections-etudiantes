import { expect, Page, test } from '@playwright/test';

// D-37 : tableau de bord de l'administrateur d'institution (D-48) et second tour + « PV signé » du comité (D-46, D-47), sur iPhone
// (WebKit) et Android (Chromium mobile), en arabe (RTL) et en français (LTR). L'API est simulée : ces tests vérifient l'interface.

const IN = (ms: number) => new Date(Date.now() + ms).toISOString();
const H = 3_600_000;
const election = (id: string, over: Record<string, unknown> = {}) => ({ id, title: `Élection ${id}`, titleAr: `انتخابات ${id}`, round: 1, status: 'VOTING_OPEN', votingStartsAt: IN(-H), votingEndsAt: IN(24 * H), ...over });
const DASHBOARD = {
  generatedAt: IN(0),
  counts: { candidacyOpen: 1, awaitingVote: 0, votingOpen: 1, awaitingPublication: 1, upcoming: 1 },
  inProgress: [
    election('a', { participation: { registered: 30, voted: 12, rate: 40, sliced: true, asOf: IN(-5 * 60_000) } }),
    election('b', { status: 'VOTING_CLOSED', round: 2, participation: { registered: 800, voted: 600, rate: 75, sliced: false, asOf: IN(0) } }),
  ],
  upcoming: [election('d', { status: 'DRAFT', votingStartsAt: IN(72 * H) })],
  pendingVerifications: 7,
  reportsToSign: { count: 1, items: [{ electionId: 'e', title: 'Élection e', titleAr: 'انتخابات e', round: 1, verificationCode: 'PV-7D9E2C145A3B', generatedAt: IN(-H) }] },
  publishedWithoutReport: { count: 0, items: [] },
};
const person = (id: string, firstName: string, lastName: string) => ({ candidateId: id, firstName, lastName, fullNameAr: null });
const RESULTS = {
  electionId: 'e1', registered: 31, voters: 22, participationRate: 71, integrityOk: true,
  positions: [
    { positionId: 'p2', title: 'Vice-président', titleAr: 'نائب الرئيس', seats: 1, tie: true, winners: [], detailPublished: true, blank: 0,
      candidates: [{ ...person('c3', 'Sara', 'Fall'), votes: 11, rank: 1, isWinner: false }, { ...person('c4', 'Éric', 'Ndiaye'), votes: 11, rank: 1, isWinner: false }] },
  ],
};

interface Mock {
  secondRound: boolean;
  signed: boolean;
  posts: { path: string; body: unknown }[];
  unhandled: string[];
}

async function mockApi(page: Page, lang: 'ar' | 'fr', role: 'INSTITUTION_ADMIN' | 'ELECTION_COMMITTEE'): Promise<Mock> {
  const mock: Mock = { secondRound: false, signed: false, posts: [], unhandled: [] };
  await page.addInitScript((l) => localStorage.setItem('lang', l), lang);
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace('/api/v1', '');
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() === 'POST' && path === '/auth/refresh') return json(200, { status: 'authenticated', accessToken: 'token' });
    if (path === '/users/me') return json(200, { id: 'u1', email: 'x@example.test', phone: null, twoFactorEnabled: true, roles: [{ role, institutionId: 'i1', electionId: role === 'ELECTION_COMMITTEE' ? 'e1' : null }] });
    if (path === '/institutions/i1/dashboard') return json(200, DASHBOARD);
    if (path === '/elections/e1') {
      return json(200, {
        id: 'e1', institutionId: 'i1', academicYearId: 'y1', title: 'Bureau du groupe A', titleAr: 'مكتب المجموعة أ', description: null, status: 'RESULTS_PUBLISHED',
        candidacyStartsAt: null, candidacyEndsAt: null, votingStartsAt: IN(-48 * H), votingEndsAt: IN(-6 * H), positions: [], round: 1,
        secondRound: mock.secondRound ? { id: 'e2', status: 'CANDIDACY_CLOSED', round: 2 } : null,
      });
    }
    if (path === '/results/e1') return json(200, { ...RESULTS, status: 'RESULTS_PUBLISHED' });
    if (path === '/elections/e1/reports') {
      return json(200, [{ reportId: 'r1', verificationCode: 'PV-7D9E2C145A3B', generatedAt: IN(-H), ballotsDigest: 'a'.repeat(64), sha256: { fr: 'b'.repeat(64), ar: 'c'.repeat(64) }, revoked: false, signedAt: mock.signed ? IN(0) : null }]);
    }
    if (req.method() === 'POST') mock.posts.push({ path, body: req.postDataJSON() });
    if (path === '/elections/e1/second-round') {
      mock.secondRound = true;
      return json(200, { id: 'e2', round: 2, status: 'CANDIDACY_CLOSED' });
    }
    if (path === '/elections/e1/report/signed') {
      mock.signed = true;
      return json(200, { reportId: 'r1', signedAt: IN(0) });
    }
    mock.unhandled.push(`${req.method()} ${path}`);
    return json(404, { message: 'Not Found' });
  });
  return mock;
}

/** Aucun défilement horizontal, cibles tactiles ≥ 44 px dans le contenu visible (D-37). */
async function expectMobileFriendly(page: Page, where: string, selector = 'main button, main a.btn, .modal button, .modal input') {
  const problems = await page.evaluate((sel) => {
    const bad: string[] = [];
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    if (overflow > 0) bad.push(`défilement horizontal de ${overflow}px`);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 44 || r.width < 44) bad.push(`cible ${el.tagName}.${el.className} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return bad;
  }, selector);
  expect(problems, where).toEqual([]);
}

for (const lang of ['ar', 'fr'] as const) {
  test.describe(`tableau de bord de l’administrateur d’institution (${lang})`, () => {
    test('quatre chiffres, élections en cours avec participation, PV à signer ; aucune liste nominative', async ({ page }) => {
      const mock = await mockApi(page, lang, 'INSTITUTION_ADMIN');
      await page.goto('/admin');
      await expect(page).toHaveURL(/\/admin\/dashboard$/); // l'accueil de l'administrateur d'institution
      await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
      await expect(page.getByTestId('count-voting')).toContainText('1');
      await expect(page.getByTestId('count-verifications')).toContainText('7');
      await expect(page.getByTestId('count-reports')).toContainText('1');
      await expect(page.getByTestId('election-a').getByTestId('participation')).toContainText('12');
      await expect(page.getByTestId('election-b').getByTestId('participation')).toContainText('600');
      await expect(page.getByTestId('report-e')).toContainText('PV-7D9E2C145A3B');
      await expect(page.locator('main table')).toHaveCount(0);
      await expectMobileFriendly(page, 'tableau de bord', 'main .app-dash-item a:not(.badge)');
      expect(mock.unhandled).toEqual([]);
    });
  });

  test.describe(`comité : second tour et PV signé (${lang})`, () => {
    test('créer le second tour en un clic (dates préremplies), puis marquer le PV signé', async ({ page }) => {
      const mock = await mockApi(page, lang, 'ELECTION_COMMITTEE');
      await page.goto('/admin/elections/e1/results');
      await expect(page.getByTestId('ties')).toBeVisible();
      await expectMobileFriendly(page, 'résultats');

      await page.getByTestId('second-round').click();
      await expect(page.locator('#sr-votingStartsAt')).toHaveValue(/^\d{4}-\d{2}-\d{2} 08:00$/);
      await expect(page.getByTestId('second-round-confirm')).toBeEnabled();
      await expectMobileFriendly(page, 'second tour');
      await page.getByTestId('second-round-confirm').click();
      await expect(page.getByTestId('second-round-link')).toBeVisible();
      await expect(page.getByTestId('second-round')).toHaveCount(0);
      expect(mock.posts.find((p) => p.path === '/elections/e1/second-round')?.body).toMatchObject({ votingStartsAt: expect.any(String), votingEndsAt: expect.any(String) });

      await page.getByTestId('sign').click();
      await expect(page.getByTestId('signed')).toBeVisible();
      await expect(page.getByTestId('sign')).toHaveCount(0);
      await expectMobileFriendly(page, 'PV signé');
      expect(mock.unhandled).toEqual([]);
    });

    test('l’administrateur d’institution ne voit ni « Créer le second tour » ni « PV signé »', async ({ page }) => {
      await mockApi(page, lang, 'INSTITUTION_ADMIN');
      await page.goto('/admin/elections/e1/results');
      await expect(page.getByTestId('ties')).toBeVisible();
      await expect(page.getByTestId('second-round')).toHaveCount(0);
      await expect(page.getByTestId('second-round-committee-only')).toBeVisible();
      await expect(page.getByTestId('sign')).toHaveCount(0);
      await expect(page.getByTestId('not-signed')).toBeVisible();
    });
  });
}
