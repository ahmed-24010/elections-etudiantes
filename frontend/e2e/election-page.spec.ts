import { expect, Page, test } from '@playwright/test';
import { mockElectionApi, Phase } from './election-mocks';

// D-37 : la page « élection » de l'étudiant tient sur un petit téléphone (375×667) : l'action principale de la phase est visible
// SANS défiler, la frise tient sur une ligne, le reste est replié. iPhone (WebKit) et Pixel (Chromium mobile), arabe et français.
test.use({ viewport: { width: 375, height: 667 } });
const VIEWPORT_HEIGHT = 667;

/** Le rectangle de l'élément est entièrement dans le premier écran (aucun défilement nécessaire). */
async function expectAboveTheFold(page: Page, testId: string) {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box, testId).not.toBeNull();
  expect(box!.y, `${testId} (haut)`).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height, `${testId} (bas)`).toBeLessThanOrEqual(VIEWPORT_HEIGHT);
}
async function noHorizontalScroll(page: Page, where: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, where).toBeLessThanOrEqual(0);
}
const open = (page: Page) => page.goto('/student/elections/e1');
const TEXT = {
  fr: { open: 'Candidatures ouvertes', notOpen: /ne sont pas ouvertes|pas dans la période/, voted: 'Vous avez voté ✓' },
  ar: { open: 'باب الترشح مفتوح', notOpen: /غير مفتوح|لسنا في فترة/, voted: 'لقد صوّتَّ ✓' },
} as const;

