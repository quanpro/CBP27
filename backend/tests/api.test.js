#!/usr/bin/env node
// End-to-end tests through doPost on the Node harness (invented fixtures only).
// Run: node backend/tests/api.test.js   (re-runs itself under TZ=UTC, Asia/Ho_Chi_Minh and America/New_York)
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

  // Locks: 5 wrong PINs → 15 min, then 30 (rolling 7 days); the 3rd lock in 7 days needs an admin.
  // Unknown codes lock exactly like real ones, and a wrong PIN costs no Sheet write, no lock, no Log row.
  const fail5 = (code) => {
    const seq = [];
    for (let i = 0; i < 5; i++) { const r = h.call({ action: 'login', code, pin: '000001' }); seq.push(r.error); }
    return seq;
  };
  const w0 = h.ss.stats.writes, acq0 = h.lock.acquisitions, log0 = h.table('Log').length;
  h.clock.set(T('2026-11-16T10:00:00+07:00'));
  const realSeq = fail5('T008');
  const wReal = h.ss.stats.writes;
  const fakeSeq = fail5('ZZ998');
  eq(h.ss.stats.writes, wReal, 'an unknown code never writes to the Sheet');
  ok(wReal > w0, 'a real person\'s lock is kept in Roster');
  eq(realSeq.map((e) => e.code), ['auth_failed', 'auth_failed', 'auth_failed', 'auth_failed', 'locked']);
  eq(fakeSeq, realSeq, 'identical error bodies for a real and an unknown code');
  eq(realSeq[4].until, '2026-11-16T10:15:00+07:00');
  eq(h.err({ action: 'login', code: 'T008', pin: PIN }, 'locked'), h.err({ action: 'login', code: 'ZZ998', pin: PIN }, 'locked'), 'correct PIN still locked');
  eq(h.lock.acquisitions, acq0, 'failed logins never take the script lock');
  eq(h.table('Log').length, log0, 'failed logins write no Log row');
  const lockRow = h.table('Roster').find((x) => x.employee_code === 'T008');
  eq([lockRow.locked_until, lockRow.lock_count, lockRow.lock_history], ['2026-11-16T10:15:00+07:00', '1', '2026-11-16T10:00:00+07:00']);
  const w1 = h.ss.stats.writes;
  h.err({ action: 'login', code: 'T004', pin: '000001' }, 'auth_failed');
  h.err({ action: 'login', code: 'ZZ997', pin: '000001' }, 'auth_failed');
  eq(h.ss.stats.writes, w1, 'a normal wrong PIN writes nothing to the Sheet (known or unknown)');
  // second lock: 30 min; third: until an admin clears it (identical for an unknown code)
  h.clock.set(T('2026-11-16T11:00:00+07:00'));
  eq(fail5('T008')[4].until, '2026-11-16T11:30:00+07:00');
  eq(fail5('ZZ998')[4].until, '2026-11-16T11:30:00+07:00', 'unknown code escalates the same way');
  h.clock.set(T('2026-11-16T11:31:00+07:00'));
  const hard = fail5('T008')[4];
  eq(hard.code, 'locked'); eq(hard.until, null, 'third lock in 7 days: until an admin clears it');
  eq(fail5('ZZ998')[4], hard, 'same body for an unknown code');
  h.clock.set(T('2026-11-25T09:00:00+07:00'));
  eq(h.err({ action: 'login', code: 'T008', pin: PIN }, 'locked').until, null, 'still locked a week later');
  h.cache.evictAll();
  eq(h.err({ action: 'login', code: 'T008', pin: PIN }, 'locked').until, null, 'kept in Roster when the cache is gone');
  h.run('clearLock_', 'T008');
  h.login('T008');
  const cleared = h.table('Roster').find((x) => x.employee_code === 'T008');
  eq([cleared.locked_until, cleared.lock_count, cleared.lock_history], ['', '0', '']);
  ok(h.table('Log').some((r) => r.action === 'admin_clear_lock' && r.employee_code === 'T008'));
  // rolling 7 days, kept in Roster across days: lock again 2 days later → 30 min; 8 days later → 15 min
  h.clock.set(T('2026-11-26T09:00:00+07:00'));
  eq(fail5('T007')[4].until, '2026-11-26T09:15:00+07:00');
  h.clock.set(T('2026-11-28T09:00:00+07:00'));
  eq(fail5('T007')[4].until, '2026-11-28T09:30:00+07:00', 'escalation survives the 6-hour cache');
  h.clock.set(T('2026-12-06T09:00:00+07:00'));
  eq(fail5('T007')[4].until, '2026-12-06T09:15:00+07:00', 'older locks drop out after 7 days');
  // successful login resets the counter: 4 wrong, 1 right, 4 wrong → still no lock
  for (let i = 0; i < 4; i++) h.err({ action: 'login', code: 'T006', pin: '000001' }, 'auth_failed');
  h.login('T006');
  for (let i = 0; i < 4; i++) h.err({ action: 'login', code: 'T006', pin: '000001' }, 'auth_failed');
  h.login('T006');
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
  eq(Object.keys(me).sort(), ['baseline', 'capstone', 'certificates', 'charters', 'courses', 'ok', 'profile', 'server_now', 'sessions', 'streak']);
  // offline sessions from the Sessions tab (active rows only, oldest first) and the charter names from BaselineText
  eq(me.sessions.length, fx.FIXTURE_SESSIONS.length);
  eq(me.sessions[0], { date: '2027-01-26', kind: 'kickoff', courses: ['A2', 'A3'], title_en: 'Fixture kick-off', title_vi: 'Buổi mẫu khởi động', start: '13:30', end: '17:30', place: 'Fixture room', note_en: '', note_vi: '' });
  eq(me.sessions.map((x) => x.date), fx.FIXTURE_SESSIONS.map((x) => x.date));
  eq(me.charters.map((c) => [c.n, c.en]), [1, 2, 3, 4, 5].map((n) => [n, 'Mock charter ' + n]));
  eq(me.courses.map((c) => c.code), ['A2', 'A3', 'A1', 'P1', 'C1', 'P2', 'P3', 'P4', 'P5', 'P6']);
  const a2 = me.courses[0];
  eq(Object.keys(a2).sort(), ['blink_url', 'checkpoint', 'checkpoint_close', 'code', 'cycle', 'episodes', 'field_until', 'forum_date', 'late_until', 'online_from', 'online_to', 'open', 'order', 'predict', 'recall']);
  eq(a2.online_to, '2027-01-22');
  eq(a2.open, true); eq(me.courses[2].open, false, 'A1 opens 2027-02-15');
  eq(a2.late_until, '2027-02-02');
  eq(a2.episodes.length, 8); eq(Object.keys(a2.episodes[0]).sort(), ['blink_url', 'embed_url', 'ep', 'minutes', 'watched']);
  eq(me.courses[2].episodes[0].ep, 0, 'A1 has a trailer (ep 0)');
  eq(Object.keys(a2.checkpoint).sort(), ['attempts', 'best_pct', 'gate_closed', 'last_attempt_id', 'needs_unlock', 'next_retake_at', 'open_attempt_id', 'passed_at', 'status']);
  eq(Object.keys(a2.predict).sort(), ['attempts', 'done', 'last_pct']);
  eq(Object.keys(me.baseline).sort(), ['parts', 'profile_ready', 'rating', 'results_open', 'wave']);
  eq(Object.keys(me.baseline.parts), ['p1', 'p2', 'p3']);
  eq(Object.keys(me.streak).sort(), ['active_this_week', 'active_weeks_total', 'current_weeks', 'multiplier', 'recent', 'weeks_total_program']);
  eq([me.streak.weeks_total_program, me.streak.recent.length], [52, 12]);
  eq(me.certificates, { level: '', checkpoints_passed: 0, checkpoints_total: 10, pitch_submitted: false, capstone_submitted: false });
  eq(me.capstone, { team_id: 'TEAM1', project_title: 'Fixture project one', pitch_submitted_at: null, capstone_submitted_at: null, pitch_deadline: '2027-06-21', capstone_deadline: '2027-12-20' });
  const text = JSON.stringify(me);
  ok(!/Bravo|Charlie|T002|T010/.test(text), 'no other person in me');
  eq(forbiddenKeys(me), []);
  eq(h.ok({ action: 'me', token: h.login('T009') }).capstone.team_id, null);
});

// ============================================================ baseline v2 (specs/22), invented MOCK-BL items
const BLI = fx.buildBaselineItems();
const BLK = Object.fromEntries(BLI.map((i) => [i.item_id, i]));
const BL_FORBIDDEN = new Set(['answer', 'answer_most', 'answer_least', 'why', 'why_en', 'why_vi', 'step', 'move', 'gate', 'level', 'charter', 'correct', 'is_correct', 'mockCorrect']);
/** Paths of forbidden keys anywhere in a response (allow: exact paths that are not items: the profile's level, me.certificates.level). */
function blLeaks(obj, allow = [], found = [], at = '$') {
  if (Array.isArray(obj)) obj.forEach((v, i) => blLeaks(v, allow, found, `${at}[${i}]`));
  else if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      const p = `${at}.${k}`;
      if (BL_FORBIDDEN.has(k) && !allow.some((a) => (a instanceof RegExp ? a.test(p) : a === p))) found.push(p);
      blLeaks(obj[k], allow, found, p);
    }
  }
  return found;
}
const BL_SECRET_TEXT = /Mock reason|Lý do mẫu/;
const itemsOf = (s) => s.sections.flatMap((x) => x.items);
const wrongL = (l) => (l === 'a' ? 'b' : 'a');
/** Part 1 / Part 3 answers: the first n served items right, the rest wrong. */
function mcqAnswers(items, n) {
  return Object.fromEntries(items.map((it, i) => [it.item_id, i < n ? BLK[it.item_id].answer : wrongL(BLK[it.item_id].answer)]));
}
/** SJT answers: every item keyed (both picks), or with `miss` items given a wrong least pick. */
function sjtAnswers(items, miss = 0) {
  return Object.fromEntries(items.map((it, i) => {
    const k = BLK[it.item_id];
    const least = i < miss ? 'abcd'.split('').find((l) => l !== k.answer_most && l !== k.answer_least) : k.answer_least;
    return [it.item_id, { most: k.answer_most, least }];
  }));
}
const rateAll = (items, v) => Object.fromEntries(items.map((it) => [it.item_id, typeof v === 'function' ? v(it) : v]));

/** Harness with the three parts open (rating and results closed). Records every response for a final leak scan. */
function blHarness(now, opts = {}) {
  const h = harness(now, Object.assign({}, opts, { config: Object.assign({ p1_open: 'TRUE', p2_open: 'TRUE', p3_open: 'TRUE' }, opts.config || {}) }));
  h.seen = [];
  const call = h.call;
  h.call = (p) => { const r = call(p); h.seen.push({ action: typeof p === 'object' ? p.action : '?', r }); return r; };
  h.scanAll = () => {
    for (const { action, r } of h.seen) {
      // not item fields: the profile's indicative level, the certificate level, the 0–4 self-rating scale
      const leaks = blLeaks(r, action === 'profile' ? ['$.p3.level'] : action === 'me' ? ['$.certificates.level'] : action === 'login' ? ['$.me.certificates.level'] : [/^\$\.scale\[\d+\]\.level$/]);
      eq(leaks, [], action + ' response carries no key, step, move, gate, level or charter: ' + leaks.slice(0, 3).join(', '));
      ok(!BL_SECRET_TEXT.test(JSON.stringify(r)), action + ' response carries no explanation text');
    }
  };
  return h;
}

