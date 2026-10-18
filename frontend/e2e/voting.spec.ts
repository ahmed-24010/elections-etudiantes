import { expect, Page, test } from '@playwright/test';

// D-37 : parcours de vote complet sur iPhone (WebKit) et Android (Chromium mobile), en arabe (RTL) et en français (LTR).
// L'API est simulée (page.route) : ces tests vérifient l'interface (étapes, récapitulatif, confirmation, écran final, tailles
// tactiles, pas de défilement horizontal), pas le serveur, qui a ses propres tests sur une vraie base (backend/test/db).

const ELECTION = {
  id: 'e1', institutionId: 'i1', academicYearId: 'y1', title: 'Bureau du groupe 1', titleAr: 'مكتب المجموعة 1', description: null,
  status: 'VOTING_OPEN', candidacyStartsAt: '2026-10-01T00:00:00.000Z', candidacyEndsAt: '2026-10-10T00:00:00.000Z',
  votingStartsAt: '2026-10-15T08:00:00.000Z', votingEndsAt: '2099-10-15T18:00:00.000Z', myCandidacy: null, hasVoted: false,
};
const person = (id: string, firstName: string, lastName: string, extra: object = {}) => ({ id, firstName, lastName, fullNameAr: null, statement: 'Un programme court et clair pour le groupe.', hasPhoto: false, hasProgram: false, ...extra });
// L'ordre est celui tiré au hasard par le serveur : l'interface ne doit pas le retrier (D-35).
const BALLOT = {
  electionId: 'e1', title: ELECTION.title, titleAr: ELECTION.titleAr, votingEndsAt: ELECTION.votingEndsAt,
  positions: [
    { id: 'p1', title: 'Président', titleAr: 'الرئيس', maxChoices: 1, allowBlank: true, candidates: [person('c2', 'Omar', 'Diallo', { hasPhoto: true, hasProgram: true }), person('c1', 'Aicha', 'Ba')] },
    { id: 'p2', title: 'Trésorier', titleAr: 'أمين الصندوق', maxChoices: 2, allowBlank: false, candidates: [person('c5', 'Mina', 'Sow'), person('c3', 'Sara', 'Fall'), person('c4', 'Ali', 'Ndiaye')] },
  ],
};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PASSWORD = 'Un-mot-de-passe-solide-1';

interface Mock {
  posts: { choices: { positionId: string; candidateIds: string[] }[]; password: string }[];
  unhandled: string[];
  /** Réponses successives de POST /voting/e1/ballot (la dernière se répète). */
  castResponses: { status: number; body: object; delayMs?: number }[];
  voted: boolean;
  /** Coupe le réseau pour POST /voting/e1/ballot (et, si `statusDown`, pour la vérification du statut). */
  abortCast: boolean;
  statusDown: boolean;
  ballotResponse?: { status: number; body: object };
}

