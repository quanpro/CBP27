// Step 6 (specs/17): team picture. Small groups (n < min_n) never appear; the page shows exactly the
// groups the server returned; managers see passed / not yet / not started for their reports, no scores.
// Real fixture roster (backend/tests/fixtures.js devRoster): demand = T001, T005 (n = 2; T010 is a
// manager and never counted), supply = T002, T006 (n = 2), materials = T003, cs = T004, T030.
import { test, expect } from './helpers/hub.mjs';
import { readFileSync } from 'node:fs';
import * as dev from './helpers/devapi.mjs';

const EN_TEAM = JSON.parse(readFileSync(new URL('../../docs/i18n/en.json', import.meta.url), 'utf8')).team;
const TEAM_N = EN_TEAM.n;
const STATUSES = ['passed', 'not_yet', 'needs_chat', 'not_started'];

const N_LABEL = (n) => TEAM_N.replace('{n}', String(n));
const GROUP_LABEL = { all: 'Whole team', demand: 'Demand planning', supply: 'Supply planning', materials: 'Materials planning', cs: 'Customer service' };

/** Real only: give the team view something to average — baselines for T001, T002, T005 (T006 takes its own in baseline.spec). */
async function seedBaselines() {
  for (const code of ['T001', 'T002', 'T005']) {
    const token = await dev.token(code);
    const s = await dev.call('start', { token, assessment: 'baseline' });
    if (!s.ok) { if (s.error.code === 'already_submitted') continue; throw new Error(`baseline start ${code}: ${s.error.code}`); }
    const r = await dev.call('submit', { token, attempt_id: s.attempt_id, answers: dev.answersFor(s.items, 20), self_ratings: dev.selfRatings(2) });
    if (!r.ok) throw new Error(`baseline submit ${code}: ${r.error.code}`);
  }
}

/** Real only: a not-yet (T001) and a pass (T003) on A2 for the manager's gate table. */
async function seedCheckpoints() {
  for (const [code, right] of [['T001', 0], ['T003', 9]]) {
    const token = await dev.token(code);
    const s = await dev.call('start', { token, assessment: 'checkpoint', course: 'A2' });
    if (!s.ok) continue; // already done in this server's life
    await dev.call('submit', { token, attempt_id: s.attempt_id, answers: dev.answersFor(s.items, right) });
  }
}

