#!/usr/bin/env node
// Unit tests for backend/Logic.gs (pure functions). Run: node backend/tests/logic.test.js
// Re-runs itself under TZ=UTC, America/New_York and Asia/Ho_Chi_Minh to prove the
// date logic never depends on the machine's time zone.
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const L = require(path.join(__dirname, '..', 'Logic.gs'));

let count = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function eq(a, b, msg) { count++; assert.deepStrictEqual(a, b, msg); }
function ok(v, msg) { count++; assert.ok(v, msg); }

const sha256 = (s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b));
const hmac = (secret) => (msg) => crypto.createHmac('sha256', secret).update(msg, 'utf8').digest('base64url');
const T = (s) => Date.parse(s);

// ------------------------------------------------------------ fixtures (invented)
function fxItem(id, answer, extra) {
  return Object.assign({
    item_id: id, assessment: 'checkpoint', course: 'A2', form: 'A', objective: '1', case_id: '',
    stem_en: 'Fixture stem ' + id, stem_vi: 'VI fixture stem ' + id,
    a_en: 'opt a', a_vi: 'vi a', b_en: 'opt b', b_vi: 'vi b', c_en: 'opt c', c_vi: 'vi c', d_en: 'opt d', d_vi: 'vi d',
    answer: answer, why_en: 'because fixture', why_vi: 'vi because', active: 'TRUE'
  }, extra || {});
}
const formIds = Array.from({ length: 10 }, (_, i) => 'FX_A2_A_' + String(i + 1).padStart(2, '0'));
const keyMap = {}; const objMap = {};
formIds.forEach((id, i) => { keyMap[id] = 'abcd'[i % 4]; objMap[id] = String((i % 5) + 1); });

// ------------------------------------------------------------ serveItem
test('serveItem strips answer and why, keeps letters, deterministic shuffle', () => {
  const row = fxItem('FX_A2_A_01', 'c', { mockCorrect: 'c', correct: 'c', secret_col: 'x' });
  const s = L.serveItem(row, 'seed-1');
  const keys = Object.keys(s).sort();
  eq(keys, ['case_id', 'course', 'item_id', 'objective', 'options', 'stem_en', 'stem_vi']);
  const json = JSON.stringify(s);
  ok(!/"answer"|"why_en"|"why_vi"|"why"|"correct"|"mockCorrect"/.test(json), 'no key fields in served item');
  eq(s.options.map((o) => o.id).sort(), ['a', 'b', 'c', 'd']);
  eq(s.options.every((o) => Object.keys(o).sort().join() === 'en,id,vi'), true);
  eq(L.serveItem(row, 'seed-1').options, s.options, 'same seed → same option order');
  const orders = new Set();
  for (let i = 0; i < 30; i++) orders.add(L.serveItem(row, 'seed-' + i).options.map((o) => o.id).join(''));
  ok(orders.size > 5, 'different seeds give different orders');
  eq(L.serveItem(row, 'x').options.find((o) => o.id === 'c').en, 'opt c', 'letter keeps its own text');
  eq(L.serveItem(row).objective, 1);
});

// ------------------------------------------------------------ grade
test('grade: 8/10 passes, 7/10 fails, unanswered = wrong', () => {
  const answers8 = {}; formIds.forEach((id, i) => { answers8[id] = i < 8 ? keyMap[id] : (keyMap[id] === 'a' ? 'b' : 'a'); });
  const g8 = L.grade(formIds, answers8, keyMap, objMap);
  eq(g8.n_correct, 8); eq(g8.score_pct, 80); eq(L.isPass(g8.n_correct, g8.n_items, 0.8), true);
  const answers7 = Object.assign({}, answers8); delete answers7[formIds[7]];
  const g7 = L.grade(formIds, answers7, keyMap, objMap);
  eq(g7.n_correct, 7); eq(g7.score_pct, 70); eq(L.isPass(g7.n_correct, g7.n_items, 0.8), false);
  eq(g7.results[7].your, null, 'unanswered is null');
  eq(L.isPass(8, 10, '80'), true, 'pass mark given as percent');
  eq(g8.by_objective['4'], { n: 2, correct: 1 });
  eq(L.weakObjectives(g8.by_objective), [4, 5]);
  eq(L.grade(formIds, {}, keyMap, objMap).score_pct, 0);
  eq(L.cleanAnswers({ FX_A2_A_01: 'B', FX_A2_A_02: 'z', other: 'a' }, formIds), { FX_A2_A_01: 'b' });
});

