// My path (path.html) and the five stages (specs/19 F30): the 1% Planner model with the person's own
// progress, how every course runs, the year from the Sheet's sessions, and how you grow. Also the
// course page in five stages, with the forum's time and place and the Teach date from the sessions.
import { test, expect } from './helpers/hub.mjs';
import { waitReady } from './helpers/pages.mjs';
import { expectFullyTranslated, horizontalOverflow } from './helpers/inspect.mjs';

async function openPath(hub, who = 'shell') {
  expect(await hub.signIn(hub.account(who))).toBe('dash');
  await hub.goto('path.html');
  await waitReady(hub.page, '#model-h');
  return hub.last('me');
}

test.describe('My path', () => {
  test('four domains, 13 skills, the courses that build each with their status, and the baseline part that measures it', async ({ page, hub }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const me = await openPath(hub);
    const cards = page.locator('.dm-card');
    await expect(cards).toHaveCount(4);
    expect(await cards.evaluateAll((els) => els.map((e) => e.dataset.domain))).toEqual(['think', 'plan', 'work', 'mind']);
    await expect(page.locator('.dm-card .skill-list li')).toHaveCount(13);
    // every course appears once, in its domain, linking to its page
    const links = await page.locator('.dm-course').evaluateAll((as) => as.map((a) => new URL(a.href).searchParams.get('c')));
    expect(links.sort()).toEqual(['A1', 'A2', 'A3', 'C1', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6']);
    for (const [d, codes] of [['think', ['A1', 'A2', 'A3']], ['plan', ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']], ['work', ['C1']]]) {
      const got = await page.locator(`.dm-card[data-domain="${d}"] .dm-course`).evaluateAll((as) => as.map((a) => new URL(a.href).searchParams.get('c')));
      expect(got.sort()).toEqual(codes);
    }
    // the passed count matches `me`
    const passedThink = me.courses.filter((c) => ['A1', 'A2', 'A3'].includes(c.code) && c.checkpoint.status === 'passed').length;
    await expect(page.locator('.dm-card[data-domain="think"] .dm-count b')).toHaveText(String(passedThink));
    // measured by Part 1 / 3 / 2 / 2
    await expect(page.locator('.dm-card[data-domain="think"] .dm-foot')).toContainText('Baseline Part 1');
    await expect(page.locator('.dm-card[data-domain="plan"] .dm-foot')).toContainText('Baseline Part 3');
    await expect(page.locator('.dm-card[data-domain="mind"] .dm-foot')).toContainText('Baseline Part 2');
    // the five charters: names from the Sheet (dev fixtures) or "Charter n" in the demo
    const charters = page.locator('.dm-card[data-domain="mind"] .charter-list li');
    await expect(charters).toHaveCount(5);
    await expect(charters.first()).toContainText(hub.isMock ? 'Charter 1' : 'Mock charter 1');
    // direction only for 2028–29, no course names
    await expect(page.locator('.years li')).toHaveCount(3);
    await expect(page.locator('.years')).not.toContainText(/Builder Lab|IBP|Teach & Coach|Business Acumen/);
  });

  test('how every course runs, the year from the sessions with "you are here", and how you grow', async ({ page, hub }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const me = await openPath(hub);
    await expect(page.locator('.stage-card h3')).toHaveText(['1Learn', '2Prove', '3Apply', '4Do', '5Teach']);
    await expect(page.locator('.recall-bars li')).toHaveCount(5);
    // every session of `me` is in the year, in date order, plus baseline and re-test; one "you are here"
    expect(me.sessions.length).toBeGreaterThan(0);
    const titles = await page.locator('.yr-item .yr-title').allTextContents();
    for (const s of me.sessions) expect(titles).toContain(s.title_en);
    await expect(page.locator('.yr-item.k-baseline')).toHaveCount(1);
    await expect(page.locator('.yr-item.k-retest')).toHaveCount(1);
    await expect(page.locator('.yr-here')).toHaveCount(1);
    const first = me.sessions[0];
    if (first.start) await expect(page.locator('.yr-item', { hasText: first.title_en }).first()).toContainText(`${first.start}–${first.end}`);
    await expect(page.locator('.goal-cards > li')).toHaveCount(3);
  });

  test('IDP gaps appear on their domain once the profile is ready (demo: results open)', async ({ page, hub }) => {
    test.skip(!hub.isMock, 'the dev server builds profiles only in profile.spec');
    await page.setViewportSize({ width: 1280, height: 900 });
    await openPath(hub, 'profile');
    await expect.poll(() => hub.payloads('profile').length).toBeGreaterThan(0);
    const gaps = hub.last('profile').gaps;
    expect(gaps.length).toBe(2);
    await expect(page.locator('.dm-gap')).not.toHaveCount(0);
    await expect(page.locator('.goal-gaps li')).toHaveCount(2);
    await expect(page.locator('.dm-gap').first()).toHaveAttribute('href', 'profile.html');
  });

  test('menu, home card, VI and 360 px', async ({ page, hub }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    expect(await hub.signIn(hub.account('shell'))).toBe('dash');
    // the home card links to My path; the phone tab bar keeps five tabs and has My path
    await expect(page.locator('.path-card .pc-domains li')).toHaveCount(4);
    await expect(page.locator('.tabbar a')).toHaveCount(5);
    await page.locator('.tabbar a[href="path.html"]').click();
    await waitReady(page, '#model-h');
    await expect(page.locator('.tabbar a[href="path.html"]')).toHaveAttribute('aria-current', 'page');
    expect(await horizontalOverflow(page)).toEqual([]);
    await page.setViewportSize({ width: 1280, height: 900 });
    await expectFullyTranslated(hub, 'path');
  });
});

test.describe('Five stages on the course page', () => {
  test('stepper Learn → Teach, the forum session from the Sheet, and Teach at the first session after the field work', async ({ page, hub }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await hub.signIn(hub.account('shell'))).toBe('dash');
    const me = hub.last('me');
    const c = me.courses.find((x) => x.forum_date && me.sessions.some((s) => s.date === x.forum_date) && me.sessions.some((s) => s.date > [x.forum_date, x.field_until].filter(Boolean).sort().pop()));
    expect(c, 'a course whose forum is a session, with a later session').toBeTruthy();
    await hub.goto(`course.html?c=${c.code}`);
    await waitReady(page, '#course-title');
    await expect(page.locator('.steps li .lbl')).toHaveText(['Learn', 'Prove', 'Apply', 'Do', 'Teach']);
    const sess = me.sessions.find((s) => s.date === c.forum_date);
    const forum = page.locator('section[aria-labelledby="forum-title"]');
    await expect(forum.locator('#forum-title')).toHaveText(sess.title_en);
    if (sess.start) await expect(forum).toContainText(`${sess.start}–${sess.end}`);
    if (sess.place) await expect(forum).toContainText(sess.place);
    const after = [c.forum_date, c.field_until].filter(Boolean).sort().pop();
    const teach = me.sessions.find((s) => s.date > after);
    if (teach) {
      await expect(page.locator('.kd-list')).toContainText('Teach: show-and-tell');
      await expect(page.locator('.teach-note')).toContainText(teach.title_en);
    }
    // the guidance box names the current stage's task
    await expect(page.locator('.guide[data-guide="course"] .guide-now dd')).not.toHaveText('');
  });
});
