// Load speed (live backend only; the demo answers instantly and keeps no copy):
// - the last `me` of the tab draws home and course pages at once while the fresh one is on its way,
// - a ticked episode is kept in that copy, any other change drops it, signing out removes it,
// - the sign-in page wakes the web app with one GET of the health check.
import { test, expect } from './helpers/hub.mjs';
import { PAGE_API } from './helpers/devapi.mjs';

const ME = 'hub.me';
const stored = (page) => page.evaluate((k) => { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch (e) { return null; } }, ME);

/** Holds every `me` request for `ms` before it reaches the backend (other actions pass straight on). */
async function slowMe(page, ms) {
  await page.route(PAGE_API, async (route) => {
    let action = '';
    try { action = JSON.parse(route.request().postData() || '{}').action; } catch (e) { /* not JSON */ }
    if (action === 'me') await new Promise((r) => setTimeout(r, ms));
    await route.fallback();
  });
}

test.describe('load speed', () => {
  test.beforeEach(({ hub }) => { test.skip(!hub.isReal, 'live backend only: demo mode keeps no copy of `me`'); });

  test('home and course draw from the last data at once, then take the fresh data', async ({ page, hub }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await hub.signIn(hub.account('shell'))).toBe('dash');
    const me = hub.last('me');
    const course = me.courses.find((c) => c.open && c.episodes.length);
    expect(course, 'an open course with episodes').toBeTruthy();
    await expect.poll(() => stored(page).then((s) => !!(s && s.data && s.data.ok))).toBe(true);

    await slowMe(page, 4000);
    const before = hub.payloads('me').length;
    await hub.goto(`course.html?c=${course.code}`);
    // drawn from the copy well before the slow `me` comes back
    await expect(page.locator('#course-title')).toBeVisible({ timeout: 2500 });
    await expect(page.locator('#app .skeleton')).toHaveCount(0);
    expect(hub.payloads('me').length).toBe(before);
    await expect.poll(() => hub.payloads('me').length, { timeout: 10_000 }).toBeGreaterThan(before);
    await expect(page.locator('#course-title')).toBeVisible();

    const before2 = hub.payloads('me').length;
    await hub.goto('index.html');
    await expect(page.locator('.dash-head h1')).toBeVisible({ timeout: 2500 });
    expect(hub.payloads('me').length).toBe(before2);
    await expect.poll(() => hub.payloads('me').length, { timeout: 10_000 }).toBeGreaterThan(before2);
  });

  test('a ticked episode is kept in the copy; another change drops it; signing out removes it', async ({ page, hub }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await hub.signIn(hub.account('shell'))).toBe('dash');
    const course = hub.last('me').courses.find((c) => c.open && c.episodes.length);
    await hub.goto(`course.html?c=${course.code}`);
    await expect(page.locator('#course-title')).toBeVisible();
    await expect.poll(() => hub.payloads('me').length).toBeGreaterThan(1);

    const watchedIn = async () => {
      const s = await stored(page);
      const c = s && s.data.courses.find((x) => x.code === course.code);
      return c ? c.episodes.filter((e) => e.watched).map((e) => e.ep) : null;
    };
    const was = await watchedIn();
    expect(was).not.toBeNull();
    const toggle = page.locator('.eps-card button.tick').first();
    await toggle.click();
    await expect.poll(() => hub.payloads('watch').length).toBe(1);
    await expect.poll(watchedIn).not.toEqual(was);
    await toggle.click(); // put it back for the other tests on this account
    await expect.poll(() => hub.payloads('watch').length).toBe(2);
    await expect.poll(watchedIn).toEqual(was);

    await hub.setLang('vi'); // set_lang changes data on the server: the copy goes
    await expect.poll(() => stored(page)).toBeNull();
    await hub.setLang('en');

    await hub.goto('index.html');
    await expect(page.locator('.dash-head h1')).toBeVisible();
    await expect.poll(() => stored(page).then((s) => !!s)).toBe(true);
    await page.evaluate(async () => { const m = await import(`${location.origin}/js/api.js`); m.clearSession(); });
    expect(await stored(page)).toBeNull();
  });

  test('the sign-in page wakes the web app with one GET of the health check', async ({ page, hub }) => {
    const gets = [];
    page.on('request', (r) => { if (r.url().startsWith(PAGE_API) && r.method() === 'GET') gets.push(r.url()); });
    await hub.goto('index.html');
    await expect(page.locator('#login-code')).toBeVisible();
    await expect.poll(() => gets.length).toBe(1);
    await page.reload(); // at most once a minute per tab
    await expect(page.locator('#login-code')).toBeVisible();
    await page.waitForTimeout(500);
    expect(gets.length).toBe(1);
  });
});
