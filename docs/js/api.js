// API client for the Apps Script web app (specs/20_api_contract.md).
// - Live mode: POST GAS_URL with a text/plain JSON body (a "simple request": no CORS preflight).
// - Demo mode: docs/js/mock-api.js, used when GAS_URL is empty or the URL has ?mock=1.
// - Local QA:  ?api=http://localhost:8787/api is honoured only when the Hub itself runs on localhost.
import { GAS_URL } from '../config.js';

const MODE_KEY = 'hub.mode';
const API_KEY = 'hub.api';
const SESSION_KEY = 'hub.session';
const RETRYABLE = new Set(['me', 'start', 'save', 'submit', 'review', 'team_summary', 'team_status', 'capstone_get', 'panel_list', 'watch']);
const isLocalHost = ['localhost', '127.0.0.1'].includes(location.hostname);

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
  clearSession();
  if (keep) ls('set', SESSION_KEY, value); else ss('set', SESSION_KEY, value);
}
export function updateProfile(patch) {
  const s = getSession();
  if (s) setSession({ ...s, profile: { ...s.profile, ...patch } });
}
export function clearSession() { ss('del', SESSION_KEY); ls('del', SESSION_KEY); }

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
  for (;;) {
    const session = getSession();
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
    if (data && data.ok) return data;
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
    const { code, message, ...extra } = err;
    throw new ApiError(code, message, extra);
  }
}

// ---- Convenience wrappers (one per action in specs/20) ----
export const api = {
  login: (code, pin) => call('login', { code, pin }, { auth: false }),
  changePin: (old_pin, new_pin) => call('change_pin', { old_pin, new_pin }),
  consent: () => call('consent'),
  setLang: (lang) => call('set_lang', { lang }),
  me: () => call('me'),
  watch: (course, ep, watched) => call('watch', { course, ep, watched }),
  start: (assessment, course, day) => call('start', { assessment, ...(course ? { course } : {}), ...(day ? { day } : {}) }),
  save: (attempt_id, answers, self_ratings) => call('save', { attempt_id, answers, ...(self_ratings ? { self_ratings } : {}) }),
  submit: (attempt_id, answers, self_ratings) => call('submit', { attempt_id, answers, ...(self_ratings ? { self_ratings } : {}) }),
  review: (attempt_id) => call('review', { attempt_id }),
  teamSummary: () => call('team_summary'),
  teamStatus: () => call('team_status'),
  capstoneGet: () => call('capstone_get'),
  capstoneSubmit: (stage, team_id, fields) => call('capstone_submit', { stage, team_id, fields }),
  panelList: (stage) => call('panel_list', { stage }),
  panelScore: (stage, team_id, scores, comment) => call('panel_score', { stage, team_id, scores, comment }),
};

/** Demo-mode helper used by the footer's "Reset demo" link. */
export async function resetDemo() {
  if (!mockModule) mockModule = await import('./mock-api.js');
  mockModule.reset();
  clearSession();
}
