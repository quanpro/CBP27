// Shared test fixture. Every test gets `hub`, which
//   - opens pages in the project's mode (?mock=1 or ?api=…) and signs in per mode,
//   - answers Google Fonts locally (deterministic, offline) and blocks every other off-site request,
//   - records every API payload the page receives: real → each POST /api response, mock → each
//     result of mock-api.js `handle()` (the module is wrapped in flight, the file on disk is untouched),
//   - after the test fails it if a payload leaked an answer key, a served item had extra fields, a
//     request went to a host other than self / fonts.googleapis.com / fonts.gstatic.com, the page
//     threw, or an i18n key was missing,
//   - puts the dev server clock back if the test moved it.
import { test as base, expect } from '@playwright/test';
import { ACCOUNTS, COURSES, PINS } from './accounts.mjs';
import { ORIGIN, PAGE_API, moveClock, fixtureKey, call as devCall } from './devapi.mjs';
import { findLeaks, itemShapeProblems } from './scan.mjs';

export { expect };

const SELF_HOST = new URL(ORIGIN).host;
export const ALLOWED_HOSTS = [SELF_HOST, 'fonts.googleapis.com', 'fonts.gstatic.com'];
const FONT_RE = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

const HANDLE_DECL = 'export async function handle(payload) {';
const HANDLE_WRAP = `
export async function handle(payload) {
  const res = await __hubOriginalHandle(payload);
  try { if (window.__hubRecord) await window.__hubRecord(JSON.stringify({ action: payload && payload.action, data: res })); } catch (e) { /* recorder gone (page closing) */ }
  return res;
}
`;

// The demo's right option is labelled like this in every invented item (docs/js/mock-api.js OPTS[0]).
const MOCK_RIGHT = /The right answer \(demo\)|Đáp án đúng \(demo\)/;

export class Hub {
  constructor(page, mode, testInfo) {
    this.page = page;
    this.mode = mode;
    this.isMock = mode === 'mock';
    this.isReal = mode === 'real';
    this.pin = PINS[mode];
    this.testInfo = testInfo;
    this.records = [];     // {action, data}
    this.requests = [];    // every URL the page asked for
    this.errors = [];      // uncaught page errors
    this.missingKeys = []; // "[i18n] missing" console warnings
    this.clockHours = 0;
  }

  /** Course code for a purpose in accounts.mjs. */
  course(purpose) {
    const c = COURSES[purpose];
    if (!c) throw new Error(`unknown course purpose ${purpose}`);
    return c[this.mode];
  }

  /** Account code for a purpose in accounts.mjs. */
  account(purpose) {
    const a = ACCOUNTS[purpose];
    if (!a) throw new Error(`unknown account purpose ${purpose}`);
    return a[this.mode];
  }

  async install() {
    const ctx = this.page.context();
    ctx.on('request', (req) => this.requests.push(req.url()));
    await ctx.route((url) => /^https?:$/.test(url.protocol) && !ALLOWED_HOSTS.includes(url.host), (route) => route.abort('blockedbyclient'));
    await ctx.route(FONT_RE, (route) => route.fulfill({ status: 200, contentType: route.request().url().includes('googleapis') ? 'text/css' : 'font/woff2', body: '' }));
    if (this.isMock) {
      await ctx.exposeBinding('__hubRecord', (_src, json) => { this.records.push(JSON.parse(json)); });
      await ctx.route('**/js/mock-api.js', async (route) => {
        const resp = await route.fetch();
        const src = await resp.text();
        if (!src.includes(HANDLE_DECL)) throw new Error('mock-api.js: handle() declaration not found; update tests/e2e/helpers/hub.mjs');
        await route.fulfill({ response: resp, body: src.replace(HANDLE_DECL, 'async function __hubOriginalHandle(payload) {') + HANDLE_WRAP });
      });
    } else {
      await ctx.route(PAGE_API, async (route) => {
        const req = route.request();
        if (req.method() !== 'POST') return route.continue();
        const resp = await route.fetch();
        const body = await resp.text();
        let action = '?';
        try { action = JSON.parse(req.postData() || '{}').action; } catch (e) { /* recorded as "?" */ }
        try { this.records.push({ action, data: JSON.parse(body) }); } catch (e) { this.records.push({ action, data: null, raw: body }); }
        return route.fulfill({ response: resp, body });
      });
    }
    this.page.on('pageerror', (e) => this.errors.push(String(e && e.stack ? e.stack.split('\n')[0] : e)));
    this.page.on('console', (m) => { if (/\[i18n\] missing/.test(m.text())) this.missingKeys.push(m.text()); });
  }