test.describe('Step 6 · team picture', () => {
  test('shows only the groups the server returned; groups under min_n never appear', async ({ page, hub }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    if (hub.isReal) await seedBaselines();
    expect(await hub.signIn(hub.account('manager'))).toBe('dash');
    await hub.goto('team.html');
    await expect(page.locator('#heat-title')).toBeVisible();
    await expect(page.locator('#app .skeleton')).toHaveCount(0);
    const ts = hub.last('team_summary');
    expect(ts.ok).toBe(true);
    expect(ts.min_n).toBe(3);
    for (const g of [...ts.baseline, ...ts.checkpoints]) expect(g.n, `${g.group} n`).toBeGreaterThanOrEqual(ts.min_n);
    if (hub.isReal) {
      // demand and supply have 2 counted people each: left out of both lists
      for (const list of [ts.baseline, ts.checkpoints]) expect(list.map((g) => g.group).filter((g) => g !== 'all')).toEqual([]);
    }
    // the heatmap rows are exactly the returned baseline groups, in order
    const rows = page.locator('table.heat tbody tr th[scope="row"] .g-name');
    if (ts.baseline.length) {
      await expect(rows).toHaveText(ts.baseline.map((g) => GROUP_LABEL[g.group]));
      await expect(page.locator('table.heat tbody tr th[scope="row"] .g-n')).toHaveText(ts.baseline.map((g) => N_LABEL(g.n)));
    } else {
      await expect(page.locator('table.heat')).toHaveCount(0);
      await expect(page.getByText('No team picture yet')).toBeVisible();
    }
    // the checkpoint table offers exactly the returned groups
    const cpGroups = ts.checkpoints.map((g) => g.group);
    if (cpGroups.length > 1) await expect(page.locator('#cpg-all').locator('xpath=..').locator('button')).toHaveCount(cpGroups.length);
    else await expect(page.locator('[id^="cpg-"]')).toHaveCount(0);
    for (const label of Object.entries(GROUP_LABEL).filter(([g]) => !ts.baseline.some((x) => x.group === g)).map(([, l]) => l)) {
      await expect(page.locator('table.heat tbody'), `${label} is not shown`).not.toContainText(label);
    }
  });

  test('baseline averages are not published while the window is open, and are after it closes (F21)', async ({ page, hub }) => {
    test.skip(hub.isMock, 'the demo mock always reports a published wave');
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedBaselines();
    const code = hub.account('manager');
    expect(await hub.signIn(code)).toBe('dash');
    await hub.goto('team.html');
    await expect(page.locator('#heat-title')).toBeVisible();
    await expect(page.locator('#app .skeleton')).toHaveCount(0);
    let ts = hub.last('team_summary');
    expect(ts.baseline_published).toBe(false);
    expect(ts.baseline).toEqual([]);
    expect(ts.checkpoints).toEqual([]); // no course has passed its late window yet
    const me = hub.last('me');
    expect(ts.baseline_publish_after).toBe(me.baseline.open_to);
    await expect(page.getByText('No team picture yet')).toBeVisible();
    // past the window (+ timer + grace) the wave is published; groups shown are never under min_n
    const hours = Math.ceil((Date.parse(`${me.baseline.open_to}T23:59:59+07:00`) - Date.parse(me.server_now)) / 3600000) + 2;
    await hub.moveServerClock(hours);
    await page.reload();
    await hub.reauthIfAsked(code);
    await expect(page.locator('#app .skeleton')).toHaveCount(0);
    ts = hub.last('team_summary');
    expect(ts.baseline_published).toBe(true);
    for (const g of ts.baseline) expect(g.n).toBeGreaterThanOrEqual(ts.min_n);
    expect(ts.baseline.map((g) => g.group).filter((g) => g === 'demand' || g === 'supply')).toEqual([]);
  });

  test('after publication, a group of 2 stays hidden while the whole team (n ≥ 3) is shown', async ({ page, hub }) => {
    test.skip(hub.isMock, 'the demo mock returns fixed groups');
    // The Hub reads averages from the Summary tab, which only buildSummary() fills (admin menu or the
    // hourly trigger). The dev server has no way to run it yet, so the published rows stay empty here;
    // backend/tests/api.test.js covers the suppression itself.
    test.fixme(true, 'TODO: needs a dev-server hook (e.g. POST /__dev/build-summary) that runs buildSummary()');
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedBaselines();
    const code = hub.account('manager');
    expect(await hub.signIn(code)).toBe('dash');
    await hub.goto('team.html');
    const me = hub.last('me');
    const hours = Math.ceil((Date.parse(`${me.baseline.open_to}T23:59:59+07:00`) - Date.parse(me.server_now)) / 3600000) + 2;
    await hub.moveServerClock(hours);
    await fetch(`http://127.0.0.1:${dev.PORT}/__dev/build-summary`, { method: 'POST' });
    await page.reload();
    await hub.reauthIfAsked(code);
    await expect(page.locator('table.heat')).toBeVisible();
    const ts = hub.last('team_summary');
    expect(ts.baseline.map((g) => g.group)).toEqual(['all']); // demand (2) and supply (2) hidden
    await expect(page.locator('table.heat tbody tr')).toHaveCount(1);
    await expect(page.locator('table.heat tbody')).not.toContainText('Demand planning');
  });
});

