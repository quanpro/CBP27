// Guidance (specs/19 F30): the "What to do here" box on every page, and the first-visit tours of
// My learning, the course page and the baseline (replayed from "Show me around" in the user menu).
import { test, expect } from './helpers/hub.mjs';
import { PAGES, openPage, waitReady } from './helpers/pages.mjs';

/** Tours on: the harness marks them seen unless the window is named "tours" (helpers/hub.mjs). */
async function toursOn(hub) {
  await hub.goto('index.html');
  await hub.page.evaluate(() => { window.name = 'tours'; ['home', 'course', 'baseline'].forEach((k) => localStorage.removeItem(`hub.tour.${k}`)); });
}

test.describe('What to do here', () => {
  test('every signed-in page has the box: this page, now (from your status) and next', async ({ page, hub }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    const signedIn = new Set();
    for (const p of PAGES.filter((x) => x.name !== 'about')) {
      await openPage(hub, p, signedIn);
      const box = page.locator('.guide').first();
      await expect(box, p.name).toBeVisible();
      await expect(box.locator('dt').first()).toHaveText('This page');
      await expect(box.locator('dd').first()).not.toHaveText('');
    }
  });

  test('folds away, stays folded after a reload, and unfolds again', async ({ page, hub }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await hub.signIn(hub.account('shell'))).toBe('dash');
    const box = page.locator('.guide[data-guide="home"]');
    const toggle = box.locator('.guide-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(box.locator('.guide-now dd')).toContainText(/\S/);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(box.locator('.guide-body')).toBeHidden();
    await page.reload();
    await waitReady(page, '#courses-title');
    await expect(page.locator('.guide[data-guide="home"] .guide-toggle')).toHaveAttribute('aria-expanded', 'false');
    await page.locator('.guide[data-guide="home"] .guide-toggle').click();
    await expect(page.locator('.guide[data-guide="home"] .guide-body')).toBeVisible();
  });

  test('baseline: the chooser says what to do now, and each part says what it measures', async ({ page, hub }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await hub.signIn(hub.account('baseline'))).toBe('dash');
    await hub.goto('baseline.html');
    await waitReady(page, '#bl-title');
    await expect(page.locator('.guide[data-guide="baseline"] .guide-now dd')).toContainText(/Part \d|No part is open|All three parts/);
    await expect(page.locator('.bl2-tile-measures')).toHaveText([/Think/, /Lead/, /Plan/]);
  });
});

test.describe('Tours', () => {
  test('My learning: starts on the first visit, steps with Next and Back, Esc ends it for good', async ({ page, hub }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await toursOn(hub);
    expect(await hub.signIn(hub.account('shell'))).toBe('dash');
    const pop = page.locator('.tour-pop[role="dialog"]');
    await expect(pop).toBeVisible();
    await expect(pop).toBeFocused();
    await expect(pop.locator('.tour-count')).toHaveText(/^1 of \d$/);
    await expect(pop.locator('.tour-title')).toHaveText('Your next step');
    await pop.getByRole('button', { name: 'Next' }).click();
    await expect(pop.locator('.tour-count')).toHaveText(/^2 of /);
    await pop.getByRole('button', { name: 'Back' }).click();
    await expect(pop.locator('.tour-count')).toHaveText(/^1 of /);
    // Tab stays inside the card
    for (let i = 0; i < 4; i += 1) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement.closest('.tour-pop'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    await expect(page.locator('.tour-ring')).toHaveCount(0);
    await page.reload();
    await waitReady(page, '#courses-title');
    await page.waitForTimeout(700);
    await expect(page.locator('.tour-pop')).toHaveCount(0);
  });

  test('"Show me around" replays the tour of the page; the last stop says Got it', async ({ page, hub }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await hub.signIn(hub.account('shell'))).toBe('dash');
    await page.locator('.user-btn').click();
    await page.getByRole('menuitem', { name: 'Show me around' }).click();
    const pop = page.locator('.tour-pop');
    await expect(pop).toBeVisible();
    const total = Number((await pop.locator('.tour-count').textContent()).split(' of ')[1]);
    for (let i = 1; i < total; i += 1) await pop.getByRole('button', { name: 'Next' }).click();
    await expect(pop.getByRole('button', { name: 'Got it' })).toBeVisible();
    await pop.getByRole('button', { name: 'Got it' }).click();
    await expect(pop).toHaveCount(0);
  });

  test('course page and baseline have their own first-visit tours; a phone shows the card as a sheet', async ({ page, hub }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await toursOn(hub);
    await page.evaluate(() => localStorage.setItem('hub.tour.home', 'done'));
    expect(await hub.signIn(hub.account('shell'))).toBe('dash');
    const me = hub.last('me');
    const open = me.courses.find((c) => c.open);
    await hub.goto(`course.html?c=${open.code}`);
    await waitReady(page, '#course-title');
    const pop = page.locator('.tour-pop');
    await expect(pop).toBeVisible();
    await expect(pop).toHaveClass(/sheet/);
    await expect(pop.locator('.tour-title')).toHaveText('Five stages');
    await pop.getByRole('button', { name: 'Skip the tour' }).click();
    await expect(pop).toHaveCount(0);
    await hub.goto('baseline.html');
    await waitReady(page, '#bl-title');
    await expect(page.locator('.tour-pop .tour-title')).toHaveText('Three parts');
  });
});
