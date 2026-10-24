// Step 6 (specs/17): capstone form (SOI ≤ 60 words, https evidence, VND digits) and the panel
// (five scores + a comment, saved per judge, still there after a reload).
import { test, expect } from './helpers/hub.mjs';

const words = (n, w = 'word') => Array.from({ length: n }, (_, i) => `${w}${i + 1}`).join(' ');
const ownTeam = (hub) => (hub.isMock ? 'TEAM-DEMO' : 'TEAM1');      // the capstone account's team
const judgedTeam = (hub) => (hub.isMock ? 'TEAM-DEMO-2' : 'TEAM1'); // a team the judge is not on

async function switchAccount(hub, purpose) {
  await hub.page.evaluate(() => { sessionStorage.removeItem('hub.session'); localStorage.removeItem('hub.session'); });
  expect(await hub.signIn(hub.account(purpose))).toBe('dash');
}

test.describe('Step 6 · capstone', () => {
  test('SOI parts are limited to 60 words; a valid submission saves and is there after a reload', async ({ page, hub }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await hub.signIn(hub.account('capstone'))).toBe('dash');
    await hub.goto('capstone.html#pitch');
    const f = (k) => page.locator(`#cap-pitch-${k}`);
    await expect(f('soi_situation')).toBeVisible();
    const cap = hub.last('capstone_get');
    expect(cap.team.team_id).toBe(ownTeam(hub));

    // 61 words: live counter goes over, Save is refused in the page and on the server
    await f('soi_situation').fill(words(61));
    await expect(page.locator('#cap-pitch-soi_situation-cnt')).toHaveText('61 / 60 words · 1 over');
    await expect(page.locator('#cap-pitch-soi_situation-cnt')).toHaveClass(/over/);
    await page.locator('[data-fk="save"]').click();
    await expect(page.locator('.cap-summary')).toContainText('61 words — keep it to 60.');
    await expect(f('soi_situation')).toHaveAttribute('aria-invalid', 'true');
    expect(hub.payloads('capstone_submit')).toHaveLength(0);
    const server = await hub.callApi('capstone_submit', { stage: 'pitch', team_id: ownTeam(hub), fields: { project_title: 'x', soi_situation: words(61) } });
    expect(server.ok).toBe(false);
    expect(server.error.code).toBe('bad_request');
    const direct = hub.payloads('capstone_submit').length; // the call above; the page itself sent none

    // other checks: evidence must be https, value digits only (non-digits are dropped as you type)
    await f('evidence_url').fill('http://example.sharepoint.com/site/doc');
    await f('soi_situation').fill(words(60));
    await expect(page.locator('#cap-pitch-soi_situation-cnt')).toHaveText('60 / 60 words');
    await page.locator('[data-fk="save"]').click();
    await expect(page.locator('.cap-summary')).toContainText('Use a link that starts with https://');
    expect(hub.payloads('capstone_submit')).toHaveLength(direct);

    await f('evidence_url').fill('https://example.sharepoint.com/sites/team/doc');
    await f('soi_observation').fill(words(25, 'obs'));
    await f('soi_implication').fill(words(12, 'imp'));
    await f('kpi_name').fill('Fill rate');
    await f('kpi_before').fill('87');
    await f('kpi_after').fill('93');
    await f('kpi_unit').fill('%');
    await f('value_vnd').fill('1.250.000.000');
    await expect(f('value_vnd')).toHaveValue('1250000000');
    await f('value_basis').fill('Invented basis for the test.');
    await page.locator('[data-fk="save"]').click();
    await expect(page.getByText('Saved. The panel sees this version.')).toBeVisible();
    const saved = hub.last('capstone_submit');
    expect(saved.ok).toBe(true);
    expect(saved.submission.soi_situation).toBe(words(60));
    expect(saved.submission.value_vnd).toBe('1250000000');
    await expect(page.locator('.cap-summary')).toHaveCount(0);

    await page.reload();
    await expect(f('soi_situation')).toHaveValue(words(60));
    await expect(f('soi_observation')).toHaveValue(words(25, 'obs'));
    await expect(f('kpi_after')).toHaveValue('93');
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('hub.capdraft.')))).toEqual([]);
    await expect(page.locator('#cap-saved-line')).toContainText('Last saved by');
  });

  test('text from a submission is shown as text on the panel page (no HTML injection)', async ({ page, hub }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
    const payload = '<img src=x onerror="alert(1)"><b>bold</b>';
    expect(await hub.signIn(hub.account('capstone'))).toBe('dash');
    await hub.goto('capstone.html#capstone');
    await page.locator('#cap-capstone-project_title').fill(`Injection check ${payload}`);
    await page.locator('#cap-capstone-soi_situation').fill(payload);
    await page.locator('[data-fk="save"]').click();
    await expect(page.getByText('Saved. The panel sees this version.')).toBeVisible();

    await switchAccount(hub, 'panel');
    await hub.goto('panel.html#capstone');
    const card = page.locator(`#team-${ownTeam(hub)}`);
    await expect(card.locator('.pn-soi')).toContainText(payload);
    await expect(card.locator('.pn-title')).toHaveText(`Injection check ${payload}`);
    await expect(card.locator('.pn-soi img, .pn-title img, img[src="x"]')).toHaveCount(0);
    await expect(card.locator('b', { hasText: /^bold$/ })).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(dialogs).toEqual([]);
  });
});

