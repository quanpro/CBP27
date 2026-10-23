// Accessibility: axe (WCAG 2 A + AA) on every signed-in page, at 360 and 1280 px, light and dark.
// Fails on serious or critical violations. Also covers the sign-in page, the onboarding gates and a
// quiz question screen.
import { test, expect } from './helpers/hub.mjs';
import { PAGES, openPage, waitReady } from './helpers/pages.mjs';
import { axeSerious } from './helpers/inspect.mjs';

const WIDTHS = [360, 1280];
const THEMES = ['light', 'dark'];

for (const width of WIDTHS) {
  for (const theme of THEMES) {
    test.describe(`a11y · ${width}px · ${theme}`, () => {
      test.use({ viewport: { width, height: width < 600 ? 780 : 900 }, colorScheme: theme });

      test('sign-in page', async ({ page, hub }) => {
        await hub.goto('index.html');
        await waitReady(page, '#login-code');
        expect(await axeSerious(page)).toEqual([]);
      });

      test('every signed-in page', async ({ page, hub }) => {
        test.setTimeout(120_000);
        const signedIn = new Set();
        const found = [];
        for (const p of PAGES) {
          await openPage(hub, p, signedIn);
          await hub.setTheme(theme);
          for (const v of await axeSerious(page)) found.push(`${p.name}: ${v}`);
        }
        // a quiz question screen (paged on phones, list on desktop)
        await openPage(hub, { as: 'manager', path: 'quiz.html?type=predict&c=A2', ready: '#qz-intro-title' }, signedIn);
        await page.locator('.qz-intro .btn-primary').click();
        await expect(page.locator('.qz-run fieldset.qz-q').first()).toBeVisible();
        for (const v of await axeSerious(page)) found.push(`quiz questions: ${v}`);
        expect(found).toEqual([]);
      });

      test('onboarding gates (own PIN, privacy notice)', async ({ page, hub }) => {
        test.skip(hub.isReal, 'the one real newcomer account is used by onboarding.spec; the gates are the same markup');
        expect(await hub.signIn(hub.account('onboarding'), { consent: false })).toBe('pin');
        expect(await axeSerious(page), 'PIN gate').toEqual([]);
        await page.locator('#pin-old').fill(hub.pin);
        await page.locator('#pin-new').fill('135792');
        await page.locator('#pin-rep').fill('135792');
        await page.locator('.onboard form button[type="submit"]').click();
        expect(await hub.homeView()).toBe('consent');
        expect(await axeSerious(page), 'privacy gate').toEqual([]);
      });
    });
  }
}