test('byCourse and gaps tie-breaks', () => {
  const ids = ['FX_BL_A2_01', 'FX_BL_A2_02', 'FX_BL_A3_01', 'FX_BL_A3_02', 'FX_BL_CASE_01'];
  const k = { FX_BL_A2_01: 'a', FX_BL_A2_02: 'a', FX_BL_A3_01: 'a', FX_BL_A3_02: 'a', FX_BL_CASE_01: 'a' };
  const cm = { FX_BL_A2_01: 'A2', FX_BL_A2_02: 'A2', FX_BL_A3_01: 'A3', FX_BL_A3_02: 'A3', FX_BL_CASE_01: 'A2' };
  eq(L.byCourse(ids, { FX_BL_A2_01: 'a', FX_BL_CASE_01: 'a', FX_BL_A3_01: 'a' }, k, cm), { A2: 67, A3: 50 }, 'case item counts for its course');
  const order = ['A2', 'A3', 'A1', 'P1', 'C1'];
  eq(L.gaps({ A2: 50, A3: 25, A1: 75, P1: 25 }, { A3: 2, P1: 1 }, order), ['P1', 'A3'], 'tie → lower self first');
  eq(L.gaps({ A2: 50, A3: 25, A1: 25 }, { A3: 2, A1: 2 }, order), ['A3', 'A1'], 'tie on self → calendar order');
  eq(L.gaps({ C1: 0, P1: 0, A2: 0 }, {}, order), ['A2', 'P1']);
});

test('calibration flags', () => {
  eq(L.calibrationFlag(3, 49), 'rates high, scores low');
  eq(L.calibrationFlag(1, 80), 'rates low, scores high');
  eq(L.calibrationFlag(2, 10), '');
});

// ------------------------------------------------------------ retake / gate
test('canRetake: 23h59m rejected, 24h allowed, attempt 3 needs unlock', () => {
  const last = T('2027-01-10T09:00:00+07:00');
  const r1 = L.canRetake(L.iso7(last), last + (23 * 60 + 59) * 60000, 24, 2, 2, false);
  eq(r1.ok, false); eq(r1.code, 'retake_too_soon'); eq(r1.next_retake_at, '2027-01-11T09:00:00+07:00');
  eq(L.canRetake(L.iso7(last), last + 24 * 3600000, 24, 2, 2, false).ok, true);
  const r3 = L.canRetake(L.iso7(last), last + 25 * 3600000, 24, 3, 2, false);
  eq(r3.code, 'unlock_needed');
  eq(L.canRetake(L.iso7(last), last + 25 * 3600000, 24, 3, 2, true).ok, true);
  eq(L.canRetake('', last, 24, 1, 2, false).ok, true, 'first attempt');
});

test('checkpointGate order and late window', () => {
  const now = T('2027-02-01T10:00:00+07:00');
  const late = L.dayEnd7('2027-02-02');
  const base = { nowMs: now, retakeHours: 24, maxFree: 2, lateUntilMs: late, unusedUnlocks: 0 };
  eq(L.checkpointGate(Object.assign({}, base, { passed: true })).code, 'already_passed');
  eq(L.checkpointGate(Object.assign({}, base, { attemptNo: 2, lastSubmittedMs: now - 3600000 })).code, 'retake_too_soon');
  eq(L.checkpointGate(Object.assign({}, base, { attemptNo: 3, lastSubmittedMs: now - 30 * 3600000 })).code, 'unlock_needed');
  eq(L.checkpointGate(Object.assign({}, base, { attemptNo: 3, lastSubmittedMs: now - 30 * 3600000, unusedUnlocks: 1 })), { ok: true, uses_unlock: true });
  const after = Object.assign({}, base, { nowMs: late + 1, attemptNo: 1 });
  eq(L.checkpointGate(after).code, 'gate_closed');
  eq(L.checkpointGate(Object.assign({}, after, { unusedUnlocks: 1 })).ok, true);
  eq(L.checkpointGate(Object.assign({}, base, { nowMs: late, attemptNo: 1 })).ok, true, 'still open at 23:59:59.999');
  eq(L.unlocksUsed([{ attempt_no: 1, started_ms: now }, { attempt_no: 3, started_ms: now }, { attempt_no: 2, started_ms: late + 5 }], 2, late), 2);
});

