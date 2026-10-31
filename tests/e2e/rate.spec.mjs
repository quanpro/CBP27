// Manager rating (specs/22 §3–4: rate_list, rate_get, rate_save). A manager rates a report's
// behaviours 1–4 or N/A; values are saved as they go and are there after a reload; a person who is not
// a report is refused; while rating_open is FALSE the page is read-only and the statements are refused.
// Real: T010 rates T001 (reports T001–T003 and T007). Mock: DEMO-M rates DEMO-N (DEMO-L is already rated).
import { test, expect } from './helpers/hub.mjs';
import { enText } from './helpers/inspect.mjs';

const ratee = (hub) => (hub.isMock ? 'DEMO-N' : 'T001');
const notMine = (hub) => (hub.isMock ? 'DEMO-M' : 'T005'); // not a report of the rater

test.describe('Baseline v2 · manager rating', () => {
  test('a manager rates a report (1–4 and N/A); the values are there after a reload', async ({ page, hub }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await hub.signIn(hub.account('manager'))).toBe('dash');
    await hub.goto('rate.html');
    await expect(page.locator('.rt h1')).toHaveText(enText('rate.title'));
    const list = hub.last('rate_list');
    expect(list.open).toBe(true);
    const row = list.reports.find((r) => r.code === ratee(hub));
    expect(row, 'the report is listed').toBeTruthy();
    for (const r of list.reports) expect(Object.keys(r).sort()).toEqual(['code', 'first_name', 'role_area', 'saved_at', 'status']);

    await page.locator(`[data-fk="row|${ratee(hub)}"]`).click();
    if (row.status === 'not_started') { // the rater guide comes first
      await expect(page.locator('#rt-guide-h')).toHaveText(enText('rate.guide_title'));
      await page.locator('[data-fk="start"]').click();
    }
    const got = await hub.waitForRecord('rate_get', (d) => d.ok);
    const items = got.items;
    expect(items.length).toBeGreaterThan(2);
    await expect(page.locator('.rt .bl2-rate')).toHaveCount(items.length);
    // every statement offers 1–4 and N/A
    await expect(page.locator(`[data-fk="v|${items[0].item_id}|NA"]`)).toBeVisible();

    const want = {};
    items.forEach((it, i) => { want[it.item_id] = i === 1 ? 'NA' : 1 + (i % 4); });
    for (const it of items) await page.locator(`[data-fk="v|${it.item_id}|${want[it.item_id]}"]`).click();
    const saved = await hub.waitForRecord('rate_save', (d) => d.ok && d.complete === true);
    expect(saved.saved_at).toBeTruthy();
    await expect(page.locator('.rt-status').first()).toContainText('Saved');

    await page.reload();
    await expect(page.locator('.rt .bl2-rate')).toHaveCount(items.length);
    const back = hub.last('rate_get');
    expect(back.values).toEqual(want);
    for (const it of items) await expect(page.locator(`[data-fk="v|${it.item_id}|${want[it.item_id]}"]`)).toHaveAttribute('aria-pressed', 'true');
    expect((await hub.callApi('rate_list')).reports.find((r) => r.code === ratee(hub)).status).toBe('complete');
  });

  test('someone who is not your report is refused; a learner gets the "for managers" page', async ({ page, hub }) => {
    expect(await hub.signIn(hub.account('manager'))).toBe('dash');
    const r = await hub.callApi('rate_get', { ratee: notMine(hub) });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe('forbidden');
    const w = await hub.callApi('rate_save', { ratee: notMine(hub), values: {} });
    expect(w.ok).toBe(false);
    expect(w.error.code).toBe('forbidden');
    // a learner
    await page.evaluate(() => { sessionStorage.removeItem('hub.session'); localStorage.removeItem('hub.session'); });
    expect(await hub.signIn(hub.account(hub.isMock ? 'profile' : 'shell'))).toBe('dash');
    await hub.goto('rate.html');
    await expect(page.locator('h1')).toHaveText(enText('rate.forbidden_title'));
    expect((await hub.callApi('rate_list')).error.code).toBe('forbidden');
  });

  test('while rating is closed the list is read-only and the statements are refused', async ({ page, hub }) => {
    expect(await hub.signIn(hub.account('manager'))).toBe('dash');
    await hub.setSwitch('rating_open', 'FALSE');
    await hub.goto('rate.html');
    await expect(page.getByText(enText('rate.closed_title'))).toBeVisible();
    expect(hub.last('rate_list').open).toBe(false);
    const g = await hub.callApi('rate_get', { ratee: ratee(hub) });
    expect(g.ok).toBe(false);
    expect(g.error.code).toBe('not_open');
    const s = await hub.callApi('rate_save', { ratee: ratee(hub), values: {} });
    expect(s.error.code).toBe('not_open');
  });
});