  /** Problems found by the always-on guards (run after every test). */
  problems() {
    const out = [];
    for (const u of this.requests) {
      if (!/^https?:/.test(u)) continue;
      const host = new URL(u).host;
      if (!ALLOWED_HOSTS.includes(host)) out.push(`request to another host: ${u}`);
    }
    for (const r of this.records) {
      if (!r.data) { out.push(`${r.action}: response was not JSON`); continue; }
      for (const l of findLeaks(r.action, r.data)) out.push(`${r.action}: forbidden key "${l.key}" at ${l.path}`);
      if (r.action === 'start' && r.data.ok) for (const p of itemShapeProblems(r.data.items)) out.push(`start: ${p}`);
    }
    for (const e of this.errors) out.push(`page error: ${e}`);
    for (const m of this.missingKeys) out.push(`i18n: ${m}`);
    return out;
  }

  async teardown() {
    if (this.clockHours) { await moveClock(-this.clockHours); this.clockHours = 0; }
  }

  // ---------------------------------------------------------------- navigation
  /** Adds ?mock=1 or ?api=… to a Hub path. */
  url(path = 'index.html') {
    const u = new URL(path, `${ORIGIN}/`);
    if (this.isMock) u.searchParams.set('mock', '1'); else u.searchParams.set('api', PAGE_API);
    return u.pathname + u.search + u.hash;
  }
  async goto(path) { await this.page.goto(this.url(path)); }

  /** Waits until index.html shows one of: login error, PIN gate, privacy gate, dashboard. */
  async homeView() {
    const handle = await this.page.waitForFunction(() => {
      const app = document.getElementById('app');
      if (!app) return null;
      if (app.querySelector('.login-error .callout')) return 'error';
      if (app.querySelector('#pin-old')) return 'pin';
      if (app.querySelector('.onboard')) return 'consent';
      if (app.querySelectorAll('.course-card').length) return 'dash';
      return null;
    }, null, { timeout: 15_000 });
    return handle.jsonValue();
  }

  /** Sign in on index.html. Accepts the privacy notice when shown (unless consent: false). Returns the view reached. */
  async signIn(code, { pin = this.pin, consent = true, path = 'index.html' } = {}) {
    const { page } = this;
    await this.goto(path);
    await page.locator('#login-code').fill(code);
    await page.locator('#login-pin').fill(pin);
    await page.locator('#app form button[type="submit"]').click();
    let view = await this.homeView();
    if (view === 'consent' && consent) view = await this.acceptConsent();
    return view;
  }

  /** On the privacy gate: "I understand", then wait for the next view. */
  async acceptConsent() {
    await this.page.locator('.onboard .btn-primary').click();
    await expect(this.page.locator('.onboard')).toHaveCount(0, { timeout: 15_000 });
    return this.homeView();
  }

  /** The page's current session token (sessionStorage). */
  async token() {
    return this.page.evaluate(() => { try { return JSON.parse(sessionStorage.getItem('hub.session') || 'null').token; } catch (e) { return null; } });
  }

  /**
   * Call an action directly as the signed-in person (default: the page's own token) — to check a
   * server-side rule the UI would not let you try. Demo mode calls the page's mock `handle()`.
   */
  async callApi(action, params = {}, token) {
    const tk = token === undefined ? await this.token() : token;
    if (this.isReal) return devCall(action, { ...params, token: tk });
    return this.page.evaluate(async ({ action, params, tk }) => {
      const m = await import('./js/mock-api.js');
      return m.handle({ ...params, action, token: tk });
    }, { action, params, tk });
  }

  /** If the "Please sign in again" dialog is open, sign in there. */
  async reauthIfAsked(code) {
    const dlg = this.page.locator('dialog.modal[open] #rl-form');
    try { await dlg.waitFor({ state: 'visible', timeout: 4000 }); } catch (e) { return false; }
    await this.page.locator('#rl-code').fill(code);
    await this.page.locator('#rl-pin').fill(this.pin);
    await this.page.locator('dialog.modal[open] button[type="submit"]').click();
    await expect(this.page.locator('dialog.modal[open] #rl-form')).toHaveCount(0);
    return true;
  }

