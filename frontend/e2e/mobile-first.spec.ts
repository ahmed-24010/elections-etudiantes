import { expect, test } from '@playwright/test';

// D-37 : contrôles mobiles sur les pages publiques. Les écrans de vote y seront ajoutés au Sprint 5.
for (const path of ['/login', '/register']) {
  test.describe(`page ${path}`, () => {
    test('aucun défilement horizontal', async ({ page }) => {
      await page.goto(path);
      await page.locator('input').first().waitFor();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test('champs ≥ 16 px (pas de zoom iOS) et cibles tactiles ≥ 44 px', async ({ page }) => {
      await page.goto(path);
      await page.locator('input').first().waitFor();
      const small = await page.evaluate(() => {
        const bad: string[] = [];
        for (const el of Array.from(document.querySelectorAll('input:not([type=hidden]), select, textarea'))) {
          if (parseFloat(getComputedStyle(el).fontSize) < 16) bad.push(`police ${el.tagName}#${el.id}`);
        }
        for (const el of Array.from(document.querySelectorAll('button, input[type=submit], input[type=checkbox], input[type=radio]'))) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && (r.height < 44 || r.width < 44)) bad.push(`cible ${el.tagName}#${el.id} ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        return bad;
      });
      expect(small).toEqual([]);
    });
  });
}
