// Baseline v2 (specs/22): three parts, each opened by an admin switch, once per part per wave, one
// timer per part, "Part N done" with no score. Part 1: sections A and B with free movement and the
// exhibits beside the question. Part 2: 2A situational judgement (most ≠ least) locked before the 2B
// statements are even sent. Part 3: ten course self-ratings first, glossary, CORE + role module.
// Real accounts: T006 sits all three parts, T005 runs out of time, T010 on a phone, T001 sees a closed
// part, T050 (admin, no role area) has no Part 3 module.
import { test, expect } from './helpers/hub.mjs';
import { enText, expectFullyTranslated } from './helpers/inspect.mjs';

const MODULE = { demand: 'DP', supply: 'SP', materials: 'RPM', cs: 'CS' };
const partName = (n) => enText(`baseline.part${n}.name`);
const doneTitle = (n) => enText('baseline.done_title').replace('{n}', String(n));

/** baseline.html?part=n → intro → Start (+ confirm unless resuming) → the start payload. */
async function openPart(hub, n, { resuming = false } = {}) {
  const { page } = hub;
  const before = hub.payloads('start').length;
  await hub.goto(`baseline.html?part=${n}`);
  await expect(page.locator('#bl-title')).toHaveText(partName(n));
  await page.locator('[data-fk="begin"]').click();
  if (!resuming) {
    await expect(page.locator('dialog.modal[open]')).toBeVisible();
    await page.locator('dialog.modal[open] .btn-primary').click();
  }
  await expect.poll(() => hub.payloads('start').length).toBeGreaterThan(before);
  const s = hub.last('start');
  expect(s.ok, `Part ${n} starts`).toBe(true);
  return s;
}

/** The single question card on screen and its item id. */
const card = (page) => page.locator('#app fieldset.qz-q');
async function pickOption(page, k = 0) {
  const c = card(page);
  await c.locator('label.opt').nth(k).click();
  await expect(c.locator('input:checked')).toHaveCount(1);
  return c.getAttribute('data-item');
}
async function submitFromReview(hub, n) {
  const { page } = hub;
  await expect(page.locator('#bl-rev-h')).toBeVisible();
  await page.locator('[data-fk="submit"]').click();
  await page.locator('dialog.modal[open] .btn-primary').click();
  await expect(page.locator('#bl-done-h')).toHaveText(doneTitle(n), { timeout: 20_000 });
  return hub.last('submit');
}
/** A sitting's result is "done" and the time used: never a score. */
function expectNoScore(res, n) {
  expect(res.ok).toBe(true);
  expect(res.part).toBe(n);
  expect(Object.keys(res).sort()).toEqual(['assessment', 'ok', 'part', 'server_now', 'submitted_at', 'time_used_s']);
}

test.describe('Baseline v2 · states', () => {
  test('without ?part= the page offers the three parts', async ({ page, hub }) => {
    expect(await hub.signIn(hub.account('blClosed'))).toBe('dash');
    await hub.goto('baseline.html');
    await expect(page.locator('#bl-title')).toHaveText(enText('baseline.chooser_title'));
    for (const n of [1, 2, 3]) await expect(page.getByText(partName(n)).first()).toBeVisible();
    const b = hub.last('me').baseline;
    expect(Object.keys(b.parts).sort()).toEqual(['p1', 'p2', 'p3']);
  });

  test('a part whose switch is off is closed ("opens when your admin starts it"), on the page and the server', async ({ page, hub }) => {
    expect(await hub.signIn(hub.account('blClosed'))).toBe('dash');
    await hub.setSwitch('p1_open', 'FALSE');
    await hub.goto('baseline.html?part=1');
    await expect(page.locator('h1')).toHaveText(enText('baseline.closed_title').replace('{name}', partName(1)));
    await expect(page.getByText('It opens when your admin starts it.')).toBeVisible();
    expect(hub.last('me').baseline.parts.p1.open).toBe(false);
    const r = await hub.callApi('start', { assessment: 'baseline_p1' });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe('not_open');
    // the other parts are unaffected
    await hub.goto('baseline.html?part=2');
    await expect(page.locator('#bl-title')).toHaveText(partName(2));
  });

  test('the v1 one-sitting baseline is gone (bad_request)', async ({ hub }) => {
    expect(await hub.signIn(hub.account('blClosed'))).toBe('dash');
    const r = await hub.callApi('start', { assessment: 'baseline' });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe('bad_request');
  });
});

