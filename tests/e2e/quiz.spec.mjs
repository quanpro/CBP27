// Step 4 (specs/17): checkpoint not-yet and pass paths, retake wait, other form, resume after reload,
// VI mid-quiz, predict and recall result screens. Decision D5: the right answers appear only after a pass.
import { test, expect } from './helpers/hub.mjs';
import { expectFullyTranslated } from './helpers/inspect.mjs';


const quizPath = (type, code, extra = '') => `quiz.html?type=${type}&c=${code}${extra}`;
const longDate = (page, d) => page.evaluate((v) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${v}T12:00:00+07:00`)), d);

/** Open a quiz page and press its start button; returns the `start` payload. */
async function startQuiz(hub, type, code, extra) {
  const { page } = hub;
  const before = hub.payloads('start').length;
  await hub.goto(quizPath(type, code, extra));
  await expect(page.locator('.qz-intro h1')).toBeVisible();
  await page.locator('.qz-intro .btn-primary').click();
  await expect(page.locator('.qz-run fieldset.qz-q').first()).toBeVisible();
  await expect.poll(() => hub.payloads('start').length).toBeGreaterThan(before);
  const s = hub.last('start');
  expect(s.ok, 'start succeeded').toBe(true);
  return s;
}

/** Answer labels on the result screen ("Your answer · …", "Right answer"). */
const answerLabels = (page) => page.locator('.qz-rcard .qz-ans-label').allTextContents(); // shown upper-case by CSS

test.describe('Step 4 · checkpoint', () => {
  test('not yet → retake blocked → other form → pass, with D5 reveal rules and recall', async ({ page, hub }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    if (hub.isMock) await page.clock.install(); // demo retake wait is 1 minute: fast-forward it
    const code = hub.account('checkpoint');
    const course = hub.course('checkpoint');
    expect(await hub.signIn(code)).toBe('dash');

    // ---- attempt 1: every answer wrong
    const s1 = await startQuiz(hub, 'checkpoint', course);
    expect(s1.attempt_no).toBe(1);
    expect(s1.items).toHaveLength(10);
    await expect(page.locator('.qz-run fieldset.qz-q')).toHaveCount(10); // list view on desktop
    expect(await hub.answerList(0)).toBe(10);
    const r1 = await hub.submitQuiz();
    expect(r1.ok).toBe(true);
    expect(r1.passed).toBe(false);
    expect(r1.reveal).toBe(false);
    expect(r1.missed).toHaveLength(10);
    for (const m of r1.missed) {
      expect(m.correct, 'no correct option before a pass').toBeNull();
      expect(m.why_en).toBe('');
      expect(m.why_vi).toBe('');
      expect(m.your).not.toBeNull();
    }
    expect(r1.weak_objectives.length).toBeGreaterThan(0);
    // the screen: next step first, weak objectives with rewatch links, own answers only
    await expect(page.locator('.qz-hero')).toHaveClass(/notyet/);
    await expect(page.locator('#res-title')).toContainText('Not yet');
    await expect(page.locator('.qz-obj.is-weak')).toHaveCount(r1.weak_objectives.length);
    const rewatch = page.locator('.qz-obj.is-weak .qz-rewatch a');
    expect(await rewatch.count()).toBeGreaterThan(0);
    for (const href of await rewatch.evaluateAll((as) => as.map((a) => a.getAttribute('href')))) expect(href).toBe(`course.html?c=${course}#episodes`);
    await expect(rewatch.first()).toContainText('Rewatch Ep');
    await expect(page.locator('.qz-rcard')).toHaveCount(10);
    for (const l of await answerLabels(page)) expect(l).toMatch(/^Your answer/);
    await expect(page.locator('.qz-why')).toHaveCount(0);
    await expect(page.getByText('The right answers unlock when you pass.')).toBeVisible();
    await expectFullyTranslated(hub, 'not-yet result');

    // ---- the retake is blocked until the wait is over (screen and server)
    await hub.goto(quizPath('checkpoint', course));
    await expect(page.locator('.qz-state h3')).toContainText('Your retake opens');
    const early = await hub.callApi('start', { assessment: 'checkpoint', course });
    expect(early.ok).toBe(false);
    expect(early.error.code).toBe('retake_too_soon');
    expect(early.error.next_retake_at).toBeTruthy();

    if (hub.isMock) await page.clock.fastForward('01:05');
    else await hub.moveServerClock(24);
    await hub.goto(quizPath('checkpoint', course));
    if (hub.isReal) await hub.reauthIfAsked(code); // 24 h later the 6-hour session has expired
    await expect(page.locator('.qz-intro')).toContainText('This is try 2');

    // ---- attempt 2: the other form, 9 of 10 right
    await page.locator('.qz-intro .btn-primary').click();
    await expect(page.locator('.qz-run fieldset.qz-q')).toHaveCount(10);
    const s2 = hub.last('start');
    expect(s2.attempt_no).toBe(2);
    expect(s2.form).not.toBe(s1.form);
    const ids1 = new Set(s1.items.map((i) => i.item_id));
    expect(s2.items.filter((i) => ids1.has(i.item_id))).toEqual([]);
    await hub.answerList(9);
    const r2 = await hub.submitQuiz();
    expect(r2.passed).toBe(true);
    expect(r2.reveal).toBe(true);
    expect(r2.n_correct).toBe(9);
    expect(r2.missed).toHaveLength(1);
    expect(r2.missed[0].correct).not.toBeNull();
    expect(r2.missed[0].why_en).not.toBe('');
    expect(r2.recall_dates).toHaveLength(3);
    await expect(page.locator('.qz-hero')).toHaveClass(/pass/);
    await expect(page.locator('#res-title')).toHaveText(`Passed: see you at the forum on ${await longDate(page, r2.forum_date)}`);
    expect(await answerLabels(page)).toEqual(['Your answer · not right', 'Right answer']);
    await expect(page.locator('.qz-rcard .qz-why')).toContainText('Why:');
    await expect(page.locator('.qz-dates li')).toHaveCount(3);
    await expectFullyTranslated(hub, 'pass result');

    // ---- after the pass, the first attempt's review shows the key too (D5)
    await hub.goto(quizPath('checkpoint', course, `&review=${encodeURIComponent(s1.attempt_id)}`));
    await expect(page.locator('.qz-hero')).toHaveClass(/notyet/);
    await expect(page.locator('.qz-rcard')).toHaveCount(10);
    const rv = hub.last('review');
    expect(rv.reveal).toBe(true);
    expect(rv.missed.every((m) => m.correct && m.why_en)).toBe(true);
    await expect(page.locator('.qz-rcard .qz-why')).toHaveCount(10);

    // ---- spaced recall (F11: max(forum, pass) + 2 / 7 / 30 days): due → 3 items → review with answers
    if (hub.isReal) {
      // move the server to the passed course's day-2 recall
      await hub.goto('index.html');
      await expect(page.locator('#app .skeleton')).toHaveCount(0);
      const me = hub.last('me');
      const day2 = me.courses.find((c) => c.code === course).recall.find((r) => r.day === 2);
      expect(day2.status).toBe('upcoming');
      const hours = Math.ceil((Date.parse(`${day2.due_date}T09:00:00+07:00`) - Date.parse(me.server_now)) / 3600000);
      await hub.moveServerClock(hours);
      await page.reload();
      await hub.reauthIfAsked(code);
    } else {
      await hub.goto('index.html');
    }
    await expect(page.locator('#app .skeleton')).toHaveCount(0);
    const due = hub.last('me').courses.flatMap((c) => c.recall.filter((r) => r.status === 'due').map((r) => ({ code: c.code, day: r.day })));
    expect(due.length, 'a recall is due').toBeGreaterThan(0);
    const rc = (hub.isReal ? due.find((d) => d.code === course) : due[0]);
    expect(rc).toBeTruthy();
    await hub.goto(`course.html?c=${rc.code}`);
    const recallBtn = page.locator(`a[href="quiz.html?type=recall&c=${rc.code}&day=${rc.day}"]`).first();
    await expect(recallBtn).toBeVisible();
    await recallBtn.click();
    await expect(page.locator('.qz-intro h1')).toHaveText('Keep it fresh');
    await page.locator('.qz-intro .btn-primary').click();
    await expect(page.locator('.qz-run fieldset.qz-q')).toHaveCount(3);
    const s3 = hub.last('start');
    expect(s3.assessment).toBe('recall');
    expect(s3.items).toHaveLength(3);
    await hub.answerList(2);
    const r3 = await hub.submitQuiz();
    expect(r3.assessment).toBe('recall');
    expect(r3.review).toHaveLength(3);
    expect(r3.review.every((r) => r.correct && r.why_en)).toBe(true);
    await expect(page.locator('.qz-rcard')).toHaveCount(3);
    await expect(page.locator('.qz-rcard .qz-why')).toHaveCount(3);
    expect((await answerLabels(page)).filter((l) => l === 'Right answer')).toHaveLength(1);
  });

  test('reload mid-quiz resumes the answers and the option order (local draft and server save)', async ({ page, hub }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const course = hub.course('resume');
    expect(await hub.signIn(hub.account('resume'))).toBe('dash');
    const s1 = await startQuiz(hub, 'checkpoint', course);
    const cards = page.locator('.qz-run fieldset.qz-q');
    for (let i = 0; i < 3; i += 1) await hub.choose(cards.nth(i), i !== 1);
    const snapshot = () => cards.evaluateAll((fs) => fs.map((f) => ({
      id: f.dataset.item,
      options: [...f.querySelectorAll('input[type="radio"]')].map((r) => r.value),
      checked: (f.querySelector('input:checked') || {}).value || null,
    })));
    const before = await snapshot();
    expect(before.filter((x) => x.checked)).toHaveLength(3);
    const saved = await hub.waitForRecord('save', (d) => d.ok);
    expect(saved.saved_at).toBeTruthy();

    const resumeAndCompare = async (label) => {
      await page.reload();
      await expect(page.locator('.qz-intro')).toContainText('Continue where you left off');
      await page.locator('.qz-intro .btn-primary').click();
      await expect(cards).toHaveCount(10);
      const s = hub.last('start');
      expect(s.resumed, label).toBe(true);
      expect(s.attempt_id).toBe(s1.attempt_id);
      expect(Object.keys(s.answers).sort(), `${label}: server kept the saved answers`).toEqual(before.filter((x) => x.checked).map((x) => x.id).sort());
      expect(await snapshot(), label).toEqual(before);
    };
    await resumeAndCompare('with the local draft');
    await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('hub.draft.')).forEach((k) => localStorage.removeItem(k)));
    await resumeAndCompare('from the server only');
  });

  test('switching to VI mid-quiz keeps the answers and the place (phone, one question per screen)', async ({ page, hub }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    const course = hub.course('viToggle');
    expect(await hub.signIn(hub.account('resume'))).toBe('dash');
    const s = await startQuiz(hub, 'checkpoint', course);
    const card = page.locator('.qz-run.is-paged fieldset.qz-q');
    await expect(card).toHaveCount(1);
    await hub.choose(card, true);
    const first = await card.locator('input:checked').getAttribute('value');
    await page.locator('[data-fk="nav-next"]').click();
    await expect(card).toHaveAttribute('data-item', s.items[1].item_id);
    await hub.choose(card, false);
    const second = await card.locator('input:checked').getAttribute('value');

    await expectFullyTranslated(hub, 'quiz question'); // EN → VI → EN, every string
    await hub.setLang('vi');
    await expect(card).toHaveAttribute('data-item', s.items[1].item_id);
    await expect(card.locator('.qz-stem')).toHaveText(s.items[1].stem_vi);
    await expect(card.locator(`input[value="${second}"]`)).toBeChecked();
    const viOption = s.items[1].options.find((o) => o.id === second).vi;
    await expect(card.locator('label.opt:has(input:checked) .txt')).toHaveText(viOption);
    await expect(page.locator('.qz-count')).toContainText('2');
    await page.locator('[data-fk="nav-prev"]').click();
    await expect(card).toHaveAttribute('data-item', s.items[0].item_id);
    await expect(card.locator(`input[value="${first}"]`)).toBeChecked();
    await expect(card.locator('.qz-stem')).toHaveText(s.items[0].stem_vi);
  });

  test('a not-yet checkpoint keeps the key hidden even after its late window (D5, tightened)', async ({ page, hub }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const course = hub.course('lateReveal');
    const code = hub.account('resume');
    expect(await hub.signIn(code)).toBe('dash');
    let attemptId;
    if (hub.isReal) {
      // attempt now (8 of 10 wrong), then move the server past the course's late window
      const s = await startQuiz(hub, 'checkpoint', course);
      await hub.answerList(2);
      expect((await hub.submitQuiz()).passed).toBe(false);
      attemptId = s.attempt_id;
      await hub.goto('index.html');
      await expect(page.locator('#app .skeleton')).toHaveCount(0);
      const me = hub.last('me');
      const live = me.courses.find((c) => c.code === course);
      const hours = Math.ceil((Date.parse(`${live.late_until}T23:59:59+07:00`) - Date.parse(me.server_now)) / 3600000) + 2;
      await hub.moveServerClock(hours);
    } else {
      // the demo seed: two failed attempts on a course whose late window has already closed
      const live = hub.last('me').courses.find((c) => c.code === course);
      expect(live.checkpoint.status).not.toBe('passed');
      expect(live.late_until < hub.last('me').server_now.slice(0, 10), 'late window closed').toBe(true);
      attemptId = live.checkpoint.last_attempt_id;
    }
    await hub.goto(quizPath('checkpoint', course, `&review=${encodeURIComponent(attemptId)}`));
    if (hub.isReal) await hub.reauthIfAsked(code);
    await expect(page.locator('.qz-hero')).toBeVisible();
    const rv = hub.last('review');
    expect(rv.passed).toBe(false);
    expect(rv.reveal).toBe(false);
    expect(rv.missed.length).toBeGreaterThan(0);
    expect(rv.missed.every((m) => m.correct === null && m.why_en === '' && m.why_vi === '')).toBe(true);
    await expect(page.locator('.qz-why')).toHaveCount(0);
  });
});

test.describe('Step 4 · predict', () => {
  test('predict is ungraded and shows the right answers and why straight after', async ({ page, hub }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await hub.signIn(hub.account('resume'))).toBe('dash');
    const s = await startQuiz(hub, 'predict', hub.course('predict'));
    expect(s.items).toHaveLength(3);
    await hub.answerList(1);
    const r = await hub.submitQuiz();
    expect(r.assessment).toBe('predict');
    expect(r.review).toHaveLength(3);
    expect(r.review.every((x) => x.correct && x.why_en && x.why_vi)).toBe(true);
    await expect(page.locator('.qz-hero')).toHaveClass(/neutral/);
    await expect(page.locator('#res-title')).toHaveText('A preview, not a grade');
    await expect(page.locator('.qz-rcard')).toHaveCount(3);
    await expect(page.locator('.qz-rcard .qz-why')).toHaveCount(3);
    expect((await answerLabels(page)).filter((l) => l === 'Right answer')).toHaveLength(2);
    await expectFullyTranslated(hub, 'predict result');
  });
});