test('pickForm balances first attempts over 20 people and alternates later', () => {
  const counts = { A: 0, B: 0 };
  for (let i = 1; i <= 20; i++) {
    const f = L.pickForm(counts, [], 'T' + String(i).padStart(3, '0'), 'A2');
    counts[f]++;
  }
  eq(counts, { A: 10, B: 10 });
  eq(L.pickForm({ A: 3, B: 5 }, [], 'T001', 'A2'), 'A');
  eq(L.pickForm({ A: 5, B: 3 }, [], 'T001', 'A2'), 'B');
  eq(L.pickForm({ A: 0, B: 9 }, ['A'], 'T001', 'A2'), 'B', 'second attempt alternates');
  eq(L.pickForm({}, ['A', 'B'], 'T001', 'A2'), 'A');
  const firsts = ['A2', 'A3', 'A1', 'P1', 'C1', 'P2', 'P3', 'P4', 'P5', 'P6'].map((c) => L.pickForm({ A: 0, B: 0 }, [], 'T001', c));
  ok(firsts.includes('A') && firsts.includes('B'), 'tie-break varies across courses for one person');
  eq(L.pickForm({ A: 0, B: 0 }, [], 't001', 'A2'), L.pickForm({ A: 0, B: 0 }, [], 'T001', 'A2'), 'code is case-insensitive');
});

// ------------------------------------------------------------ shuffle
test('shuffle is deterministic and a permutation', () => {
  const a = Array.from({ length: 40 }, (_, i) => i);
  const s1 = L.shuffle(a, 'attempt-seed');
  eq(L.shuffle(a, 'attempt-seed'), s1);
  eq(s1.slice().sort((x, y) => x - y), a);
  ok(JSON.stringify(s1) !== JSON.stringify(a), 'order changed');
  ok(JSON.stringify(L.shuffle(a, 'other')) !== JSON.stringify(s1));
  eq(a[0], 0, 'input not mutated');
  eq(L.shuffle(['x', 'y', 'z'], 42), L.shuffle(['x', 'y', 'z'], '42'));
});

// ------------------------------------------------------------ recall (F11)
test('recall dates and items', () => {
  eq(L.recallDates('2027-03-23', '2027-03-10', [2, 7, 30]), ['2027-03-25', '2027-03-30', '2027-04-22']);
  eq(L.recallDates('2027-03-23', [2, 7, 30]), ['2027-03-25', '2027-03-30', '2027-04-22'], 'spec 12 signature');
  eq(L.recallDates('2027-03-23', '2027-03-26', [2, 7, 30]), ['2027-03-28', '2027-04-02', '2027-04-25'], 'late pass shifts');
  eq(L.recallDates('2027-12-30', '', [2]), ['2028-01-01']);
  eq(L.recallForm({ A: { taken: true, best_correct: 8 } }), 'B');
  eq(L.recallForm({ B: { taken: true, best_correct: 8 } }), 'A');
  eq(L.recallForm({ A: { taken: true, best_correct: 6 }, B: { taken: true, best_correct: 8 } }), 'A');
  eq(L.recallForm({ A: { taken: true, best_correct: 8, last_ms: 2 }, B: { taken: true, best_correct: 8, last_ms: 1 } }), 'B');
  const d0 = L.recallItems(formIds, 'T001:A2', 0), d1 = L.recallItems(formIds, 'T001:A2', 1), d2 = L.recallItems(formIds, 'T001:A2', 2);
  eq(d0.length, 3);
  eq(new Set(d0.concat(d1, d2)).size, 9, 'three different items per day');
  eq(L.recallItems(formIds.slice().reverse(), 'T001:A2', 0), d0, 'independent of input order');
});