test.describe('Baseline v2 · Part 1', () => {
  test('Part 1: free movement between sections A and B, exhibits, autosave + resume, "Part 1 done" without a score, once per wave', async ({ page, hub }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await hub.signIn(hub.account('baseline'))).toBe('dash');
    const s = await openPart(hub, 1);
    expect(s.part).toBe(1);
    expect(s.sections.map((x) => x.id)).toEqual(['A', 'B']);
    const A = s.sections[0].items; const B = s.sections[1].items;
    expect(A.length).toBeGreaterThan(0);
    expect(B.length).toBeGreaterThan(0);
    expect(s.time_limit_min).toBe(hub.last('me').baseline.parts.p1.minutes);
    await expect(page.locator('.qz-timer')).toBeVisible();

    // the first question, its case and its exhibits beside it (desktop)
    await expect(card(page)).toHaveAttribute('data-item', A[0].item_id);
    if (A[0].case_id && s.cases && s.cases[A[0].case_id]) await expect(page.locator('.bl2-case-line')).toHaveText(s.cases[A[0].case_id].title_en);
    expect(A[0].exhibit_ids.length).toBeGreaterThan(0);
    const panel = page.locator('aside.bl2-ex-panel');
    await expect(panel).toBeVisible();
    for (const id of A[0].exhibit_ids) await expect(panel).toContainText(s.exhibits[id].title_en);
    expect(Object.keys(s.exhibits).sort()).toEqual([...new Set([...A, ...B].flatMap((i) => i.exhibit_ids))].sort()); // only referenced exhibits

    // answer A1, A2; jump to section B and back: answers and place are kept
    const a1 = await pickOption(page, 1);
    await page.locator('[data-fk="nav-next"]').click();
    const a2 = await pickOption(page, 2);
    await page.locator('[data-fk="sec|B"]').click();
    await expect(card(page)).toHaveAttribute('data-item', B[0].item_id);
    const b1 = await pickOption(page, 0);
    await page.locator('[data-fk="sec|A"]').click();
    await expect(card(page)).toHaveAttribute('data-item', a2);
    await expect(card(page).locator('input:checked')).toHaveCount(1);
    await expect(page.locator('[data-fk="sec|A"] .bl2-sec-count')).toContainText('2');

    // autosave reaches the Hub; reload resumes from the device and from the server alone
    await hub.waitForRecord('save', (d) => d.ok);
    const resumeCheck = async (label) => {
      await page.reload();
      await expect(page.locator('#bl-title')).toBeVisible();
      await page.locator('[data-fk="begin"]').click();
      await expect(card(page)).toBeVisible();
      const r = hub.last('start');
      expect(r.resumed, label).toBe(true);
      expect(r.attempt_id).toBe(s.attempt_id);
      expect(Object.keys(r.answers).sort(), `${label}: answers on the server`).toEqual([a1, a2, b1].sort());
      // same option order on resume
      const order = (x) => x.sections.flatMap((q) => q.items).map((i) => `${i.item_id}:${i.options.map((o) => o.id).join('')}`);
      expect(order(r), label).toEqual(order(s));
    };
    await resumeCheck('with the local draft');
    await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('hub.draft.')).forEach((k) => localStorage.removeItem(k)));
    await resumeCheck('from the server only');

    // review → submit → "Part 1 done", time used, no score anywhere
    await page.locator('[data-fk="nav-review-link"]').click();
    const res = await submitFromReview(hub, 1);
    expectNoScore(res, 1);
    await expect(page.locator('.bl-overall')).toBeVisible(); // time used
    expect(await page.locator('#app').innerText()).not.toMatch(/\d\s*%/);
    await expectFullyTranslated(hub, 'Part 1 done');

    // once per part per wave
    const again = await hub.callApi('start', { assessment: 'baseline_p1' });
    expect(again.ok).toBe(false);
    expect(again.error.code).toBe('already_submitted');
    await hub.goto('baseline.html?part=1');
    await expect(page.locator('#bl-done-h')).toHaveText(doneTitle(1));
    expect(hub.last('me').baseline.parts.p1.status).toBe('submitted');
  });

  test('Part 1 on a phone: the exhibits fold above the question', async ({ page, hub }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    expect(await hub.signIn(hub.account('blPhone'))).toBe('dash');
    const s = await openPart(hub, 1);
    const panel = page.locator('details.bl2-ex-panel');
    await expect(panel).toHaveAttribute('open', '');
    await expect(panel).toContainText(s.exhibits[s.sections[0].items[0].exhibit_ids[0]].title_en);
    await panel.locator('summary').click();
    await expect(panel).not.toHaveAttribute('open', '');
    await expect(card(page)).toBeVisible();
    await expectFullyTranslated(hub, 'Part 1 question (phone)');
  });
});

