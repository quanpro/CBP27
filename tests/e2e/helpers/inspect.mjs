// Page inspection helpers: visible strings (EN/VI), horizontal overflow (360 px), axe scans.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';

const DOCS = fileURLToPath(new URL('../../../docs/', import.meta.url));
const readJson = (rel) => JSON.parse(readFileSync(DOCS + rel, 'utf8'));

// ---------------------------------------------------------------- visible strings
/** Every visible text node and placeholder under <body>, whitespace-collapsed, in DOM order. */
export async function visibleStrings(page) {
  return page.evaluate(() => {
    const out = [];
    const shown = (el) => el && el.getClientRects().length > 0
      && (!el.checkVisibility || el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true }));
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const s = n.nodeValue.replace(/\s+/g, ' ').trim();
      const el = n.parentElement;
      if (!s || !el || el.closest('script, style, noscript, template, svg')) continue;
      if (el.closest('.sr-only[aria-live]')) continue; // one-off screen-reader announcements, not page text
      if (!shown(el)) continue;
      out.push(s);
    }
    document.querySelectorAll('input[placeholder], textarea[placeholder]').forEach((el) => { if (shown(el) && el.placeholder.trim()) out.push(el.placeholder.trim()); });
    return out;
  });
}

const RAW_KEY = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
/** Strings that look like an untranslated i18n key ("home.title"). */
export const rawKeys = (strings) => strings.filter((s) => RAW_KEY.test(s));

// Strings that are the same in both languages by design.
function flat(o, p = '', out = {}) {
  for (const [k, v] of Object.entries(o)) { if (v && typeof v === 'object') flat(v, `${p}${k}.`, out); else out[`${p}${k}`] = v; }
  return out;
}
// Same dictionaries the page builds: en.json / vi.json plus any build-time parts listed in i18n.js PARTS.
const PARTS = ((readFileSync(DOCS + 'js/i18n.js', 'utf8').match(/const PARTS = \[([^\]]*)\]/) || [])[1] || '')
  .split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
const dict = (lang) => {
  const out = flat(readJson(`i18n/${lang}.json`));
  for (const p of PARTS) { try { Object.assign(out, flat(readJson(`i18n/parts/${p}.${lang}.json`))); } catch (e) { /* part not present */ } }
  return out;
};
const EN = dict('en');
const VI = dict('vi');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** en.json values equal to their vi.json value, as patterns ({vars} match anything). */
const SAME_IN_BOTH = Object.keys(EN).filter((k) => typeof EN[k] === 'string' && EN[k] === VI[k] && EN[k].trim())
  .map((k) => new RegExp(`^${EN[k].trim().split(/\{\w+\}/).map(escapeRe).join('.*')}$`));
/** en == vi values without variables ("Checkpoint", "Capstone" …), longest first, removed inside longer strings. */
const SAME_WORDS = [...new Set(Object.keys(EN).filter((k) => typeof EN[k] === 'string' && EN[k] === VI[k] && EN[k].trim() && !/\{\w+\}/.test(EN[k]))
  .map((k) => EN[k].trim()))].sort((a, b) => b.length - a.length);
const CATALOG = readJson('data/courses.json');
const CODES = CATALOG.courses.map((c) => c.code);
// No letters left once course codes, option letters, units and the brand are removed.
const NEUTRAL_TOKENS = new RegExp(`\\b(${CODES.join('|')}|EN|VI|PIN|KPI|SOI|VND|Blink|Marico|The 1% Planner|[A-Z]|BA|WK|FO|LE|MOCK-\\d+|FX_[A-Z0-9_]+|DEMO-[A-Z0-9]+|T\\d{3}|TEAM\\d*|TEAM-DEMO(-2)?)\\b`, 'g');

/**
 * A string that did not change between EN and VI is fine when it is language-neutral: no words
 * left after removing codes/numbers, the same in en.json and vi.json, or data typed by people
 * (project titles, names, comments: fields without an _en/_vi pair in the API payloads).
 */
