#!/usr/bin/env node
// Local QA server (zero dependencies): serves docs/ at / and answers POST /api through the
// real backend code running on the Node harness with invented fixtures. Nothing leaves the
// machine; no Google account needed.
//
//   node backend/dev/server.mjs --port 8787 [--clock-offset-hours N] [--host 127.0.0.1]
//   open http://localhost:8787/?api=http://localhost:8787/api
//
// Accounts (all PIN 246810): T001 T005 learners (demand) · T002 T006 (supply) · T003 (materials)
// · T004 (cs) · T007 (materials, all three baseline parts done + rated by T010) · T010 manager of
// T001–T003 and T007 (also a learner; rates them) · T050 admin (rates T010) · T020 panel judge
// · T030 must change PIN.
// Baseline v2: parts 1–3 and manager rating open; results (profiles, team baseline numbers) closed.
// Dev only (never in the real backend):
//   POST /__dev/clock {"add_hours": 24}                  moves the server clock forward (retakes, timers)
//   POST /__dev/config {"key": "results_open", "value": "TRUE"}   sets one Config switch and refreshes the cache
//        (keys: p1_open p2_open p3_open rating_open results_open p1_minutes p2_minutes p3_minutes grace_minutes)
//   POST /__dev/build {"what": "profiles"|"summary"}     runs buildProfiles() or buildSummary() now
import http from 'node:http';
import { createRequire } from 'node:module';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createHarness } = require('../tests/harness.js');
const fx = require('../tests/fixtures.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(HERE, '..', '..', 'docs');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt;
}
const PORT = parseInt(arg('port', process.env.PORT || '8787'), 10);
const HOST = arg('host', '127.0.0.1');
const OFFSET_H = parseFloat(arg('clock-offset-hours', '0')) || 0;

// ---------------------------------------------------------------- backend on the harness
const h = createHarness({ realClock: true, offsetMs: OFFSET_H * 3600000 });
const L = h.ctx; // Logic.gs helpers live in the same context
const today = L.date7(h.clock.now());
const day = (n) => L.addDays(today, n);
fx.loadFixtures(h, {
  roster: fx.devRoster(),
  courseDates: () => ({ online_from: day(-14), checkpoint_close: day(7), forum_date: day(10), field_until: day(40), open: 'TRUE' }),
  config: { p1_open: 'TRUE', p2_open: 'TRUE', p3_open: 'TRUE', rating_open: 'TRUE', results_open: 'FALSE' },
  teams: [
    { team_id: 'TEAM1', project_title: 'Fixture project one', members: 'T001;T002;T003', sponsor_code: 'T010', active: 'TRUE' },
    { team_id: 'TEAM2', project_title: 'Fixture project two', members: 'T004;T005;T006', sponsor_code: 'T010', active: 'TRUE' }
  ]
});

// T007 has done all three baseline parts, and T010 has rated T007 (for the profile once results_open is on).
function seedBaselineT007() {
  const call = (p) => { const r = h.call(p); if (!r.ok) throw new Error(`dev seed ${p.action}: ${r.error.code}`); return r; };
  const items = fx.buildBaselineItems();
  const key = Object.fromEntries(items.map((i) => [i.item_id, i]));
  const token = call({ action: 'login', code: 'T007', pin: fx.PIN }).token;
  const mcq = (s, right) => Object.fromEntries(s.sections.flatMap((x) => x.items).map((it, i) => [it.item_id, i < right ? key[it.item_id].answer : (key[it.item_id].answer === 'a' ? 'b' : 'a')]));
  const p1 = call({ action: 'start', token, assessment: 'baseline_p1' });
  call({ action: 'submit', token, attempt_id: p1.attempt_id, answers: mcq(p1, 21) });
  const p2 = call({ action: 'start', token, assessment: 'baseline_p2' });
  const sjt = Object.fromEntries(p2.sections[0].items.map((it, i) => [it.item_id, { most: key[it.item_id].answer_most, least: i < 10 ? key[it.item_id].answer_least : ['a', 'b', 'c', 'd'].find((l) => l !== key[it.item_id].answer_most && l !== key[it.item_id].answer_least) }]));
  const rate = call({ action: 'baseline_next', token, attempt_id: p2.attempt_id, answers: sjt }).section.items;
  call({ action: 'submit', token, attempt_id: p2.attempt_id, answers: Object.fromEntries(rate.map((it, i) => [it.item_id, it.allow_nr ? 'NR' : 3 + (i % 2)])) });
  const p3 = call({ action: 'start', token, assessment: 'baseline_p3' });
  call({ action: 'submit', token, attempt_id: p3.attempt_id, answers: mcq(p3, 17), self_ratings: { A2: 3, A3: 2, A1: 3, P1: 2, C1: 3, P2: 1, P3: 4, P4: 1, P5: 3, P6: 1 } });
  const mt = call({ action: 'login', code: 'T010', pin: fx.PIN }).token;
  call({ action: 'consent', token: mt });
  call({ action: 'rate_save', token: mt, ratee: 'T007', values: Object.fromEntries(rate.map((it, i) => [it.item_id, i % 7 === 0 ? 'NA' : 1 + (i % 3)])) });
  // T010 starts with consent_needed like every other dev account: clear it again
  h.updateWhere('Roster', 'employee_code', 'T010', { consent_at: '' });
  h.run('resetRequest_');
}
seedBaselineT007();

