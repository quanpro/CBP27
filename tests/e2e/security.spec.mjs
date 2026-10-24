// Security in the browser. The always-on guards in helpers/hub.mjs already deep-scan every payload of
// every test; these tests drive the paths explicitly and prove the guards themselves work.
import { readFileSync, readdirSync } from 'node:fs';
import { test, expect, ALLOWED_HOSTS } from './helpers/hub.mjs';
import { findLeaks, itemShapeProblems } from './helpers/scan.mjs';
import { PAGES, openPage } from './helpers/pages.mjs';

const DOCS = new URL('../../docs/', import.meta.url);

test.describe('answer keys never reach the browser before a submit', () => {
  test('start / save / resume / me payloads: no answer, why, correct or mockCorrect; items carry only the whitelist', async ({ page, hub }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await hub.signIn(hub.account('security'))).toBe('dash');
    await hub.goto(`quiz.html?type=checkpoint&c=${hub.course('security')}`);
    await page.locator('.qz-intro .btn-primary').click();
    const cards = page.locator('.qz-run fieldset.qz-q');
    await expect(cards).toHaveCount(10);
    await hub.choose(cards.nth(0), true);
    await hub.choose(cards.nth(1), false);
    await hub.waitForRecord('save', (d) => d.ok);
    await page.reload();
    await page.locator('.qz-intro .btn-primary').click();
    await expect(cards).toHaveCount(10);
    await hub.goto('index.html');
    await expect(page.locator('#courses-title')).toBeVisible();

    const starts = hub.payloads('start');
    expect(starts.length).toBe(2);
    expect(starts[1].resumed).toBe(true);
    for (const action of ['start', 'save', 'me']) {
      const list = hub.payloads(action);
      expect(list.length, `${action} was recorded`).toBeGreaterThan(0);
      for (const p of list) expect(findLeaks(action, p), action).toEqual([]);
    }
    for (const s of starts) expect(itemShapeProblems(s.items)).toEqual([]);
    // the DOM does not carry a key either: no data-* or hidden input names one
    const domKeys = await page.evaluate(() => document.documentElement.outerHTML.match(/mockCorrect|why_en|why_vi|"answer"/g));
    expect(domKeys).toBeNull();
  });

  test('the scanner flags a planted key (guards are live)', async ({ hub }) => {
    expect(findLeaks('start', { items: [{ item_id: 'X', options: [], answer: 'b' }] })).toEqual([{ path: 'items[0].answer', key: 'answer' }]);
    expect(findLeaks('me', { courses: [{ checkpoint: { correct: { id: 'a' } } }] })).toHaveLength(1);
    expect(findLeaks('start', { items: [{ mockCorrect: 'c' }] })).toHaveLength(1);
    expect(findLeaks('submit', { missed: [{ correct: { id: 'a' }, why_en: 'x', why_vi: 'y' }], by_objective: { 1: { n: 2, correct: 1 } } })).toEqual([]);
    expect(findLeaks('submit', { missed: [{ answer: 'a' }] })).toHaveLength(1);
    expect(itemShapeProblems([{ item_id: 'X', course: 'A2', objective: 1, case_id: '', stem_en: '', stem_vi: '', why_en: '', options: [] }]).length).toBeGreaterThan(0);
    void hub;
  });
});

test.describe('redirects and hosts', () => {
  for (const next of ['https://evil.example/', '//evil.example', 'javascript:alert(1)', 'https:%2F%2Fevil.example', '/\\evil.example']) {
    test(`?next=${next} does not leave the Hub`, async ({ page, hub }) => {
      const dialogs = [];
      page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
      const view = await hub.signIn(hub.account('security'), { path: `index.html?next=${encodeURIComponent(next)}` });
      expect(view).toBe('dash');
      await page.waitForTimeout(300);
      expect(new URL(page.url()).host).toBe(ALLOWED_HOSTS[0]);
      expect(new URL(page.url()).pathname).toBe('/index.html');
      expect(hub.requests.filter((u) => /^https?:/.test(u) && new URL(u).host.includes('evil.example'))).toEqual([]);
      expect(dialogs).toEqual([]);
    });
  }

  test('a relative ?next inside the Hub still works', async ({ page, hub }) => {
    await hub.goto(`index.html?next=${encodeURIComponent('about.html#privacy')}`);
    await page.locator('#login-code').fill(hub.account('security'));
    await page.locator('#login-pin').fill(hub.pin);
    await page.locator('#app form button[type="submit"]').click();
    // a dev account may still owe the privacy notice; accept it if it shows, then the redirect follows
    await page.waitForFunction(() => /\/about\.html$/.test(location.pathname) || !!document.querySelector('.onboard .btn-primary'));
    if (await page.locator('.onboard .btn-primary').isVisible()) await page.locator('.onboard .btn-primary').click();
    await expect(page).toHaveURL(/\/about\.html#privacy$/);
  });

  test('pages only talk to the Hub itself and Google Fonts', async ({ page, hub }) => {
    test.setTimeout(90_000);
    const signedIn = new Set();
    for (const p of PAGES) await openPage(hub, p, signedIn);
    const hosts = [...new Set(hub.requests.filter((u) => /^https?:/.test(u)).map((u) => new URL(u).host))].sort();
    expect(hosts.filter((h) => !ALLOWED_HOSTS.includes(h))).toEqual([]);
    expect(hosts).toContain('fonts.googleapis.com'); // the recorder sees off-site requests
    expect(hosts).toContain(ALLOWED_HOSTS[0]);
    void page;
  });

  test('the session stays in this tab unless "Keep me signed in" is ticked', async ({ page, hub }) => {
    expect(await hub.signIn(hub.account('security'))).toBe('dash');
    const where = () => page.evaluate(() => ({ ss: !!sessionStorage.getItem('hub.session'), ls: !!localStorage.getItem('hub.session') }));
    expect(await where()).toEqual({ ss: true, ls: false });
    // nothing the Hub itself keeps on the device holds the PIN (the demo mock's own fake store is excluded)
    const kept = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k !== 'hub.mock.v1').map((k) => [k, localStorage.getItem(k)])));
    expect(JSON.stringify(kept)).not.toContain(hub.pin);
  });
});

test.describe('static guarantees of the pages', () => {
  const htmlFiles = readdirSync(DOCS).filter((f) => f.endsWith('.html') && f !== '404.html');

  test('every page has the Content-Security-Policy and no inline or third-party scripts', async ({ hub }) => {
    expect(htmlFiles.length).toBeGreaterThanOrEqual(8);
    for (const f of htmlFiles) {
      const html = readFileSync(new URL(f, DOCS), 'utf8');
      const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
      expect(csp, f).toContain("script-src 'self'");
      expect(csp, f).toContain("default-src 'self'");
      expect(csp, f).toContain("object-src 'none'");
      expect(csp, f).not.toContain("'unsafe-eval'");
      expect(csp.match(/script-src [^;]*/)[0], f).not.toContain("'unsafe-inline'");
      expect(html, f).toContain('<meta name="referrer" content="no-referrer">');
      const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
      for (const [, attrs, body] of scripts) {
        expect(body.trim(), `${f}: inline script`).toBe('');
        expect(attrs, `${f}: script src`).toMatch(/src="js\//);
      }
    }
    void hub;
  });
});
