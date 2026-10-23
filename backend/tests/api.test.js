#!/usr/bin/env node
// End-to-end tests through doPost on the Node harness (invented fixtures only).
// Run: node backend/tests/api.test.js   (re-runs itself under TZ=UTC and America/New_York)
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { createHarness } = require('./harness');
const fx = require('./fixtures');

const ROOT = path.join(__dirname, '..', '..');
const T = (s) => Date.parse(s);
const H = 3600000, MIN = 60000, DAY = 86400000;
const PIN = fx.PIN;

let count = 0;
const sections = [];
function section(name, fn) { sections.push({ name, fn }); }
function eq(a, b, msg) { count++; assert.deepStrictEqual(a, b, msg); }
function ok(v, msg) { count++; assert.ok(v, msg); }

// ------------------------------------------------------------ helpers
const ITEMS = fx.buildItems();
const KEY = Object.fromEntries(ITEMS.map((i) => [i.item_id, i.answer]));
const BYID = Object.fromEntries(ITEMS.map((i) => [i.item_id, i]));
const wrongOf = (l) => (l === 'a' ? 'b' : 'a');
const FORBIDDEN_KEYS = new Set(['answer', 'why', 'why_en', 'why_vi', 'correct', 'mockCorrect', 'is_correct', 'key']);

function forbiddenKeys(obj, found = [], at = '$') {
  if (Array.isArray(obj)) obj.forEach((v, i) => forbiddenKeys(v, found, `${at}[${i}]`));
  else if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      if (FORBIDDEN_KEYS.has(k)) found.push(`${at}.${k}`);
      forbiddenKeys(obj[k], found, `${at}.${k}`);
    }
  }
  return found;
}

/** n correct answers for the served items (first n right, the rest wrong or left blank). */
function answersFor(items, n, blankRest) {
  const out = {};
  items.forEach((it, i) => {
    const id = it.item_id || it;
    if (i < n) out[id] = KEY[id];
    else if (!blankRest) out[id] = wrongOf(KEY[id]);
  });
  return out;
}

function harness(now, opts) {
  const h = createHarness({ now: T(now) });
  fx.loadFixtures(h, opts);
  const rawCall = h.call;
  h.call = (p) => {
    const r = rawCall(p);
    count++;
    assert.match(r.server_now, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/, 'every response carries server_now (+07:00)');
    return r;
  };
  h.login = (code, pin) => {
    const r = h.call({ action: 'login', code, pin: pin || PIN });
    assert.equal(r.ok, true, `login ${code}: ${JSON.stringify(r.error)}`);
    return r.token;
  };
  h.ok = (p) => {
    const r = h.call(p);
    assert.equal(r.ok, true, `${p.action} failed: ${JSON.stringify(r.error)}`);
    return r;
  };
  h.err = (p, code) => {
    const r = h.call(p);
    assert.equal(r.ok, false, `${p.action} should fail with ${code}`);
    eq(r.error.code, code, `${p.action} → ${code} (got ${r.error.code}: ${r.error.message})`);
    return r.error;
  };
  return h;
}

const SELF10 = { A2: 2, A3: 1, A1: 3, P1: 0, C1: 4, P2: 2, P3: 1, P4: 2, P5: 3, P6: 1 };
const PROFILE_KEYS = ['certificate', 'code', 'consent_needed', 'first_name', 'is_manager', 'lang', 'must_change_pin', 'role_area', 'roles'];

// ============================================================ transport
section('transport: health, bad requests, JSON only', () => {
  const h = harness('2026-11-16T09:00:00+07:00');
  const g = h.get();
  eq(g.ok, true); eq(g.server_now, '2026-11-16T09:00:00+07:00'); eq(Object.keys(g).sort(), ['ok', 'server_now', 'service', 'version']);
  eq(h.call('not json').error.code, 'bad_request');
  eq(h.call('[1,2]').error.code, 'bad_request');
  eq(h.call('').error.code, 'bad_request');
  eq(h.call({ action: 'nope' }).error.code, 'bad_request');
  eq(h.call({ action: 'toString' }).error.code, 'bad_request', 'no prototype routes');
  eq(h.call({ action: 'me' }).error.code, 'session_expired');
  eq(h.call({ action: 'me', token: 'v1.abc.def' }).error.code, 'session_expired');
  const r = h.call({ action: 'me', token: 42 });
  eq(Object.keys(r).sort(), ['error', 'ok', 'server_now']);
  eq(Object.keys(r.error).sort(), ['code', 'message']);
});

// ============================================================ auth
section('auth: login, same error for unknown codes, lockout escalation', () => {
  const h = harness('2026-11-16T09:00:00+07:00');
  const r = h.ok({ action: 'login', code: ' t004 ', pin: PIN });
  ok(/^v1\./.test(r.token));
  eq(r.expires_at, '2026-11-16T15:00:00+07:00');
  eq(Object.keys(r.profile).sort(), PROFILE_KEYS);
  eq(r.profile, { code: 'T004', first_name: 'Del', role_area: 'supply', is_manager: false, roles: ['learner'], lang: 'en', must_change_pin: false, consent_needed: false, certificate: '' });
  eq(h.ok({ action: 'login', code: 'T001', pin: PIN }).profile.first_name, 'Alpha', 'last word of display_name');
  eq(h.ok({ action: 'login', code: 'T010', pin: PIN }).profile.roles, ['learner', 'manager']);
  eq(h.ok({ action: 'login', code: 'T040', pin: PIN }).profile.roles, ['learner'], 'test role never shown');

  const wrong = h.err({ action: 'login', code: 'T005', pin: '999999' }, 'auth_failed');
  const unknown = h.err({ action: 'login', code: 'T999', pin: PIN }, 'auth_failed');
  const inactive = h.err({ action: 'login', code: 'T060', pin: PIN }, 'auth_failed');
  const garbage = h.err({ action: 'login', code: '<script>', pin: 'x' }, 'auth_failed');
  eq(unknown, wrong, 'unknown code = same error as wrong PIN'); eq(inactive, wrong); eq(garbage, wrong);

  // 5 failures → 15 min; same day 30, 60; next day 15 again
  const code = 'T008';
  const fail5 = () => {
    for (let i = 0; i < 4; i++) h.err({ action: 'login', code, pin: '000001' }, 'auth_failed');
    return h.err({ action: 'login', code, pin: '000001' }, 'locked');
  };
  let now = h.clock.now();
  let e = fail5();
  eq(e.until, '2026-11-16T09:15:00+07:00');
  h.clock.advance(MIN);
  eq(h.err({ action: 'login', code, pin: PIN }, 'locked').until, '2026-11-16T09:15:00+07:00', 'correct PIN still locked');
  h.clock.set(T('2026-11-16T09:16:00+07:00'));
  e = fail5(); eq(e.until, '2026-11-16T09:46:00+07:00', 'second lock doubles to 30 min');
  h.clock.set(T('2026-11-16T09:47:00+07:00'));
  e = fail5(); eq(e.until, '2026-11-16T10:47:00+07:00', 'third lock 60 min');
  h.clock.set(T('2026-11-17T09:00:00+07:00'));
  e = fail5(); eq(e.until, '2026-11-17T09:15:00+07:00', 'new day starts at 15 min');
  h.clock.set(T('2026-11-17T09:15:01+07:00'));
  h.login(code);
  const row = h.table('Roster').find((x) => x.employee_code === code);
  eq(row.failed_logins, '0'); eq(row.lock_count, '1');
  void now;
});