test.describe('Baseline v2 · Part 2', () => {
  test('Part 2: most ≠ least, statements only after the 2A lock, 2A frozen, "not my role" only where allowed', async ({ page, hub }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await hub.signIn(hub.account('baseline'))).toBe('dash');
    const s = await openPart(hub, 2);
    expect(s.sections.map((x) => x.id)).toEqual(['SJT', 'RATE']);
    const sjt = s.sections[0].items;
    expect(sjt.length).toBeGreaterThan(0);
    expect(s.sections[1].items, '2B statements are not sent before the lock').toEqual([]);
    const ratingSent = () => hub.records.some((r) => JSON.stringify(r.data || {}).includes('"type":"rating"'));
    expect(ratingSent()).toBe(false);

    // most = least is impossible on the page …
    const c = card(page);
    const rows = c.locator('tbody tr');
    const opt0 = await rows.nth(0).getAttribute('data-opt');
    await rows.nth(0).locator('td.is-most input').check();
    await expect(rows.nth(0).locator('td.is-least input')).toBeDisabled();
    await rows.nth(1).locator('td.is-least input').check();
    // … and on the server: a lock with most = least is refused and nothing is locked
    const same = Object.fromEntries(sjt.map((it) => [it.item_id, { most: it.options[0].id, least: it.options[1].id }]));
    same[sjt[0].item_id] = { most: opt0, least: opt0 };
    const refused = await hub.callApi('baseline_next', { attempt_id: s.attempt_id, answers: same });
    expect(refused.ok).toBe(false);
    expect(refused.error.code).toBe('bad_request');
    expect(refused.error.field).toBe(sjt[0].item_id);
    expect(ratingSent(), 'still no statements').toBe(false);

    // answer every scenario on the page, then lock
    for (let i = 1; i < sjt.length; i += 1) {
      await page.locator('[data-fk="nav-next"]').click();
      await expect(card(page)).toHaveAttribute('data-item', sjt[i].item_id);
      await card(page).locator('tbody tr').nth(2).locator('td.is-most input').check();
      await card(page).locator('tbody tr').nth(3).locator('td.is-least input').check();
    }
    await page.locator('[data-fk="nav-lock"]').click();
    await expect(page.locator('dialog.modal[open]')).toContainText(enText('baseline.p2.lock_title'));
    await page.locator('dialog.modal[open] .btn-primary').click();
    const next = await hub.waitForRecord('baseline_next', (d) => d.ok);
    expect(next.locked).toEqual(['SJT']);
    const rate = next.section.items;
    expect(rate.length).toBeGreaterThan(0);
    expect(rate.every((it) => it.type === 'rating')).toBe(true);
    await expect(page.locator('h1')).toHaveText(next.section.title_en);

    // 2A is frozen: no way back on the page, and a later save cannot change it
    await expect(page.locator('[data-fk="sec|SJT"]')).toHaveCount(0);
    const frozen = hub.last('baseline_next');
    const flip = { [sjt[0].item_id]: { most: sjt[0].options[3].id, least: sjt[0].options[2].id } };
    expect((await hub.callApi('save', { attempt_id: s.attempt_id, answers: flip })).ok).toBe(true);
    const resumed = await hub.callApi('start', { assessment: 'baseline_p2' });
    expect(resumed.resumed).toBe(true);
    expect(resumed.sections.find((x) => x.id === 'SJT').locked).toBe(true);
    expect(resumed.answers[sjt[0].item_id]).not.toEqual(flip[sjt[0].item_id]);
    void frozen;

    // "not my role" only on the statements that allow it
    const nrItems = rate.filter((it) => it.allow_nr).map((it) => it.item_id);
    expect(nrItems.length).toBeGreaterThan(0);
    expect(nrItems.length).toBeLessThan(rate.length);
    const nrShown = await page.locator('.bl2-rate .bl2-nr').evaluateAll((bs) => bs.map((b) => b.dataset.fk.split('|')[1]));
    expect(nrShown.sort()).toEqual(nrItems.sort());

    // rate everything (one NR) → review → submit
    for (const it of rate) {
      const v = it.item_id === nrItems[0] ? 'NR' : String(1 + (rate.indexOf(it) % 4));
      await page.locator(`[data-fk="r|${it.item_id}|${v}"]`).click();
    }
    await page.locator('[data-fk="to-review"]').click();
    const res = await submitFromReview(hub, 2);
    expectNoScore(res, 2);
  });
});