// ------------------------------------------------------------ summarise
test('summarise drops small groups and every manager / test row', () => {
  const rows = [];
  const add = (group, v, extra) => rows.push(Object.assign({ group, roles: 'learner', is_manager: 'FALSE', values: { pct: v } }, extra || {}));
  add('demand', 50); add('demand', 60); add('demand', 70);
  add('supply', 40); add('supply', 50); add('supply', 60);
  add('materials', 90); add('materials', 80); add('cs', 10);
  add('demand', 0, { is_manager: 'TRUE', roles: 'learner;manager' });
  add('supply', 0, { roles: 'learner;manager' });
  add('demand', 0, { roles: 'learner;test' });
  const out = L.summarise(rows, 3);
  eq(out.map((g) => g.group), ['all', 'demand', 'supply'], 'materials (2) and cs (1) dropped');
  eq(out[0].n, 9, 'managers and test users never counted');
  eq(out[1].avg.pct, 60);
  eq(out[0].avg.pct, 510 / 9);
  // complementary rule: only cs (n=1) hidden → hiding 1 person is not enough; next smallest goes too
  const rows2 = rows.filter((r) => r.group !== 'materials' || r.values.pct !== 80).concat([
    { group: 'materials', roles: 'learner', values: { pct: 1 } }, { group: 'materials', roles: 'learner', values: { pct: 2 } }]);
  const out2 = L.summarise(rows2, 3);
  eq(out2.map((g) => g.group).includes('cs'), false);
  const hidden = out2[0].n - out2.slice(1).reduce((s, g) => s + g.n, 0);
  ok(hidden === 0 || hidden >= 3, 'all minus shown groups never reveals fewer than 3 people');
  eq(L.summarise(rows.slice(0, 2), 3), [], 'all suppressed when n < 3');
  const four = [{ group: 'demand', values: { pct: null } }, { group: 'demand', values: { pct: 5 } }, { group: 'demand', values: { pct: 7 } }, { group: 'demand', values: { pct: 9 } }];
  eq(L.summarise(four, 3)[0].avg.pct, 7, 'null values ignored in averages');
  eq(L.summarise(four, 3)[0].count.pct, 3, 'count = people with a value');
  eq(L.summarise(four.slice(0, 3), 3)[0].avg.pct, null, 'a metric only 2 people have is suppressed');
  eq(L.summarise(four.slice(0, 3), 3)[0].n, 3);
});

test('summarise: per-metric counts and complementary suppression (no single result exposed)', () => {
  // first-try pass: only one person in the whole team attempted → no group may show it
  const rows = [];
  ['demand', 'demand', 'demand', 'supply', 'supply', 'supply'].forEach((g, i) => rows.push({ group: g, values: { ftp: i === 0 ? 0 : null, pbf: i % 2 } }));
  let out = L.summarise(rows, 3);
  eq(out.map((g) => [g.group, g.n, g.avg.ftp, g.count.ftp]), [['all', 6, null, 1], ['demand', 3, null, 1], ['supply', 3, null, 0]]);
  eq(out[0].count.pbf, 6); eq(out[0].avg.pbf, 0.5);
  // 4 attempters: demand 3 shown would leave 1 supply person = all − demand → demand hidden too
  const rows2 = rows.map((r, i) => ({ group: r.group, values: { ftp: i < 4 ? 1 : null } }));
  out = L.summarise(rows2, 3);
  eq(out.map((g) => [g.group, g.avg.ftp]), [['all', 1], ['demand', null], ['supply', null]]);
  // 6 attempters, 3 + 3 → both shown
  out = L.summarise(rows.map((r, i) => ({ group: r.group, values: { ftp: i % 2 } })), 3);
  eq(out.map((g) => g.count.ftp), [6, 3, 3]); ok(out.every((g) => g.avg.ftp !== null));
});