section('auth: must_change_pin, change_pin, session_ver, consent, set_lang, token expiry', () => {
  const h = harness('2026-11-16T09:00:00+07:00');
  const r = h.ok({ action: 'login', code: 'T030', pin: PIN });
  eq(r.profile.must_change_pin, true); eq(r.profile.consent_needed, true);
  const tok = r.token;
  eq(h.ok({ action: 'me', token: tok }).profile.must_change_pin, true, 'me is allowed');
  h.err({ action: 'start', token: tok, assessment: 'baseline' }, 'pin_change_required');
  h.err({ action: 'consent', token: tok }, 'pin_change_required');
  h.err({ action: 'team_summary', token: tok }, 'pin_change_required');
  for (const bad of ['111111', '123456', '654321', '12345', 'abcdef', PIN]) h.err({ action: 'change_pin', token: tok, old_pin: PIN, new_pin: bad }, 'pin_weak');
  h.err({ action: 'change_pin', token: tok, old_pin: '000000', new_pin: '135790' }, 'auth_failed');
  const c = h.ok({ action: 'change_pin', token: tok, old_pin: PIN, new_pin: '135790' });
  eq(c.profile.must_change_pin, false); ok(c.token !== tok); eq(Object.keys(c).sort(), ['expires_at', 'ok', 'profile', 'server_now', 'token']);
  h.err({ action: 'me', token: tok }, 'session_expired');
  const tok2 = c.token;
  eq(h.ok({ action: 'consent', token: tok2 }).consent_at, '2026-11-16T09:00:00+07:00');
  eq(h.ok({ action: 'me', token: tok2 }).profile.consent_needed, false);
  h.err({ action: 'login', code: 'T030', pin: PIN }, 'auth_failed');
  const tok3 = h.login('T030', '135790');
  eq(h.ok({ action: 'set_lang', token: tok3, lang: 'vi' }), { ok: true, server_now: '2026-11-16T09:00:00+07:00', lang: 'vi' });
  eq(h.ok({ action: 'me', token: tok3 }).profile.lang, 'vi');
  h.err({ action: 'set_lang', token: tok3, lang: 'fr' }, 'bad_request');
  eq(h.table('Roster').find((x) => x.employee_code === 'T030').session_ver, '2', 'session_ver bumped');

  // a PIN change on one device signs out the other
  const d1 = h.login('T001'), d2 = h.login('T001');
  h.ok({ action: 'change_pin', token: d1, old_pin: PIN, new_pin: '975310' });
  h.err({ action: 'me', token: d2 }, 'session_expired');
  // tampered token and 6-hour expiry
  const t = h.login('T002');
  const parts = t.split('.');
  const forged = parts[0] + '.' + Buffer.from(JSON.stringify({ c: 'T010', e: T('2030-01-01'), v: 1 })).toString('base64url') + '.' + parts[2];
  h.err({ action: 'me', token: forged }, 'session_expired');
  h.clock.advance(6 * H - 1000);
  h.ok({ action: 'me', token: t });
  h.clock.advance(2000);
  h.err({ action: 'me', token: t }, 'session_expired');
});

// ============================================================ me shape
section('me: journey shape, calendar order, nobody else\'s data', () => {
  const h = harness('2027-01-05T09:00:00+07:00');
  const tok = h.login('T001');
  const me = h.ok({ action: 'me', token: tok });
  eq(Object.keys(me).sort(), ['baseline', 'capstone', 'certificates', 'courses', 'ok', 'profile', 'server_now', 'streak']);
  eq(me.courses.map((c) => c.code), ['A2', 'A3', 'A1', 'P1', 'C1', 'P2', 'P3', 'P4', 'P5', 'P6']);
  const a2 = me.courses[0];
  eq(Object.keys(a2).sort(), ['blink_url', 'checkpoint', 'checkpoint_close', 'code', 'cycle', 'episodes', 'field_until', 'forum_date', 'late_until', 'online_from', 'open', 'order', 'predict', 'recall']);
  eq(a2.open, true); eq(me.courses[2].open, false, 'A1 opens 2027-02-15');
  eq(a2.late_until, '2027-02-02');
  eq(a2.episodes.length, 8); eq(Object.keys(a2.episodes[0]).sort(), ['blink_url', 'embed_url', 'ep', 'minutes', 'watched']);
  eq(me.courses[2].episodes[0].ep, 0, 'A1 has a trailer (ep 0)');
  eq(Object.keys(a2.checkpoint).sort(), ['attempts', 'best_pct', 'gate_closed', 'last_attempt_id', 'needs_unlock', 'next_retake_at', 'open_attempt_id', 'passed_at', 'status']);
  eq(Object.keys(a2.predict).sort(), ['attempts', 'done', 'last_pct']);
  eq(Object.keys(me.baseline).sort(), ['open_from', 'open_to', 'status', 'wave', 'window']);
  eq(me.baseline.window, 'after');
  eq(Object.keys(me.streak).sort(), ['active_this_week', 'active_weeks_total', 'current_weeks', 'multiplier']);
  eq(me.certificates, { level: '', checkpoints_passed: 0, checkpoints_total: 10, pitch_submitted: false, capstone_submitted: false });
  eq(me.capstone, { team_id: 'TEAM1', project_title: 'Fixture project one', pitch_submitted_at: null, capstone_submitted_at: null, pitch_deadline: '2027-06-21', capstone_deadline: '2027-12-20' });
  const text = JSON.stringify(me);
  ok(!/Bravo|Charlie|T002|T010/.test(text), 'no other person in me');
  eq(forbiddenKeys(me), []);
  eq(h.ok({ action: 'me', token: h.login('T009') }).capstone.team_id, null);
});