for (const lang of ['fr', 'ar'] as const) {
  test.describe(`page élection (${lang})`, () => {
    test('vote ouvert : le gros bouton « Voter » est dans le premier écran, le reste est replié', async ({ page }) => {
      await mockElectionApi(page, 'voting', lang);
      await open(page);
      await expectAboveTheFold(page, 'vote-link');
      await expect(page.getByTestId('details-fold')).not.toHaveAttribute('open', '');
      await expect(page.getByTestId('candidates-fold')).not.toHaveAttribute('open', '');
      const cta = await page.getByTestId('vote-link').boundingBox();
      expect(cta!.height).toBeGreaterThanOrEqual(56); // « gros » bouton, cible tactile largement ≥ 44 px
      await noHorizontalScroll(page, 'vote ouvert');
      await page.getByTestId('vote-link').click();
      await expect(page).toHaveURL(/\/student\/elections\/e1\/vote$/);
    });

    test('déjà voté : « Vous avez voté ✓ » en tête, pas de bouton « Voter »', async ({ page }) => {
      await mockElectionApi(page, 'voted', lang);
      await open(page);
      await expectAboveTheFold(page, 'voted-card');
      await expect(page.getByTestId('voted-card')).toContainText(TEXT[lang].voted);
      await expect(page.getByTestId('vote-link')).toHaveCount(0);
    });

    test('candidatures, pas encore candidat : « Se porter candidat » dans le premier écran ; le formulaire s’ouvre à la demande', async ({ page }) => {
      await mockElectionApi(page, 'candidacy-none', lang);
      await open(page);
      await expectAboveTheFold(page, 'start-apply');
      await expect(page.locator('#positionIdNew')).toHaveCount(0);
      await page.getByTestId('start-apply').click();
      await expect(page.locator('#positionIdNew')).toBeVisible();
      await noHorizontalScroll(page, 'candidature');
    });

    test('ma candidature : une ligne (poste + statut), « Modifier » ouvre le formulaire, « Retirer » pendant les candidatures', async ({ page }) => {
      await mockElectionApi(page, 'candidacy-mine', lang);
      await open(page);
      await expectAboveTheFold(page, 'candidacy-card');
      await expect(page.getByTestId('my-status')).toBeVisible();
      await expect(page.getByTestId('withdraw')).toBeVisible();
      await expect(page.locator('#statement')).toHaveCount(0); // formulaire replié
      await page.getByTestId('edit-candidacy').click();
      await expect(page.locator('#statement')).toBeVisible();
      await noHorizontalScroll(page, 'modifier');
    });

    test('examen des candidatures (fermées) : plus de « Modifier » ni de « Retirer »', async ({ page }) => {
      await mockElectionApi(page, 'review', lang);
      await open(page);
      await expectAboveTheFold(page, 'candidacy-card');
      await expect(page.getByTestId('my-status')).toBeVisible();
      await expect(page.getByTestId('edit-candidacy')).toHaveCount(0);
      await expect(page.getByTestId('withdraw')).toHaveCount(0);
    });

    test('résultats publiés : les élus sont affichés ; sous 3 votants le détail est masqué', async ({ page }) => {
      await mockElectionApi(page, 'results', lang);
      await open(page);
      await expect(page.getByTestId('results-card')).toBeVisible();
      await expect(page.getByTestId('winner')).toHaveCount(2);
      const first = await page.getByTestId('winner').first().boundingBox();
      expect(first!.y + first!.height).toBeLessThanOrEqual(VIEWPORT_HEIGHT); // le premier élu est dans le premier écran
      await noHorizontalScroll(page, 'résultats');
    });

    test('candidats : cartes compactes (photo ou initiale, nom, poste, programme), dépliées pendant les candidatures', async ({ page }) => {
      await mockElectionApi(page, 'candidacy-mine', lang);
      await open(page);
      await expect(page.getByTestId('candidates-fold')).toHaveAttribute('open', '');
      const card = page.getByTestId('cand-c1');
      await expect(card).toContainText('Omar Diallo');
      await expect(card.locator('img')).toBeVisible({ timeout: 15_000 }); // sa photo
      const h = (await card.boundingBox())!.height;
      expect(h).toBeLessThan(110); // compacte : une ligne de carte, pas un bloc de texte
      await expect(card.getByRole('button')).toBeVisible(); // lien « Programme »
    });

    test('frise des phases : une seule ligne, quatre phases, la phase actuelle est marquée et colorée', async ({ page }) => {
      const expected: [Phase, string][] = [['candidacy-mine', 'candidacy'], ['review', 'review'], ['voting', 'voting'], ['closed', 'results'], ['results', 'results']];
      for (const [phase, current] of expected) {
        await mockElectionApi(page, phase, lang);
        await open(page);
        const items = page.getByTestId('phases').locator('li');
        await expect(items).toHaveCount(4);
        const tops = await items.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
        expect(new Set(tops).size, `${phase} : même ligne`).toBe(1);
        await expect(page.getByTestId(`phase-${current}`)).toHaveAttribute('aria-current', 'step');
        const colors = await items.evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
        const index = ['candidacy', 'review', 'voting', 'results'].indexOf(current);
        expect(colors.filter((c, i) => i !== index && c === colors[index])).toEqual([]); // seule la phase actuelle est en couleur
        await page.unrouteAll();
      }
    });

    test('bug « badge ouvert + alerte pas ouvert » : la page périmée se recharge, badge et alerte disent la même chose', async ({ page }) => {
      const mock = await mockElectionApi(page, 'candidacy-mine', lang);
      await open(page);
      await expect(page.getByTestId('status-badge')).toContainText(TEXT[lang].open);
      // Pendant que la page est ouverte, le comité ferme les candidatures : le retrait est refusé (409).
      mock.status = 'CANDIDACY_CLOSED';
      mock.candidacyError = { status: 409, message: 'candidacy_not_open' };
      await page.getByTestId('withdraw').click();
      await page.locator('.modal-footer .btn-danger').click();
      await expect(page.getByTestId('page-error')).toContainText(TEXT[lang].notOpen);
      await expect(page.getByTestId('status-badge')).not.toContainText(TEXT[lang].open); // plus jamais les deux ensemble
      await expect(page.getByTestId('withdraw')).toHaveCount(0);
      await expect(page.getByTestId('phase-review')).toHaveAttribute('aria-current', 'step');
    });

    test('candidatures « ouvertes » mais hors période : aucun bouton proposé, message clair, pas d’alerte', async ({ page }) => {
      const mock = await mockElectionApi(page, 'candidacy-none', lang);
      const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
      mock.datesOverride = { candidacyStartsAt: day(2), candidacyEndsAt: day(9), votingStartsAt: day(11), votingEndsAt: day(12) };
      await open(page);
      await expect(page.getByTestId('outside-window')).toBeVisible();
      await expect(page.getByTestId('start-apply')).toHaveCount(0);
      await expect(page.getByTestId('page-error')).toHaveCount(0);
    });
  });
}