test('panel weighting (F20)', () => {
  eq(L.panelWeighted('pitch', { c1: 3, c2: 3, c3: 3, c4: 3, c5: 5 }).toFixed(2), '3.67', 'communication counts double');
  eq(L.panelWeighted('capstone', { c1: 3, c2: 3, c3: 5, c4: 5, c5: 3 }).toFixed(2), '4.14', 'result and value count double');
  eq(L.panelWeighted('pitch', { c1: '5', c2: 5, c3: 5, c4: 5, c5: 5 }), 5);
  eq(L.panelWeighted('pitch', { c1: 3, c2: 3, c3: 3, c4: 3 }), null);
});

// ------------------------------------------------------------ dates (+07:00)
test('date helpers: +07:00 formatting and end-of-day windows', () => {
  eq(L.iso7(T('2026-11-16T02:30:00Z')), '2026-11-16T09:30:00+07:00');
  eq(L.date7(T('2026-11-15T17:00:00Z')), '2026-11-16', 'midnight +07:00 is the next day');
  eq(L.date7(T('2026-11-15T16:59:59Z')), '2026-11-15');
  eq(L.dayEndIso7('2026-11-27'), '2026-11-27T23:59:59+07:00');
  eq(L.iso7(L.dayEnd7('2026-11-27')), '2026-11-27T23:59:59+07:00');
  eq(L.windowState(T('2026-11-27T23:59:59+07:00'), '2026-11-16', '2026-11-27'), 'open');
  eq(L.windowState(T('2026-11-28T00:00:00+07:00'), '2026-11-16', '2026-11-27'), 'after');
  eq(L.windowState(T('2026-11-15T23:59:59+07:00'), '2026-11-16', '2026-11-27'), 'before');
  eq(L.windowState(T('2026-11-16T00:00:00+07:00'), '2026-11-16', '2026-11-27'), 'open');
  eq(L.addDays('2027-02-27', 2), '2027-03-01');
  eq(L.parseTime('2027-01-04'), T('2027-01-04T00:00:00+07:00'));
  eq(L.parseTime('2027-01-04 08:00'), T('2027-01-04T08:00:00+07:00'));
  eq(L.parseTime('2027-01-04T08:00:00+0700'), T('2027-01-04T08:00:00+07:00'));
  eq(Number.isNaN(L.parseTime('soon')), true);
  eq(L.cellToString(new Date(T('2027-01-04T00:00:00+07:00'))), '2027-01-04', 'coerced Sheet date');
  eq(L.cellToString(new Date(T('2027-01-04T08:15:00+07:00'))), '2027-01-04T08:15:00+07:00');
  eq(L.cellToString(true), 'TRUE');
  eq(L.normWave(new Date(T('2026-11-01T00:00:00+07:00'))), '2026-11');
  eq(L.normWave('2026-11'), '2026-11');
  eq(L.normDate('2027-01-04T23:30:00+07:00'), '2027-01-04');
});

test('ISO weeks in +07:00 and streak multiplier', () => {
  eq(L.isoWeekKey(T('2027-01-04T05:00:00+07:00')), '2027-W01', 'Monday +07:00 although Sunday in UTC');
  eq(L.isoWeekKey(T('2027-01-03T23:30:00+07:00')), '2026-W53');
  eq(L.isoWeekKey(T('2026-11-16T09:00:00+07:00')), '2026-W47');
  eq(L.isoWeekKey(T('2027-12-31T12:00:00+07:00')), '2027-W52');
  const now = T('2027-01-20T10:00:00+07:00'); // Wed, W03
  const s = L.streak([T('2027-01-05T10:00:00+07:00'), T('2027-01-12T10:00:00+07:00'), T('2027-01-13T10:00:00+07:00'), T('2027-01-19T10:00:00+07:00'), T('2026-12-01T10:00:00+07:00')], now);
  eq(s, { current_weeks: 3, active_this_week: true, active_weeks_total: 4, multiplier: 1.04 });
  const s2 = L.streak([T('2027-01-12T10:00:00+07:00')], now);
  eq(s2.current_weeks, 1, 'last week still counts until this week ends');
  eq(s2.active_this_week, false);
  eq(L.streak([], now), { current_weeks: 0, active_this_week: false, active_weeks_total: 0, multiplier: 1 });
  const many = Array.from({ length: 52 }, (_, i) => T('2027-01-05T10:00:00+07:00') + i * 7 * 86400000);
  eq(L.streak(many, T('2027-12-30T10:00:00+07:00')).multiplier, 1.68, '1.01^52');
});