// ============================================================ baseline
section('baseline: window, parts, resume, Part A required, one per wave, expiry from last save', () => {
  const h = harness('2026-11-15T20:00:00+07:00');
  let tok = h.login('T001');
  eq(h.err({ action: 'start', token: tok, assessment: 'baseline' }, 'not_open').opens_at, '2026-11-16T00:00:00+07:00');
  h.clock.set(T('2026-11-16T09:00:00+07:00'));
  tok = h.login('T001');
  const s = h.ok({ action: 'start', token: tok, assessment: 'baseline' });
  eq(forbiddenKeys(s), [], 'start has no answer/why/correct anywhere');
  eq(s.items.length, 46); eq(s.parts, { A: 10, B: 40, C: 6 });
  eq(s.self.map((x) => x.course), fx.COURSES); eq(Object.keys(s.self[0]).sort(), ['course', 'en', 'vi']);
  eq(s.scale.length, 5); eq(Object.keys(s.scale[0]).sort(), ['desc_en', 'desc_vi', 'en', 'level', 'vi']);
  eq(s.scale[2].en, '2 · Working knowledge (WK)'); eq(s.scale[0].en, '0 · Not yet');
  eq(s.case, fx.CASES[0]);
  eq(s.deadline_at, '2026-11-16T10:00:00+07:00'); eq(s.time_limit_min, 60);
  eq(s.form, 'BL'); eq(s.attempt_no, 1); eq(s.resumed, false); eq(s.answers, {}); eq(s.self_ratings, {});
  const order = s.items.slice(0, 40).map((i) => fx.COURSES.indexOf(i.course));
  eq(order, order.slice().sort((a, b) => a - b), 'Part B grouped by course in calendar order');
  eq(s.items.slice(40).every((i) => i.case_id === 'CASE1'), true, 'Part C last');
  eq(Object.keys(s.items[0]).sort(), ['case_id', 'course', 'item_id', 'objective', 'options', 'stem_en', 'stem_vi']);
  eq(s.items.every((i) => i.options.length === 4 && i.options.every((o) => Object.keys(o).sort().join() === 'en,id,vi')), true);
  ok(!JSON.stringify(s).includes('Fixture reason'), 'no why text in start');

  // save then resume: same item order, same option order, saved answers and self-ratings
  const partial = answersFor(s.items.slice(0, 20), 20);
  const acq = h.lock.acquisitions;
  const sv = h.ok({ action: 'save', token: tok, attempt_id: s.attempt_id, answers: partial, self_ratings: { A2: 2, A3: 9, ZZ: 1 } });
  eq(Object.keys(sv).sort(), ['ok', 'saved_at', 'server_now']);
  eq(h.lock.acquisitions, acq, 'save never takes the script lock (F4)');
  h.clock.advance(5 * MIN);
  const r = h.ok({ action: 'start', token: tok, assessment: 'baseline' });
  eq(r.resumed, true); eq(r.attempt_id, s.attempt_id);
  eq(r.items, s.items, 'same items and option order on resume (F9)');
  eq(r.answers, partial); eq(r.self_ratings, { A2: 2 }, 'invalid self-ratings dropped');
  eq(h.ok({ action: 'me', token: tok }).baseline.status, 'in_progress');
  eq(h.ok({ action: 'me', token: tok }).baseline.deadline_at, '2026-11-16T10:00:00+07:00');

  // Part A required
  const nine = Object.assign({}, SELF10); delete nine.P6;
  eq(h.err({ action: 'submit', token: tok, attempt_id: s.attempt_id, answers: partial, self_ratings: nine }, 'bad_request').field, 'self_ratings');
  const all = answersFor(s.items, 23); // 23 of 46 right
  const res = h.ok({ action: 'submit', token: tok, attempt_id: s.attempt_id, answers: all, self_ratings: SELF10 });
  eq(Object.keys(res).sort(), ['assessment', 'by_course', 'gaps', 'ok', 'score_pct', 'self', 'server_now']);
  eq(res.score_pct, 50); eq(Object.keys(res.by_course), fx.COURSES); eq(res.self, SELF10);
  // expected by course from the served order
  const exp = {};
  const counts = {};
  s.items.forEach((it, i) => { counts[it.course] = counts[it.course] || [0, 0]; counts[it.course][0]++; if (i < 23) counts[it.course][1]++; });
  for (const c of fx.COURSES) exp[c] = Math.round(100 * counts[c][1] / counts[c][0]);
  eq(res.by_course, exp, 'by_course = Part B + case items per course');
  const lows = fx.COURSES.slice().sort((a, b) => exp[a] - exp[b] || SELF10[a] - SELF10[b] || fx.COURSES.indexOf(a) - fx.COURSES.indexOf(b));
  eq(res.gaps, lows.slice(0, 2));
  eq(h.ok({ action: 'submit', token: tok, attempt_id: s.attempt_id, answers: {} }).score_pct, 50, 'idempotent submit');
  h.err({ action: 'start', token: tok, assessment: 'baseline' }, 'already_submitted');
  h.err({ action: 'save', token: tok, attempt_id: s.attempt_id, answers: {} }, 'already_submitted');
  const me = h.ok({ action: 'me', token: tok });
  eq(me.baseline.status, 'submitted'); eq(me.baseline.result.gaps, res.gaps); eq(me.baseline.result.score_pct, 50);
  eq(h.ok({ action: 'review', token: tok, attempt_id: s.attempt_id }).by_course, exp);
  eq(h.table('SelfRatings').filter((x) => x.employee_code === 'T001').length, 10);
  const other = h.login('T002');
  h.err({ action: 'review', token: other, attempt_id: s.attempt_id }, 'not_found');
  h.err({ action: 'save', token: other, attempt_id: s.attempt_id, answers: {} }, 'not_found');

  // 70-minute expiry graded from the last save (me path)
  const s2 = h.ok({ action: 'start', token: other, assessment: 'baseline' });
  h.clock.advance(10 * MIN);
  h.ok({ action: 'save', token: other, attempt_id: s2.attempt_id, answers: answersFor(s2.items, 10, true), self_ratings: SELF10 });
  h.clock.advance(59 * MIN); // 69 min: still inside the grace
  h.ok({ action: 'save', token: other, attempt_id: s2.attempt_id, answers: answersFor(s2.items, 12, true), self_ratings: SELF10 });
  h.clock.advance(2 * MIN); // 71 min
  h.err({ action: 'save', token: other, attempt_id: s2.attempt_id, answers: answersFor(s2.items, 46) }, 'already_submitted');
  const me2 = h.ok({ action: 'me', token: other });
  eq(me2.baseline.status, 'submitted');
  eq(me2.baseline.result.score_pct, Math.round(100 * 12 / 46), 'graded from the last save');
  const row2 = h.table('Attempts').find((x) => x.attempt_id === s2.attempt_id);
  eq(row2.status, 'expired'); eq(row2.submitted_at, '2026-11-16T10:15:00+07:00');

  // expiry through submit: the late answers are ignored
  const t3 = h.login('T003');
  const s3 = h.ok({ action: 'start', token: t3, assessment: 'baseline' });
  h.ok({ action: 'save', token: t3, attempt_id: s3.attempt_id, answers: answersFor(s3.items, 5, true), self_ratings: SELF10 });
  h.clock.advance(71 * MIN);
  const late = h.ok({ action: 'submit', token: t3, attempt_id: s3.attempt_id, answers: answersFor(s3.items, 46), self_ratings: SELF10 });
  eq(late.score_pct, Math.round(100 * 5 / 46));
  h.err({ action: 'start', token: t3, assessment: 'baseline' }, 'already_submitted');

  // window ends 23:59:59 +07:00; an open attempt can still be resumed after it
  h.clock.set(T('2026-11-27T23:59:59+07:00'));
  const t4 = h.login('T004');
  const s4 = h.ok({ action: 'start', token: t4, assessment: 'baseline' });
  h.clock.set(T('2026-11-28T00:00:00+07:00'));
  const t5 = h.login('T005');
  const closed = h.err({ action: 'start', token: t5, assessment: 'baseline' }, 'not_open');
  eq(closed.opens_at, undefined);
  eq(h.ok({ action: 'me', token: t5 }).baseline.window, 'after');
  h.clock.set(T('2026-11-28T00:30:00+07:00'));
  eq(h.ok({ action: 'start', token: t4, assessment: 'baseline' }).resumed, true);
  eq(h.ok({ action: 'submit', token: t4, attempt_id: s4.attempt_id, answers: {}, self_ratings: SELF10 }).score_pct, 0);

  // re-test wave: the earlier wave shows as previous
  h.setConfig('wave', '2027-12');
  h.setConfig('baseline_open_from', '2027-11-29');
  h.setConfig('baseline_open_to', '2027-12-10');
  h.clock.set(T('2027-11-29T08:00:00+07:00'));
  const t1 = h.login('T001');
  const mb = h.ok({ action: 'me', token: t1 }).baseline;
  eq(mb.wave, '2027-12'); eq(mb.status, 'not_started'); eq(mb.window, 'open');
  eq(mb.previous, { wave: '2026-11', score_pct: 50, by_course: exp });
  eq(h.ok({ action: 'start', token: t1, assessment: 'baseline' }).items.length, 46, 'same items in the re-test');
});

// ============================================================ predict, checkpoint, recall, watch
section('predict: open courses only, answers always shown, unlimited', () => {
  const h = harness('2027-01-05T09:00:00+07:00');
  const tok = h.login('T001');
  eq(h.err({ action: 'start', token: tok, assessment: 'predict', course: 'P6' }, 'not_open').opens_at, '2027-10-25T00:00:00+07:00');
  h.err({ action: 'start', token: tok, assessment: 'predict', course: 'XX' }, 'not_found');
  h.err({ action: 'start', token: tok, assessment: 'quiz', course: 'A2' }, 'bad_request');
  const s = h.ok({ action: 'start', token: tok, assessment: 'predict', course: 'A2' });
  eq(forbiddenKeys(s), []); eq(s.items.length, 3); eq(s.form, 'PR'); eq(s.course, 'A2');
  ok(!('deadline_at' in s) && !('self' in s) && !('parts' in s));
  const res = h.ok({ action: 'submit', token: tok, attempt_id: s.attempt_id, answers: answersFor(s.items, 1, true) });
  eq(Object.keys(res).sort(), ['assessment', 'course', 'n_correct', 'n_items', 'ok', 'review', 'score_pct', 'server_now']);
  eq(res.n_correct, 1); eq(res.score_pct, 33); eq(res.review.length, 3);
  eq(Object.keys(res.review[0]).sort(), ['correct', 'course', 'is_correct', 'item_id', 'objective', 'stem_en', 'stem_vi', 'why_en', 'why_vi', 'your']);
  eq(res.review.every((r) => r.correct && r.correct.id === KEY[r.item_id] && r.why_en), true, 'predict always reveals');
  eq(res.review[2].your, null, 'unanswered');
  eq(h.ok({ action: 'start', token: tok, assessment: 'predict', course: 'A2' }).attempt_no, 2);
  const me = h.ok({ action: 'me', token: tok });
  eq(me.courses[0].predict, { done: true, attempts: 1, last_pct: 33 });
});