/** A complete sitting through the API. Returns {s, res}. */
function sitPart(h, tok, part, o = {}) {
  const s = h.ok({ action: 'start', token: tok, assessment: 'baseline_p' + part });
  if (part === 2) {
    const sjt = s.sections[0].items;
    const nx = h.ok({ action: 'baseline_next', token: tok, attempt_id: s.attempt_id, answers: sjtAnswers(sjt, o.miss || 0) });
    const res = h.ok({ action: 'submit', token: tok, attempt_id: s.attempt_id, answers: rateAll(nx.section.items, o.self || 3) });
    return { s, nx, res };
  }
  const answers = mcqAnswers(itemsOf(s), o.right === undefined ? 20 : o.right);
  const body = { action: 'submit', token: tok, attempt_id: s.attempt_id, answers };
  if (part === 3) body.self_ratings = o.selfRatings || SELF10;
  return { s, res: h.ok(body) };
}

section('baseline v2: v1 removed, switches, Part 1 start shape, resume, result without feedback, once per part', () => {
  const h = blHarness('2026-11-16T09:00:00+07:00', { config: { p1_open: 'FALSE' } });
  const tok = h.login('T001');
  h.err({ action: 'start', token: tok, assessment: 'baseline' }, 'bad_request');
  h.err({ action: 'start', token: tok, assessment: 'baseline_p4' }, 'bad_request');
  let me = h.ok({ action: 'me', token: tok });
  eq(Object.keys(me.baseline).sort(), ['parts', 'profile_ready', 'rating', 'results_open', 'wave']);
  eq([me.baseline.wave, me.baseline.results_open, me.baseline.profile_ready, me.baseline.rating], ['2026-11', false, false, null]);
  eq(me.baseline.parts.p1, { open: false, status: 'not_started', minutes: 65, n_items: 32 });
  eq(me.baseline.parts.p2, { open: true, status: 'not_started', minutes: 35, n_items: 38 });
  eq(me.baseline.parts.p3, { open: true, status: 'not_started', minutes: 48, n_items: 28 });
  eq(h.err({ action: 'start', token: tok, assessment: 'baseline_p1' }, 'not_open').opens_at, undefined, 'no dates gate the baseline');
  h.setConfig('p1_open', 'TRUE');
  const s = h.ok({ action: 'start', token: tok, assessment: 'baseline_p1' });
  eq(Object.keys(s).sort(), ['answers', 'assessment', 'attempt_id', 'cases', 'deadline_at', 'exhibits', 'form', 'intro_en', 'intro_vi', 'module', 'ok', 'part',
    'resumed', 'sections', 'server_now', 'started_at', 'time_limit_min', 'title_en', 'title_vi']);
  eq([s.assessment, s.part, s.module, s.resumed, s.time_limit_min, s.deadline_at], ['baseline_p1', 1, '', false, 65, '2026-11-16T10:05:00+07:00']);
  ok(s.form === 'B' || s.form === 'C', 'a live form');
  eq(s.sections.map((x) => [x.id, x.items.length, x.locked]), [['A', 22, false], ['B', 10, false]]);
  eq(Object.keys(s.sections[0]).sort(), ['id', 'intro_en', 'intro_vi', 'items', 'locked', 'title_en', 'title_vi']);
  eq(s.sections[1].intro_en, 'Mock logic intro for form ' + s.form + '.');
  eq(s.title_en, 'Part 1 · Mock problem solving');
  const it = s.sections[0].items[2];
  eq(Object.keys(it).sort(), ['case_id', 'exhibit_ids', 'item_id', 'options', 'section', 'stem_en', 'stem_vi', 'type']);
  eq([it.type, it.section, it.case_id], ['mcq', 'A', 'C1']);
  eq(itemsOf(s).every((x) => x.item_id.startsWith('MOCK-BL-1' + s.form + '-')), true, 'one form only');
  eq(itemsOf(s).every((x) => x.options.length === 4 && x.options.every((o) => Object.keys(o).sort().join() === 'en,id,vi')), true);
  eq(Object.keys(s.exhibits).sort(), ['C1', 'C2'].flatMap((c) => [`MOCK-EX-${s.form}-${c}-T1`, `MOCK-EX-${s.form}-${c}-T2`]).sort(), 'only the exhibits the items reference');
  eq(Object.keys(s.exhibits[`MOCK-EX-${s.form}-C1-T1`]).sort(), ['md_en', 'md_vi', 'title_en', 'title_vi']);
  eq(s.cases, { C1: { title_en: `Mock case one (${s.form})`, title_vi: `VI Mock case one (${s.form})` }, C2: { title_en: `Mock case two (${s.form})`, title_vi: `VI Mock case two (${s.form})` } });
  eq(s.answers, {});
  // save (no lock), resume: same order and options, saved answers back
  const partial = mcqAnswers(s.sections[0].items.slice(0, 5), 5);
  partial['MOCK-BL-2S01'] = { most: 'a', least: 'b' };
  const acq = h.lock.acquisitions;
  eq(Object.keys(h.ok({ action: 'save', token: tok, attempt_id: s.attempt_id, answers: partial })).sort(), ['ok', 'saved_at', 'server_now']);
  eq(h.lock.acquisitions, acq, 'save never takes the script lock');
  h.clock.advance(5 * MIN);
  const r = h.ok({ action: 'start', token: tok, assessment: 'baseline_p1' });
  eq([r.resumed, r.attempt_id, r.deadline_at], [true, s.attempt_id, s.deadline_at]);
  eq(r.sections, s.sections, 'same items and option order on resume');
  delete partial['MOCK-BL-2S01'];
  eq(r.answers, partial, 'answers for items not served are dropped');
  me = h.ok({ action: 'me', token: tok });
  eq(me.baseline.parts.p1, { open: true, status: 'in_progress', minutes: 65, n_items: 32, attempt_id: s.attempt_id, started_at: s.started_at, deadline_at: s.deadline_at, form: s.form });
  // closing the switch stops new starts, not a sitting in progress
  h.setConfig('p1_open', 'FALSE');
  h.err({ action: 'start', token: h.login('T002'), assessment: 'baseline_p1' }, 'not_open');
  eq(h.ok({ action: 'start', token: tok, assessment: 'baseline_p1' }).resumed, true);
  const res = h.ok({ action: 'submit', token: tok, attempt_id: s.attempt_id, answers: mcqAnswers(itemsOf(s), 24) });
  eq(Object.keys(res).sort(), ['assessment', 'ok', 'part', 'server_now', 'submitted_at', 'time_used_s'], 'no score, no item feedback');
  eq([res.assessment, res.part, res.submitted_at, res.time_used_s], ['baseline_p1', 1, '2026-11-16T09:05:00+07:00', 300]);
  const row = h.table('Attempts').find((a) => a.attempt_id === s.attempt_id);
  eq([row.status, row.part, row.n_items, row.n_correct, row.raw_pct, row.scaled_pct, row.score_pct, row.time_used_s, row.wave], ['submitted', '1', '32', '24', '75', '75', '75', '300', '2026-11']);
  eq(JSON.parse(row.section_pct), { A: 100, B: 20 });
  eq(Object.values(JSON.parse(row.by_step)).reduce((a, c) => a + c.n, 0), 32);
  ok(JSON.parse(row.by_move).ASK.n > 0); ok(JSON.parse(row.by_course).A1.n > 0);
  eq(h.ok({ action: 'submit', token: tok, attempt_id: s.attempt_id, answers: {} }), Object.assign({}, res, { server_now: '2026-11-16T09:05:00+07:00' }), 'idempotent');
  eq(h.ok({ action: 'review', token: tok, attempt_id: s.attempt_id }).time_used_s, 300);
  h.setConfig('p1_open', 'TRUE');
  h.err({ action: 'start', token: tok, assessment: 'baseline_p1' }, 'already_submitted');
  h.err({ action: 'save', token: tok, attempt_id: s.attempt_id, answers: {} }, 'already_submitted');
  me = h.ok({ action: 'me', token: tok });
  eq(me.baseline.parts.p1, { open: true, status: 'submitted', minutes: 65, n_items: 32, attempt_id: s.attempt_id, started_at: s.started_at, submitted_at: res.submitted_at, form: s.form });
  eq(me.baseline.profile_ready, false, 'results closed');
  const other = h.login('T002');
  h.err({ action: 'save', token: other, attempt_id: s.attempt_id, answers: {} }, 'not_found');
  h.err({ action: 'submit', token: other, attempt_id: s.attempt_id }, 'not_found');
  h.err({ action: 'baseline_next', token: other, attempt_id: s.attempt_id }, 'not_found');
  h.err({ action: 'baseline_next', token: tok, attempt_id: s.attempt_id }, 'bad_request');
  h.scanAll();
});

section('baseline v2: Part 1 forms balance by role, Overrides give the backup, void lets a person re-sit, re-test swaps', () => {
  const h = blHarness('2026-11-16T09:00:00+07:00');
  const forms = {};
  for (const c of ['T001', 'T002', 'T003', 'T004', 'T005', 'T006', 'T007', 'T008', 'T009']) forms[c] = h.ok({ action: 'start', token: h.login(c), assessment: 'baseline_p1' }).form;
  eq(Object.values(forms).every((f) => f === 'B' || f === 'C'), true, 'never the backup without an override');
  const demand = ['T001', 'T002', 'T003'].map((c) => forms[c]);
  ok(demand.includes('B') && demand.includes('C'), 'balanced inside demand');
  const supply = ['T004', 'T005', 'T006'].map((c) => forms[c]);
  ok(supply.includes('B') && supply.includes('C'), 'balanced inside supply');
  ok(forms.T007 !== forms.T008, 'materials: the second person gets the other form');
  // Assign a Part 1 form… (menu) → backup for a person who saw a live form
  h.ui.prompts.push('t010', 'a', 'saw a live form');
  h.run('menuAssignP1Form');
  ok(/T010 gets Part 1 form A/.test(h.ui.alerts.pop().message));
  eq(h.table('Overrides').map((o) => [o.employee_code, o.wave, o.part, o.form, o.reason]), [['T010', '2026-11', '1', 'A', 'saw a live form']]);
  const t10 = h.login('T010');
  const s10 = h.ok({ action: 'start', token: t10, assessment: 'baseline_p1' });
  eq(s10.form, 'A'); ok(itemsOf(s10).every((x) => x.item_id.startsWith('MOCK-BL-1A-')));
  eq(Object.keys(s10.exhibits).every((x) => x.startsWith('MOCK-EX-A-')), true);
  // a person with an attempt: the menu says to void it first; after the void they sit again with the override
  const first = h.table('Attempts').find((a) => a.employee_code === 'T001');
  h.ui.prompts.push('T001', 'A', 're-sit after a technical problem');
  h.run('menuAssignP1Form');
  ok(/void it first/.test(h.ui.alerts.pop().message));
  const t1 = h.login('T001');
  eq(h.ok({ action: 'start', token: t1, assessment: 'baseline_p1' }).attempt_id, first.attempt_id, 'still resumes the open attempt');
  h.ui.prompts.push(first.attempt_id, 'technical problem');
  h.run('menuVoidAttempt');
  const again = h.ok({ action: 'start', token: t1, assessment: 'baseline_p1' });
  ok(again.attempt_id !== first.attempt_id); eq(again.form, 'A');
  // re-test wave: the other live form; the earlier wave shows as previous
  const t2 = h.login('T002');
  h.ok({ action: 'submit', token: t2, attempt_id: h.ok({ action: 'start', token: t2, assessment: 'baseline_p1' }).attempt_id, answers: {} });
  h.setConfig('wave', '2027-12');
  h.clock.set(T('2027-11-29T09:00:00+07:00'));
  const t2b = h.login('T002');
  const mb = h.ok({ action: 'me', token: t2b }).baseline;
  eq([mb.wave, mb.parts.p1.status, mb.previous], ['2027-12', 'not_started', { wave: '2026-11', parts_done: [1] }]);
  eq(h.ok({ action: 'start', token: t2b, assessment: 'baseline_p1' }).form, forms.T002 === 'B' ? 'C' : 'B', 'the live form not taken last wave');
  h.scanAll();
});