test.describe('Step 6 · manager gate status', () => {
  test('a manager sees passed / not yet / not started for each report, never a score', async ({ page, hub }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    if (hub.isReal) await seedCheckpoints();
    expect(await hub.signIn(hub.account('manager'))).toBe('dash');
    await hub.goto('team.html#gates');
    const gates = page.locator('#gates');
    await expect(gates.locator('.status-table')).toBeVisible();
    const st = hub.last('team_status');
    expect(st.ok).toBe(true);
    expect(st.reports.length).toBeGreaterThan(0);
    for (const r of st.reports) {
      expect(Object.keys(r).sort()).toEqual(['baseline', 'code', 'courses', 'first_name']);
      expect(['done', 'not_done']).toContain(r.baseline);
      for (const v of Object.values(r.courses)) expect(STATUSES).toContain(v);
    }
    const cells = (await gates.locator('.status-table tbody td .chip').allTextContents()).map((c) => c.trim());
    const allowed = [...STATUSES, 'bl_done', 'bl_not'].map((k) => EN_TEAM.gs[k]).filter(Boolean);
    expect(cells.filter((c) => !allowed.includes(c))).toEqual([]);
    expect(cells).toContain(EN_TEAM.gs.passed);
    expect(cells.some((c) => c === EN_TEAM.gs.not_yet || c === EN_TEAM.gs.needs_chat)).toBe(true);
    const text = await gates.innerText();
    expect(text, 'no percentage anywhere in the gate view').not.toContain('%');
    expect(await gates.locator('.status-table tbody').innerText()).not.toMatch(/\b\d{1,3}\s*\/\s*10\b/);
    await expect(gates.locator('.status-table tbody tr')).toHaveCount(st.reports.length);
  });

  test('a manager reopens a third try after the coaching chat (unlock_retake)', async ({ page, hub }) => {
    test.fixme(hub.isMock, 'TODO(final pass): demo seed v2 with unlock_retake in the mock has not landed yet');
    const course = hub.course('unlock');
    const learner = hub.account('capstone'); // reports to the manager account (DEMO-L → DEMO-M, T001 → T010)
    await hub.goto('index.html');
    const login = async (code) => {
      const r = await hub.callApi('login', { code, pin: hub.pin }, '');
      expect(r.ok, `${code} signs in`).toBe(true);
      if (r.profile.consent_needed) await hub.callApi('consent', {}, r.token);
      return r.token;
    };
    let lt = await login(learner);
    if (hub.isReal) {
      // two failed attempts, 24 h apart → the third needs a chat
      for (let i = 0; i < 2; i += 1) {
        if (i) { await hub.moveServerClock(24); lt = await login(learner); }
        const s = await hub.callApi('start', { assessment: 'checkpoint', course }, lt);
        expect(s.ok, `attempt ${i + 1} starts`).toBe(true);
        await hub.callApi('submit', { attempt_id: s.attempt_id, answers: dev.answersFor(s.items, 0) }, lt);
      }
      await hub.moveServerClock(24);
      lt = await login(learner);
    }
    const blocked = await hub.callApi('start', { assessment: 'checkpoint', course }, lt);
    expect(blocked.ok).toBe(false);
    expect(blocked.error.code).toBe('unlock_needed');

    const mt = await login(hub.account('manager'));
    let st = await hub.callApi('team_status', {}, mt);
    expect(st.reports.find((r) => r.code === learner).courses[course]).toBe('needs_chat');
    const other = await login(hub.account('shell'));
    if (hub.isReal) expect((await hub.callApi('unlock_retake', { code: learner, course, note: 'x' }, other)).error.code).toBe('forbidden');
    const ok = await hub.callApi('unlock_retake', { code: learner, course, note: 'Talked through objectives 2 and 4.' }, mt);
    expect(ok.ok).toBe(true);
    st = await hub.callApi('team_status', {}, mt);
    expect(st.reports.find((r) => r.code === learner).courses[course]).toBe('not_yet');

    const third = await hub.callApi('start', { assessment: 'checkpoint', course }, lt);
    expect(third.ok).toBe(true);
    expect(third.attempt_no).toBe(3);
    void page;
  });

  test('the manager records the chat from the gate table ("I\'ve had the chat")', async ({ page, hub }) => {
    test.fixme(true, 'TODO(final pass): the team.html unlock button is being built by the polish agent');
    void page; void hub;
  });

  test('a learner who is not a manager has no gate view, and the server refuses team_status', async ({ page, hub }) => {
    expect(await hub.signIn(hub.account('shell'))).toBe('dash');
    await hub.goto('team.html');
    await expect(page.locator('#heat-title')).toBeVisible();
    await expect(page.locator('#gates')).toHaveCount(0);
    expect(hub.payloads('team_status')).toHaveLength(0);
    const r = await hub.callApi('team_status');
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe('forbidden');
  });
});
