// Node-side calls to the local dev server (backend/dev/server.mjs): the real backend code on the
// harness. Used to set up state that a test does not drive through the UI, to check server-side rules
// directly, and to move the server clock. Never used against a deployed backend.
import { createRequire } from 'node:module';
import { PINS } from './accounts.mjs';

export const PORT = Number(process.env.E2E_PORT || 8787);
export const ORIGIN = `http://localhost:${PORT}`;
/** What the page is told to use (?api=…). Same origin as the Hub, so the CSP's connect-src 'self' covers it. */
export const PAGE_API = `${ORIGIN}/api`;
const NODE_API = `http://127.0.0.1:${PORT}/api`;
const NODE_CLOCK = `http://127.0.0.1:${PORT}/__dev/clock`;
const NODE_DEV = (what) => `http://127.0.0.1:${PORT}/__dev/${what}`;

export async function call(action, params = {}) {
  const res = await fetch(NODE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...params }),
  });
  return res.json();
}

/** Sign in from Node and acknowledge the privacy notice (the server refuses other actions before it); returns the token. */
export async function token(code, pin = PINS.real) {
  const r = await call('login', { code, pin });
  if (!r.ok) throw new Error(`dev login ${code} failed: ${r.error && r.error.code}`);
  if (r.profile && r.profile.consent_needed) await call('consent', { token: r.token });
  return r.token;
}

/** Moves the dev server clock (negative hours move it back). Returns the new server_now. */
export async function moveClock(hours) {
  const res = await fetch(NODE_CLOCK, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ add_hours: hours }) });
  const r = await res.json();
  return r.server_now;
}

/** Sets one dev Config switch (p1_open … results_open, p1_minutes …); returns the previous value if the server reports it. */
export async function setConfig(key, value) {
  const res = await fetch(NODE_DEV('config'), { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ key, value: String(value) }) });
  const r = await res.json();
  if (!r.ok) throw new Error(`dev config ${key}: ${JSON.stringify(r)}`);
  return r;
}

/** Runs buildProfiles() or buildSummary() on the dev server now. */
export async function build(what) {
  const res = await fetch(NODE_DEV('build'), { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ what }) });
  const r = await res.json();
  if (!r.ok) throw new Error(`dev build ${what}: ${JSON.stringify(r)}`);
  return r;
}

/** Dev server defaults (backend/dev/server.mjs): restored after a test changes them. */
export const DEV_CONFIG_DEFAULTS = {
  p1_open: 'TRUE', p2_open: 'TRUE', p3_open: 'TRUE', rating_open: 'TRUE', results_open: 'FALSE',
  p1_minutes: '65', p2_minutes: '35', p3_minutes: '48', grace_minutes: '5',
};

// The dev server loads the invented fixtures from backend/tests/fixtures.js; their keys are part of
// that public test file (FX_… ids, no real items). Tests use them to answer right or wrong on purpose.
const require = createRequire(import.meta.url);
const fixtures = require('../../../backend/tests/fixtures.js');
const KEYS = new Map(fixtures.buildItems().map((it) => [it.item_id, it.answer]));
const BL_KEYS = new Map(fixtures.buildBaselineItems().map((it) => [it.item_id, it]));
/** Baseline fixture key: mcq → answer letter; sjt → {most, least}. */
export function baselineKey(itemId) {
  const it = BL_KEYS.get(itemId);
  if (!it) throw new Error(`no baseline fixture item ${itemId}`);
  return it.item_type === 'sjt' ? { most: it.answer_most, least: it.answer_least } : it.answer;
}
export function fixtureKey(itemId) {
  const k = KEYS.get(itemId);
  if (!k) throw new Error(`no fixture key for ${itemId}`);
  return k;
}
export const FIXTURE_COURSES = fixtures.COURSES;

/** Answers for a served item list: `right` items correct, the rest wrong (first other option). */
export function answersFor(items, right) {
  const out = {};
  items.forEach((it, i) => {
    const k = fixtureKey(it.item_id);
    out[it.item_id] = i < right ? k : it.options.map((o) => o.id).find((id) => id !== k);
  });
  return out;
}

/** Full self-rating map for the baseline. */
export const selfRatings = (level = 2) => Object.fromEntries(FIXTURE_COURSES.map((c) => [c, level]));