test.describe('Step 6 · panel', () => {
  test('a judge saves five scores and a comment; they are still there after a reload', async ({ page, hub }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await hub.signIn(hub.account('panel'))).toBe('dash');
    await hub.goto('panel.html');
    const card = page.locator(`#team-${judgedTeam(hub)}`);
    await expect(card).toBeVisible();
    const pick = (c, n) => card.locator(`.pn-crit[data-crit="${c}"] .score-pick button`).nth(n - 1);
    const scores = { c1: 4, c2: 3, c3: 5, c4: 2, c5: 4 };
    for (const c of ['c1', 'c2', 'c3', 'c4']) await pick(c, scores[c]).click();
    await card.locator('button[type="submit"]').click();
    await expect(card.locator('.err')).toHaveText('Score all five criteria — 1 left.');
    expect(hub.payloads('panel_score')).toHaveLength(0);

    await pick('c5', scores.c5).click();
    const comment = 'Keep: the clear SOI. Change: show the KPI baseline period.';
    await card.locator('textarea').fill(comment);
    await card.locator('button[type="submit"]').click();
    await expect(page.getByText('Scores saved.')).toBeVisible();
    await expect(card.locator('.pn-status')).toContainText('Saved');
    const res = hub.last('panel_score');
    expect(res.ok).toBe(true);

    await page.reload();
    await expect(card).toBeVisible();
    for (const [c, n] of Object.entries(scores)) {
      await expect(pick(c, n)).toHaveAttribute('aria-pressed', 'true');
      await expect(card.locator(`.pn-crit[data-crit="${c}"] .score-pick button[aria-pressed="true"]`)).toHaveCount(1);
    }
    await expect(card.locator('textarea')).toHaveValue(comment);
    const mine = hub.last('panel_list').teams.find((t) => t.team_id === judgedTeam(hub)).my_score;
    expect(mine).toMatchObject({ ...scores, comment });
  });

  test('a judge cannot score a team they are a member of', async ({ page, hub }) => {
    test.skip(hub.isReal, 'no judge in the dev roster is on a team; the server rule is covered by backend/tests/api.test.js');
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await hub.signIn(hub.account('panel'))).toBe('dash');
    await hub.goto('panel.html');
    const own = 'TEAM-DEMO'; // DEMO-M is on this team
    const card = page.locator(`#team-${own}`);
    await expect(card).toBeVisible();
    for (const c of ['c1', 'c2', 'c3', 'c4', 'c5']) await card.locator(`.pn-crit[data-crit="${c}"] .score-pick button`).nth(2).click();
    await card.locator('button[type="submit"]').click();
    await expect(card.locator('.pn-status')).toHaveClass(/is-bad/);
    const res = hub.last('panel_score');
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('forbidden');
  });

  test('people without the panel role get the "for the panel" page and no Panel link', async ({ page, hub }) => {
    expect(await hub.signIn(hub.account('capstone'))).toBe('dash');
    await expect(page.locator('.nav-primary a[href="panel.html"]')).toHaveCount(0);
    await hub.goto('panel.html');
    await expect(page.getByText('This page is for the panel')).toBeVisible();
    expect(hub.payloads('panel_list')).toHaveLength(0);
    const r = await hub.callApi('panel_list', { stage: 'pitch' });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe('forbidden');
  });
});
