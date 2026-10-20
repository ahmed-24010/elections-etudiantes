import { expect, Page, test } from '@playwright/test';

// D-37 : écran du comité (suivi du vote, prolongation, ajout exceptionnel) sur iPhone (WebKit) et Android (Chromium mobile),
// en arabe (RTL) et en français (LTR). L'API est simulée : ces tests vérifient l'interface, pas le serveur (backend/test/db).

const IN = (ms: number) => new Date(Date.now() + ms).toISOString();
const H = 3_600_000;
const ELECTION = {
  id: 'e1', institutionId: 'i1', academicYearId: 'y1', title: 'Bureau du groupe A — L3 Droit public', titleAr: 'مكتب المجموعة أ — السنة الثالثة قانون عام', description: null,
  status: 'VOTING_OPEN', candidacyStartsAt: IN(-9 * 24 * H), candidacyEndsAt: IN(-3 * 24 * H), votingStartsAt: IN(-6 * H), votingEndsAt: IN(6 * H), positions: [], committeeCount: 3, minCommittee: 3,
};

interface Mock {
  extended: boolean;
  requests: { path: string; body: unknown }[];
  unhandled: string[];
}

async function mockApi(page: Page, lang: 'ar' | 'fr'): Promise<Mock> {
  const mock: Mock = { extended: false, requests: [], unhandled: [] };
  await page.addInitScript((l) => localStorage.setItem('lang', l), lang);
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace('/api/v1', '');
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() === 'POST' && path === '/auth/refresh') return json(200, { status: 'authenticated', accessToken: 'token' });
    if (path === '/users/me') return json(200, { id: 'u1', email: 'comite1@example.test', phone: null, twoFactorEnabled: true, roles: [{ role: 'ELECTION_COMMITTEE', institutionId: 'i1', electionId: 'e1' }] });
    if (path === '/elections/e1') return json(200, ELECTION);
    if (path === '/elections/e1/turnout') {
      return json(200, { registered: 30, voted: 12, rate: 40, asOf: IN(-5 * 60_000), sliced: true, status: 'VOTING_OPEN', votingStartsAt: ELECTION.votingStartsAt, votingEndsAt: ELECTION.votingEndsAt, extended: mock.extended, addedAfterFreeze: 0 });
    }
    if (req.method() === 'POST') mock.requests.push({ path, body: req.postDataJSON() });
    if (path === '/elections/e1/voting/extend') {
      mock.extended = true;
      return json(200, { votingEndsAt: IN(8 * H) });
    }
    if (path === '/elections/e1/voter-roll/preview') {
      return (req.postDataJSON() as { studentNumber: string }).studentNumber === 'INCONNU'
        ? json(404, { statusCode: 404, message: 'voter_not_addable' })
        : json(200, { faculty: { name: 'Droit', nameAr: 'القانون' }, program: { name: 'Droit public', nameAr: 'القانون العام' }, level: { name: 'L3', nameAr: null }, group: 'A' });
    }
    if (path === '/elections/e1/voter-roll') return json(200, { registered: 31 });
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
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('main button, main a.btn, main input, main textarea, .modal button, .modal input, .modal textarea'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 44 || r.width < 44) bad.push(`cible ${el.tagName}.${el.className} ${Math.round(r.width)}x${Math.round(r.height)}`);
      if (el.matches('input[type=text], textarea') && parseFloat(getComputedStyle(el).fontSize) < 16) bad.push(`police ${el.tagName}#${el.id}`);
    }
    return bad;
  });
  expect(problems, where).toEqual([]);
}

for (const lang of ['ar', 'fr'] as const) {
  test.describe(`écran du comité : suivi du vote (${lang})`, () => {
    test('suivi en chiffres, prolongation unique, ajout exceptionnel ; confortable au pouce', async ({ page }) => {
      const mock = await mockApi(page, lang);
      await page.goto('/admin/elections/e1/vote');
      await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');

      // Suivi : des chiffres seulement, la tranche de 15 minutes est annoncée sous 50 électeurs
      await expect(page.getByTestId('registered')).toContainText('30');
      await expect(page.getByTestId('voted')).toContainText('12');
      await expect(page.getByTestId('rate')).toContainText('40');
      await expect(page.getByTestId('sliced')).toBeVisible();
      await expectMobileFriendly(page, 'suivi');

      // Prolongation : la fenêtre s'ouvre, puis l'action n'est plus offerte (une seule fois)
      await page.getByTestId('extend').click();
      await expectMobileFriendly(page, 'prolongation');
      const t = (ms: number) => {
        const d = new Date(Date.now() + ms);
        const p = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
      };
      await page.locator('#extend-outageStart').fill(t(-3 * H));
      await page.locator('#extend-outageEnd').fill(t(-1 * H));
      await page.locator('#extend-newEnd').fill(t(7 * H));
      await page.locator('#extend-reason').fill('Panne du serveur');
      await page.getByTestId('extend-submit').click();
      await expect(page.getByTestId('notice')).toBeVisible();
      await expect(page.getByTestId('extend')).toHaveCount(0);
      await expect(page.getByTestId('extended')).toBeVisible();
      expect(mock.requests.find((r) => r.path.endsWith('/voting/extend'))?.body).toMatchObject({ reason: 'Panne du serveur' });

      // Ajout exceptionnel : un matricule inconnu et un matricule valide reçoivent le MÊME traitement côté interface
      await page.getByTestId('add-voter').click();
      await page.locator('#voter-number').fill('INCONNU');
      await page.getByTestId('lookup-submit').click();
      await expect(page.getByTestId('dialog-error')).toBeVisible();
      await page.locator('#voter-number').fill('20240001');
      await page.getByTestId('lookup-submit').click();
      await expect(page.getByTestId('preview')).toBeVisible();
      await expect(page.getByTestId('preview')).not.toContainText('20240001'); // jamais le matricule ni le nom
      await expectMobileFriendly(page, 'confirmation');
      await page.locator('#add-reason').fill('Vérifié en retard par la scolarité');
      await page.getByTestId('add-submit').click();
      await expect(page.getByTestId('notice')).toBeVisible();
      expect(mock.requests.find((r) => r.path === '/elections/e1/voter-roll')?.body).toEqual({ studentNumber: '20240001', reason: 'Vérifié en retard par la scolarité' });
      expect(mock.unhandled).toEqual([]);
    });
  });
}