section('baseline v2: Part 2 SJT lock, rating statements withheld until then, frozen answers, self-ratings to Ratings', () => {
  const h = blHarness('2026-11-16T09:00:00+07:00');
  const tok = h.login('T004');
  const s = h.ok({ action: 'start', token: tok, assessment: 'baseline_p2' });
  eq(Object.keys(s).sort(), ['answers', 'assessment', 'attempt_id', 'deadline_at', 'form', 'intro_en', 'intro_vi', 'module', 'ok', 'part', 'rating_scale',
    'resumed', 'sections', 'server_now', 'started_at', 'time_limit_min', 'title_en', 'title_vi']);
  eq([s.form, s.time_limit_min, s.deadline_at], ['ONE', 35, '2026-11-16T09:35:00+07:00']);
  eq(s.sections.map((x) => [x.id, x.items.length, x.locked]), [['SJT', 15, false], ['RATE', 0, false]], 'no statement before the SJT is locked');
  eq(Object.keys(s.sections[0].items[0]).sort(), ['item_id', 'options', 'stem_en', 'stem_vi', 'type']);
  eq(s.rating_scale, { points: [1, 2, 3, 4].map((v, i) => ({ v, en: v + ' · ' + ['Rarely', 'Sometimes', 'Often', 'Almost always'][i], vi: 'VI ' + v + ' · ' + ['Rarely', 'Sometimes', 'Often', 'Almost always'][i] })), nr: { en: 'Not my role', vi: 'VI Not my role' } });
  ok(!/mock behaviour|MOCK-BL-2R/.test(JSON.stringify(s)), 'no rating text or id before the lock');
  const sjt = s.sections[0].items;
  h.err({ action: 'submit', token: tok, attempt_id: s.attempt_id, answers: {} }, 'bad_request');
  eq(h.call({ action: 'submit', token: tok, attempt_id: s.attempt_id, answers: {} }).error.field, 'SJT');
  // rating answers before the lock are dropped; an incomplete or most = least SJT cannot lock (but is saved)
  const keyed = sjtAnswers(sjt);
  const part = Object.assign({}, keyed); delete part[sjt[14].item_id];
  part['MOCK-BL-2R01'] = 4;
  eq(h.err({ action: 'baseline_next', token: tok, attempt_id: s.attempt_id, answers: part }, 'bad_request').field, sjt[14].item_id);
  const same = Object.assign({}, keyed, { [sjt[3].item_id]: { most: 'c', least: 'c' } });
  eq(h.err({ action: 'baseline_next', token: tok, attempt_id: s.attempt_id, answers: same }, 'bad_request').field, sjt[3].item_id, 'most = least rejected');
  const r1 = h.ok({ action: 'start', token: tok, assessment: 'baseline_p2' });
  eq(r1.answers[sjt[3].item_id], { most: 'c', least: 'c' }, 'saved anyway'); eq(r1.answers['MOCK-BL-2R01'], undefined); eq(r1.sections[1].items, []);
  // lock: 2 of 30 points lost on purpose (one wrong least pick in the first item)
  const lockAns = sjtAnswers(sjt, 1);
  const nx = h.ok({ action: 'baseline_next', token: tok, attempt_id: s.attempt_id, answers: lockAns });
  eq(Object.keys(nx).sort(), ['locked', 'ok', 'section', 'server_now']); eq(nx.locked, ['SJT']);
  eq([nx.section.id, nx.section.locked, nx.section.items.length, nx.section.title_en], ['RATE', false, 23, '2B · Mock self-rating']);
  const ri = nx.section.items;
  eq(Object.keys(ri[0]).sort(), ['allow_nr', 'anchor1_en', 'anchor1_vi', 'anchor4_en', 'anchor4_vi', 'item_id', 'text_en', 'text_vi', 'type']);
  eq(ri.filter((x) => x.allow_nr).map((x) => x.item_id), fx.NR_POSITIONS.map((n) => 'MOCK-BL-2R' + String(n).padStart(2, '0')));
  eq(ri[0].text_en, 'I do mock behaviour 1.', 'self wording');
  eq(h.ok({ action: 'baseline_next', token: tok, attempt_id: s.attempt_id, answers: keyed }).section.items.length, 23, 'idempotent once locked');
  // after the lock: SJT answers are frozen (save and submit cannot change them)
  const changed = Object.assign(rateAll(ri, 2), sjtAnswers(sjt));
  h.ok({ action: 'save', token: tok, attempt_id: s.attempt_id, answers: changed });
  const r2 = h.ok({ action: 'start', token: tok, assessment: 'baseline_p2' });
  eq(r2.sections.map((x) => [x.id, x.items.length, x.locked]), [['SJT', 15, true], ['RATE', 23, false]]);
  eq(r2.answers[sjt[0].item_id], lockAns[sjt[0].item_id], 'frozen at the lock');
  eq(r2.answers['MOCK-BL-2R05'], 2, 'ratings saved after the lock');
  // every statement must be answered; NR only where allowed
  const rates = rateAll(ri, (x) => (x.allow_nr ? 'NR' : x.item_id.endsWith('01') ? 4 : 2));
  const missing = Object.assign({}, rates); delete missing['MOCK-BL-2R07'];
  eq(h.err({ action: 'submit', token: tok, attempt_id: s.attempt_id, answers: missing }, 'bad_request').field, 'MOCK-BL-2R07');
  eq(h.err({ action: 'submit', token: tok, attempt_id: s.attempt_id, answers: Object.assign({}, rates, { 'MOCK-BL-2R04': 'NR' }) }, 'bad_request').field, 'MOCK-BL-2R04');
  const res = h.ok({ action: 'submit', token: tok, attempt_id: s.attempt_id, answers: Object.assign({}, rates, sjtAnswers(sjt)) });
  eq(Object.keys(res).sort(), ['assessment', 'ok', 'part', 'server_now', 'submitted_at', 'time_used_s']);
  const row = h.table('Attempts').find((a) => a.attempt_id === s.attempt_id);
  eq([row.n_items, row.n_correct, row.raw_pct, row.score_pct], ['30', '29', '97', '97'], 'graded on the frozen SJT answers');
  const bc = JSON.parse(row.by_charter);
  eq(Object.keys(bc), ['1', '2', '3', '4', '5', 'QWS']);
  eq(bc['1'], { sjt_points: 5, sjt_max: 6, self_mean: 2.7 }, 'NR left out of the mean: (4 + 2 + 2) / 3'); eq(bc.QWS, { sjt_points: 0, sjt_max: 0, self_mean: 2 });
  const ratings = h.table('Ratings').filter((x) => x.ratee_code === 'T004');
  eq(ratings.length, 23); eq(ratings.every((x) => x.rater_code === 'T004' && x.rater_role === 'self' && x.wave === '2026-11'), true);
  eq(ratings.filter((x) => x.value === 'NR').length, 3);
  // a voided Part 2 clears its self-ratings, and the person can sit again
  h.run('voidAttempt_', s.attempt_id, 'pilot');
  eq(h.table('Ratings').filter((x) => x.ratee_code === 'T004' && x.value !== '').length, 0);
  sitPart(h, tok, 2, { self: 4 });
  eq(h.table('Ratings').filter((x) => x.ratee_code === 'T004').map((x) => x.value), Array(23).fill('4'), 'upserted, not duplicated');
  h.scanAll();
});

section('baseline v2: Part 3 module routing, self-rating opener, glossary, exhibits, level and gate stored', () => {
  const h = blHarness('2026-11-16T09:00:00+07:00');
  h.updateWhere('Roster', 'employee_code', 'T005', { p3_module: 'rpm' });
  h.run('resetRequest_');
  const tok = h.login('T001');
  const s = h.ok({ action: 'start', token: tok, assessment: 'baseline_p3' });
  eq(Object.keys(s).sort(), ['answers', 'assessment', 'attempt_id', 'deadline_at', 'exhibits', 'form', 'glossary', 'intro_en', 'intro_vi', 'module', 'ok', 'part',
    'resumed', 'scale', 'sections', 'self', 'self_ratings', 'server_now', 'started_at', 'time_limit_min', 'title_en', 'title_vi']);
  eq([s.module, s.time_limit_min, s.intro_en], ['DP', 48, 'Mock intro for Part 3.']);
  eq(s.sections.map((x) => [x.id, x.items.length, x.title_en]), [['CORE', 10, 'Mock S&OP core'], ['MOD', 18, 'Mock module DP']]);
  eq(s.sections[1].items.every((x) => x.item_id.startsWith('MOCK-BL-3DP') && x.section === 'MOD'), true);
  eq(Object.keys(s.exhibits).sort(), ['MOCK-EX-3-CORE-1', 'MOCK-EX-3-DP-1']);
  eq(s.glossary, { en: ['FA: mock forecast accuracy', 'Bias: mock bias', 'FVA: mock value added'], vi: ['VI FA: mock forecast accuracy', 'VI Bias: mock bias', 'VI FVA: mock value added'] });
  eq(s.self.map((x) => x.course), fx.COURSES); eq(s.scale.length, 5); eq(s.self_ratings, {});
  eq(h.ok({ action: 'start', token: h.login('T005'), assessment: 'baseline_p3' }).module, 'RPM', 'Roster.p3_module wins over role_area');
  eq(h.ok({ action: 'start', token: h.login('T007'), assessment: 'baseline_p3' }).module, 'RPM', 'materials → RPM');
  eq(h.err({ action: 'start', token: h.login('T050'), assessment: 'baseline_p3' }, 'not_found').message, 'No Part 3 module is set for you yet. Please ask HR.');
  // self-ratings saved, required at submit
  h.ok({ action: 'save', token: tok, attempt_id: s.attempt_id, answers: {}, self_ratings: { A2: 2, A3: 9 } });
  eq(h.ok({ action: 'start', token: tok, assessment: 'baseline_p3' }).self_ratings, { A2: 2 });
  const nine = Object.assign({}, SELF10); delete nine.P6;
  const all = mcqAnswers(itemsOf(s), 28);
  eq(h.err({ action: 'submit', token: tok, attempt_id: s.attempt_id, answers: all, self_ratings: nine }, 'bad_request').field, 'self_ratings');
  h.ok({ action: 'submit', token: tok, attempt_id: s.attempt_id, answers: all, self_ratings: SELF10 });
  const row = h.table('Attempts').find((a) => a.attempt_id === s.attempt_id);
  eq([row.module, row.n_items, row.n_correct, row.raw_pct], ['DP', '28', '28', '100']);
  eq(JSON.parse(row.section_pct), { CORE: 100, MOD: 100 });
  eq(Object.keys(JSON.parse(row.by_level)), ['BA', 'WK', 'FO', 'LE']); ok(Object.keys(JSON.parse(row.by_gate)).length > 1);
  eq(JSON.parse(row.self_ratings), SELF10);
  eq(h.table('SelfRatings').filter((x) => x.employee_code === 'T001').length, 10);
  h.scanAll();
});