section('checkpoint: pass 8/10, not yet 7/10, reveal rule, 24 h retake with other form, unlocks, gate, recall', () => {
  const h = harness('2027-01-05T09:00:00+07:00');
  let tok = h.login('T001');
  h.err({ action: 'start', token: tok, assessment: 'checkpoint', course: 'A1' }, 'not_open');
  const s = h.ok({ action: 'start', token: tok, assessment: 'checkpoint', course: 'A2' });
  eq(forbiddenKeys(s), [], 'checkpoint start has no key');
  eq(s.items.length, 10); eq(s.attempt_no, 1); ok(s.form === 'A' || s.form === 'B');
  eq(new Set(s.items.map((i) => i.item_id.split('_')[2])), new Set([s.form]), 'one form');
  const firstForm = s.form;
  // resume
  h.ok({ action: 'save', token: tok, attempt_id: s.attempt_id, answers: { [s.items[0].item_id]: 'c', bogus: 'a' } });
  const rs = h.ok({ action: 'start', token: tok, assessment: 'checkpoint', course: 'A2' });
  eq(rs.resumed, true); eq(rs.items, s.items); eq(rs.answers, { [s.items[0].item_id]: 'c' });
  // 7/10 → not yet, key hidden (D5)
  const r7 = h.ok({ action: 'submit', token: tok, attempt_id: s.attempt_id, answers: answersFor(s.items, 7) });
  eq(r7.passed, false); eq(r7.score_pct, 70); eq(r7.n_correct, 7); eq(r7.reveal, false); eq(r7.attempt_no, 1); eq(r7.form, firstForm);
  eq(Object.keys(r7).sort(), ['assessment', 'attempt_no', 'by_objective', 'course', 'form', 'forum_date', 'missed', 'n_correct', 'n_items', 'needs_unlock', 'next_retake_at', 'ok', 'passed', 'reveal', 'score_pct', 'server_now', 'weak_objectives']);
  eq(r7.missed.length, 3);
  eq(r7.missed.every((m) => m.correct === null && m.why_en === '' && m.why_vi === '' && m.your && m.is_correct === false), true, 'own answer only before a pass');
  ok(!JSON.stringify(r7).includes('Fixture reason'), 'no why text before a pass');
  eq(r7.next_retake_at, '2027-01-06T09:00:00+07:00'); eq(r7.needs_unlock, false); eq(r7.forum_date, '2027-01-26');
  ok(r7.weak_objectives.length >= 1 && r7.weak_objectives.every((n) => typeof n === 'number'));
  eq(Object.values(r7.by_objective).reduce((a, o) => a + o.n, 0), 10);
  // retake timing
  h.clock.set(T('2027-01-06T08:59:00+07:00'));
  tok = h.login('T001');
  eq(h.err({ action: 'start', token: tok, assessment: 'checkpoint', course: 'A2' }, 'retake_too_soon').next_retake_at, '2027-01-06T09:00:00+07:00');
  eq(h.ok({ action: 'me', token: tok }).courses[0].checkpoint.next_retake_at, '2027-01-06T09:00:00+07:00');
  h.clock.set(T('2027-01-06T09:00:00+07:00'));
  const s2 = h.ok({ action: 'start', token: tok, assessment: 'checkpoint', course: 'A2' });
  eq(s2.attempt_no, 2); ok(s2.form !== firstForm, 'retake uses the other form');
  const r8 = h.ok({ action: 'submit', token: tok, attempt_id: s2.attempt_id, answers: answersFor(s2.items, 8) });
  eq(r8.passed, true); eq(r8.score_pct, 80); eq(r8.reveal, true); eq(r8.next_retake_at, null);
  eq(r8.missed.length, 2);
  eq(r8.missed.every((m) => m.correct && m.correct.id === KEY[m.item_id] && m.why_en === BYID[m.item_id].why_en), true);
  eq(r8.recall_dates, ['2027-01-28', '2027-02-02', '2027-02-25'], 'F11 dates from the forum date');
  eq(h.ok({ action: 'review', token: tok, attempt_id: s.attempt_id }).reveal, true, 'earlier attempt reveals after the pass');
  h.err({ action: 'start', token: tok, assessment: 'checkpoint', course: 'A2' }, 'already_passed');
  let me = h.ok({ action: 'me', token: tok });
  const cp = me.courses[0].checkpoint;
  eq(cp.status, 'passed'); eq(cp.attempts, 2); eq(cp.best_pct, 80); eq(cp.passed_at, '2027-01-06T09:00:00+07:00'); eq(cp.last_attempt_id, s2.attempt_id);
  eq(me.courses[0].recall.map((x) => [x.day, x.due_date, x.status]), [[2, '2027-01-28', 'upcoming'], [7, '2027-02-02', 'upcoming'], [30, '2027-02-25', 'upcoming']]);
  eq(me.certificates.checkpoints_passed, 1);

  // form balance across learners (F10)
  const forms = { A: 0, B: 0 };
  forms[firstForm]++;
  for (const c of ['T002', 'T003', 'T004', 'T005', 'T006', 'T007']) {
    const st = h.ok({ action: 'start', token: h.login(c), assessment: 'checkpoint', course: 'A3' });
    forms[st.form]++;
  }
  ok(Math.abs(forms.A - forms.B) <= 1, 'first attempts balanced: ' + JSON.stringify(forms));

  // attempt 3 needs an unlock; each unlock = one attempt
  let t2 = h.login('T002');
  const a1 = h.ok({ action: 'start', token: t2, assessment: 'checkpoint', course: 'A2' });
  h.ok({ action: 'submit', token: t2, attempt_id: a1.attempt_id, answers: answersFor(a1.items, 5) });
  h.clock.advance(24 * H);
  t2 = h.login('T002');
  const a2 = h.ok({ action: 'start', token: t2, assessment: 'checkpoint', course: 'A2' });
  ok(a2.form !== a1.form);
  h.ok({ action: 'submit', token: t2, attempt_id: a2.attempt_id, answers: answersFor(a2.items, 6) });
  h.clock.advance(24 * H);
  t2 = h.login('T002');
  h.err({ action: 'start', token: t2, assessment: 'checkpoint', course: 'A2' }, 'unlock_needed');
  eq(h.ok({ action: 'me', token: t2 }).courses[0].checkpoint.needs_unlock, true);
  h.run('unlockRetake_', 'T002', 'A2', 'T010', 'coaching chat');
  eq(h.table('Unlocks').length, 1);
  const a3 = h.ok({ action: 'start', token: t2, assessment: 'checkpoint', course: 'A2' });
  eq(a3.attempt_no, 3); eq(a3.form, a1.form, 'alternates back');
  h.ok({ action: 'submit', token: t2, attempt_id: a3.attempt_id, answers: answersFor(a3.items, 7) });
  h.clock.advance(24 * H);
  t2 = h.login('T002');
  h.err({ action: 'start', token: t2, assessment: 'checkpoint', course: 'A2' }, 'unlock_needed');

  // after late_until (forum 2027-01-26 + 7 = 2027-02-02 23:59:59): gate closed, key revealed
  h.clock.set(T('2027-02-02T23:59:59+07:00'));
  let t3 = h.login('T003');
  const rv = h.ok({ action: 'review', token: h.login('T002'), attempt_id: a1.attempt_id });
  eq(rv.reveal, false, 'still hidden on the last day');
  h.clock.set(T('2027-02-03T00:00:00+07:00'));
  t3 = h.login('T003');
  h.err({ action: 'start', token: t3, assessment: 'checkpoint', course: 'A2' }, 'gate_closed');
  me = h.ok({ action: 'me', token: t3 });
  eq(me.courses[0].checkpoint.gate_closed, true); eq(me.courses[0].checkpoint.status, 'not_started');
  const rv2 = h.ok({ action: 'review', token: h.login('T002'), attempt_id: a1.attempt_id });
  eq(rv2.reveal, true, 'key shown after late_until');
  eq(rv2.missed.every((m) => m.correct !== null), true);
  h.run('unlockRetake_', 'T003', 'A2', 'T010', 'late with manager');
  const late = h.ok({ action: 'start', token: t3, assessment: 'checkpoint', course: 'A2' });
  const lr = h.ok({ action: 'submit', token: t3, attempt_id: late.attempt_id, answers: answersFor(late.items, 10) });
  eq(lr.passed, true);
  eq(lr.recall_dates, ['2027-02-05', '2027-02-10', '2027-03-05'], 'late pass: recall from the pass date (F11)');

  // recall for T001: not due, then 3 items from the form with fewer correct (both taken)
  h.clock.set(T('2027-01-27T09:00:00+07:00'));
  tok = h.login('T001');
  h.err({ action: 'start', token: tok, assessment: 'recall', course: 'A2', day: 2 }, 'not_due');
  h.err({ action: 'start', token: tok, assessment: 'recall', course: 'A2', day: 5 }, 'bad_request');
  h.err({ action: 'start', token: tok, assessment: 'recall', course: 'A3', day: 2 }, 'not_due');
  h.clock.set(T('2027-01-28T09:00:00+07:00'));
  tok = h.login('T001');
  eq(h.ok({ action: 'me', token: tok }).courses[0].recall[0].status, 'due');
  const rc = h.ok({ action: 'start', token: tok, assessment: 'recall', course: 'A2', day: 2 });
  eq(forbiddenKeys(rc), []); eq(rc.items.length, 3); eq(rc.form, firstForm, 'form with fewer correct answers (7 < 8)');
  eq(rc.items.every((i) => i.item_id.split('_')[2] === firstForm), true);
  eq(h.ok({ action: 'start', token: tok, assessment: 'recall', course: 'A2', day: 2 }).attempt_id, rc.attempt_id, 'resume');
  const rr = h.ok({ action: 'submit', token: tok, attempt_id: rc.attempt_id, answers: answersFor(rc.items, 2) });
  eq(Object.keys(rr).sort(), ['assessment', 'course', 'day', 'n_correct', 'n_items', 'ok', 'review', 'score_pct', 'server_now']);
  eq(rr.day, 2); eq(rr.score_pct, 67); eq(rr.review.every((x) => x.correct && x.why_en), true, 'recall reveals');
  eq(h.ok({ action: 'submit', token: tok, attempt_id: rc.attempt_id, answers: {} }).score_pct, 67, 'idempotent');
  h.err({ action: 'start', token: tok, assessment: 'recall', course: 'A2', day: 2 }, 'not_due');
  const recRow = h.table('Recall').find((x) => x.employee_code === 'T001' && x.day === '2');
  eq([recRow.status, recRow.score_pct, recRow.attempt_id], ['done', '67', rc.attempt_id]);
  h.clock.set(T('2027-02-02T09:00:00+07:00'));
  tok = h.login('T001');
  const rc7 = h.ok({ action: 'start', token: tok, assessment: 'recall', course: 'A2', day: 7 });
  eq(rc7.items.filter((i) => rc.items.some((x) => x.item_id === i.item_id)).length, 0, 'different items on day 7');
  me = h.ok({ action: 'me', token: tok });
  eq(me.courses[0].recall.map((x) => x.status), ['done', 'due', 'upcoming']);
  eq(me.courses[0].recall[0].score_pct, 67); eq(me.courses[0].recall[1].attempt_id, rc7.attempt_id);
});

