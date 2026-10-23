// Step 3 (specs/17): sign-in → My learning, EN/VI, 360 px, dark mode.
import { test, expect } from './helpers/hub.mjs';
import { ORDER } from './helpers/accounts.mjs';
import { PAGES, openPage, waitReady } from './helpers/pages.mjs';
import { expectFullyTranslated, horizontalOverflow, axeSerious, visibleStrings, rawKeys } from './helpers/inspect.mjs';

test.describe('Step 3 · shell', () => {
  test('sign-in shows My learning with the 10 courses in calendar order', async ({ page, hub }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const view = await hub.signIn(hub.account('shell'));
    expect(view).toBe('dash');
    const codes = await page.locator('.course-card .code-badge').allInnerTexts();
    expect(codes).toEqual(ORDER);
    // the greeting uses the first name from the profile, and the journey came from `me`
    const me = hub.last('me');
    expect(me.ok).toBe(true);
    expect(me.courses.map((c) => c.code)).toEqual(ORDER);
    await expect(page.locator('.dash-head h1')).toContainText(me.profile.first_name);
    // the signed-in shell: primary navigation and footer privacy line
    await expect(page.locator('.app-header .nav-primary a')).not.toHaveCount(0);
    await expect(page.locator('.app-footer a[href="about.html"]')).toBeVisible();
    if (hub.isMock) await expect(page.locator('.demo-banner')).toBeVisible();
    else await expect(page.locator('.demo-banner')).toHaveCount(0);
  });

  test('the sign-in page is fully translated and shows no raw keys', async ({ page, hub }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await hub.goto('index.html');
    await waitReady(page, '#login-code');
    await expectFullyTranslated(hub, 'sign-in');
  });

  for (const p of PAGES) {
    test(`EN/VI toggle changes every visible string · ${p.name}`, async ({ page, hub }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await openPage(hub, p);
      await expectFullyTranslated(hub, p.name);
      // the choice is remembered on this device
      await hub.setLang('vi');
      await page.reload();
      await waitReady(page, p.ready);
      await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
      expect(rawKeys(await visibleStrings(page))).toEqual([]);
    });
  }

  test('360 px: no horizontal scroll on any page, in EN and VI', async ({ page, hub }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 360, height: 780 });
    await hub.goto('index.html');
    await waitReady(page, '#login-code');
    expect(await horizontalOverflow(page), 'sign-in').toEqual([]);
    const signedIn = new Set();
    for (const p of PAGES) {
      await openPage(hub, p, signedIn);
      for (const lang of ['en', 'vi']) {
        await hub.setLang(lang);
        await page.waitForTimeout(100);
        expect(await horizontalOverflow(page), `${p.name} · ${lang}`).toEqual([]);
      }
      await hub.setLang('en');
    }
    // a quiz question screen (phones show one question at a time)
    await openPage(hub, { as: 'manager', path: 'quiz.html?type=predict&c=A2', ready: '#qz-intro-title' }, signedIn);
    await page.locator('.qz-intro .btn-primary').click();
    await expect(page.locator('.qz-run.is-paged fieldset.qz-q')).toHaveCount(1);
    for (const lang of ['en', 'vi']) {
      await hub.setLang(lang);
      expect(await horizontalOverflow(page), `quiz question · ${lang}`).toEqual([]);
    }
  });

  test('dark mode: data-theme and the dark tokens apply; system dark follows the OS', async ({ page, hub }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await hub.signIn(hub.account('shell'))).toBe('dash');
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await hub.setTheme('light');
    expect(await bg()).toBe('rgb(244, 246, 248)'); // --bg light #F4F6F8
    await hub.setTheme('dark');
    expect(await bg()).toBe('rgb(11, 22, 32)'); // --bg dark #0B1620
    await page.reload();
    await waitReady(page, '.course-card');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark'); // remembered, applied before paint
    await hub.setTheme('system');
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await bg()).toBe('rgb(11, 22, 32)');
    await page.emulateMedia({ colorScheme: 'light' });
    expect(await bg()).toBe('rgb(244, 246, 248)');
  });

  for (const theme of ['light', 'dark']) {
    test(`axe colour-contrast passes on key pages · ${theme}`, async ({ page, hub }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: 1280, height: 900 });
      const signedIn = new Set();
      for (const p of PAGES.filter((x) => ['home', 'course', 'quiz', 'team', 'about'].includes(x.name))) {
        await openPage(hub, p, signedIn);
        await hub.setTheme(theme);
        expect(await axeSerious(page, { rules: ['color-contrast'] }), `${p.name} · ${theme}`).toEqual([]);
      }
    });
  }
});
