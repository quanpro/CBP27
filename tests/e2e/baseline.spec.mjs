// Step 5 (specs/17): baseline. Part A gate (all 10 self-ratings), Part C case panel, resume after
// reload, the 60-minute timer auto-submits at 0:00, result = per-course bars + two largest gaps, and
// no item feedback ever. The browser clock is faked (page.clock) so 60 minutes pass in a moment.
import { test, expect } from './helpers/hub.mjs';
import { ORDER } from './helpers/accounts.mjs';
import { expectFullyTranslated } from './helpers/inspect.mjs';

test('baseline: Part A gate, case panel, resume, timer auto-submit, result without item feedback', async ({ page, hub }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.clock.install();
  expect(await hub.signIn(hub.account('baseline'))).toBe('dash');
  await hub.goto('baseline.html');
  await expect(page.locator('#bl-title')).toHaveText('Where are you starting from?');
  await page.locator('.qz-intro .btn-primary').click();
  await expect(page.locator('dialog.modal[open]')).toContainText('Start the 60-minute timer?');
  await page.locator('dialog.modal[open] .btn-primary').click();

  // ---- Part A: ten statements, 0–4
  const cards = page.locator('.bl-rate');
  await expect(cards).toHaveCount(10);
  const start = hub.last('start');
  expect(start.assessment).toBe('baseline');
  expect(start.time_limit_min).toBe(60);
  expect(start.parts).toEqual({ A: 10, B: 40, C: 6 });
  expect(start.self.map((s) => s.course)).toEqual(ORDER);
  expect(start.items).toHaveLength(46);
  await expect(page.locator('.qz-timer')).toHaveText(/^(60:00|59:\d\d)$/);
  for (let i = 0; i < 9; i += 1) await cards.nth(i).locator('.scale-row button').nth(i % 5).click();
  await page.locator('[data-fk="to-b"]').click();
  await expect(page.locator('.bl-err')).toBeVisible();
  await expect(page.locator('.bl-err')).toContainText('1 left');
  await expect(page.locator('fieldset.qz-q')).toHaveCount(0); // still on Part A
  // the server refuses a submit with fewer than 10 self-ratings, too
  const partial = Object.fromEntries(start.self.slice(0, 9).map((s) => [s.course, 2]));
  const refused = await hub.callApi('submit', { attempt_id: start.attempt_id, answers: {}, self_ratings: partial });
  expect(refused.ok).toBe(false);
  expect(refused.error.code).toBe('bad_request');

  await cards.nth(9).locator('.scale-row button').nth(3).click();
  await expect(page.locator('.bl-err')).toBeHidden();
  await page.locator('[data-fk="to-b"]').click();

  // ---- Part B: 40 items grouped by course (list view on desktop)
  const qs = page.locator('.qz-run fieldset.qz-q');
  await expect(qs).toHaveCount(40);
  const groups = await page.locator('.bl-group-head .code-badge').allInnerTexts();
  expect(groups).toEqual(ORDER);
  for (let i = 0; i < 6; i += 1) await hub.choose(qs.nth(i * 4), i % 2 === 0);
  await page.locator('[data-fk="nav-done"]').click();

  // ---- Part C: the case stays visible next to its 6 questions
  await expect(qs).toHaveCount(6);
  await expect(page.locator('aside.case-panel.sticky')).toBeVisible();
  await expect(page.locator('#bl-case-h')).toHaveText(start.case.title_en);
  await hub.choose(qs.nth(0), true);
  await hub.waitForRecord('save', (d) => d.ok);

  // ---- reload: resume where we were, ratings and answers kept
  await page.reload();
  await expect(page.locator('#bl-title')).toHaveText('Welcome back');
  await page.locator('.qz-intro .btn-primary').click();
  await expect(qs).toHaveCount(6);
  expect(hub.last('start').resumed).toBe(true);
  await expect(qs.nth(0).locator('input:checked')).toHaveCount(1);
  expect(Object.keys(hub.last('start').self_ratings)).toHaveLength(10);

  // ---- 60 minutes later the timer reaches 0:00 and submits by itself
  await page.clock.fastForward(60 * 60_000 + 5_000);
  await expect(page.locator('#bl-res-h')).toHaveText('Your starting point', { timeout: 20_000 });
  const res = hub.last('submit');
  expect(res.ok).toBe(true);
  expect(res.assessment).toBe('baseline');
  expect(Object.keys(res.by_course).sort()).toEqual([...ORDER].sort());
  expect(Object.keys(res.self)).toHaveLength(10);
  expect(res.gaps).toHaveLength(2);
  for (const k of ['review', 'missed', 'by_objective', 'n_correct']) expect(res, `baseline result has no ${k}`).not.toHaveProperty(k);

  // per-course bars in calendar order, the two largest gaps, no item feedback
  expect(await page.locator('.bl-bar .code-badge').allInnerTexts()).toEqual(ORDER);
  await expect(page.locator('#bl-gaps-h')).toHaveText('Your two largest gaps');
  expect(await page.locator('.bl-gap-list .code-badge').allInnerTexts()).toEqual(res.gaps);
  await expect(page.getByText('Take these two to your IDP conversation in December.')).toBeVisible();
  await expect(page.locator('.bl-nofeedback')).toBeVisible();
  await expect(page.locator('.qz-rcard, .qz-why, .qz-ans-label')).toHaveCount(0);
  await expectFullyTranslated(hub, 'baseline result');

  // one attempt per wave: the result stays, a new start is refused
  await page.reload();
  await expect(page.locator('#bl-res-h')).toBeVisible();
  const again = await hub.callApi('start', { assessment: 'baseline' });
  expect(again.ok).toBe(false);
  expect(again.error.code).toBe('already_submitted');
});

test('baseline Part A and Part C on a phone: scale buttons and a collapsible case panel', async ({ page, hub }) => {
  test.skip(hub.isReal, 'one baseline per wave: the real fixture account is used by the test above');
  await page.setViewportSize({ width: 360, height: 780 });
  expect(await hub.signIn(hub.account('baseline'))).toBe('dash');
  await hub.goto('baseline.html');
  await page.locator('.qz-intro .btn-primary').click();
  await page.locator('dialog.modal[open] .btn-primary').click();
  const cards = page.locator('.bl-rate');
  await expect(cards).toHaveCount(10);
  for (let i = 0; i < 10; i += 1) {
    const b = cards.nth(i).locator('.scale-row button').nth(2);
    await b.click();
    await expect(b).toHaveAttribute('aria-pressed', 'true');
  }
  await expectFullyTranslated(hub, 'baseline Part A');
  await page.locator('[data-fk="to-b"]').click();
  await expect(page.locator('.qz-run.is-paged')).toBeVisible();
  await page.locator('.qz-review-link').click(); // "Review and submit" → review screen
  await expect(page.locator('#bl-rev-h')).toBeVisible();
  await page.locator('.bl-rev-row').nth(2).locator('.btn-ghost').click(); // open Part C
  const panel = page.locator('details.case-panel');
  await expect(panel).toHaveAttribute('open', '');
  await panel.locator('summary').click();
  await expect(panel).not.toHaveAttribute('open', '');
  await expect(page.locator('.qz-run.is-paged fieldset.qz-q')).toHaveCount(1);
});