section('watch: ticks saved per episode, reflected in me', () => {
  const h = harness('2027-01-05T09:00:00+07:00');
  const tok = h.login('T001');
  eq(h.ok({ action: 'watch', token: tok, course: 'A2', ep: 3, watched: true }), { ok: true, server_now: '2027-01-05T09:00:00+07:00', course: 'A2', watched: [3] });
  eq(h.ok({ action: 'watch', token: tok, course: 'a2', ep: 1, watched: true }).watched, [1, 3]);
  eq(h.ok({ action: 'watch', token: tok, course: 'A2', ep: 3, watched: false }).watched, [1]);
  eq(h.ok({ action: 'watch', token: tok, course: 'A2', ep: 3, watched: true }).watched, [1, 3]);
  eq(h.table('Watched').length, 2, 'one row per episode (upsert)');
  h.err({ action: 'watch', token: tok, course: 'A2', ep: 99, watched: true }, 'not_found');
  h.err({ action: 'watch', token: tok, course: 'ZZ', ep: 1, watched: true }, 'not_found');
  h.err({ action: 'watch', token: tok, course: 'A2', ep: -1, watched: true }, 'bad_request');
  h.ok({ action: 'watch', token: tok, course: 'A1', ep: 0, watched: true });
  const me = h.ok({ action: 'me', token: tok });
  eq(me.courses[0].episodes.filter((e) => e.watched).map((e) => e.ep), [1, 3]);
  eq(me.courses[2].episodes[0].watched, true, 'trailer tick');
  eq(me.streak.active_this_week, true); eq(me.streak.current_weeks, 1);
  eq(h.ok({ action: 'me', token: h.login('T002') }).courses[0].episodes.some((e) => e.watched), false, 'ticks are per person');
});

// ============================================================ team views, capstone, panel
section('team_summary suppression and team_status (manager only, no scores)', () => {
  const h = harness('2026-11-16T09:00:00+07:00');
  const takers = ['T001', 'T002', 'T003', 'T004', 'T005', 'T006', 'T007', 'T008', 'T009', 'T010', 'T040'];
  takers.forEach((c, i) => {
    const t = h.login(c);
    const s = h.ok({ action: 'start', token: t, assessment: 'baseline' });
    const self = Object.fromEntries(fx.COURSES.map((k) => [k, (i + 1) % 5]));
    h.ok({ action: 'submit', token: t, attempt_id: s.attempt_id, answers: answersFor(s.items, 10 + i * 3), self_ratings: self });
  });
  const tok = h.login('T001');
  let ts = h.ok({ action: 'team_summary', token: tok });
  eq(Object.keys(ts).sort(), ['baseline', 'checkpoints', 'min_n', 'ok', 'server_now', 'updated_at', 'wave']);
  eq(ts.min_n, 3); eq(ts.wave, '2026-11');
  eq(ts.baseline.map((g) => [g.group, g.n]), [['all', 9], ['demand', 3], ['supply', 3]], 'materials (2) and cs (1) hidden; manager and test user never counted');
  eq(Object.keys(ts.baseline[0].courses), fx.COURSES);
  eq(Object.keys(ts.baseline[0].courses.A2).sort(), ['pct', 'self']);
  eq(ts.baseline[1].courses.A2.self, round1((1 + 2 + 3) / 3));
  ok(Number.isInteger(ts.baseline[0].courses.A2.pct));
  eq(ts.checkpoints.map((g) => g.group), ['all', 'demand', 'supply']);
  eq(Object.keys(ts.checkpoints[0].courses.A2).sort(), ['first_try_pass', 'passed_by_forum']);
  eq(ts.checkpoints[0].courses.A2, { first_try_pass: null, passed_by_forum: null }, 'course not started');
  ok(!/T00|Alpha|Juliet/.test(JSON.stringify(ts)), 'no names or codes in team_summary');
  // the hourly summary tab gives the same answer
  eq(h.run('buildSummary') > 0, true);
  ok(h.table('Summary').every((r) => +r.n >= 3), 'Summary tab never stores small groups');
  ts = h.ok({ action: 'team_summary', token: tok });
  eq(ts.updated_at, '2026-11-16T09:00:00+07:00');
  eq(ts.baseline.map((g) => g.n), [9, 3, 3]);

  h.err({ action: 'team_status', token: tok }, 'forbidden');
  const st = h.ok({ action: 'team_status', token: h.login('T010') });
  eq(st.reports.map((r) => r.code), ['T001', 'T002', 'T003', 'T004'], 'direct reports only; test user hidden');
  eq(Object.keys(st.reports[0]).sort(), ['baseline', 'code', 'courses', 'first_name']);
  eq(st.reports[0].first_name, 'Alpha'); eq(st.reports[0].baseline, 'done');
  eq(st.reports[0].courses.A2, 'not_started'); eq(Object.keys(st.reports[0].courses), fx.COURSES);
  ok(!/pct|score|n_correct/.test(JSON.stringify(st)), 'no scores in team_status');
  // checkpoint states show up as passed / not_yet
  h.clock.set(T('2027-01-05T09:00:00+07:00'));
  const t1 = h.login('T001');
  const c1 = h.ok({ action: 'start', token: t1, assessment: 'checkpoint', course: 'A2' });
  h.ok({ action: 'submit', token: t1, attempt_id: c1.attempt_id, answers: answersFor(c1.items, 9) });
  const t2 = h.login('T002');
  const c2 = h.ok({ action: 'start', token: t2, assessment: 'checkpoint', course: 'A2' });
  h.ok({ action: 'submit', token: t2, attempt_id: c2.attempt_id, answers: answersFor(c2.items, 3) });
  const st2 = h.ok({ action: 'team_status', token: h.login('T010') });
  eq([st2.reports[0].courses.A2, st2.reports[1].courses.A2, st2.reports[2].courses.A2], ['passed', 'not_yet', 'not_started']);
  h.run('buildSummary');
  const ts2 = h.ok({ action: 'team_summary', token: t1 });
  eq(ts2.checkpoints[1].courses.A2.first_try_pass, 50, 'demand: 1 of 2 who tried passed first time');
  eq(ts2.checkpoints[1].courses.A2.passed_by_forum, 33, 'demand: 1 of 3 passed so far');
});

