import { expect, Page, test } from '@playwright/test';

// D-37 : écran « Résultats » du comité (publication, procès-verbal par langue, vérification de l'urne) sur iPhone (WebKit) et
// Android (Chromium mobile), en arabe (RTL) et en français (LTR). L'API est simulée : ces tests vérifient l'interface.

const IN = (ms: number) => new Date(Date.now() + ms).toISOString();
const H = 3_600_000;
const person = (id: string, firstName: string, lastName: string, fullNameAr: string | null = null) => ({ candidateId: id, firstName, lastName, fullNameAr });
const RESULTS = {
  electionId: 'e1', registered: 31, voters: 22, participationRate: 71, integrityOk: true,
  positions: [
    { positionId: 'p1', title: 'Président', titleAr: 'الرئيس', seats: 1, tie: false, winners: [person('c1', 'Omar', 'Diallo', 'عمر جالو')], detailPublished: true, blank: 2,
      candidates: [{ ...person('c1', 'Omar', 'Diallo', 'عمر جالو'), votes: 12, rank: 1, isWinner: true }, { ...person('c2', 'Aïcha', 'Ba'), votes: 8, rank: 2, isWinner: false }] },
    { positionId: 'p2', title: 'Vice-président', titleAr: 'نائب الرئيس', seats: 1, tie: true, winners: [], detailPublished: true, blank: 0,
      candidates: [{ ...person('c3', 'Sara', 'Fall'), votes: 11, rank: 1, isWinner: false }, { ...person('c4', 'Éric', 'Ndiaye'), votes: 11, rank: 1, isWinner: false }] },
  ],
};
const REPORT = { reportId: '7d9e2c14-5a3b-4f8e-9c21-0b6a8d4e1f73', verificationCode: 'PV-7D9E2C145A3B', generatedAt: IN(-H), ballotsDigest: 'a'.repeat(64), sha256: { fr: 'b'.repeat(64), ar: 'c'.repeat(64) }, revoked: false };

interface Mock {
  status: string;
  tampered: boolean;
  requests: { method: string; path: string; query: string }[];
  unhandled: string[];
}

async function mockApi(page: Page, lang: 'ar' | 'fr', initial: 'VOTING_CLOSED' | 'RESULTS_PUBLISHED'): Promise<Mock> {
  const mock: Mock = { status: initial, tampered: false, requests: [], unhandled: [] };
  await page.addInitScript((l) => localStorage.setItem('lang', l), lang);
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace('/api/v1', '');
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() === 'POST' && path === '/auth/refresh') return json(200, { status: 'authenticated', accessToken: 'token' });
    if (path === '/users/me') return json(200, { id: 'u1', email: 'comite1@example.test', phone: null, twoFactorEnabled: true, roles: [{ role: 'ELECTION_COMMITTEE', institutionId: 'i1', electionId: 'e1' }] });
    if (path === '/elections/e1') {
      return json(200, { id: 'e1', institutionId: 'i1', academicYearId: 'y1', title: 'Bureau du groupe A', titleAr: 'مكتب المجموعة أ', description: null, status: mock.status, candidacyStartsAt: IN(-9 * 24 * H), candidacyEndsAt: IN(-3 * 24 * H), votingStartsAt: IN(-30 * H), votingEndsAt: IN(-6 * H), positions: [] });
    }
    mock.requests.push({ method: req.method(), path, query: url.search });
    if (path === '/results/e1') return json(200, { ...RESULTS, status: mock.status });
    if (path === '/elections/e1/results/publish') {
      mock.status = 'RESULTS_PUBLISHED';
      return json(200, { status: 'RESULTS_PUBLISHED', report: 'generated' });
    }
    if (path === '/elections/e1/reports') return json(200, mock.status === 'RESULTS_PUBLISHED' ? [REPORT] : []);
    if (path === '/elections/e1/report/download') return route.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.from('%PDF-1.4 essai') });
    if (path === '/results/e1/verify') {
      const bad = mock.tampered;
      return json(200, { computedDigest: bad ? 'd'.repeat(64) : 'a'.repeat(64), tallyDigest: 'a'.repeat(64), reportDigest: 'a'.repeat(64), reportId: REPORT.reportId, matchesTally: !bad, matchesReport: !bad, checkedAt: IN(0) });
    }
    mock.unhandled.push(`${req.method()} ${path}`);
    return json(404, { message: 'Not Found' });
  });
  return mock;
}

/** Aucun défilement horizontal, champs ≥ 16 px, cibles tactiles ≥ 44 px dans le contenu visible (D-37). */
async function expectMobileFriendly(page: Page, where: string) {
  const problems = await page.evaluate(() => {
    const bad: string[] = [];
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    if (overflow > 0) bad.push(`défilement horizontal de ${overflow}px`);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('main button, main a.btn, .modal button'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 44 || r.width < 44) bad.push(`cible ${el.tagName}.${el.className} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return bad;
  });
  expect(problems, where).toEqual([]);
}

for (const lang of ['ar', 'fr'] as const) {
  test.describe(`écran du comité : résultats (${lang})`, () => {
    test('publication, PV dans la langue du site, vérification de l’urne ; confortable au pouce', async ({ page }) => {
      const mock = await mockApi(page, lang, 'VOTING_CLOSED');
      await page.goto('/admin/elections/e1/results');
      await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');

      await expect(page.getByTestId('voters')).toContainText('22');
      await expect(page.getByTestId('integrity-ok')).toBeVisible();
      await expect(page.getByTestId('ties')).toBeVisible();
      await expect(page.getByTestId('position-p2').getByTestId('tie-badge')).toBeVisible();
      await expectMobileFriendly(page, 'résultats');

      // Publication avec confirmation
      await page.getByTestId('publish').click();
      await expectMobileFriendly(page, 'confirmation');
      await page.getByTestId('publish-confirm').click();
      await expect(page.getByTestId('notice')).toBeVisible();
      await expect(page.getByTestId('publish')).toHaveCount(0);
      await expect(page.getByTestId('report-code')).toContainText('PV-7D9E2C145A3B');
      await expectMobileFriendly(page, 'procès-verbal');

      // Le bouton principal télécharge la langue du site
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download').click()]);
      expect(download.suggestedFilename()).toBe(`PV-7D9E2C145A3B-${lang}.pdf`);
      expect(mock.requests.find((r) => r.path === '/elections/e1/report/download')?.query).toBe(`?lang=${lang}`);

      // Vérifier l'urne : identique, puis différente
      await page.getByTestId('verify').click();
      await expect(page.getByTestId('urn-identical')).toBeVisible();
      await expect(page.getByTestId('digest-computed')).toContainText('a'.repeat(64));
      await expectMobileFriendly(page, 'urne identique');
      mock.tampered = true;
      await page.getByTestId('verify').click();
      await expect(page.getByTestId('urn-different')).toBeVisible();
      await expect(page.getByTestId('urn-identical')).toHaveCount(0);
      expect(mock.unhandled).toEqual([]);
    });
  });
}
