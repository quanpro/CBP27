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

// The dev server loads the invented fixtures from backend/tests/fixtures.js; their keys are part of
// that public test file (FX_… ids, no real items). Tests use them to answer right or wrong on purpose.
const require = createRequire(import.meta.url);
const fixtures = require('../../../backend/tests/fixtures.js');
const KEYS = new Map(fixtures.buildItems().map((it) => [it.item_id, it.answer]));
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