function round1(x) { return Math.round(x * 10) / 10; }

section('capstone: members only, SOI ≤ 60 words, URL and VND rules, deadline; panel scores', () => {
  const h = harness('2027-06-01T09:00:00+07:00');
  const t1 = h.login('T001');
  const g = h.ok({ action: 'capstone_get', token: t1 });
  eq(g.team, { team_id: 'TEAM1', project_title: 'Fixture project one', members: [{ code: 'T001', first_name: 'Alpha' }, { code: 'T002', first_name: 'Bravo' }, { code: 'T003', first_name: 'Charlie' }], sponsor: { code: 'T010', first_name: 'Juliet' } });
  eq(g.submissions, { pitch: null, capstone: null }); eq(g.deadlines, { pitch: '2027-06-21', capstone: '2027-12-20' });
  eq(h.ok({ action: 'capstone_get', token: h.login('T009') }).team, null);
  const fields = {
    project_title: 'Fixture project one', soi_situation: 'Fixture situation in a few words.', soi_observation: 'Fixture observation ending in a question?',
    soi_implication: 'Fixture implication.', kpi_name: 'Fixture KPI', kpi_before: '-5', kpi_after: '2', kpi_unit: '%',
    evidence_url: 'https://example.invalid/evidence', value_vnd: '120000000', value_basis: 'Fixture basis', lessons: '=HYPERLINK("https://x")'
  };
  const sub = h.ok({ action: 'capstone_submit', token: t1, stage: 'pitch', team_id: 'TEAM1', fields });
  eq(Object.keys(sub).sort(), ['ok', 'server_now', 'submission', 'submitted_at']);
  eq(Object.keys(sub.submission).sort(), ['evidence_url', 'kpi_after', 'kpi_before', 'kpi_name', 'kpi_unit', 'lessons', 'project_title', 'soi_implication', 'soi_observation', 'soi_situation', 'stage', 'submitted_at', 'submitted_by', 'value_basis', 'value_vnd']);
  eq(sub.submission.lessons, fields.lessons, 'formula-like text comes back as text');
  eq(sub.submission.kpi_before, '-5');
  ok(h.table('Capstone').every((r) => !Object.values(r).includes('#FORMULA')), 'no formula reached the Sheet');
  h.err({ action: 'capstone_submit', token: h.login('T004'), stage: 'pitch', team_id: 'TEAM1', fields }, 'forbidden');
  h.err({ action: 'capstone_submit', token: t1, stage: 'pitch', team_id: 'NOPE', fields }, 'not_found');
  h.err({ action: 'capstone_submit', token: t1, stage: 'final', team_id: 'TEAM1', fields }, 'bad_request');
  const long = Array.from({ length: 61 }, (_, i) => 'w' + i).join(' ');
  eq(h.err({ action: 'capstone_submit', token: t1, stage: 'pitch', team_id: 'TEAM1', fields: Object.assign({}, fields, { soi_observation: long }) }, 'bad_request').field, 'soi_observation');
  h.ok({ action: 'capstone_submit', token: t1, stage: 'pitch', team_id: 'TEAM1', fields: Object.assign({}, fields, { soi_situation: long.split(' ').slice(0, 60).join(' ') }) });
  eq(h.err({ action: 'capstone_submit', token: t1, stage: 'pitch', team_id: 'TEAM1', fields: Object.assign({}, fields, { evidence_url: 'http://x' }) }, 'bad_request').field, 'evidence_url');
  eq(h.err({ action: 'capstone_submit', token: t1, stage: 'pitch', team_id: 'TEAM1', fields: Object.assign({}, fields, { value_vnd: '12,000' }) }, 'bad_request').field, 'value_vnd');
  const t2 = h.login('T002');
  h.ok({ action: 'capstone_submit', token: t2, stage: 'pitch', team_id: 'TEAM1', fields: Object.assign({}, fields, { kpi_after: '3' }) });
  eq(h.table('Capstone').length, 1, 'one row per team and stage (update)');
  const g2 = h.ok({ action: 'capstone_get', token: t1 });
  eq(g2.submissions.pitch.kpi_after, '3'); eq(g2.submissions.pitch.submitted_by, 'T002');
  const me = h.ok({ action: 'me', token: t1 });
  eq(me.capstone.pitch_submitted_at, '2027-06-01T09:00:00+07:00'); eq(me.certificates.pitch_submitted, true);
  h.clock.set(T('2027-06-21T23:59:59+07:00'));
  h.ok({ action: 'capstone_submit', token: h.login('T003'), stage: 'pitch', team_id: 'TEAM1', fields });
  h.clock.set(T('2027-06-22T00:00:00+07:00'));
  eq(h.err({ action: 'capstone_submit', token: h.login('T003'), stage: 'pitch', team_id: 'TEAM1', fields }, 'gate_closed').deadline, '2027-06-21');
  h.ok({ action: 'capstone_submit', token: h.login('T003'), stage: 'capstone', team_id: 'TEAM1', fields });

  // panel
  const judge = h.login('T020');
  h.err({ action: 'panel_list', token: h.login('T001'), stage: 'pitch' }, 'forbidden');
  h.err({ action: 'panel_score', token: h.login('T001'), stage: 'pitch', team_id: 'TEAM1', scores: { c1: 3, c2: 3, c3: 3, c4: 3, c5: 3 } }, 'forbidden');
  const pl = h.ok({ action: 'panel_list', token: judge, stage: 'pitch' });
  eq(pl.stage, 'pitch'); eq(pl.teams.map((t) => t.team_id), ['TEAM1', 'TEAM2']);
  eq(Object.keys(pl.teams[0]).sort(), ['my_score', 'project_title', 'submission', 'team_id']);
  ok(pl.teams[0].submission && pl.teams[1].submission === null); eq(pl.teams[0].my_score, null);
  eq(h.err({ action: 'panel_score', token: judge, stage: 'pitch', team_id: 'TEAM1', scores: { c1: 6, c2: 3, c3: 3, c4: 3, c5: 3 } }, 'bad_request').field, 'c1');
  h.err({ action: 'panel_score', token: judge, stage: 'pitch', team_id: 'TEAM1', scores: { c1: 2, c2: 3, c3: 3, c4: 3 } }, 'bad_request');
  h.err({ action: 'panel_score', token: judge, stage: 'pitch', team_id: 'NOPE', scores: { c1: 2, c2: 3, c3: 3, c4: 3, c5: 1 } }, 'not_found');
  const sc = h.ok({ action: 'panel_score', token: judge, stage: 'pitch', team_id: 'TEAM1', scores: { c1: 2, c2: 3, c3: 4, c4: 5, c5: 1 }, comment: 'Keep the tree; tighten the ask.' });
  eq(Object.keys(sc).sort(), ['ok', 'scored_at', 'server_now']);
  h.ok({ action: 'panel_score', token: judge, stage: 'pitch', team_id: 'TEAM1', scores: { c1: 4, c2: 4, c3: 4, c4: 4, c5: 5 }, comment: 'Updated.' });
  eq(h.table('PanelScores').length, 1, 'panel_score upserts per judge/team/stage');
  eq(h.ok({ action: 'panel_list', token: judge, stage: 'pitch' }).teams[0].my_score, { c1: 4, c2: 4, c3: 4, c4: 4, c5: 5, comment: 'Updated.', scored_at: '2027-06-22T00:00:00+07:00' });
  eq(h.ok({ action: 'panel_list', token: h.login('T050'), stage: 'pitch' }).teams[0].my_score, null, 'admin may list; own scores only');
  h.ok({ action: 'panel_score', token: h.login('T050'), stage: 'pitch', team_id: 'TEAM1', scores: { c1: 2, c2: 2, c3: 2, c4: 2, c5: 2 } });
  h.run('menuPanelResults');
  const dp = h.table('Dash_Panel');
  eq(dp.map((r) => [r.stage, r.team_id, r.judges, r.weighted_score]), [['pitch', 'TEAM1', '2', '3.17']], 'mean of judges: (26/6 + 12/6) / 2');
});