// ------------------------------------------------------------ crypto
test('hashPin with pepper and salt; tokens sign and verify', () => {
  const h = L.hashPin('pep', 'salt1', '246810', sha256);
  eq(h, crypto.createHash('sha256').update('pep:salt1:246810').digest('hex'));
  ok(h !== L.hashPin('pep', 'salt2', '246810', sha256), 'salt matters');
  ok(h !== L.hashPin('pep2', 'salt1', '246810', sha256), 'pepper matters');
  eq(L.constantTimeEqual('abc', 'abc'), true); eq(L.constantTimeEqual('abc', 'abd'), false); eq(L.constantTimeEqual('', ''), false);
  const now = T('2027-01-04T08:00:00+07:00');
  const tok = L.signToken({ c: 'T001', e: now + 6 * 3600000, v: 2 }, hmac('s3cret'));
  ok(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(tok));
  const v = L.verifyToken(tok, now, hmac('s3cret'));
  eq(v.ok, true); eq(v.payload.c, 'T001'); eq(v.payload.v, 2);
  eq(L.verifyToken(tok, now + 6 * 3600000 + 1, hmac('s3cret')).reason, 'expired');
  eq(L.verifyToken(tok, now, hmac('other')).reason, 'bad_signature');
  const parts = tok.split('.');
  const forged = 'v1.' + L.b64urlEncode(JSON.stringify({ c: 'T010', e: now + 1e9, v: 2 })) + '.' + parts[2];
  eq(L.verifyToken(forged, now, hmac('s3cret')).ok, false, 'payload swap rejected');
  eq(L.verifyToken('garbage', now, hmac('s3cret')).reason, 'malformed');
  eq(L.verifyToken(null, now, hmac('s3cret')).ok, false);
  eq(L.b64urlDecode(L.b64urlEncode('Mỗi tuần {x}')), 'Mỗi tuần {x}');
  eq(L.b64urlEncode('ab?'), Buffer.from('ab?').toString('base64url'));
});

test('lockout: 15 → 30 min within 7 days, 3rd lock in 7 days needs an admin, rolling window', () => {
  const t0 = T('2026-11-16T09:00:00+07:00');
  const l1 = L.nextLock([], t0);
  eq([l1.count, l1.hard, l1.locked_until - t0], [1, false, 15 * 60000]);
  const l2 = L.nextLock(l1.history, t0 + 3 * 86400000);
  eq([l2.count, l2.hard, l2.locked_until - (t0 + 3 * 86400000)], [2, false, 30 * 60000]);
  const l3 = L.nextLock(l2.history, t0 + 6 * 86400000);
  eq([l3.count, l3.hard, l3.locked_until], [3, true, Infinity], 'third lock within 7 days is permanent');
  eq(l3.history.length, 3);
  eq(L.nextLock(l1.history, t0 + 7 * 86400000 + 1).count, 1, 'older than 7 days no longer counts');
  eq(L.nextLock([t0 - 8 * 86400000, t0 - 86400000], t0).count, 2, 'rolling window, not per calendar day');
  eq(L.nextLock(['2026-11-15T09:00:00+07:00', 'junk'], t0).count, 2, 'ISO history accepted');
  eq(L.nextLock([t0, t0], t0 + 1000).count, 2, 'duplicates ignored');
  eq(L.lockMinutes(2), 30); eq(L.HARD_LOCK_AFTER, 3);
});

