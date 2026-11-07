// API client for the Apps Script web app (specs/20_api_contract.md).
// - Live mode: POST GAS_URL with a text/plain JSON body (a "simple request": no CORS preflight).
// - Demo mode: docs/js/mock-api.js, used when GAS_URL is empty or the URL has ?mock=1.
// - Local QA:  ?api=http://localhost:8787/api is honoured only when the Hub itself runs on localhost.
import { GAS_URL } from '../config.js';

const MODE_KEY = 'hub.mode';
const API_KEY = 'hub.api';
const SESSION_KEY = 'hub.session';
const RETRYABLE = new Set(['me', 'start', 'save', 'submit', 'review', 'team_summary', 'team_status', 'capstone_get', 'panel_list', 'watch',
  'baseline_next', 'rate_list', 'rate_get', 'rate_save', 'profile']); // all idempotent on the server
const isLocalHost = ['localhost', '127.0.0.1'].includes(location.hostname);
// Actions that change nothing on the server. Any other action that succeeds drops the cached `me`.
const READ_ONLY = new Set(['me', 'review', 'team_summary', 'team_status', 'capstone_get', 'panel_list', 'rate_list', 'rate_get', 'profile']);
// Signing in changes no learning data (a new token drops the copy in setSession), so a sign-in from the
// "session expired" dialog does not make the `me` it was retrying look out of date.
const NOT_A_CHANGE = new Set([...READ_ONLY, 'login']);
const ME_KEY = 'hub.me';
const ME_MAX_AGE_MS = 15 * 60 * 1000;

function ss(op, key, val) {
  try {
    if (op === 'get') return sessionStorage.getItem(key);
    if (op === 'set') sessionStorage.setItem(key, val);
    if (op === 'del') sessionStorage.removeItem(key);
  } catch (e) { /* storage blocked */ }
  return null;
}
function ls(op, key, val) {
  try {
    if (op === 'get') return localStorage.getItem(key);
    if (op === 'set') localStorage.setItem(key, val);
    if (op === 'del') localStorage.removeItem(key);
  } catch (e) { /* storage blocked */ }
  return null;
}

// ---- Mode ----
(function readModeFromUrl() {
  const p = new URLSearchParams(location.search);
  if (p.get('mock') === '1') ss('set', MODE_KEY, 'mock');
  if (p.get('mock') === '0') ss('del', MODE_KEY);
  if (isLocalHost && p.get('api')) ss('set', API_KEY, p.get('api'));
})();

function endpoint() {
  const local = isLocalHost ? ss('get', API_KEY) : null;
  return local || GAS_URL || '';
}
export const isDemo = () => ss('get', MODE_KEY) === 'mock' || !endpoint();

// ---- Errors ----
export class ApiError extends Error {
  constructor(code, message, extra = {}) {
    super(message || code);
    this.name = 'ApiError';
    this.code = code;
    Object.assign(this, extra);
  }
}

// ---- Session ----
export function getSession() {
  const raw = ss('get', SESSION_KEY) || ls('get', SESSION_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    if (!s || !s.token || (s.expires_at && Date.parse(s.expires_at) <= Date.now())) { clearSession(); return null; }
    return s;
  } catch (e) { clearSession(); return null; }
}
export function setSession({ token, expires_at, profile }, { remember } = {}) {
  const prev = getSession();
  const keep = remember !== undefined ? remember : !!(prev && prev.remember);
  const value = JSON.stringify({ token, expires_at, profile, remember: keep });
  if (!prev || prev.token !== token) ss('del', ME_KEY); // another sign-in: the last `me` is not theirs
  ss('del', SESSION_KEY); ls('del', SESSION_KEY);
  if (keep) ls('set', SESSION_KEY, value); else ss('set', SESSION_KEY, value);
}
export function updateProfile(patch) {
  const s = getSession();
  if (s) setSession({ ...s, profile: { ...s.profile, ...patch } });
}
export function clearSession() { ss('del', SESSION_KEY); ls('del', SESSION_KEY); ss('del', ME_KEY); }

