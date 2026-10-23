// EN/VI strings. Default EN; the choice is remembered in localStorage (wrapped in try/catch).
// Usage: await initI18n(); t('nav.home'); t('quiz.progress', {n: 3, total: 10});
//        <span data-i18n="nav.home"></span> is filled by applyI18n(); pick(course, 'name') → name_vi | name_en.

const LANGS = ['en', 'vi'];
const STORE_KEY = 'hub.lang';
const dicts = { en: {}, vi: {} };
let lang = 'en';
const listeners = new Set();

function readStored() {
  try { const v = localStorage.getItem(STORE_KEY); return LANGS.includes(v) ? v : null; } catch (e) { return null; }
}
function writeStored(v) {
  try { localStorage.setItem(STORE_KEY, v); } catch (e) { /* private mode */ }
}

async function loadDict(code) {
  const res = await fetch(new URL(`../i18n/${code}.json`, import.meta.url), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`i18n ${code}: HTTP ${res.status}`);
  return res.json();
}

// Build-time only: page areas keep their strings in i18n/parts/<area>.<lang>.json until they are
// merged into en.json / vi.json (tools/merge_parts.mjs). Empty in the shipped Hub.
const PARTS = [];

function deepMerge(base, extra) {
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) base[k] = deepMerge(base[k] && typeof base[k] === 'object' ? base[k] : {}, v);
    else base[k] = v;
  }
  return base;
}

export async function initI18n() {
  const part = (p, code) => fetch(new URL(`../i18n/parts/${p}.${code}.json`, import.meta.url), { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const [en, vi, ...parts] = await Promise.all([loadDict('en'), loadDict('vi').catch(() => ({})),
    ...PARTS.flatMap((p) => [part(p, 'en'), part(p, 'vi')])]);
  dicts.en = en; dicts.vi = vi;
  PARTS.forEach((p, i) => { deepMerge(dicts.en, parts[2 * i]); deepMerge(dicts.vi, parts[2 * i + 1]); });
  lang = readStored() || 'en';
  document.documentElement.lang = lang;
  return lang;
}

export function getLang() { return lang; }

export function setLang(next, { silent = false } = {}) {
  if (!LANGS.includes(next) || next === lang) return;
  lang = next;
  writeStored(next);
  document.documentElement.lang = next;
  applyI18n(document);
  if (!silent) listeners.forEach((fn) => { try { fn(lang); } catch (e) { console.error(e); } });
}

/** Subscribe to language changes; returns an unsubscribe function. */
export function onLangChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function lookup(dict, key) {
  return key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), dict);
}

/** Translate a key. Vars replace {name}. If vars.count is set, uses key_one / key_other when present. */
export function t(key, vars) {
  let k = key;
  if (vars && typeof vars.count === 'number') {
    const form = vars.count === 1 ? `${key}_one` : `${key}_other`;
    if (lookup(dicts[lang], form) !== undefined || lookup(dicts.en, form) !== undefined) k = form;
  }
  let s = lookup(dicts[lang], k);
  if (typeof s !== 'string') s = lookup(dicts.en, k);
  if (typeof s !== 'string') {
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') console.warn('[i18n] missing', key);
    return key;
  }
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, name) => (vars[name] !== undefined && vars[name] !== null ? String(vars[name]) : m));
  return s;
}

/** True if the key exists in English (useful for optional strings such as error codes). */
export function has(key) { return typeof lookup(dicts.en, key) === 'string'; }

/** Pick a bilingual field: pick(obj, 'name') → obj.name_vi in VI (falls back to EN). */
export function pick(obj, field) {
  if (!obj) return '';
  const v = obj[`${field}_${lang}`];
  return (v !== undefined && v !== null && v !== '') ? v : (obj[`${field}_en`] || '');
}

/** Fill [data-i18n], [data-i18n-placeholder], [data-i18n-aria], [data-i18n-title] under root. */
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder)); });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.setAttribute('title', t(el.dataset.i18nTitle)); });
  const titleKey = document.body && document.body.dataset.titleKey;
  if (titleKey) document.title = `${t(titleKey)} · ${t('brand.name')}`;
}

/** All keys of a dictionary, flattened (used by tests for EN/VI parity). */
export function flatKeys(dict = dicts.en, prefix = '') {
  return Object.entries(dict).flatMap(([k, v]) => (v && typeof v === 'object' ? flatKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}
