#!/usr/bin/env node
// Local QA server (zero dependencies): serves docs/ at / and answers POST /api through the
// real backend code running on the Node harness with invented fixtures. Nothing leaves the
// machine; no Google account needed.
//
//   node backend/dev/server.mjs --port 8787 [--clock-offset-hours N] [--host 127.0.0.1]
//   open http://localhost:8787/?api=http://localhost:8787/api
//
// Accounts (all PIN 246810): T001 T005 learners (demand) · T002 T006 (supply) · T003 (materials)
// · T004 (cs) · T010 manager of T001–T003 (also a learner) · T020 panel judge · T030 must change PIN.
// Dev only: POST /__dev/clock {"add_hours": 24} moves the server clock forward (retake tests).
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
  config: { baseline_open_from: day(-3), baseline_open_to: day(10) },
  teams: [
    { team_id: 'TEAM1', project_title: 'Fixture project one', members: 'T001;T002;T003', sponsor_code: 'T010', active: 'TRUE' },
    { team_id: 'TEAM2', project_title: 'Fixture project two', members: 'T004;T005;T006', sponsor_code: 'T010', active: 'TRUE' }
  ]
});

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
  console.log(`Server clock: ${L.iso7(h.clock.now())}${OFFSET_H ? ` (offset ${OFFSET_H} h)` : ''} · courses open since ${day(-14)}, forum ${day(10)} · baseline window ${day(-3)}…${day(10)}`);
  console.log('Accounts (PIN 246810): T001 T005 demand · T002 T006 supply · T003 materials · T004 cs · T010 manager · T020 panel · T030 must change PIN');
});
