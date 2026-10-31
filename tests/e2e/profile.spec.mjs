// Baseline profile (specs/22 §4 `profile`). Closed until results_open; then Part 1 / 2 / 3 sections
// and the two IDP gaps. The learner never sees an item-level manager rating, only charter means and
// flags. Real: T007 has done all three parts and T010 rated them; results are opened with
// /__dev/config and the profiles built with /__dev/build. Mock: DEMO-L (results already open).
import { test, expect } from './helpers/hub.mjs';
import { enText } from './helpers/inspect.mjs';

const CHARTER_KEYS = ['flags', 'index', 'mgr_mean', 'name_en', 'name_vi', 'self_mean', 'sjt_band'];

test.describe('Baseline v2 · profile', () => {
  test('closed until results are published', async ({ page, hub }) => {
    expect(await hub.signIn(hub.account('profile'))).toBe('dash');
    if (hub.isMock) { await hub.setSwitch('results_open', 'FALSE'); await page.reload(); }
    await hub.goto('profile.html');
    await expect(page.locator('h1')).toHaveText(enText('profile.closed_title'));
    expect(hub.last('profile').error.code).toBe('not_open');
    const me = await hub.callApi('me');
    expect(me.baseline.results_open).toBe(false);
    expect(me.baseline.profile_ready).toBe(false);
  });

  test('once published: Part 1, 2 and 3 sections and the two largest gaps; no item-level manager ratings', async ({ page, hub }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await hub.signIn(hub.account('profile'))).toBe('dash');
    if (hub.isReal) {
      await hub.setSwitch('results_open', 'TRUE');
      await hub.build('profiles');
    }
    await hub.goto('profile.html');
    await expect(page.locator('.pf h1')).toHaveText(enText('profile.title'));
    const p = hub.last('profile');
    expect(p.ok).toBe(true);
    for (const k of ['p1', 'p2', 'p3']) expect(p[k], `${k} present`).toBeTruthy();
    await expect(page.locator('#pf-p1')).toHaveText(enText('profile.p1_title'));
    await expect(page.locator('#pf-p2')).toHaveText(enText('profile.p2_title'));
    await expect(page.locator('#pf-p3')).toHaveText(enText('profile.p3_title'));
    expect(p.gaps).toHaveLength(2);
    await expect(page.locator('.pf-gap-list li')).toHaveCount(2);
    for (const g of p.gaps) await expect(page.locator('.pf-gap-list')).toContainText(g.name_en || g.area);
    await expect(page.getByText(enText('profile.gaps_idp'))).toBeVisible();

    // the manager's ratings reach the learner only as charter means and flags
    for (const [k, c] of Object.entries(p.p2.by_charter)) expect(Object.keys(c).sort(), `charter ${k}`).toEqual(CHARTER_KEYS);
    for (const d of p.p2.top_dev) expect(Object.keys(d).sort()).toEqual(['item_id', 'text_en', 'text_vi']);
    expect(JSON.stringify(p)).not.toMatch(/"(values|ratings|rater_code|value)"\s*:/);
    expect(hub.payloads('rate_get')).toHaveLength(0);
    const own = await hub.callApi('rate_get', { ratee: hub.account('profile') });
    expect(own.ok).toBe(false);
    expect(own.error.code).toBe('forbidden');
    // the home page links to the profile now
    const me = await hub.callApi('me');
    expect(me.baseline.results_open).toBe(true);
    expect(me.baseline.profile_ready).toBe(true);
  });
});