test.describe('Baseline v2 · Part 3', () => {
  test('Part 3: self-ratings first (all 10), glossary, module from the role, "Part 3 done"', async ({ page, hub }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await hub.signIn(hub.account('baseline'))).toBe('dash');
    const role = hub.last('me').profile.role_area;
    const s = await openPart(hub, 3);
    expect(s.module).toBe(MODULE[role]);
    expect(s.sections.map((x) => x.id)).toEqual(['CORE', 'MOD']);
    expect(s.self).toHaveLength(10);
    // the server needs all ten self-ratings before a normal submit
    const early = await hub.callApi('submit', { attempt_id: s.attempt_id, answers: {}, self_ratings: {} });
    expect(early.ok).toBe(false);
    expect(early.error.field).toBe('self_ratings');

    // glossary is one tap away
    await page.locator('.bl2-gloss-btn').first().click();
    const gloss = page.locator('dialog.modal[open] .bl2-gloss li');
    await expect(gloss).toHaveCount(s.glossary.en.length);
    await page.locator('dialog.modal[open] .btn-primary').click();

    // the opener: cannot go on with 9 of 10
    const cards = page.locator('.bl-rate');
    await expect(cards).toHaveCount(10);
    for (let i = 0; i < 9; i += 1) await cards.nth(i).locator('.scale-row button').nth(i % 5).click();
    await page.locator('[data-fk="to-q"]').click();
    await expect(page.locator('.bl-err')).toBeVisible();
    await expect(card(page)).toHaveCount(0);
    await cards.nth(9).locator('.scale-row button').nth(2).click();
    await page.locator('[data-fk="to-q"]').click();

    // CORE, then the role module
    await expect(card(page)).toHaveAttribute('data-item', s.sections[0].items[0].item_id);
    await pickOption(page, 0);
    await page.locator(`[data-fk="sec|MOD"]`).click();
    await expect(card(page)).toHaveAttribute('data-item', s.sections[1].items[0].item_id);
    await expect(page.locator('[data-fk="sec|MOD"]')).toContainText(s.sections[1].title_en);
    await pickOption(page, 1);
    await page.locator('[data-fk="nav-review-link"]').click();
    const res = await submitFromReview(hub, 3);
    expectNoScore(res, 3);
  });

  test('Part 3 without a module (no role area): the page explains, nothing starts', async ({ page, hub }) => {
    test.skip(hub.isMock, 'every demo account has a role area');
    expect(await hub.signIn(hub.account('noModule'))).toBe('dash');
    await hub.goto('baseline.html?part=3');
    await page.locator('[data-fk="begin"]').click();
    await page.locator('dialog.modal[open] .btn-primary').click();
    await expect(page.locator('h1')).toHaveText(enText('baseline.p3.no_module_title'));
    expect(hub.last('start').error.code).toBe('not_found');
  });
});

test.describe('Baseline v2 · time up', () => {
  test('Part 1 submits by itself at 0:00, with most questions unanswered', async ({ page, hub }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.clock.install();
    expect(await hub.signIn(hub.account('timeup'))).toBe('dash');
    if (hub.isReal) await hub.setSwitch('p1_minutes', '1');
    const s = await openPart(hub, 1);
    await pickOption(page, 0); // one answer, 30+ gaps
    await hub.waitForRecord('save', (d) => d.ok);
    if (hub.isReal) await hub.moveServerClock(0.04); // the server is past the deadline, inside the grace
    await page.clock.fastForward(s.time_limit_min * 60_000 + 3_000);
    await expect(page.locator('#bl-done-h')).toHaveText(doneTitle(1), { timeout: 20_000 });
    const res = hub.last('submit');
    expectNoScore(res, 1);
    expect(hub.last('me').baseline.parts.p1.status).toBe('submitted');
  });

  test('Part 2 submits at 0:00 even before 2A is locked (the saved answers count)', async ({ page, hub }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.clock.install();
    expect(await hub.signIn(hub.account('timeup'))).toBe('dash');
    if (hub.isReal) await hub.setSwitch('p2_minutes', '1');
    const s = await openPart(hub, 2);
    await card(page).locator('tbody tr').nth(0).locator('td.is-most input').check();
    await hub.waitForRecord('save', (d) => d.ok);
    if (hub.isReal) await hub.moveServerClock(0.04);
    await page.clock.fastForward(s.time_limit_min * 60_000 + 3_000);
    await expect(page.locator('#bl-done-h')).toHaveText(doneTitle(2), { timeout: 20_000 });
    await expect.poll(async () => (await hub.callApi('me')).baseline.parts.p2.status).toBe('submitted');
  });
});