// ============================================================ privacy, infrastructure
section('Log tab never holds PINs, answers or tokens; busy lock; cache eviction', () => {
  const h = harness('2027-01-05T09:00:00+07:00');
  h.err({ action: 'login', code: 'T001', pin: '864201' }, 'auth_failed');
  h.err({ action: 'login', code: '246810', pin: PIN }, 'auth_failed');
  const tok = h.login('T001');
  const s = h.ok({ action: 'start', token: tok, assessment: 'checkpoint', course: 'A2' });
  const answers = answersFor(s.items, 9);
  h.ok({ action: 'save', token: tok, attempt_id: s.attempt_id, answers });
  h.ok({ action: 'submit', token: tok, attempt_id: s.attempt_id, answers });
  h.ok({ action: 'change_pin', token: h.login('T002'), old_pin: PIN, new_pin: '975310' });
  h.call('{"action":"login","code":"T003","pin":246810,"x":');
  const log = h.table('Log');
  ok(log.length >= 5, 'log rows written');
  const text = JSON.stringify(log);
  for (const bad of [PIN, '864201', '975310', 'v1.', '"a"', 'FX_A2_A_0', 'answers', 'pin_hash']) ok(!text.includes(bad), 'Log must not contain ' + bad);
  ok(log.some((r) => r.action === 'login' && r.ok === 'FALSE' && /auth_failed/.test(r.message)));
  ok(log.some((r) => r.action === 'submit' && r.message.includes(s.attempt_id)), 'attempt ids are kept');
  eq(log.filter((r) => r.employee_code === '246810').length, 0, 'unknown codes are not logged');

  // busy: start/submit need the lock, save does not
  const t2 = h.login('T002', '975310');
  const s2 = h.ok({ action: 'start', token: t2, assessment: 'predict', course: 'A2' });
  h.lock.contended = true;
  h.err({ action: 'start', token: t2, assessment: 'checkpoint', course: 'A2' }, 'busy');
  h.err({ action: 'submit', token: t2, attempt_id: s2.attempt_id, answers: {} }, 'busy');
  h.err({ action: 'login', code: 'T003', pin: PIN }, 'busy');
  h.ok({ action: 'save', token: t2, attempt_id: s2.attempt_id, answers: answersFor(s2.items, 3) });
  h.ok({ action: 'me', token: t2 });
  h.lock.contended = false;
  eq(h.ok({ action: 'submit', token: t2, attempt_id: s2.attempt_id }).n_correct, 3, 'submit falls back to the saved answers');

  // cache: values stay under 100 KB, forced eviction still works, refresh picks up edits
  ok(Array.from(h.cache.store.values()).every((e) => Buffer.byteLength(e.v) < 100 * 1024));
  ok(Array.from(h.cache.store.keys()).some((k) => /items:checkpoint:A2:A$/.test(k)), 'items cached per assessment/course/form');
  h.cache.forceEvict = true;
  const t3 = h.login('T003');
  eq(h.ok({ action: 'start', token: t3, assessment: 'predict', course: 'A2' }).items.length, 3);
  h.cache.forceEvict = false;
  h.updateWhere('Items', 'item_id', 'FX_A3_PR_01', { active: 'FALSE' });
  eq(h.ok({ action: 'start', token: t3, assessment: 'predict', course: 'A3' }).items.length, 3, 'cached for 10 min');
  h.run('menuRefreshCache');
  eq(h.ok({ action: 'start', token: h.login('T004'), assessment: 'predict', course: 'A3' }).items.length, 2, 'after Refresh cache');
  h.clock.advance(11 * MIN);
  h.updateWhere('Items', 'item_id', 'FX_A3_PR_02', { active: 'FALSE' });
  h.clock.advance(11 * MIN);
  eq(h.ok({ action: 'start', token: h.login('T005'), assessment: 'predict', course: 'A3' }).items.length, 1, 'cache expires after 10 min');
});

section('F5 coercion: setup makes every tab plain text and repairs converted cells', () => {
  const h = createHarness({ now: T('2026-11-16T09:00:00+07:00') });
  // what an unformatted Sheet does
  const raw = h.ss.insertSheet('Scratch');
  raw.getRange(1, 1, 1, 4).setValues([['2026-11', '2027-01-04', '00123', 'TRUE']]);
  const v = raw.getRange(1, 1, 1, 4).getValues()[0];
  ok(Object.prototype.toString.call(v[0]) === '[object Date]' && Object.prototype.toString.call(v[1]) === '[object Date]');
  eq(v[2], 123); eq(v[3], true);
  // a Config tab that was typed in before setup
  const cfg = h.ss.insertSheet('Config');
  cfg.getRange(1, 1, 3, 2).setValues([['key', 'value'], ['wave', '2026-11'], ['baseline_open_from', '2026-11-16']]);
  h.run('setupSheet');
  eq(h.ss.getSpreadsheetTimeZone(), 'Asia/Ho_Chi_Minh');
  const conf = Object.fromEntries(h.table('Config').map((r) => [r.key, r.value]));
  eq(conf.wave, '2026-11', 'coerced wave repaired'); eq(conf.baseline_open_from, '2026-11-16'); eq(conf.late_days, '7');
  eq(conf.pitch_deadline, '2027-06-21'); eq(conf.capstone_deadline, '2027-12-20');
  eq(h.sheet('Roster').getRange(500, 1).getNumberFormat(), '@', 'whole columns are plain text');
  h.appendObjects('Roster', [{ employee_code: '00123', display_name: 'Fixture Zero', active: 'TRUE' }]);
  eq(h.table('Roster')[0].employee_code, '00123', 'leading zeros survive');
  eq(h.table('Courses').find((r) => r.code === 'A2').online_from, '2027-01-04');
  const hdr = h.sheet('Roster').getRange(1, 1, 1, h.sheet('Roster').getLastColumn()).getValues()[0];
  for (const c of ['preferred_name', 'lock_count', 'session_ver', 'consent_at', 'certificate']) ok(hdr.includes(c), 'Roster.' + c);
  ok(h.sheet('Attempts').getRange(1, 1, 1, 21).getValues()[0].includes('seed'));
  ok(h.sheet('Recall').getRange(1, 1, 1, 8).getValues()[0].includes('attempt_id'));
  ok(h.sheet('Courses').getRange(1, 1, 1, 25).getValues()[0].includes('order'));
  ok(h.props.get('TOKEN_SECRET') && h.props.get('PIN_PEPPER'));
  const pepper = h.props.get('PIN_PEPPER');
  h.run('setupSheet');
  eq(h.props.get('PIN_PEPPER'), pepper, 'secrets never overwritten');
  eq(h.table('Episodes').length, 76, 'episodes seeded once');
  eq(h.table('Config').filter((r) => r.key === 'wave').length, 1, 'setup is idempotent');
  // a Courses.csv "Replace current sheet" import drops the hand columns: Validate puts them back
  const cs = h.sheet('Courses');
  cs.clear();
  cs.getRange(1, 1, 2, 3).setValues([['code', 'name_en', 'self_en'], ['A2', 'Fixture course A2', 'Fixture self A2']]);
  h.run('validateNow_');
  const a2 = h.table('Courses').find((r) => r.code === 'A2');
  eq([a2.order, a2.online_from, a2.forum_date, a2.open], ['1', '2027-01-04', '2027-01-26', 'TRUE']);
  eq(h.table('Courses').length, 10);
});