async function mockApi(page: Page, lang: 'ar' | 'fr'): Promise<Mock> {
  const mock: Mock = { posts: [], unhandled: [], castResponses: [{ status: 201, body: { status: 'recorded' } }], voted: false, abortCast: false, statusDown: false };
  await page.addInitScript((l) => localStorage.setItem('lang', l), lang);
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace('/api/v1', '');
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() === 'POST' && path === '/auth/refresh') return json(200, { status: 'authenticated', accessToken: 'token' });
    if (path === '/users/me') return json(200, { id: 'u1', email: 'aicha@example.test', phone: null, twoFactorEnabled: false, roles: [{ role: 'STUDENT', institutionId: 'i1', electionId: null }] });
    if (path === '/elections/mine') return json(200, [{ ...ELECTION, hasVoted: mock.voted }]);
    if (path === '/voting/e1/status') {
      if (mock.statusDown) return route.abort('failed');
      return json(200, { state: mock.voted ? 'VOTED' : 'NOT_VOTED', electionStatus: 'VOTING_OPEN', open: true, votingStartsAt: ELECTION.votingStartsAt, votingEndsAt: ELECTION.votingEndsAt, votedAt: mock.voted ? '2026-10-15T09:41:00.000Z' : null });
    }
    if (req.method() === 'GET' && path === '/voting/e1/ballot') return mock.ballotResponse ? json(mock.ballotResponse.status, mock.ballotResponse.body) : json(200, BALLOT);
    if (req.method() === 'POST' && path === '/voting/e1/ballot') {
      mock.posts.push(req.postDataJSON());
      if (mock.abortCast) return route.abort('failed');
      const res = mock.castResponses.length > 1 ? mock.castResponses.shift()! : mock.castResponses[0];
      if (res.delayMs) await new Promise((r) => setTimeout(r, res.delayMs));
      if (res.status === 201) mock.voted = true;
      return json(res.status, res.body);
    }
    if (req.method() === 'POST' && /\/candidates\/c2\/files\/photo\/access$/.test(path)) return json(200, { url: '/api/v1/files/f-photo?uid=u1&exp=1&sig=x' });
    if (path === '/files/f-photo') return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    mock.unhandled.push(`${req.method()} ${path}`);
    return json(404, { message: 'non simulé' });
  });
  return mock;
}

/** Aucun défilement horizontal, champs ≥ 16 px, cibles tactiles ≥ 44 px dans le contenu de la page (D-37). */
async function expectMobileFriendly(page: Page, where: string) {
  const problems = await page.evaluate(() => {
    const bad: string[] = [];
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    if (overflow > 0) bad.push(`défilement horizontal de ${overflow}px`);
    const main = document.querySelector('main') ?? document.body;
    for (const el of Array.from(main.querySelectorAll<HTMLElement>('button, a.btn, input:not([type=hidden]), select, textarea'))) {
      const target = el.matches('input[type=radio], input[type=checkbox]') ? (el.closest('label') ?? el) : el;
      const r = target.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 44 || r.width < 44) bad.push(`cible ${el.tagName}.${el.className} ${Math.round(r.width)}x${Math.round(r.height)}`);
      if (el.matches('input[type=text], input[type=password], select, textarea') && parseFloat(getComputedStyle(el).fontSize) < 16) bad.push(`police ${el.tagName}#${el.id}`);
    }
    return bad;
  });
  expect(problems, where).toEqual([]);
}