section('baseline v2: one timer per part + grace, auto-submit from the last save (me, start, submit, baseline_next)', () => {
  const h = blHarness('2026-11-16T09:00:00+07:00');
  const tok = h.login('T001');
  const s = h.ok({ action: 'start', token: tok, assessment: 'baseline_p1' });
  h.clock.advance(64 * MIN);
  h.ok({ action: 'save', token: tok, attempt_id: s.attempt_id, answers: mcqAnswers(itemsOf(s).slice(0, 10), 10) });
  h.clock.advance(5 * MIN); // 69 min: inside the 5-min grace
  h.ok({ action: 'save', token: tok, attempt_id: s.attempt_id, answers: mcqAnswers(itemsOf(s).slice(0, 12), 12) });
  h.clock.advance(2 * MIN); // 71 min
  h.err({ action: 'save', token: tok, attempt_id: s.attempt_id, answers: mcqAnswers(itemsOf(s), 32) }, 'already_submitted');
  const me = h.ok({ action: 'me', token: tok });
  eq(me.baseline.parts.p1.status, 'submitted');
  const row = h.table('Attempts').find((a) => a.attempt_id === s.attempt_id);
  eq([row.status, row.submitted_at, row.n_correct, row.time_used_s], ['expired', '2026-11-16T10:10:00+07:00', '12', '3900'], 'graded from the last save at deadline + grace');
  // through submit: late answers ignored
  const t2 = h.login('T002');
  const s2 = h.ok({ action: 'start', token: t2, assessment: 'baseline_p3' });
  h.ok({ action: 'save', token: t2, attempt_id: s2.attempt_id, answers: mcqAnswers(itemsOf(s2).slice(0, 5), 5) });
  h.clock.advance(54 * MIN);
  const late = h.ok({ action: 'submit', token: t2, attempt_id: s2.attempt_id, answers: mcqAnswers(itemsOf(s2), 28), self_ratings: SELF10 });
  eq(late.time_used_s, 48 * 60);
  eq(h.table('Attempts').find((a) => a.attempt_id === s2.attempt_id).n_correct, '5', 'no self-rating check on an expiry');
  // Part 2 expiring before the lock: SJT graded from the save, no ratings
  const t3 = h.login('T003');
  const s3 = h.ok({ action: 'start', token: t3, assessment: 'baseline_p2' });
  h.ok({ action: 'save', token: t3, attempt_id: s3.attempt_id, answers: sjtAnswers(s3.sections[0].items.slice(0, 4)) });
  h.clock.advance(41 * MIN);
  h.err({ action: 'baseline_next', token: t3, attempt_id: s3.attempt_id, answers: sjtAnswers(s3.sections[0].items) }, 'already_submitted');
  const r3 = h.table('Attempts').find((a) => a.attempt_id === s3.attempt_id);
  eq([r3.status, r3.n_correct], ['expired', '8']);
  eq(h.table('Ratings').filter((x) => x.ratee_code === 'T003').length, 0);
  // through start: the expired attempt is graded first, then already_submitted
  const t4 = h.login('T004');
  const s4 = h.ok({ action: 'start', token: t4, assessment: 'baseline_p2' });
  h.clock.advance(41 * MIN);
  h.err({ action: 'start', token: t4, assessment: 'baseline_p2' }, 'already_submitted');
  eq(h.table('Attempts').find((a) => a.attempt_id === s4.attempt_id).status, 'expired');
  // a timer change in Config does not move a sitting that already started
  const t5 = h.login('T005');
  const s5 = h.ok({ action: 'start', token: t5, assessment: 'baseline_p1' });
  h.setConfig('p1_minutes', '10');
  eq(h.ok({ action: 'start', token: t5, assessment: 'baseline_p1' }).deadline_at, s5.deadline_at);
  h.scanAll();
});

section('baseline v2: manager rating (rate_list / rate_get / rate_save), rating_open switch, forbidden for non-reports', () => {
  const h = blHarness('2026-11-16T09:00:00+07:00');
  h.updateWhere('Roster', 'employee_code', 'T010', { manager_code: 'T050' });
  h.run('resetRequest_');
  const learner = h.login('T001');
  h.err({ action: 'rate_list', token: learner }, 'forbidden');
  h.err({ action: 'rate_get', token: learner, ratee: 'T002' }, 'forbidden');
  h.err({ action: 'rate_save', token: learner, ratee: 'T002', values: {} }, 'forbidden');
  const mgr = h.login('T010');
  let rl = h.ok({ action: 'rate_list', token: mgr });
  eq(Object.keys(rl).sort(), ['ok', 'open', 'reports', 'server_now', 'wave']);
  eq([rl.open, rl.wave], [false, '2026-11']);
  eq(rl.reports.map((r) => r.code), ['T001', 'T002', 'T003', 'T004'], 'test user T040 and inactive T060 are not listed');
  eq(rl.reports[0], { code: 'T001', first_name: 'Alpha', role_area: 'demand', status: 'not_started', saved_at: null });
  h.err({ action: 'rate_get', token: mgr, ratee: 'T001' }, 'not_open');
  h.err({ action: 'rate_save', token: mgr, ratee: 'T001', values: { 'MOCK-BL-2R01': 3 } }, 'not_open');
  eq(h.ok({ action: 'me', token: mgr }).baseline.rating, { open: false, to_rate: 4, done: 0 });
  h.setConfig('rating_open', 'TRUE');
  const g = h.ok({ action: 'rate_get', token: mgr, ratee: 't001' });
  eq(Object.keys(g).sort(), ['guide_en', 'guide_vi', 'items', 'ok', 'open', 'ratee', 'saved_at', 'scale', 'server_now', 'values']);
  eq([g.open, g.ratee, g.values, g.saved_at], [true, { code: 'T001', first_name: 'Alpha' }, {}, null]);
  eq(g.items.length, 23); eq(Object.keys(g.items[0]).sort(), ['anchor1_en', 'anchor1_vi', 'anchor4_en', 'anchor4_vi', 'item_id', 'text_en', 'text_vi']);
  eq(g.items[0].text_en, 'He/she does mock behaviour 1.', 'manager wording');
  eq(g.scale.points.length, 4); eq(g.scale.na, { en: 'N/A · not observed', vi: 'VI N/A · not observed' });
  ok(g.guide_en.includes('**seen**'), 'rater guide (Markdown text)');
  h.err({ action: 'rate_get', token: mgr, ratee: 'T005' }, 'forbidden');
  h.err({ action: 'rate_get', token: mgr, ratee: 'T040' }, 'forbidden');
  h.err({ action: 'rate_save', token: mgr, ratee: 'T005', values: { 'MOCK-BL-2R01': 3 } }, 'forbidden');
  h.err({ action: 'rate_save', token: mgr, ratee: 'T060', values: { 'MOCK-BL-2R01': 3 } }, 'forbidden');
  eq(h.err({ action: 'rate_save', token: mgr, ratee: 'T001', values: { 'MOCK-BL-2R01': 5 } }, 'bad_request').field, 'MOCK-BL-2R01');
  eq(h.err({ action: 'rate_save', token: mgr, ratee: 'T001', values: { 'MOCK-BL-2R03': 'NR' } }, 'bad_request').field, 'MOCK-BL-2R03', 'NR is for the self form only');
  const half = h.ok({ action: 'rate_save', token: mgr, ratee: 'T001', values: { 'MOCK-BL-2R01': 3, 'MOCK-BL-2R02': 'na' } });
  eq(Object.keys(half).sort(), ['complete', 'ok', 'saved_at', 'server_now']); eq(half.complete, false);
  eq(h.ok({ action: 'rate_list', token: mgr }).reports[0].status, 'in_progress');
  const full = rateAll(g.items, (x) => (x.item_id === 'MOCK-BL-2R02' ? 'NA' : 2));
  eq(h.ok({ action: 'rate_save', token: mgr, ratee: 'T001', values: full }).complete, true);
  h.clock.advance(MIN);
  h.ok({ action: 'rate_save', token: mgr, ratee: 'T001', values: { 'MOCK-BL-2R01': 4 } });
  const rows = h.table('Ratings').filter((x) => x.ratee_code === 'T001' && x.rater_role === 'manager');
  eq(rows.length, 23, 'one row per statement (edits update in place)');
  eq(rows.find((x) => x.item_id === 'MOCK-BL-2R01').value, '4'); eq(rows.find((x) => x.item_id === 'MOCK-BL-2R02').value, 'NA');
  rl = h.ok({ action: 'rate_list', token: mgr });
  eq([rl.reports[0].status, rl.reports[0].saved_at], ['complete', '2026-11-16T09:01:00+07:00']);
  eq(h.ok({ action: 'rate_get', token: mgr, ratee: 'T001' }).values['MOCK-BL-2R02'], 'NA');
  eq(h.ok({ action: 'me', token: mgr }).baseline.rating, { open: true, to_rate: 4, done: 1 });
  eq(h.ok({ action: 'me', token: learner }).baseline.rating, null);
  // admins rate their own reports (Quân rates the managers); a manager can be a ratee
  const admin = h.login('T050');
  eq(h.ok({ action: 'rate_list', token: admin }).reports.map((r) => r.code), ['T010']);
  h.ok({ action: 'rate_save', token: admin, ratee: 'T010', values: { 'MOCK-BL-2R01': 3 } });
  h.err({ action: 'rate_save', token: admin, ratee: 'T001', values: { 'MOCK-BL-2R01': 3 } }, 'forbidden');
  h.setConfig('rating_open', 'FALSE');
  h.err({ action: 'rate_save', token: mgr, ratee: 'T001', values: full }, 'not_open');
  eq(h.ok({ action: 'rate_list', token: mgr }).open, false);
  ok(h.table('Log').some((r) => r.action === 'rate_save' && r.employee_code === 'T010'));
  ok(!h.table('Log').some((r) => /MOCK-BL/.test(r.message)), 'no item ids or values in the Log');
  h.scanAll();
});