section('admin menu: PINs, reset, unlock, void, summaries, dashboards, validate, import, trigger', () => {
  const h = harness('2027-01-05T09:00:00+07:00');
  h.run('onOpen');
  const labels = h.ui.menus[0].items.filter((i) => i.label).map((i) => i.label);
  eq(h.ui.menus[0].name, '1% Planner');
  for (const l of ['Set up / repair tabs', 'Import items from CSV…', 'Validate items / courses', 'Issue PINs for new roster rows', 'Reset a PIN…', 'Unlock a retake…', 'Void an attempt…', 'Rebuild summaries', 'Install hourly summary trigger', 'Baseline heatmap', 'Course gate report', 'IDP export', 'Recall due list', 'Seed episodes', 'Panel results']) ok(labels.includes(l), 'menu: ' + l);
  for (const i of h.ui.menus[0].items) if (i.fn) eq(typeof h.ctx[i.fn], 'function', 'menu handler exists: ' + i.fn);

  // Issue PINs: shown once, only hashes stored, first login must change
  h.appendObjects('Roster', [{ employee_code: 't070', display_name: 'Fixture New Papa', role_area: 'cs', roles: 'learner', active: 'TRUE' }]);
  h.run('menuIssuePins');
  const dlg = h.ui.dialogs.pop();
  const pin = /T070<\/td><td[^>]*>Fixture New Papa<\/td><td[^>]*>(\d{6})</.exec(dlg.html)[1];
  ok(!JSON.stringify(h.table('Roster')).includes(pin), 'the PIN itself is never stored');
  eq(h.ok({ action: 'login', code: 'T070', pin }).profile.must_change_pin, true);
  eq(h.run('issuePins_').length, 0, 'nothing left to issue');
  // Reset a PIN: old sessions and PIN stop working
  const old = h.login('T001');
  h.ui.prompts.push('T001');
  h.run('menuResetPin');
  const pin2 = /(\d{6})</.exec(h.ui.dialogs.pop().html)[1];
  h.err({ action: 'me', token: old }, 'session_expired');
  h.err({ action: 'login', code: 'T001', pin: PIN }, 'auth_failed');
  eq(h.ok({ action: 'login', code: 'T001', pin: pin2 }).profile.must_change_pin, true);
  // Unlock via the menu prompts
  h.ui.prompts.push('t005', 'a2', 'T010', 'chat on 5 Jan');
  h.run('menuUnlock');
  eq(h.table('Unlocks').map((u) => [u.employee_code, u.course, u.unlocked_by, u.unlocked_at]), [['T005', 'A2', 'T010', '2027-01-05T09:00:00+07:00']]);
  // Void: a voided pass no longer counts, its recall rows are voided, the person can retake
  const t6 = h.login('T006');
  const s = h.ok({ action: 'start', token: t6, assessment: 'checkpoint', course: 'A2' });
  h.ok({ action: 'submit', token: t6, attempt_id: s.attempt_id, answers: answersFor(s.items, 10) });
  h.ui.prompts.push(s.attempt_id, 'pilot');
  h.run('menuVoidAttempt');
  eq(h.table('Attempts').find((a) => a.attempt_id === s.attempt_id).status, 'void');
  eq(h.table('Recall').filter((r) => r.employee_code === 'T006').map((r) => r.status), ['void', 'void', 'void']);
  const me6 = h.ok({ action: 'me', token: t6 });
  eq(me6.courses[0].checkpoint.status, 'not_started'); eq(me6.courses[0].recall, []);
  eq(h.ok({ action: 'start', token: t6, assessment: 'checkpoint', course: 'A2' }).attempt_no, 1);
  ok(h.table('Log').some((r) => r.action === 'admin_void' && r.employee_code === 'T006'));

  // dashboards (baseline taken in the window first)
  h.clock.set(T('2026-11-20T09:00:00+07:00'));
  for (const [c, n, lvl] of [['T002', 46, 1], ['T003', 5, 4]]) {
    const t = h.login(c);
    const b = h.ok({ action: 'start', token: t, assessment: 'baseline' });
    h.ok({ action: 'submit', token: t, attempt_id: b.attempt_id, answers: answersFor(b.items, n), self_ratings: Object.fromEntries(fx.COURSES.map((k) => [k, lvl])) });
  }
  h.clock.set(T('2027-01-06T09:00:00+07:00'));
  h.run('menuBaselineHeatmap');
  const heat = h.table('Dash_Baseline');
  eq(heat.length, 2);
  ok(/rates low, scores high/.test(heat.find((r) => r.code === 'T002').flags));
  ok(/rates high, scores low/.test(heat.find((r) => r.code === 'T003').flags));
  ok(h.sheet('Dash_Baseline').backgrounds.length === 1, 'heatmap colours');
  h.run('menuGateReport');
  const gate = h.table('Dash_Gate');
  ok(gate.some((r) => r.course === 'A2' && r.code === 'TOTAL'));
  ok(!gate.some((r) => r.code === 'T040'), 'test users left out of the gate report');
  h.run('menuIdpExport');
  const idp = h.table('Dash_IDP');
  ok(idp.find((r) => r.code === 'T003').goal_1.startsWith('Reach '));
  eq(idp.find((r) => r.code === 'T005').gap_1, 'no baseline');
  h.run('menuRecallDue');
  ok(h.sheet('Dash_Recall'));
  h.run('menuRebuildSummaries');
  ok(h.table('Summary').length > 0);
  h.run('menuInstallTrigger'); h.run('menuInstallTrigger');
  eq(h.triggers.length, 1); eq(h.triggers[0].getHandlerFunction(), 'buildSummary'); eq(h.triggers[0].everyHours, 1);
  h.run('menuSeedEpisodes');
  eq(h.table('Episodes').length, 76);

  // validate: the fixture bank matches the blueprint exactly
  const v = h.run('validateNow_');
  eq(v.errors, []); eq(v.warnings, []);
  h.updateWhere('Items', 'item_id', 'FX_P6_B_10', { answer: 'e' });
  h.run('menuValidate');
  ok(/answer must be a, b, c or d/.test(h.ui.dialogs.pop().html));
  // import a Cases CSV (invented)
  const rep = h.run('adminImportCsv', 'Cases', 'case_id,title_en,title_vi,context_en,context_vi\r\nCASE1,"Fixture, imported",VI,"Context ""quoted""",VI ctx\r\n');
  ok(/Cases: imported 1 row/.test(rep));
  eq(h.table('Cases')[0].title_en, 'Fixture, imported'); eq(h.table('Cases')[0].context_en, 'Context "quoted"');
  ok(/Problem: .*FX_P6_B_10/.test(rep), 'import reports validation problems');
});

section('generated files: Seed.gs in sync, bundle builds and runs', () => {
  const seed = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'gen_seed.mjs'), '--check'], { encoding: 'utf8' });
  eq(seed.status, 0, 'Seed.gs in sync with docs/data/courses.json: ' + seed.stderr);
  const b = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'bundle_backend.mjs'), '--check'], { encoding: 'utf8' });
  eq(b.status, 0, 'backend/dist is up to date: ' + b.stderr + b.stdout);
  const dist = path.join(ROOT, 'backend', 'dist', 'Hub.gs');
  const h = createHarness({ now: T('2027-01-05T09:00:00+07:00'), files: [dist] });
  fx.loadFixtures(h);
  const r = h.call({ action: 'login', code: 'T001', pin: PIN });
  eq(r.ok, true, 'smoke login on the bundle');
  const s = h.call({ action: 'start', token: r.token, assessment: 'checkpoint', course: 'A2' });
  eq(s.ok, true); eq(forbiddenKeys(s), []);
  eq(JSON.parse(fs.readFileSync(path.join(ROOT, 'backend', 'dist', 'appsscript.json'), 'utf8')).webapp.access, 'ANYONE_ANONYMOUS');
});

// ------------------------------------------------------------ run
let failed = 0;
const t0 = Date.now();
for (const s of sections) {
  try { s.fn(); } catch (e) { failed++; console.error('✖ ' + s.name + '\n  ' + (e && e.stack || e)); }
}
const tz = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
if (failed) { console.error(`✖ api tests: ${failed} of ${sections.length} sections failed (${count} assertions ran, TZ=${tz})`); process.exit(1); }
console.log(`✔ api tests: ${sections.length} sections, ${count} assertions passed in ${Date.now() - t0} ms (TZ=${tz})`);

if (!process.env.API_TZ_CHILD) {
  for (const zone of ['UTC', 'America/New_York']) {
    const r = spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { TZ: zone, API_TZ_CHILD: '1' }), encoding: 'utf8' });
    process.stdout.write('  ' + (r.stdout || '').trim() + '\n');
    if (r.status !== 0) { console.error(r.stderr); console.error(`✖ api tests failed under TZ=${zone}`); process.exit(1); }
  }
}