const DEV_CONFIG_KEYS = new Set(['p1_open', 'p2_open', 'p3_open', 'rating_open', 'results_open', 'p1_minutes', 'p2_minutes', 'p3_minutes', 'grace_minutes']);

// ---------------------------------------------------------------- HTTP
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function send(res, status, body, type, extra) {
  res.writeHead(status, Object.assign({ 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extra || {}));
  res.end(body);
}

function readBody(req) {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 1e6) { fail(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

async function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, 'Bad path', 'text/plain'); }
  let file = resolve(DOCS, '.' + rel);
  if (file !== DOCS && !file.startsWith(DOCS + sep)) return send(res, 403, 'Forbidden', 'text/plain');
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const data = await readFile(file);
    send(res, 200, req.method === 'HEAD' ? '' : data, TYPES[extname(file).toLowerCase()] || 'application/octet-stream');
  } catch {
    send(res, 404, 'Not found: ' + rel, 'text/plain; charset=utf-8');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api' || url.pathname === '/api/') {
      if (req.method === 'OPTIONS') return send(res, 204, '', 'text/plain', CORS);
      if (req.method === 'GET') return send(res, 200, JSON.stringify(h.get()), null, CORS);
      if (req.method !== 'POST') return send(res, 405, '{"ok":false}', null, CORS);
      const body = await readBody(req);
      const out = h.postRaw(body);
      let action = '?', result = '';
      try { action = JSON.parse(body).action; } catch { /* bad JSON is answered by the backend */ }
      try { const o = JSON.parse(out); result = o.ok ? 'ok' : o.error.code; } catch { /* ignore */ }
      console.log(`${new Date().toISOString().slice(11, 19)} POST /api ${action} → ${result}`);
      return send(res, 200, out, null, CORS);
    }
    if (url.pathname === '/__dev/clock' && req.method === 'POST') {
      let hours = 0;
      try { hours = Number(JSON.parse((await readBody(req)) || '{}').add_hours) || 0; } catch { /* 0 */ }
      h.clock.advance(hours * 3600000);
      return send(res, 200, JSON.stringify({ ok: true, server_now: L.iso7(h.clock.now()) }), null, CORS);
    }
    if (url.pathname === '/__dev/config' && req.method === 'POST') {
      let b = {};
      try { b = JSON.parse((await readBody(req)) || '{}'); } catch { /* empty */ }
      if (!DEV_CONFIG_KEYS.has(b.key)) return send(res, 400, JSON.stringify({ ok: false, error: { code: 'bad_request', message: 'key must be one of ' + [...DEV_CONFIG_KEYS].join(', ') } }), null, CORS);
      h.setConfig(b.key, String(b.value));
      return send(res, 200, JSON.stringify({ ok: true, key: b.key, value: String(b.value) }), null, CORS);
    }
    if (url.pathname === '/__dev/build' && req.method === 'POST') {
      let b = {};
      try { b = JSON.parse((await readBody(req)) || '{}'); } catch { /* empty */ }
      const fn = b.what === 'summary' ? 'buildSummary' : b.what === 'profiles' ? 'buildProfiles' : '';
      if (!fn) return send(res, 400, JSON.stringify({ ok: false, error: { code: 'bad_request', message: 'what must be profiles or summary' } }), null, CORS);
      return send(res, 200, JSON.stringify({ ok: true, what: b.what, rows: h.run(fn) }), null, CORS);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(e);
    return send(res, 500, JSON.stringify({ ok: false, error: { code: 'server_error', message: 'dev server error' } }), null, CORS);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`1% Planner dev server on http://localhost:${PORT}/  (API: POST http://localhost:${PORT}/api)`);
  console.log(`Hub against this backend: http://localhost:${PORT}/?api=http://localhost:${PORT}/api`);
  console.log(`Server clock: ${L.iso7(h.clock.now())}${OFFSET_H ? ` (offset ${OFFSET_H} h)` : ''} · courses open since ${day(-14)}, forum ${day(10)} · baseline parts 1–3 and rating open, results closed`);
  console.log('Accounts (PIN 246810): T001 T005 demand · T002 T006 supply · T003 materials · T004 cs · T007 baseline done · T010 manager · T050 admin · T020 panel · T030 must change PIN');
  console.log('Dev hooks: POST /__dev/clock {add_hours} · /__dev/config {key, value} · /__dev/build {what: profiles|summary}');
});