export function isNeutral(s, dataStrings = new Set()) {
  if (dataStrings.has(s)) return true;
  if (SAME_IN_BOTH.some((re) => re.test(s))) return true;
  let t = s.replace(/https?:\/\/\S+/g, '');
  for (const w of SAME_WORDS) t = t.split(w).join(' ');
  const rest = t.replace(NEUTRAL_TOKENS, '').replace(/[\d\s.,:;%×+\-–—·/()#?!'"’“”…|<>=≈≥≤✓₫*&_]/g, '');
  return rest === '';
}

/** Strings from API payloads that are not translatable (fields with no _en/_vi partner). */
export function dataStrings(records) {
  const out = new Set();
  const walk = (v, key) => {
    if (Array.isArray(v)) { v.forEach((x) => walk(x, key)); return; }
    if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v)) { if (/_(en|vi)$/.test(k) || k === 'en' || k === 'vi') continue; walk(x, k); } return; }
    if (typeof v === 'string' && v.trim() && !['server_now', 'token'].includes(key)) {
      out.add(v.trim());
      v.split(/\s*[\n·]\s*/).forEach((p) => p.trim() && out.add(p.trim()));
    }
  };
  records.forEach((r) => walk(r.data, ''));
  return out;
}

/**
 * Toggle EN → VI on the current page and compare: every visible string must change unless it is
 * language-neutral; no raw keys in either language. Then toggle back and expect the EN text again.
 */
export async function expectFullyTranslated(hub, label) {
  const { page } = hub;
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  const en = await visibleStrings(page);
  await hub.setLang('vi');
  await page.waitForTimeout(150); // re-render settles
  const vi = await visibleStrings(page);
  const data = dataStrings(hub.records);
  const enSet = new Set(en);
  const unchanged = [...new Set(vi.filter((s) => enSet.has(s) && !isNeutral(s, data)))];
  expect(rawKeys(en).concat(rawKeys(vi)), `${label}: raw i18n keys on screen`).toEqual([]);
  expect(vi.length, `${label}: VI page shows text`).toBeGreaterThan(5);
  expect(unchanged, `${label}: strings that stayed in English after switching to VI`).toEqual([]);
  await hub.setLang('en');
  await page.waitForTimeout(150);
  const back = new Set(await visibleStrings(page));
  const lost = [...new Set(en.filter((s) => !back.has(s) && !/\d/.test(s)))];
  expect(lost, `${label}: EN strings missing after switching back`).toEqual([]);
}

// ---------------------------------------------------------------- 360 px
/** Elements that stick out of the viewport sideways (outside a horizontal scroller). */
export async function horizontalOverflow(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out = [];
    const scroller = (el) => {
      for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
      }
      return false;
    };
    const se = document.scrollingElement || document.documentElement;
    if (se.scrollWidth > vw + 1) out.push(`document scrollWidth ${se.scrollWidth} > ${vw}`);
    for (const el of document.body.querySelectorAll('*')) {
      if (el.closest('.sr-only, dialog:not([open]), [hidden]')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if ((r.right > vw + 1 || r.left < -1) && !scroller(el)) {
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed' && (r.right <= 0 || r.left >= vw)) continue; // parked off-screen on purpose
        out.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${[...el.classList].join('.')} [${Math.round(r.left)}, ${Math.round(r.right)}]`);
      }
    }
    return out.slice(0, 12);
  });
}

// ---------------------------------------------------------------- axe
/** axe WCAG 2 A/AA; returns serious and critical violations as readable lines. */
export async function axeSerious(page, { rules } = {}) {
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']);
  if (rules) builder = builder.withRules(rules);
  const res = await builder.analyze();
  return res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 4).map((n) => n.target.join(' ')).join(' | ')}${v.nodes.length > 4 ? ` … +${v.nodes.length - 4}` : ''} — ${v.nodes[0] && v.nodes[0].failureSummary ? v.nodes[0].failureSummary.split('\n').slice(0, 2).join(' ') : ''}`);
}