for (const lang of ['ar', 'fr'] as const) {
  test.describe(`parcours de vote (${lang})`, () => {
    test('de « Mes élections » à « Votre vote est enregistré », bulletin un poste par étape', async ({ page }) => {
      const mock = await mockApi(page, lang);
      await page.goto('/student/elections');
      await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
      await expectMobileFriendly(page, 'mes élections');
      await page.getByTestId('vote-link').click();

      // Poste 1 : un seul choix, ordre du serveur conservé (Omar avant Aicha), vote blanc proposé
      await expect(page.getByTestId('vote-progress')).toContainText('1');
      const order = await page.locator('[data-testid^=candidate-]').evaluateAll((labels) => labels.map((l) => l.getAttribute('data-testid')));
      expect(order).toEqual(['candidate-c2', 'candidate-c1']);
      await expect(page.getByTestId('blank-choice')).toBeVisible();
      await expect(page.getByTestId('vote-next')).toBeDisabled();
      await expectMobileFriendly(page, 'poste 1');
      await page.getByTestId('candidate-c2').click();
      await expect(page.getByTestId('vote-next')).toBeEnabled();
      await page.getByTestId('candidate-c1').click(); // un seul choix : remplace
      await expect(page.locator('#choice-c2')).not.toBeChecked();
      await page.getByTestId('vote-next').click();

      // Poste 2 : deux choix au plus, pas de vote blanc
      await expect(page.getByTestId('vote-progress')).toContainText('2');
      await expect(page.getByTestId('blank-choice')).toHaveCount(0);
      await page.getByTestId('candidate-c5').click();
      await page.getByTestId('candidate-c3').click();
      await expect(page.locator('#choice-c4')).toBeDisabled(); // maximum atteint
      await expectMobileFriendly(page, 'poste 2');
      await page.getByTestId('vote-next').click();

      // Récapitulatif, puis modification du poste 1 (vote blanc) et retour au récapitulatif
      await expect(page.getByTestId('summary-p1')).toContainText('Aicha');
      await expect(page.getByTestId('summary-p2')).toContainText('Mina');
      await expect(page.getByTestId('summary-p2')).toContainText('Sara');
      await expectMobileFriendly(page, 'récapitulatif');
      await page.getByRole('button', { name: lang === 'ar' ? /تعديل/ : /Modifier/ }).first().click();
      await page.getByTestId('blank-choice').click();
      await page.getByTestId('vote-next').click();
      await expect(page.getByTestId('summary-p1')).not.toContainText('Aicha');
      await page.getByTestId('vote-continue').click();

      // Confirmation : avertissement, mot de passe ; un mauvais mot de passe laisse l'électeur sur place
      await expect(page.getByTestId('vote-final')).toBeVisible();
      await expectMobileFriendly(page, 'confirmation');
      await expect(page.getByTestId('vote-submit')).toBeDisabled();
      mock.castResponses = [{ status: 401, body: { statusCode: 401, message: 'INVALID_PASSWORD' } }, { status: 201, body: { status: 'recorded' } }];
      await page.locator('#vote-password').fill('mauvais');
      await page.getByTestId('vote-submit').click();
      await expect(page.getByTestId('vote-error')).toBeVisible();
      await expect(page.locator('#vote-password')).toHaveValue('');
      expect(mock.posts).toHaveLength(1);
      await expectMobileFriendly(page, 'confirmation en erreur');

      await page.locator('#vote-password').fill(PASSWORD);
      await page.getByTestId('vote-submit').click();
      await expect(page.getByTestId('vote-done')).toBeVisible();
      expect(mock.posts).toHaveLength(2);
      expect(mock.posts[1]).toEqual({
        choices: [{ positionId: 'p1', candidateIds: [] }, { positionId: 'p2', candidateIds: ['c5', 'c3'] }],
        password: PASSWORD,
      });
      // Écran final : l'heure, aucun rappel des choix, aucun numéro de bulletin
      await expect(page.getByTestId('vote-done')).toContainText(/2026-10-15 \d{2}:\d{2}/);
      for (const name of ['Omar', 'Aicha', 'Mina', 'Sara', 'Ali']) await expect(page.getByTestId('vote-done')).not.toContainText(name);
      await expectMobileFriendly(page, 'écran final');

      // De retour dans « Mes élections » : « Vous avez voté », plus de bouton « Voter »
      await page.getByRole('link', { name: lang === 'ar' ? /العودة إلى انتخاباتي/ : /Retour à mes élections/ }).click();
      await expect(page.getByTestId('voted-badge')).toBeVisible();
      await expect(page.getByTestId('vote-link')).toHaveCount(0);
      expect(mock.unhandled).toEqual([]);
    });

    test('double appui sur « Envoyer » : un seul vote part', async ({ page }) => {
      const mock = await mockApi(page, lang);
      mock.castResponses = [{ status: 201, body: { status: 'recorded' }, delayMs: 1500 }];
      await page.goto('/student/elections/e1/vote');
      await page.getByTestId('candidate-c1').click();
      await page.getByTestId('vote-next').click();
      await page.getByTestId('candidate-c3').click();
      await page.getByTestId('vote-next').click();
      await page.getByTestId('vote-continue').click();
      await page.locator('#vote-password').fill(PASSWORD);
      // Trois appuis dans le même instant, avant que l'écran ait pu réagir : seul le premier doit partir.
      await page.evaluate(() => {
        const submit = document.querySelector<HTMLButtonElement>('[data-testid=vote-submit]')!;
        submit.click();
        submit.click();
        submit.click();
      });
      await expect(page.getByTestId('vote-done')).toBeVisible();
      expect(mock.posts).toHaveLength(1);
    });

    test('échec de l’envoi (500, réseau coupé) : « Votre vote n’a PAS été enregistré », jamais l’écran de succès ; le réessai aboutit', async ({ page }) => {
      const mock = await mockApi(page, lang);
      await page.goto('/student/elections/e1/vote');
      await page.getByTestId('candidate-c1').click();
      await page.getByTestId('vote-next').click();
      await page.getByTestId('candidate-c3').click();
      await page.getByTestId('vote-next').click();
      await page.getByTestId('vote-continue').click();
      const notRecorded = lang === 'ar' ? /لم يتم تسجيل تصويتك/ : /PAS été enregistré/;
      const uncertain = lang === 'ar' ? /تعذر تأكيد تسجيل/ : /PAS pu être confirmé/;

      // 1. erreur serveur : le statut confirme « pas voté »
      mock.castResponses = [{ status: 500, body: { statusCode: 500, message: 'Internal server error' } }];
      await page.locator('#vote-password').fill(PASSWORD);
      await page.getByTestId('vote-submit').click();
      await expect(page.getByTestId('vote-error')).toContainText(notRecorded);
      await expect(page.getByTestId('vote-done')).toHaveCount(0);
      await expectMobileFriendly(page, 'échec 500');

      // 2. réseau coupé, statut injoignable aussi : message prudent, toujours pas de succès
      mock.abortCast = true;
      mock.statusDown = true;
      await page.getByTestId('vote-submit').click();
      await expect(page.getByTestId('vote-error')).toContainText(uncertain);
      await expect(page.getByTestId('vote-done')).toHaveCount(0);

      // 3. réseau coupé pour le vote seulement : le serveur confirme « pas voté »
      mock.statusDown = false;
      await page.getByTestId('vote-submit').click();
      await expect(page.getByTestId('vote-error')).toContainText(notRecorded);
      await expect(page.getByTestId('vote-done')).toHaveCount(0);

      // 4. retour du réseau : le même bulletin part et le succès s'affiche
      mock.abortCast = false;
      mock.castResponses = [{ status: 201, body: { status: 'recorded' } }];
      await page.getByTestId('vote-submit').click();
      await expect(page.getByTestId('vote-done')).toBeVisible();
      expect(mock.posts.at(-1)).toEqual({ choices: [{ positionId: 'p1', candidateIds: ['c1'] }, { positionId: 'p2', candidateIds: ['c3'] }], password: PASSWORD });
      expect(mock.unhandled).toEqual([]);
    });

    test('déjà voté : « Votre vote a déjà été enregistré », sans bulletin', async ({ page }) => {
      const mock = await mockApi(page, lang);
      mock.ballotResponse = { status: 409, body: { statusCode: 409, message: 'ALREADY_VOTED' } };
      mock.voted = true;
      await page.goto('/student/elections/e1/vote');
      await expect(page.getByTestId('vote-done')).toBeVisible();
      await expect(page.locator('[data-testid^=candidate-]')).toHaveCount(0);
      await expectMobileFriendly(page, 'déjà voté');
    });

    test('vote refusé (ELECTION_NOT_OPEN) : message clair et retour', async ({ page }) => {
      const mock = await mockApi(page, lang);
      mock.ballotResponse = { status: 409, body: { statusCode: 409, message: 'ELECTION_NOT_OPEN' } };
      await page.goto('/student/elections/e1/vote');
      await expect(page.getByTestId('vote-blocked')).toBeVisible();
      await expectMobileFriendly(page, 'vote fermé');
    });

    test('photo et programme du candidat chargés à la demande, sans casser la mise en page', async ({ page }) => {
      await mockApi(page, lang);
      await page.goto('/student/elections/e1/vote');
      await expect(page.locator('[data-testid=candidate-c2] img')).toBeVisible({ timeout: 15_000 }); // la photo de c2 remplace l'initiale
      await expectMobileFriendly(page, 'poste avec photo');
    });
  });
}