  // ---------------------------------------------------------------- language and theme
  async setLang(lang) {
    await this.page.locator(`.app-header .seg button[lang="${lang}"]`).click();
    await expect(this.page.locator('html')).toHaveAttribute('lang', lang);
  }

  /** system | light | dark, via the header button (it cycles system → light → dark). */
  async setTheme(mode) {
    for (let i = 0; i < 4; i += 1) {
      const now = await this.page.evaluate(() => { try { return localStorage.getItem('hub.theme') || 'system'; } catch (e) { return 'system'; } });
      if (now === mode) break;
      await this.page.locator('.app-header .header-actions > .icon-btn').click();
    }
    if (mode === 'system') await expect(this.page.locator('html')).not.toHaveAttribute('data-theme', /./);
    else await expect(this.page.locator('html')).toHaveAttribute('data-theme', mode);
  }

  // ---------------------------------------------------------------- dev server clock (real only)
  async moveServerClock(hours) {
    if (!this.isReal) throw new Error('moveServerClock is for the real project');
    await moveClock(hours);
    this.clockHours += hours;
  }

  // ---------------------------------------------------------------- API records
  /** Payloads recorded for an action (newest last). */
  payloads(action) { return this.records.filter((r) => r.action === action).map((r) => r.data); }
  last(action) { const p = this.payloads(action); return p[p.length - 1]; }
  async waitForRecord(action, pred = () => true, timeout = 15_000) {
    await expect.poll(() => this.records.some((r) => r.action === action && pred(r.data)), { timeout, message: `waiting for a ${action} payload` }).toBe(true);
    return this.records.filter((r) => r.action === action && pred(r.data)).pop().data;
  }

  // ---------------------------------------------------------------- quiz helpers
  /** Pick the right (or a wrong) option in one question card (fieldset.qz-q). */
  async choose(card, right) {
    const labels = card.locator('label.opt');
    let target;
    if (this.isMock) {
      const texts = await labels.locator('.txt').allInnerTexts();
      const idx = texts.findIndex((s) => MOCK_RIGHT.test(s));
      if (idx < 0) throw new Error('demo item without its right option');
      target = labels.nth(right ? idx : (idx === 0 ? 1 : 0));
    } else {
      const id = await card.getAttribute('data-item');
      const key = fixtureKey(id);
      const values = await card.locator('input[type="radio"]').evaluateAll((els) => els.map((e) => e.value));
      const v = right ? key : values.find((x) => x !== key);
      target = card.locator(`label.opt:has(input[value="${v}"])`);
    }
    await target.click();
    await expect(target.locator('input')).toBeChecked();
  }

  /** List view (≥ 900 px): answer every card on screen; the first `right` correctly. */
  async answerList(right) {
    const cards = this.page.locator('.qz-run fieldset.qz-q');
    const n = await cards.count();
    for (let i = 0; i < n; i += 1) await this.choose(cards.nth(i), i < right);
    return n;
  }

  /** From the questions view: Review answers → Submit → confirm. Returns the submit payload. */
  async submitQuiz() {
    const before = this.payloads('submit').length;
    await this.page.locator('[data-fk="nav-done"]').click();
    await this.page.locator('.qz-review .q-nav .btn-primary').click();
    await this.page.locator('dialog.modal[open] .btn-primary').click();
    await expect(this.page.locator('.qz-hero')).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => this.payloads('submit').length).toBeGreaterThan(before);
    return this.last('submit');
  }
}

export const test = base.extend({
  hubMode: ['mock', { option: true }],
  hub: [async ({ page, hubMode }, use, testInfo) => {
    if (hubMode === 'real' && process.env.HUB_REAL_STALE) throw new Error(process.env.HUB_REAL_STALE);
    const hub = new Hub(page, hubMode, testInfo);
    await hub.install();
    try {
      await use(hub);
    } finally {
      await hub.teardown();
    }
    const problems = hub.problems();
    expect(problems, 'always-on guards: no answer keys, no other hosts, no page errors, no missing strings').toEqual([]);
  }, { auto: true }],
});