test('PIN strength, word count, codes, names, roles, reveal rule', () => {
  eq(L.pinProblem('135790'), null);
  ok(L.pinProblem('111111')); ok(L.pinProblem('123456')); ok(L.pinProblem('654321')); ok(L.pinProblem('12345')); ok(L.pinProblem('12a456'));
  ok(L.pinProblem('135790', '135790'), 'same as old');
  const p = L.pinFromHex('9f86d081884c7d65'); ok(p === null || /^\d{6}$/.test(p));
  eq(L.wordCount('  one two\nthree  '), 3); eq(L.wordCount(''), 0);
  eq(L.wordCount(Array(61).fill('w').join(' ')) <= 60, false);
  eq(L.isValidCode(' t001 '), true); eq(L.isValidCode('ab'), false); eq(L.isValidCode('T 01'), false);
  eq(L.firstName('Fixture Family Alpha', ''), 'Alpha'); eq(L.firstName('Fixture Alpha', 'Al'), 'Al');
  eq(L.publicRoles('learner;test;panel', true), ['learner', 'manager', 'panel']);
  eq(L.publicRoles('', false), ['learner'], 'blank roles = learner');
  eq(L.publicRoles('panel', false), ['panel'], 'a judge is not a learner');
  eq(L.toBool('true'), true); eq(L.toBool('1'), true); eq(L.toBool('FALSE'), false); eq(L.toBool(''), false);
  const lateEnd = L.dayEnd7('2027-02-02');
  eq(L.revealKey(false, lateEnd, '2027-02-02'), false, 'not passed');
  eq(L.revealKey(false, lateEnd + 365 * 86400000, '2027-02-02'), false, 'never revealed by time alone');
  eq(L.revealKey(true), true, 'passed');
  eq(L.guardCell('=HYPERLINK("x")'), ' =HYPERLINK("x")'); eq(L.guardCell('plain'), 'plain');
  eq(L.escapeHtml('<a href="x">'), '&lt;a href=&quot;x&quot;&gt;');
});

test('CSV parsing and bank validation', () => {
  const rows = L.parseCsv('﻿a,b,c\r\n1,"two, 2","say ""hi"""\n\n4,5,6');
  eq(rows, [['a', 'b', 'c'], ['1', 'two, 2', 'say "hi"'], ['4', '5', '6']]);
  const courses = [{ code: 'A2', self_en: 's', obj1_en: 'o1', obj2_en: 'o2', online_from: '2027-01-04', checkpoint_close: '2027-01-22', forum_date: '2027-01-26', field_until: '2027-02-26', order: '1' }];
  const items = [fxItem('FX_A2_A_01', 'b', { objective: '2' }), fxItem('FX_A2_A_01', 'e', { objective: '7' }), fxItem('FX_A2_A_03', 'a', { form: 'PR', case_id: 'NOPE' })];
  const v = L.validateBank(items, courses, []);
  ok(v.errors.some((e) => /duplicate item_id/.test(e)));
  ok(v.errors.some((e) => /answer must be/.test(e)));
  ok(v.errors.some((e) => /objective must be 1–2/.test(e)));
  ok(v.errors.some((e) => /form must be A or B/.test(e)));
  ok(v.errors.some((e) => /case_id NOPE/.test(e)));
  ok(v.warnings.some((e) => /expected 10/.test(e)));
  eq(L.validateBank([fxItem('FX_A2_A_09', 'a')], courses, []).errors, []);
});

// ------------------------------------------------------------ run
let failed = 0;
for (const t of tests) {
  try { t.fn(); } catch (e) { failed++; console.error('✖ ' + t.name + '\n  ' + (e && e.stack || e)); }
}
const tz = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
if (failed) { console.error(`✖ logic tests: ${failed} failed (${count} assertions ran, TZ=${tz})`); process.exit(1); }
console.log(`✔ logic tests: ${tests.length} tests, ${count} assertions passed (TZ=${tz})`);

if (!process.env.LOGIC_TZ_CHILD) {
  for (const zone of ['UTC', 'America/New_York', 'Asia/Ho_Chi_Minh']) {
    const r = spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { TZ: zone, LOGIC_TZ_CHILD: '1' }), encoding: 'utf8' });
    process.stdout.write('  ' + (r.stdout || '').trim() + '\n');
    if (r.status !== 0) { console.error(r.stderr); console.error(`✖ logic tests failed under TZ=${zone}`); process.exit(1); }
  }
}