section('baseline v2: profile hidden until results_open; buildProfiles, equating, flags, team_summary, team_status, hourly job', () => {
  const roster = fx.testRoster().map((p) => (p.employee_code === 'T030' ? Object.assign({}, p, { must_change_pin: 'FALSE', consent_at: '2026-11-01T09:00:00+07:00' }) : p));
  const h = blHarness('2026-11-16T09:00:00+07:00', { roster, config: { rating_open: 'TRUE' } });
  // Part 1: two on the backup (overrides), the live forms far apart → equating applies (reference Form A)
  for (const c of ['T008', 'T009']) h.run('assignP1Form_', c, 'A', 'fixture', 'test');
  const p1 = {};
  const scoreFor = { A: [16, 24], B: [16, 20, 24], C: [24, 28, 32] };
  const used = { A: 0, B: 0, C: 0 };
  for (const c of ['T001', 'T002', 'T003', 'T004', 'T005', 'T006', 'T007', 'T008', 'T009']) {
    const t = h.login(c);
    const s = h.ok({ action: 'start', token: t, assessment: 'baseline_p1' });
    const list = scoreFor[s.form];
    const right = list[Math.min(used[s.form]++, list.length - 1)];
    h.ok({ action: 'submit', token: t, attempt_id: s.attempt_id, answers: mcqAnswers(itemsOf(s), right) });
    p1[c] = { form: s.form, raw: Math.round(100 * right / 32) };
  }
  // Parts 2 and 3 for T001 (all three parts) and some others; manager ratings for T001
  const t1 = h.login('T001');
  sitPart(h, t1, 2, { self: 4 });
  sitPart(h, t1, 3, { right: 14, selfRatings: Object.assign({}, SELF10, { P4: 4, A2: 3 }) });
  for (const c of ['T002', 'T003', 'T005']) { const t = h.login(c); sitPart(h, t, 2, { self: 3 }); sitPart(h, t, 3, { right: 20 }); }
  const mgr = h.login('T010');
  const items = h.ok({ action: 'rate_get', token: mgr, ratee: 'T001' }).items;
  h.ok({ action: 'rate_save', token: mgr, ratee: 'T001', values: rateAll(items, (x) => (x.item_id === 'MOCK-BL-2R05' ? 1 : x.item_id === 'MOCK-BL-2R06' ? 1 : 2)) });
  for (const c of ['T002', 'T003']) h.ok({ action: 'rate_save', token: mgr, ratee: c, values: rateAll(items, 3) });

  // before results_open: no profile, no team numbers
  h.err({ action: 'profile', token: t1 }, 'not_open');
  eq(h.ok({ action: 'me', token: t1 }).baseline.profile_ready, false);
  h.run('buildSummary');
  let ts = h.ok({ action: 'team_summary', token: t1 });
  eq([ts.baseline_published, ts.baseline_publish_after, ts.baseline], [false, null, []]);
  eq(h.table('Profiles').length, 0, 'the hourly job builds profiles only while results_open');
  const st = h.ok({ action: 'team_status', token: mgr });
  eq(st.reports.find((r) => r.code === 'T001').baseline, { p1: 'done', p2: 'done', p3: 'done' });
  eq(st.reports.find((r) => r.code === 'T004').baseline, { p1: 'done', p2: 'not_done', p3: 'not_done' });
  const t4 = h.login('T004');
  h.ok({ action: 'start', token: t4, assessment: 'baseline_p3' });
  eq(h.ok({ action: 'team_status', token: mgr }).reports.find((r) => r.code === 'T004').baseline.p3, 'in_progress');
  ok(!/pct|score|n_correct/.test(JSON.stringify(h.ok({ action: 'team_status', token: mgr }))), 'no scores in team_status');

  // results open: live profile first (not built yet), then the built row
  h.setConfig('results_open', 'TRUE');
  eq(h.ok({ action: 'me', token: t1 }).baseline.profile_ready, true);
  eq(h.ok({ action: 'me', token: h.login('T030') }).baseline.profile_ready, false, 'nothing submitted');
  h.err({ action: 'profile', token: h.login('T030') }, 'not_found');
  const live = h.ok({ action: 'profile', token: t1 });
  eq(Object.keys(live).sort(), ['built_at', 'courses', 'gaps', 'ok', 'p1', 'p2', 'p3', 'server_now', 'wave']);
  const n = h.run('buildProfiles');
  eq(n, 9, 'one profile per person with a submitted part (T001–T009)');
  const prow = h.table('Profiles').find((r) => r.employee_code === 'T001');
  eq([prow.wave, prow.built_at], ['2026-11', '2026-11-16T09:00:00+07:00']);
  const p = h.ok({ action: 'profile', token: t1 });
  eq(p.built_at, '2026-11-16T09:00:00+07:00');
  eq(Object.keys(p.p1).sort(), ['by_move', 'by_step', 'form', 'raw_pct', 'scaled_pct', 'section_A_pct', 'section_B_pct']);
  eq([p.p1.form, p.p1.raw_pct], [p1.T001.form, p1.T001.raw]);
  eq(Object.keys(p.p2).sort(), ['by_charter', 'mgr_mean', 'self_mean', 'sjt_pct', 'top_dev']);
  eq([p.p2.sjt_pct, p.p2.self_mean], [100, 4]);
  eq(Object.keys(p.p2.by_charter), ['1', '2', '3', '4', '5', 'QWS']);
  eq(Object.keys(p.p2.by_charter['1']).sort(), ['flags', 'index', 'mgr_mean', 'name_en', 'name_vi', 'self_mean', 'sjt_band']);
  eq(p.p2.by_charter['1'], { name_en: 'Mock charter 1', name_vi: 'VI Mock charter 1', sjt_band: 'high', self_mean: 4, mgr_mean: 2, index: Math.round(0.5 * 100 + 0.5 * 100 / 3), flags: ['blind_spot', 'knowing_doing'] });
  eq(p.p2.top_dev.map((x) => x.item_id), ['MOCK-BL-2R05', 'MOCK-BL-2R06']);
  eq(Object.keys(p.p2.top_dev[0]).sort(), ['item_id', 'text_en', 'text_vi']);
  eq([p.p3.module, p.p3.total_pct, p.p3.core_pct], ['DP', 50, 100]);
  eq(Object.keys(p.p3).sort(), ['by_gate', 'by_level', 'core_pct', 'level', 'module', 'module_pct', 'total_pct']);
  eq(p.courses.P4, { self: 4, score_pct: p.p3.module_pct, flag: p.p3.module_pct < 50 });
  eq(p.courses.A3, { self: SELF10.A3, score_pct: null, flag: false });
  eq(p.gaps.length, 2); eq(Object.keys(p.gaps[0]).sort(), ['area', 'name_en', 'name_vi', 'pct']);
  ok(!JSON.stringify(p).includes('"values"'), 'no item-level manager ratings in the profile');
  // equating: B and C means differ by > 5 points → mean-sigma onto Form A (two backup takers)
  const att = h.table('Attempts').filter((a) => a.assessment === 'baseline_p1');
  const byForm = (f) => att.filter((a) => a.form === f);
  ok(byForm('A').length === 2 && byForm('B').length >= 2 && byForm('C').length >= 2, 'all three forms sat');
  const L = require('../Logic.gs');
  const stats = Object.fromEntries(['A', 'B', 'C'].map((f) => [f, L.meanSd(byForm(f).map((a) => +a.raw_pct))]));
  for (const a of byForm('C')) eq(+a.scaled_pct, L.equateLinear(+a.raw_pct, stats.C, stats.A), 'C onto A for ' + a.employee_code);
  for (const a of byForm('A')) eq(a.scaled_pct, a.raw_pct, 'Form A is the reference');
  // team numbers: published while results_open, from the Summary tab only
  ts = h.ok({ action: 'team_summary', token: t1 });
  eq([ts.baseline_published, ts.baseline], [true, []], 'never computed on a request');
  h.run('buildSummary');
  ts = h.ok({ action: 'team_summary', token: t1 });
  eq(ts.baseline.map((g) => g.group), ['all', 'demand', 'supply']);
  eq(Object.keys(ts.baseline[0]).sort(), ['group', 'n', 'p1_pct', 'p2_mgr_mean', 'p2_sjt_pct', 'p3_core_pct']);
  eq(ts.baseline[0].n, 9, 'managers and test users left out');
  ok(Number.isInteger(ts.baseline[0].p1_pct)); eq(ts.baseline[0].p2_mgr_mean, round1((2 * 21 + 1 * 2 + 3 * 23 * 2) / (23 * 3)));
  eq(ts.baseline[0].p3_core_pct, 100); ok(Number.isInteger(ts.baseline[0].p2_sjt_pct));
  eq([ts.baseline[1].p2_sjt_pct, ts.baseline[2].p2_sjt_pct], [null, null], 'supply has 1 Part 2 (< 3), so demand is hidden too (complement rule)');
  eq(ts.baseline[1].p2_mgr_mean, ts.baseline[0].p2_mgr_mean, 'demand = the 3 rated people');
  ok(!/T00|Alpha/.test(JSON.stringify(ts)));
  // the hourly job (buildSummary) also rebuilds profiles while results_open
  h.clock.advance(H);
  h.run('buildSummary');
  eq(h.table('Profiles').find((r) => r.employee_code === 'T001').built_at, '2026-11-16T10:00:00+07:00');
  h.setConfig('results_open', 'FALSE');
  h.err({ action: 'profile', token: t1 }, 'not_open');
  eq(h.ok({ action: 'team_summary', token: t1 }).baseline, []);
  h.scanAll();
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
  eq(rv2.reveal, false, 'no reveal by time: a late learner never sees the key before passing');
  eq(rv2.missed.every((m) => m.correct === null && m.why_en === ''), true);
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
section('team_summary: checkpoint numbers published only after the late window, per-metric counts, never live; team_status', () => {
  const roster = fx.testRoster().concat([Object.assign(fx.testRoster().find((p) => p.employee_code === 'T010'),
    { employee_code: 'T011', display_name: 'Fixture Manager Quebec', manager_code: 'T010' })]);
  const h = harness('2027-01-05T09:00:00+07:00', { roster });
  const tok = h.login('T001');
  let ts = h.ok({ action: 'team_summary', token: tok });
  eq(Object.keys(ts).sort(), ['baseline', 'baseline_publish_after', 'baseline_published', 'checkpoints', 'min_n', 'ok', 'server_now', 'updated_at', 'wave']);
  eq([ts.min_n, ts.wave, ts.baseline_published, ts.baseline_publish_after], [3, '2026-11', false, null]);
  eq([ts.baseline, ts.checkpoints, ts.updated_at], [[], [], null], 'nothing published yet');

  // team_status: direct reports only, no managers, no test users, no scores
  h.err({ action: 'team_status', token: h.login('T001') }, 'forbidden');
  const st = h.ok({ action: 'team_status', token: h.login('T010') });
  eq(st.reports.map((r) => r.code), ['T001', 'T002', 'T003', 'T004'], 'manager T011 and test user T040 hidden');
  eq(Object.keys(st.reports[0]).sort(), ['baseline', 'code', 'courses', 'first_name']);
  eq(st.reports[0].first_name, 'Alpha'); eq(st.reports[0].baseline, { p1: 'not_done', p2: 'not_done', p3: 'not_done' });
  eq(st.reports[0].courses.A2, 'not_started'); eq(Object.keys(st.reports[0].courses), fx.COURSES);
  ok(!/pct|score|n_correct/.test(JSON.stringify(st)), 'no scores in team_status');

  // checkpoints: published after late_until (A2: 2027-02-02 23:59:59), counts per metric
  for (const [c, n] of [['T001', 9], ['T002', 3], ['T003', 2], ['T004', 10]]) {
    const t = h.login(c);
    const a = h.ok({ action: 'start', token: t, assessment: 'checkpoint', course: 'A2' });
    h.ok({ action: 'submit', token: t, attempt_id: a.attempt_id, answers: answersFor(a.items, n) });
  }
  const st2 = h.ok({ action: 'team_status', token: h.login('T010') });
  eq([st2.reports[0].courses.A2, st2.reports[1].courses.A2], ['passed', 'not_yet']);
  h.run('buildSummary');
  eq(h.ok({ action: 'team_summary', token: h.login('T001') }).checkpoints, [], 'not before the late window closes');
  h.clock.set(T('2027-02-03T00:00:01+07:00'));
  h.run('buildSummary');
  ts = h.ok({ action: 'team_summary', token: h.login('T001') });
  eq(ts.checkpoints.map((g) => [g.group, g.n]), [['all', 10], ['demand', 3], ['supply', 3]]);
  eq(Object.keys(ts.checkpoints[0].courses.A2).sort(), ['first_try_pass', 'n_by_forum', 'n_first_try', 'passed_by_forum']);
  eq(ts.checkpoints[0].courses.A2, { first_try_pass: 50, passed_by_forum: 20, n_first_try: 4, n_by_forum: 10 });
  eq(ts.checkpoints[1].courses.A2, { first_try_pass: null, passed_by_forum: 33, n_first_try: 3, n_by_forum: 3 }, 'demand hidden: all − demand would expose the one supply attempter');
  eq(ts.checkpoints[2].courses.A2, { first_try_pass: null, passed_by_forum: 33, n_first_try: 1, n_by_forum: 3 });
  eq(ts.checkpoints[0].courses.A3, { first_try_pass: null, passed_by_forum: 0, n_first_try: 0, n_by_forum: 10 }, 'A3 (same forum) published: nobody attempted');
  eq(ts.checkpoints[0].courses.A1, { first_try_pass: null, passed_by_forum: null, n_first_try: 0, n_by_forum: 0 }, 'A1 not published yet');
  // a late attempt (with an unlock) after publication does not move the published numbers
  h.run('unlockRetake_', 'T005', 'A2', 'T010', 'late');
  const t5 = h.login('T005');
  const l5 = h.ok({ action: 'start', token: t5, assessment: 'checkpoint', course: 'A2' });
  h.ok({ action: 'submit', token: t5, attempt_id: l5.attempt_id, answers: answersFor(l5.items, 10) });
  h.run('buildSummary');
  eq(h.ok({ action: 'team_summary', token: t5 }).checkpoints[0].courses.A2, ts.checkpoints[0].courses.A2, 'frozen after publication');
});

function round1(x) { return Math.round(x * 10) / 10; }

section('manager unlock_retake, team_status needs_chat, streak skip weeks', () => {
  const roster = fx.testRoster().concat([Object.assign(fx.testRoster().find((p) => p.employee_code === 'T010'),
    { employee_code: 'T011', display_name: 'Fixture Manager Quebec', manager_code: 'T010' })]);
  const h = harness('2027-01-05T09:00:00+07:00', { roster });
  let t1 = h.login('T001');
  for (const n of [5, 6]) {
    const a = h.ok({ action: 'start', token: t1, assessment: 'checkpoint', course: 'A2' });
    h.ok({ action: 'submit', token: t1, attempt_id: a.attempt_id, answers: answersFor(a.items, n) });
    h.clock.advance(24 * H);
    t1 = h.login('T001');
  }
  const mgr = h.login('T010');
  let st = h.ok({ action: 'team_status', token: mgr });
  eq(st.reports.map((r) => [r.code, r.courses.A2]), [['T001', 'needs_chat'], ['T002', 'not_started'], ['T003', 'not_started'], ['T004', 'not_started']]);
  const unlock = (tok, code, course, note) => h.call({ action: 'unlock_retake', token: tok, code, course, note });
  eq(unlock(h.login('T002'), 'T001', 'A2', 'x').error.code, 'forbidden', 'learners cannot unlock');
  eq(unlock(mgr, 'T005', 'A2', 'x').error.code, 'forbidden', 'not a direct report');
  eq(unlock(mgr, 'T011', 'A2', 'x').error.code, 'forbidden', 'a report who is a manager');
  eq(unlock(mgr, 'T999', 'A2', 'x').error.code, 'forbidden', 'unknown code');
  const nb = unlock(mgr, 'T002', 'A2', 'x');
  eq([nb.error.code, nb.error.field], ['bad_request', 'course'], 'no chat needed yet');
  eq(unlock(mgr, 'T001', 'ZZ', 'x').error.field, 'course');
  const acq = h.lock.acquisitions;
  const note = '=HYPERLINK("x") chat about objective 3 ' + 'z'.repeat(400);
  const u = h.ok({ action: 'unlock_retake', token: mgr, code: 't001', course: 'a2', note });
  eq(Object.keys(u).sort(), ['ok', 'server_now', 'unlocked_at']); eq(u.unlocked_at, '2027-01-07T09:00:00+07:00');
  ok(h.lock.acquisitions > acq, 'under the script lock');
  const row = h.table('Unlocks')[0];
  eq([row.employee_code, row.course, row.unlocked_by, row.unlocked_at], ['T001', 'A2', 'T010', '2027-01-07T09:00:00+07:00']);
  ok(row.reason.startsWith(' =HYPERLINK') && row.reason.length <= 300, 'note formula-guarded and capped at 300 characters');
  ok(h.table('Log').some((r) => r.action === 'unlock_retake' && r.employee_code === 'T002' && r.message === 'forbidden'), 'refusals are logged (signed-in)');
  const logRow = h.table('Log').find((r) => r.action === 'unlock_retake' && r.ok === 'TRUE');
  eq([logRow.employee_code, logRow.ok, logRow.message], ['T010', 'TRUE', 'unlock T001 A2']);
  ok(!JSON.stringify(h.table('Log')).includes('HYPERLINK'), 'the note never reaches the Log');
  eq(h.ok({ action: 'team_status', token: mgr }).reports[0].courses.A2, 'not_yet');
  eq(unlock(mgr, 'T001', 'A2', 'again').error.field, 'course', 'one unlock per chat');
  eq(h.ok({ action: 'start', token: t1, assessment: 'checkpoint', course: 'A2' }).attempt_no, 3);
  eq(h.ok({ action: 'team_status', token: mgr }).reports[0].courses.A2, 'not_yet', 'in progress is not a chat');
  // after the late window: everyone not passed needs a chat
  h.clock.set(T('2027-02-03T09:00:00+07:00'));
  const m2 = h.login('T010');
  st = h.ok({ action: 'team_status', token: m2 });
  eq(st.reports.map((r) => r.courses.A2), ['not_yet', 'needs_chat', 'needs_chat', 'needs_chat']);
  eq(st.reports[0].courses.A1, 'not_started', 'a course not yet run');
  h.ok({ action: 'unlock_retake', token: m2, code: 'T002', course: 'A2', note: '' });
  eq(h.ok({ action: 'start', token: h.login('T002'), assessment: 'checkpoint', course: 'A2' }).attempt_no, 1);

  // streak: the Tết week (Config streak_skip_weeks, default 2027-02-08) neither breaks nor adds
  h.clock.set(T('2027-02-01T10:00:00+07:00'));
  h.ok({ action: 'watch', token: h.login('T004'), course: 'A2', ep: 1, watched: true });
  h.clock.set(T('2027-02-15T10:00:00+07:00'));
  h.ok({ action: 'watch', token: h.login('T004'), course: 'A2', ep: 2, watched: true });
  h.clock.set(T('2027-02-16T10:00:00+07:00'));
  let sk = h.ok({ action: 'me', token: h.login('T004') }).streak;
  eq([sk.current_weeks, sk.active_this_week, sk.active_weeks_total, sk.weeks_total_program], [2, true, 2, 52]);
  eq(sk.recent.length, 12); eq(sk.recent.slice(-3), [true, false, true]);
  eq(h.table('Config').find((r) => r.key === 'streak_skip_weeks').value, '2027-02-08');
  h.setConfig('streak_skip_weeks', '');
  sk = h.ok({ action: 'me', token: h.login('T004') }).streak;
  eq(sk.current_weeks, 1, 'without a skip week the gap breaks the streak');
});

section('capstone: members only, SOI ≤ 60 words, URL and VND rules, deadline; panel scores', () => {
  const roster = fx.testRoster().map((p) => (p.employee_code === 'T004' ? Object.assign({}, p, { roles: 'learner;panel' })
    : p.employee_code === 'T010' ? Object.assign({}, p, { roles: 'learner;manager;panel' }) : p));
  const h = harness('2027-06-01T09:00:00+07:00', { roster });
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
  eq(Object.keys(pl.teams[0]).sort(), ['is_sponsor', 'my_score', 'project_title', 'submission', 'team_id']);
  eq(pl.teams.map((t) => t.is_sponsor), [false, false]);
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
  let dp = h.table('Dash_Panel');
  eq(dp.map((r) => [r.stage, r.team_id, r.judges, r.weighted_score, r.sponsor_scored]), [['pitch', 'TEAM1', '2', '3.17', 'no']], 'mean of judges: (26/6 + 12/6) / 2');
  // a judge who is a team member cannot score that team; a sponsor may, and is marked
  const member = h.login('T004');
  eq(h.err({ action: 'panel_score', token: member, stage: 'pitch', team_id: 'TEAM2', scores: { c1: 5, c2: 5, c3: 5, c4: 5, c5: 5 } }, 'forbidden').message, 'Judges cannot score their own team.');
  h.ok({ action: 'panel_score', token: member, stage: 'pitch', team_id: 'TEAM1', scores: { c1: 3, c2: 3, c3: 3, c4: 3, c5: 3 } });
  const sponsor = h.login('T010');
  eq(h.ok({ action: 'panel_list', token: sponsor, stage: 'pitch' }).teams.map((t) => t.is_sponsor), [true, true]);
  h.ok({ action: 'panel_score', token: sponsor, stage: 'pitch', team_id: 'TEAM1', scores: { c1: 5, c2: 5, c3: 5, c4: 5, c5: 5 } });
  h.run('menuPanelResults');
  dp = h.table('Dash_Panel');
  eq([dp[0].judges, dp[0].sponsor_scored, dp[0].weighted_without_sponsor, dp[0].weighted_score], ['4', 'yes (T010)', '3.11', '3.58']);
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
  eq(log.filter((r) => r.ok === 'FALSE' && r.action === 'login').length, 0, 'anonymous failures are never logged');
  ok(log.some((r) => r.action === 'login' && r.ok === 'TRUE' && r.employee_code === 'T001'));
  ok(log.some((r) => r.action === 'submit' && r.message.includes(s.attempt_id)), 'attempt ids are kept');
  eq(log.filter((r) => r.employee_code === '246810').length, 0, 'unknown codes are not logged');

  // busy: start/submit need the lock, save does not
  const t2 = h.login('T002', '975310');
  const s2 = h.ok({ action: 'start', token: t2, assessment: 'predict', course: 'A2' });
  h.lock.contended = true;
  h.err({ action: 'start', token: t2, assessment: 'checkpoint', course: 'A2' }, 'busy');
  h.err({ action: 'submit', token: t2, attempt_id: s2.attempt_id, answers: {} }, 'busy');
  h.ok({ action: 'login', code: 'T003', pin: PIN }); // login needs no lock (its Log row is skipped when busy)
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
  eq(h.ok({ action: 'start', token: t3, assessment: 'predict', course: 'A3' }).items.length, 3, 'cached until someone edits the tab');
  h.run('menuRefreshCache');
  eq(h.ok({ action: 'start', token: h.login('T004'), assessment: 'predict', course: 'A3' }).items.length, 2, 'after Refresh the Hub now');
  // F31: content tabs stay cached for 6 hours…
  h.updateWhere('Items', 'item_id', 'FX_A3_PR_02', { active: 'FALSE' });
  h.clock.advance(5 * 60 * MIN);
  eq(h.ok({ action: 'start', token: h.login('T005'), assessment: 'predict', course: 'A3' }).items.length, 2, 'still cached after 5 hours');
  // …and a hand edit of one of them (the onEdit simple trigger) refreshes the Hub at once
  const editOf = (tab) => ({ range: { getSheet: () => ({ getName: () => tab }) } });
  h.run('onEdit', editOf('Attempts'));
  eq(h.ok({ action: 'start', token: h.login('T006'), assessment: 'predict', course: 'A3' }).items.length, 2, 'an edit of a data tab does not drop the cache');
  h.run('onEdit', editOf('Items'));
  eq(h.ok({ action: 'start', token: h.login('T007'), assessment: 'predict', course: 'A3' }).items.length, 1, 'an edit of Items starts a new cache generation');
  // rows removed (no onEdit): the installable change trigger does the same
  h.updateWhere('Config', 'key', 'retake_hours', { value: '36' });
  eq(h.run('config_').retake_hours, 24);
  h.run('onSheetChange', { source: { getActiveSheet: () => ({ getName: () => 'Config' }) } });
  h.run('resetRequest_');
  eq(h.run('config_').retake_hours, 36, 'onSheetChange refreshes Config');
  h.run('onEdit', undefined); h.run('onSheetChange', {}); // malformed events never throw
  // without any edit, the 6-hour limit of CacheService still ends a generation's values
  h.updateWhere('Config', 'key', 'retake_hours', { value: '48' });
  h.clock.advance(6 * 60 * MIN + MIN);
  h.run('resetRequest_');
  eq(h.run('config_').retake_hours, 48, 'cache expires after 6 hours');
});

section('F31 speed: sign-in carries `me`, warm `me` reads three tabs, cached lookups are batched', () => {
  const h = harness('2027-01-05T09:00:00+07:00');
  const login = h.ok({ action: 'login', code: 'T009', pin: PIN }); // a learner in no capstone team
  ok(login.me && login.me.ok === undefined, 'login carries the me payload');
  const me = h.ok({ action: 'me', token: login.token });
  const strip = (x) => { const o = Object.assign({}, x); delete o.ok; delete o.server_now; return o; };
  eq(strip(login.me), strip(me), 'login.me is exactly what `me` returns');
  eq(login.me.profile.code, 'T009');
  // a wrong PIN gets no `me`
  const bad = h.call({ action: 'login', code: 'T009', pin: '000000' });
  ok(!bad.ok && bad.me === undefined && bad.error.me === undefined);
  ok(h.ok({ action: 'login', code: 'T030', pin: PIN }).me.profile.must_change_pin, 'before the PIN change `me` rides along too (it is allowed there)');
  // warm cache: `me` reads Roster, Attempts and Watched only, with two cache round trips
  const calls = { getAll: 0, get: 0 };
  const cache = h.ctx.CacheService.getScriptCache();
  const realGetAll = cache.getAll, realGet = cache.get;
  cache.getAll = function (k) { calls.getAll++; return realGetAll.call(cache, k); };
  cache.get = function (k) { if (!calls.inAll) calls.get++; return realGet.call(cache, k); };
  const wrap = (fn) => function (k) { calls.inAll = true; try { return fn.call(cache, k); } finally { calls.inAll = false; } };
  cache.getAll = ((orig) => function (k) { calls.getAll++; return wrap(orig)(k); })(realGetAll);
  const before = h.ss.stats.ranges;
  h.ok({ action: 'me', token: login.token });
  eq(h.ss.stats.ranges - before, 3, 'warm me: three tab reads (Roster, Attempts, Watched)');
  eq(calls.getAll, 2, 'warm me: two cache round trips');
  eq(calls.get, 0, 'warm me: no single cache lookups');
  cache.getAll = realGetAll; cache.get = realGet;
  // the Unlocks tab is read only for a course that may need an unlock; Recall only after a pass
  const names = [];
  const ss = h.ss; const realByName = ss.getSheetByName.bind(ss);
  ss.getSheetByName = (n) => { names.push(n); return realByName(n); };
  h.ok({ action: 'me', token: login.token });
  ss.getSheetByName = realByName;
  eq(names.sort(), ['Attempts', 'Roster', 'Watched']);
  // a team member's `me` also reads the Capstone tab (their submissions count for the streak)
  const names2 = [];
  ss.getSheetByName = (n) => { names2.push(n); return realByName(n); };
  h.ok({ action: 'me', token: h.login('T001') });
  ss.getSheetByName = realByName;
  ok(names2.includes('Capstone') && !names2.includes('Teams') && !names2.includes('Unlocks') && !names2.includes('Recall'), names2.join(','));
  // setupSheet installs the change trigger once
  h.run('setupSheet'); h.run('setupSheet');
  eq(h.triggers.filter((t) => t.getHandlerFunction() === 'onSheetChange').length, 1);
});

section('hardening: anonymous flooding, secrets cache, save-after-submit race, consent, logout', () => {
  const h = harness('2027-01-05T09:00:00+07:00');
  // warm the secrets once (a real request), then count Properties reads on anonymous traffic
  h.login('T001');
  const ps = h.ctx.PropertiesService.getScriptProperties();
  const orig = ps.getProperty;
  let reads = 0;
  ps.getProperty = (k) => { reads++; return orig(k); };
  const log0 = h.table('Log').length, acq0 = h.lock.acquisitions, w0 = h.ss.stats.writes;
  for (let i = 0; i < 25; i++) {
    h.call('{"action":');
    h.call({ action: 'me', token: 'v1.eyJjIjoiWCJ9.AAAA' + i });
    h.call({ action: 'drop_tables', token: 'x' });
    h.call({ action: 'login', code: 'NOPE' + i, pin: '1' });
  }
  ps.getProperty = orig;
  eq([h.table('Log').length - log0, h.lock.acquisitions - acq0, h.ss.stats.writes - w0], [0, 0, 0], '100 anonymous requests: no Log row, no lock, no Sheet write');
  eq(reads, 0, 'forged tokens do not read Script Properties (secrets cached)');
  const anon = Array.from(h.cache.store.entries()).filter(([k]) => k.startsWith('stat:anon:'));
  eq(anon.length, 1); eq(anon[0][1].v, '100', 'anonymous failures counted in CacheService');
  // secrets fall back to Script Properties when the cache is empty
  h.cache.evictAll();
  h.login('T001');

  // save-after-submit race: a save that read the row while open writes after submit graded it
  const tok = h.login('T002');
  const s = h.ok({ action: 'start', token: tok, assessment: 'checkpoint', course: 'A2' });
  const real = answersFor(s.items, 7);
  const probe = Object.fromEntries(s.items.map((i) => [i.item_id, 'a']));
  const origRead = h.ctx.readRow_;
  let fired = false;
  h.ctx.readRow_ = function (name, rowNum) {
    const r = origRead(name, rowNum);
    if (name === 'Attempts' && !fired) {
      fired = true;
      const saved = h.ctx.REQ_;
      const res = JSON.parse(h.ctx.doPost({ postData: { contents: JSON.stringify({ action: 'submit', token: tok, attempt_id: s.attempt_id, answers: real }) } }).getContent());
      eq([res.score_pct, res.missed.length], [70, 3]);
      h.ctx.REQ_ = saved;
    }
    return r;
  };
  h.call({ action: 'save', token: tok, attempt_id: s.attempt_id, answers: probe });
  h.ctx.readRow_ = origRead;
  ok(fired);
  const rv = h.ok({ action: 'review', token: tok, attempt_id: s.attempt_id });
  eq([rv.score_pct, rv.missed.length], [70, 3], 'results come from the frozen graded answers');
  eq(rv.missed.map((m) => m.your.id), s.items.slice(7).map((i) => real[i.item_id]));
  const row = h.table('Attempts').find((a) => a.attempt_id === s.attempt_id);
  eq(JSON.parse(row.graded_answers), real);

  // consent is enforced on the server (F18)
  const roster = fx.testRoster().map((p) => (p.employee_code === 'T009' ? Object.assign({}, p, { consent_at: '' }) : p));
  const h2 = harness('2027-01-05T09:00:00+07:00', { roster });
  const t9 = h2.login('T009');
  eq(h2.ok({ action: 'me', token: t9 }).profile.consent_needed, true);
  for (const a of [{ action: 'start', assessment: 'predict', course: 'A2' }, { action: 'team_summary' }, { action: 'capstone_get' }, { action: 'watch', course: 'A2', ep: 1, watched: true }, { action: 'save', attempt_id: 'x' }, { action: 'review', attempt_id: 'x' }]) {
    h2.err(Object.assign({ token: t9 }, a), 'consent_required');
  }
  eq(h2.ok({ action: 'set_lang', token: t9, lang: 'vi' }).lang, 'vi', 'set_lang allowed before consent');
  h2.ok({ action: 'consent', token: t9 });
  h2.ok({ action: 'start', token: t9, assessment: 'predict', course: 'A2' });
  // must_change_pin comes first, then consent
  const t30 = h2.login('T030');
  h2.err({ action: 'consent', token: t30 }, 'pin_change_required');
  const c30 = h2.ok({ action: 'change_pin', token: t30, old_pin: PIN, new_pin: '135790' });
  h2.err({ action: 'start', token: c30.token, assessment: 'predict', course: 'A2' }, 'consent_required');

  // logout signs out every device
  const d1 = h2.login('T001'), d2 = h2.login('T001');
  const lo = h2.ok({ action: 'logout', token: d1 });
  eq(Object.keys(lo).sort(), ['ok', 'server_now']);
  h2.err({ action: 'me', token: d1 }, 'session_expired');
  h2.err({ action: 'me', token: d2 }, 'session_expired');
  h2.err({ action: 'logout', token: d1 }, 'session_expired');
  h2.ok({ action: 'logout', token: h2.login('T030', '135790') }); // allowed before consent
  h2.login('T001');
  ok(h2.table('Log').some((r) => r.action === 'logout' && r.employee_code === 'T001'));
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
  const ses = h.table('Sessions');
  eq(ses.length, 9, 'the nine offline sessions seeded once');
  eq([ses[0].date, ses[0].kind, ses[0].courses, ses[0].start, ses[0].active], ['2026-12-22', 'kickoff', 'A1', '13:30', 'TRUE']);
  eq(ses.map((r) => r.kind).filter((k) => k === 'pitch' || k === 'warroom'), ['pitch', 'warroom']);
  eq(h.table('Config').filter((r) => r.key === 'wave').length, 1, 'setup is idempotent');
  // a Courses.csv "Replace current sheet" import drops the hand columns: Validate puts them back
  const cs = h.sheet('Courses');
  cs.clear();
  cs.getRange(1, 1, 2, 3).setValues([['code', 'name_en', 'self_en'], ['A2', 'Fixture course A2', 'Fixture self A2']]);
  h.run('validateNow_');
  const a2 = h.table('Courses').find((r) => r.code === 'A2');
  eq([a2.order, a2.online_from, a2.forum_date, a2.open], ['2', '2027-01-04', '2027-02-23', 'TRUE'], 'real calendar from Seed.gs (courses.json)');
  eq(h.table('Courses').length, 10);
});

section('setupSheet on the live Sheet: v1 tabs kept, baseline columns added, BaselineItems pasted in the bank\'s own column order', () => {
  const h = createHarness({ now: T('2026-11-16T09:00:00+07:00') });
  // what the live Sheet looks like: v1 tabs with data, BaselineItems pasted by hand (alphabetical headers, no allow_nr, unformatted cells)
  const put = (name, rows) => { const sh = h.ss.insertSheet(name); if (rows[0].length > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), rows[0].length - sh.getMaxColumns()); sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows); return sh; };
  put('Config', [['key', 'value', 'note'], ['wave', '2026-11', ''], ['baseline_open_from', '2026-11-16', 'old'], ['baseline_minutes', '60', 'old']]);
  put('Attempts', [['attempt_id', 'employee_code', 'assessment', 'status', 'wave'], ['at_old1', 'T001', 'baseline', 'submitted', '2026-11']]);
  const bank = fx.buildBaselineItems();
  const cols = Object.keys(bank[0]).filter((k) => k !== 'allow_nr').sort();
  put('BaselineItems', [cols].concat(bank.map((it) => cols.map((c) => it[c]))));
  h.run('setupSheet');
  const conf = Object.fromEntries(h.table('Config').map((r) => [r.key, r.value]));
  eq([conf.wave, conf.baseline_open_from, conf.baseline_minutes], ['2026-11', '2026-11-16', '60'], 'old keys left alone (no longer read)');
  eq([conf.p1_open, conf.p1_live, conf.p1_backup, conf.p1_minutes, conf.p2_minutes, conf.p3_minutes, conf.grace_minutes, conf.p2_w_sjt, conf.p2_w_mgr, conf.equate_threshold_pts, conf.results_open, conf.rating_open],
    ['FALSE', 'B,C', 'A', '65', '35', '48', '5', '0.5', '0.5', '5', 'FALSE', 'FALSE']);
  const att = h.table('Attempts');
  eq([att.length, att[0].attempt_id, att[0].assessment], [1, 'at_old1', 'baseline'], 'old attempts kept');
  for (const c of ['part', 'module', 'section_locks', 'raw_pct', 'scaled_pct', 'by_step', 'by_move', 'by_charter', 'by_level', 'by_gate', 'time_used_s']) ok(c in att[0], 'Attempts.' + c);
  const bi = h.table('BaselineItems');
  eq(bi.length, 216); ok('allow_nr' in bi[0], 'allow_nr added at the end');
  eq(typeof bi[0].order, 'string', 'cells the Sheet had turned into numbers are text again');
  for (const t of ['Exhibits', 'BaselineText', 'Ratings', 'Overrides', 'Profiles']) ok(h.sheet(t), t + ' created');
  ok(h.sheet('Roster').getRange(1, 1, 1, h.sheet('Roster').getLastColumn()).getValues()[0].includes('p3_module'));
  // the rest of the fixtures, then a Part 2 sitting reads BaselineItems by header
  fx.loadFixtures(h, { baseline: false });
  h.appendObjects('Exhibits', fx.buildExhibits());
  h.appendObjects('BaselineText', fx.buildBaselineText());
  for (const n of fx.NR_POSITIONS) h.updateWhere('BaselineItems', 'item_id', 'MOCK-BL-2R' + String(n).padStart(2, '0'), { allow_nr: 'TRUE' });
  h.setConfig('p2_open', 'TRUE');
  const v = h.run('validateNow_');
  eq(v.errors, []);
  const tok = JSON.parse(h.postRaw(JSON.stringify({ action: 'login', code: 'T001', pin: PIN }))).token;
  const s = h.call({ action: 'start', token: tok, assessment: 'baseline_p2' });
  eq(s.ok, true); eq(s.sections[0].items.length, 15);
  const nx = h.call({ action: 'baseline_next', token: tok, attempt_id: s.attempt_id, answers: sjtAnswers(s.sections[0].items) });
  eq(nx.section.items.filter((x) => x.allow_nr).length, 3);
  eq(blLeaks(nx), []); eq(blLeaks(s), []);
});