// ---- Last `me` (live mode only) ----
// Each Apps Script call takes a few seconds, so pages draw the last `me` of this tab at once and
// replace it when the fresh one arrives. Kept in sessionStorage (this tab only, gone when it closes),
// tied to the session token, at most 15 minutes old, and dropped after any action that changes data.
const tokenTag = (tok) => String(tok || '').slice(-24);
let writes = 0;
/** Counts data-changing calls started in this page; a `me` that began before one may be out of date. */
export const writeMark = () => writes;
function storeMe(data) {
  const s = getSession();
  if (!s || isDemo()) return;
  ss('set', ME_KEY, JSON.stringify({ tag: tokenTag(s.token), at: Date.now(), data }));
}
/** The last `me` of this tab for the current session, or null. */
export function cachedMe() {
  const s = getSession();
  if (!s || isDemo()) return null;
  try {
    const c = JSON.parse(ss('get', ME_KEY) || 'null');
    if (c && c.tag === tokenTag(s.token) && Date.now() - c.at < ME_MAX_AGE_MS && c.data && c.data.ok) return c.data;
  } catch (e) { /* unreadable: ignore */ }
  return null;
}
// A ticked episode is the one change worth keeping in the cached `me` (it happens on every course visit).
function patchWatched(course, watched) {
  try {
    const c = JSON.parse(ss('get', ME_KEY) || 'null');
    const crs = c && c.data && Array.isArray(c.data.courses) ? c.data.courses.find((x) => x.code === course) : null;
    if (!crs || !Array.isArray(watched)) { ss('del', ME_KEY); return; }
    const set = new Set(watched.map(Number));
    crs.episodes.forEach((e) => { e.watched = set.has(Number(e.ep)); });
    ss('set', ME_KEY, JSON.stringify(c));
  } catch (e) { ss('del', ME_KEY); }
}
/** Same data apart from the server clock (so a page redraws only when something changed). */
export const sameMe = (a, b) => {
  const strip = (x) => JSON.stringify({ ...x, server_now: '' });
  return !!a && !!b && strip(a) === strip(b);
};

// Clock offset (server_now − client now), so timers follow the server clock.
let clockOffset = 0;
export const serverNow = () => Date.now() + clockOffset;

let sessionExpiredHandler = null;
/** Register a handler that shows a sign-in dialog and resolves true when the user signed in again. */
export function onSessionExpired(fn) { sessionExpiredHandler = fn; }

// ---- Transport ----
let mockModule = null;
async function transport(payload) {
  if (isDemo()) {
    if (!mockModule) mockModule = await import('./mock-api.js');
    return mockModule.handle(JSON.parse(JSON.stringify(payload)));
  }
  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
    redirect: 'follow',
    cache: 'no-store',
    keepalive: payload.action === 'save' || payload.action === 'rate_save', // a save started as the page hides still reaches the server (bodies are a few KB)
  });
  if (!res.ok) throw new ApiError('server_error', `HTTP ${res.status}`);
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Call an action. Adds the session token automatically.
 * Retries network failures and `busy` for idempotent actions (up to 3 tries, 1 s / 2 s / 4 s).
 * On `session_expired` asks the registered handler to sign in again, then retries once.
 */
export async function call(action, params = {}, { auth = true, retries } = {}) {
  const maxTries = retries !== undefined ? retries : (RETRYABLE.has(action) ? 3 : 1);
  let attempt = 0;
  let reauthed = false;
  const mark = writes; // a `me` that overlaps a change is not kept
  for (;;) {
    const session = getSession();
    if (!NOT_A_CHANGE.has(action) && attempt === 0 && !reauthed) { writes += 1; if (action !== 'watch') ss('del', ME_KEY); }
    const payload = { action, ...params };
    if (auth && session) payload.token = session.token;
    let data;
    try {
      data = await transport(payload);
    } catch (e) {
      attempt += 1;
      if (attempt < maxTries) { await sleep(1000 * 2 ** (attempt - 1)); continue; }
      throw new ApiError('network', e && e.message ? e.message : 'Network error');
    }
    if (data && data.server_now) {
      const t = Date.parse(data.server_now);
      if (!Number.isNaN(t)) clockOffset = t - Date.now();
    }
    if (data && data.ok) {
      if (action === 'me') { if (writes === mark) storeMe(data); }
      else if (action === 'watch') patchWatched(params.course, data.watched);
      else if (!NOT_A_CHANGE.has(action)) ss('del', ME_KEY);
      return data;
    }
    const err = (data && data.error) || { code: 'server_error', message: 'Unexpected response' };
    if (err.code === 'busy') {
      attempt += 1;
      if (attempt < Math.max(maxTries, 3)) { await sleep(1000 * 2 ** (attempt - 1)); continue; }
    }
    if (err.code === 'session_expired' && auth && !reauthed && sessionExpiredHandler) {
      clearSession();
      reauthed = true;
      const ok = await sessionExpiredHandler();
      if (ok) continue;
    }
    if ((err.code === 'consent_required' || err.code === 'pin_change_required') && auth && !/(^|\/)index\.html$|\/$/.test(location.pathname)) {
      location.replace('index.html'); // finish onboarding (own PIN, privacy notice) first
    }
    const { code, message, ...extra } = err;
    throw new ApiError(code, message, extra);
  }
}

/**
 * Wakes the Apps Script web app while the person types their code and PIN: a script nobody used for a
 * while needs several seconds to start, and this lets the sign-in itself skip that wait. A plain GET
 * of the health check (no data, no token, nothing written); at most once a minute per tab.
 */
export function warmUp() {
  if (isDemo()) return;
  const last = Number(ss('get', 'hub.warm') || 0);
  if (Date.now() - last < 60_000) return;
  ss('set', 'hub.warm', String(Date.now()));
  try { fetch(endpoint(), { method: 'GET', mode: 'no-cors', cache: 'no-store', credentials: 'omit' }).catch(() => {}); } catch (e) { /* best effort */ }
}

// ---- Convenience wrappers (one per action in specs/20) ----
export const api = {
  login: (code, pin) => call('login', { code, pin }, { auth: false }),
  changePin: (old_pin, new_pin) => call('change_pin', { old_pin, new_pin }),
  consent: () => call('consent'),
  logout: () => call('logout', {}, { retries: 1 }),
  setLang: (lang) => call('set_lang', { lang }),
  me: () => call('me'),
  watch: (course, ep, watched) => call('watch', { course, ep, watched }),
  start: (assessment, course, day) => call('start', { assessment, ...(course ? { course } : {}), ...(day ? { day } : {}) }),
  save: (attempt_id, answers, self_ratings) => call('save', { attempt_id, answers, ...(self_ratings ? { self_ratings } : {}) }),
  submit: (attempt_id, answers, self_ratings) => call('submit', { attempt_id, answers, ...(self_ratings ? { self_ratings } : {}) }),
  review: (attempt_id) => call('review', { attempt_id }),
  teamSummary: () => call('team_summary'),
  teamStatus: () => call('team_status'),
  /** Manager records the 15-minute chat for a report's checkpoint; one more attempt opens. */
  unlockRetake: (code, course, note) => call('unlock_retake', { code, course, note: note || '' }),
  capstoneGet: () => call('capstone_get'),
  capstoneSubmit: (stage, team_id, fields) => call('capstone_submit', { stage, team_id, fields }),
  panelList: (stage) => call('panel_list', { stage }),
  panelScore: (stage, team_id, scores, comment) => call('panel_score', { stage, team_id, scores, comment }),
  // ---- Baseline v2 (specs/22 §4) ----
  /** Start or resume one part (1, 2 or 3): `start {assessment: "baseline_p<n>"}`. */
  baselineStart: (part) => call('start', { assessment: `baseline_p${Number(part)}` }),
  /** Part 2: save the SJT answers and lock them; returns the 2B statements. */
  baselineNext: (attempt_id, answers) => call('baseline_next', { attempt_id, answers }),
  rateList: () => call('rate_list'),
  rateGet: (ratee) => call('rate_get', { ratee }),
  rateSave: (ratee, values) => call('rate_save', { ratee, values }),
  profile: () => call('profile'),
};

/** Demo-mode helper used by the footer's "Reset demo" link. */
export async function resetDemo() {
  if (!mockModule) mockModule = await import('./mock-api.js');
  mockModule.reset();
  clearSession();
}