section('new code on the old Sheet (before Set up / repair tabs): me, team views and rating still answer', () => {
  const h = harness('2026-11-16T09:00:00+07:00', { config: { p1_open: 'TRUE', rating_open: 'TRUE' } });
  for (const t of ['BaselineItems', 'Exhibits', 'BaselineText', 'Ratings', 'Overrides', 'Profiles']) h.ss.deleteSheet(h.sheet(t));
  h.run('clearCaches_');
  const tok = h.login('T001');
  eq(h.ok({ action: 'me', token: tok }).baseline.parts.p1, { open: true, status: 'not_started', minutes: 65, n_items: 0 });
  h.err({ action: 'start', token: tok, assessment: 'baseline_p1' }, 'not_found');
  const mt = h.login('T010');
  eq(h.ok({ action: 'me', token: mt }).baseline.rating, { open: true, to_rate: 4, done: 0 });
  h.ok({ action: 'team_status', token: mt });
  h.ok({ action: 'rate_list', token: mt });
  h.ok({ action: 'team_summary', token: tok });
  h.run('setupSheet');
  ok(h.sheet('BaselineItems') && h.sheet('Profiles'), 'setup creates them');
});

section('admin menu: PINs, reset, unlock, void, summaries, dashboards, validate, import, trigger', () => {
  const h = harness('2027-01-05T09:00:00+07:00');
  h.run('onOpen');
  const labels = h.ui.menus[0].items.filter((i) => i.label).map((i) => i.label);
  eq(h.ui.menus[0].name, '1% Planner');
  for (const l of ['Set up / repair tabs', 'Import items from CSV…', 'Validate items / courses', 'Issue PINs for new roster rows', 'Reset a PIN…', 'Unlock a retake…', 'Void an attempt…', 'Rebuild summaries', 'Install hourly summary trigger', 'Course gate report', 'IDP export', 'Recall due list', 'Seed episodes', 'Panel results', 'Clear a lock…',
    'Baseline: open or close parts…', 'Assign a Part 1 form…', 'Build baseline profiles', 'Baseline v2 reports']) ok(labels.includes(l), 'menu: ' + l);
  ok(!labels.includes('Baseline heatmap'), 'the v1 heatmap is gone');
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
  // Clear a lock (menu) and Reset a PIN both lift a lock
  for (let i = 0; i < 5; i++) h.call({ action: 'login', code: 'T007', pin: '000001' });
  h.err({ action: 'login', code: 'T007', pin: PIN }, 'locked');
  h.ui.prompts.push('t007');
  h.run('menuClearLock');
  h.login('T007');
  for (let i = 0; i < 5; i++) h.call({ action: 'login', code: 'T008', pin: '000001' });
  h.ui.prompts.push('T008');
  h.run('menuResetPin');
  const pin8 = /(\d{6})</.exec(h.ui.dialogs.pop().html)[1];
  h.login('T008', pin8);
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

  // Baseline: open or close parts… (dialog shows the state; saving writes Config and refreshes the cache)
  h.run('menuBaselineSwitches');
  let dlgS = h.ui.dialogs.pop();
  eq(dlgS.title, 'Baseline: open or close parts');
  for (const k of ['p1_open', 'p2_open', 'p3_open', 'rating_open', 'results_open']) ok(new RegExp('id="' + k + '">').test(dlgS.html), k + ' shown closed');
  const t2 = h.login('T002');
  h.err({ action: 'start', token: t2, assessment: 'baseline_p1' }, 'not_open');
  const swRep = h.run('adminSetBaselineSwitches', { p1_open: true, p2_open: true, p3_open: 'TRUE', rating_open: false });
  ok(/Saved: Part 1 · Problem solving with data: open/.test(swRep) && /Results \(profiles and team averages\): closed/.test(swRep));
  eq(Object.fromEntries(h.table('Config').map((r) => [r.key, r.value])).p1_open, 'TRUE');
  ok(h.table('Log').some((r) => r.action === 'admin_baseline_switches'));
  h.run('menuBaselineSwitches');
  dlgS = h.ui.dialogs.pop();
  ok(/id="p1_open" checked/.test(dlgS.html) && /id="results_open">/.test(dlgS.html), 'the dialog shows the new state');
  eq(h.run('adminSetBaselineSwitches', { p1_open: true }).split('\n')[0], 'Nothing changed.');
  // baseline v2 dashboards: two people with all three parts, one manager rating
  for (const [c, right] of [['T002', 30], ['T003', 6]]) {
    const t = h.login(c);
    const p1 = h.ok({ action: 'start', token: t, assessment: 'baseline_p1' });
    h.ok({ action: 'submit', token: t, attempt_id: p1.attempt_id, answers: mcqAnswers(itemsOf(p1), right) });
    const p2 = h.ok({ action: 'start', token: t, assessment: 'baseline_p2' });
    const nx = h.ok({ action: 'baseline_next', token: t, attempt_id: p2.attempt_id, answers: sjtAnswers(p2.sections[0].items, right > 10 ? 0 : 15) });
    h.ok({ action: 'submit', token: t, attempt_id: p2.attempt_id, answers: rateAll(nx.section.items, 4) });
    const p3 = h.ok({ action: 'start', token: t, assessment: 'baseline_p3' });
    h.ok({ action: 'submit', token: t, attempt_id: p3.attempt_id, answers: mcqAnswers(itemsOf(p3), right > 10 ? 26 : 3), self_ratings: Object.fromEntries(fx.COURSES.map((k) => [k, 4])) });
  }
  h.run('adminSetBaselineSwitches', { rating_open: true });
  const mt = h.login('T010');
  const rItems = h.ok({ action: 'rate_get', token: mt, ratee: 'T003' }).items;
  h.ok({ action: 'rate_save', token: mt, ratee: 'T003', values: rateAll(rItems, 1) });
  h.run('menuBaselineReports');
  ok(/Dash_BL2_Heatmap 2 person/.test(h.ui.alerts.pop().message));
  const heat = h.table('Dash_BL2_Heatmap');
  eq(heat.map((r) => r.code), ['T002', 'T003']);
  eq([heat[0].p1_raw, heat[0].p3_module, heat[1].p3_module], [String(Math.round(100 * 30 / 32)), 'DP', 'DP'], 'both demand');
  ok(h.sheet('Dash_BL2_Heatmap').backgrounds.length === 1, 'heatmap colours');
  const di = h.table('Dash_BL2_Items');
  const p1row = di.find((r) => r.type === 'mcq' && r.assessment === 'baseline_p1');
  eq(p1row.n, '1'); ok(/a \d+% · b \d+% · c \d+% · d \d+% · blank \d+%/.test(p1row.distribution));
  ok(di.some((r) => r.type === 'sjt' && /most: .*\| least: /.test(r.distribution)));
  ok(di.some((r) => r.type === 'rating' && /manager mean 1 \(n 1\)/.test(r.distribution)));
  const core = di.find((r) => r.item_id === 'MOCK-BL-3CORE05');
  eq([core.n, core.p_value_or_mean], ['2', '0.5']); ok(core.point_biserial !== '', 'point-biserial with two takers');
  const df = h.table('Dash_BL2_Forms');
  eq(df.map((r) => r.form), ['A', 'B', 'C', 'equating']); eq(df[0].use, 'backup');
  eq(df.filter((r) => r.use === 'live').reduce((a, r) => a + +r.starts, 0), 2);
  eq(h.table('Dash_BL2_Raters').map((r) => [r.rater_code, r.ratees, r.ratings, r.mean]), [['T010', '1', '23', '1']]);
  const fl = h.table('Dash_BL2_Flags');
  ok(fl.some((r) => r.code === 'T003' && r.flag === 'blind_spot'), 'self 4 vs manager 1');
  ok(fl.some((r) => r.code === 'T003' && r.flag === 'rates_high_scores_low'));
  ok(!fl.some((r) => r.code === 'T002' && r.flag === 'rates_high_scores_low'));
  // Build baseline profiles (menu) writes Profiles even while results are closed (learners cannot read them yet)
  h.run('menuBuildProfiles');
  eq(h.table('Profiles').map((r) => r.employee_code).sort(), ['T002', 'T003']);
  h.err({ action: 'profile', token: h.login('T002') }, 'not_open');
  h.clock.set(T('2027-01-06T09:00:00+07:00'));
  h.run('menuGateReport');
  const gate = h.table('Dash_Gate');
  ok(gate.some((r) => r.course === 'A2' && r.code === 'TOTAL'));
  ok(!gate.some((r) => r.code === 'T040'), 'test users left out of the gate report');
  h.run('menuIdpExport');
  const idp = h.table('Dash_IDP');
  ok(idp.find((r) => r.code === 'T003').goal_1.startsWith('Raise '));
  ok(/\(\d+%\)$/.test(idp.find((r) => r.code === 'T003').gap_1));
  eq(idp.find((r) => r.code === 'T005').gap_1, 'no baseline');
  h.run('menuRecallDue');
  ok(h.sheet('Dash_Recall'));
  h.run('menuRebuildSummaries');
  eq(h.table('Summary').length, 0, 'results closed and no closed late window: nothing to publish');
  ok(h.sheet('Summary').getRange(1, 1, 1, 8).getValues()[0].includes('count'));
  h.run('menuInstallTrigger'); h.run('menuInstallTrigger');
  const sumTrig = h.triggers.filter((t) => t.getHandlerFunction() === 'buildSummary');
  eq(sumTrig.length, 1); eq(sumTrig[0].everyHours, 1);
  eq(h.triggers.length, 2, 'the hourly summary and the change trigger from setupSheet');
  h.run('menuSeedEpisodes');
  eq(h.table('Episodes').length, 76);

  // validate: the fixture banks (Items and BaselineItems/Exhibits) match the blueprint exactly
  const v = h.run('validateNow_');
  eq(v.errors, []); eq(v.warnings, []);
  h.updateWhere('Items', 'item_id', 'FX_P6_B_10', { answer: 'e' });
  h.updateWhere('BaselineItems', 'item_id', 'MOCK-BL-2S07', { answer_least: BLK['MOCK-BL-2S07'].answer_most });
  h.updateWhere('BaselineItems', 'item_id', 'MOCK-BL-1C-A05', { exhibit_ids: 'MOCK-EX-GONE' });
  h.run('menuValidate');
  const vd = h.ui.dialogs.pop().html;
  ok(/answer must be a, b, c or d/.test(vd));
  ok(/MOCK-BL-2S07.*answer_most and answer_least must differ/.test(vd));
  ok(/MOCK-BL-1C-A05.*MOCK-EX-GONE is not in Exhibits/.test(vd));
  // import BaselineText (invented) through the CSV dialog path
  const bt = h.run('adminImportCsv', 'BaselineText', 'key,en,vi\r\np1_title,"Part 1, imported",Phần 1\r\n');
  ok(/BaselineText: imported 1 row/.test(bt));
  eq(h.table('BaselineText'), [{ key: 'p1_title', en: 'Part 1, imported', vi: 'Phần 1' }]);
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
  for (const zone of ['UTC', 'Asia/Ho_Chi_Minh', 'America/New_York']) {
    const r = spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { TZ: zone, API_TZ_CHILD: '1' }), encoding: 'utf8' });
    process.stdout.write('  ' + (r.stdout || '').trim() + '\n');
    if (r.status !== 0) { console.error(r.stderr); console.error(`✖ api tests failed under TZ=${zone}`); process.exit(1); }
  }
}
