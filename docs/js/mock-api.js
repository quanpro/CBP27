// Demo backend for the Hub (specs/20 "Demo mode"). Runs in the browser; state lives in localStorage.
// Invented questions only: ids MOCK-001…, the right option is in `mockCorrect` and is stripped
// before any item reaches page code. No real item text, names or codes appear here.

const STORE = 'hub.mock.v1';
const PIN = '270127';
const RETAKE_MS = 60 * 1000; // demo: 1 minute instead of 24 h
const SESSION_MS = 6 * 3600 * 1000;
const BASELINE_MIN = 60;
const PASS = 0.8;
const H = 3600 * 1000;
const D = 24 * H;

// ---------- helpers ----------
const now = () => Date.now();
const iso = (ms) => new Date(ms + 7 * H).toISOString().replace(/\.\d{3}Z$/, '+07:00');
const day = (ms) => iso(ms).slice(0, 10);
const addDays = (dateStr, n) => day(Date.parse(`${dateStr}T12:00:00+07:00`) + n * D);
const clone = (x) => JSON.parse(JSON.stringify(x));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hash(s) { let x = 2166136261; for (const ch of String(s)) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; }
function shuffle(arr, seed) { const a = arr.slice(); const r = rng(seed); for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const ok = (data) => ({ ok: true, server_now: iso(now()), ...data });
const fail = (code, message, extra = {}) => ({ ok: false, server_now: iso(now()), error: { code, message: message || code, ...extra } });

// ---------- catalogue + invented item bank ----------
let catalog = null;
async function getCatalog() {
  if (!catalog) catalog = await fetch(new URL('../data/courses.json', import.meta.url)).then((r) => r.json());
  return catalog;
}
const ORDER = ['A2', 'A3', 'A1', 'P1', 'C1', 'P2', 'P3', 'P4', 'P5', 'P6'];
const CASE_COURSES = ['P1', 'P2', 'A1', 'P4', 'C1', 'P3'];
const OPTS = [
  ['The right answer (demo)', 'Đáp án đúng (demo)'],
  ['A tempting distractor', 'Một phương án dễ gây nhầm'],
  ['Another plausible distractor', 'Một phương án gây nhiễu khác'],
  ['A clearly wrong option', 'Một phương án sai rõ ràng'],
];
let bank = null;
async function getBank() {
  if (bank) return bank;
  const cat = await getCatalog();
  const items = [];
  let n = 0;
  const make = (assessment, course, form, objective, caseId) => {
    n += 1;
    const id = `MOCK-${String(n).padStart(3, '0')}`;
    const correct = 'abcd'[hash(id) % 4];
    const others = 'abcd'.split('').filter((x) => x !== correct);
    const options = [];
    options.push({ id: correct, en: OPTS[0][0], vi: OPTS[0][1] });
    others.forEach((oid, i) => options.push({ id: oid, en: OPTS[i + 1][0], vi: OPTS[i + 1][1] }));
    options.sort((x, y) => x.id.localeCompare(y.id));
    const label = { predict: ['Predict', 'Dự đoán'], checkpoint: ['Checkpoint', 'Checkpoint'], baseline: ['Baseline', 'Đánh giá đầu vào'] }[assessment];
    items.push({
      item_id: id, assessment, course, form, objective, case_id: caseId || '',
      stem_en: `${label[0]} demo question · ${course}, objective ${objective}. In the live Hub this is a real planning scenario; here, pick “${OPTS[0][0]}” to answer correctly.`,
      stem_vi: `Câu hỏi demo ${label[1]} · ${course}, mục tiêu ${objective}. Trên Hub thật đây là một tình huống hoạch định thực tế; ở đây, hãy chọn “${OPTS[0][1]}” để trả lời đúng.`,
      options, mockCorrect: correct,
      why_en: 'Demo explanation: in the live Hub, one line here explains why the right option is right.',
      why_vi: 'Giải thích demo: trên Hub thật, một dòng ở đây giải thích vì sao phương án đúng là đúng.',
    });
  };
  for (const c of cat.courses) {
    const k = c.objectives.length;
    for (let i = 0; i < 3; i += 1) make('predict', c.code, 'PR', (i % k) + 1);
    for (const form of ['A', 'B']) for (let i = 0; i < 10; i += 1) make('checkpoint', c.code, form, (i % k) + 1);
    for (let i = 0; i < 4; i += 1) make('baseline', c.code, 'BL', ((i + 1) % k) + 1);
  }
  CASE_COURSES.forEach((code, i) => make('baseline', code, 'BL', 1 + (i % 3), 'CASE1'));
  bank = items;
  return bank;
}
const CASE = {
  case_id: 'CASE1', title_en: 'Mini case (demo)', title_vi: 'Tình huống ngắn (demo)',
  context_en: 'Demo case. In the live Hub, a short business scenario appears here and stays visible while you answer the six case questions. Numbers in the real case are illustrative.',
  context_vi: 'Tình huống demo. Trên Hub thật, một tình huống kinh doanh ngắn hiện ở đây và luôn hiển thị trong khi bạn trả lời sáu câu hỏi. Các con số trong tình huống thật chỉ mang tính minh hoạ.',
};

// ---------- state ----------
function blankUser(code, first_name, role_area, extra = {}) {
  return { code, first_name, role_area, is_manager: false, manager: 'DEMO-M', roles: ['learner'], pin: PIN, must_change_pin: false,
    consent_at: iso(now() - 30 * D), lang: 'en', certificate: '', fails: 0, locked_until: null, sv: 1, ...extra };
}
async function seedState() {
  const items = await getBank();
  const t0 = now();
  const s = {
    version: 1,
    users: {
      'DEMO-L': blankUser('DEMO-L', 'Linh', 'demand'),
      'DEMO-M': blankUser('DEMO-M', 'Minh', 'supply', { is_manager: true, manager: '', roles: ['learner', 'manager', 'panel'] }),
      'DEMO-N': blankUser('DEMO-N', 'An', 'cs', { must_change_pin: true, consent_at: null }),
    },
    attempts: [], watched: {}, recall: [], unlocks: [], activity: {}, capstone: {}, panel: {}, seq: 0,
  };
  // DEMO-L: a learner part-way through the year.
  const L = 'DEMO-L';
  const byCourse = { A2: 70, A3: 55, A1: 50, P1: 40, C1: 60, P2: 35, P3: 30, P4: 45, P5: 25, P6: 50 };
  const self = { A2: 2, A3: 1, A1: 2, P1: 1, C1: 2, P2: 1, P3: 1, P4: 2, P5: 1, P6: 3 };
  s.attempts.push({ attempt_id: 'MA-SEED-BL', code: L, assessment: 'baseline', course: '', form: 'BL', attempt_no: 1, status: 'submitted',
    started_at: iso(t0 - 20 * D), last_saved_at: iso(t0 - 20 * D + 50 * 60000), submitted_at: iso(t0 - 20 * D + 52 * 60000), served: [], seed: 1, answers: {}, self,
    n_items: 46, n_correct: 22, score_pct: 48, by_course: byCourse, wave: '2026-11' });
  const cp = (course, form, no, pct, daysAgo) => {
    const served = items.filter((i) => i.assessment === 'checkpoint' && i.course === course && i.form === form).map((i) => i.item_id);
    const answers = {}; const nCorrect = Math.round(pct / 10);
    served.forEach((id, i) => { const it = items.find((x) => x.item_id === id); answers[id] = i < nCorrect ? it.mockCorrect : 'abcd'.split('').find((x) => x !== it.mockCorrect); });
    s.attempts.push({ attempt_id: `MA-SEED-${course}-${no}`, code: L, assessment: 'checkpoint', course, form, attempt_no: no, status: 'submitted',
      started_at: iso(t0 - daysAgo * D - 20 * 60000), last_saved_at: iso(t0 - daysAgo * D), submitted_at: iso(t0 - daysAgo * D), served, seed: hash(`${course}${no}`), answers,
      n_items: 10, n_correct: nCorrect, score_pct: pct, passed: pct >= 80 });
  };
  const pr = (course, daysAgo) => {
    const served = items.filter((i) => i.assessment === 'predict' && i.course === course).map((i) => i.item_id);
    s.attempts.push({ attempt_id: `MA-SEED-PR-${course}`, code: L, assessment: 'predict', course, form: 'PR', attempt_no: 1, status: 'submitted',
      started_at: iso(t0 - daysAgo * D), last_saved_at: iso(t0 - daysAgo * D), submitted_at: iso(t0 - daysAgo * D), served, seed: 7, answers: {}, n_items: 3, n_correct: 1, score_pct: 33 });
  };
  pr('A2', 18); pr('A3', 17); pr('A1', 3);
  cp('A2', 'A', 1, 90, 6);
  cp('A3', 'B', 1, 70, 2);
  s.recall.push({ code: L, course: 'A2', day: 2, due_date: day(t0), status: 'due', score_pct: null, attempt_id: '' });
  s.recall.push({ code: L, course: 'A2', day: 7, due_date: day(t0 + 5 * D), status: 'upcoming', score_pct: null, attempt_id: '' });
  s.recall.push({ code: L, course: 'A2', day: 30, due_date: day(t0 + 28 * D), status: 'upcoming', score_pct: null, attempt_id: '' });
  s.watched[L] = { A2: [1, 2, 3, 4, 5, 6, 7, 8], A3: [1, 2, 3], A1: [0] };
  s.activity[L] = [1, 2, 3, 4, 5, 6, 8, 9, 11].map((w) => iso(t0 - w * 7 * D + D)).concat([iso(t0 - 2 * D)]);
  s.capstone['TEAM-DEMO'] = { pitch: null, capstone: null };
  s.capstone['TEAM-DEMO-2'] = { pitch: {
    project_title: 'Line 3 output reliability from 85% to 92% (demo)', soi_situation: 'Demo team submission for the panel view.', soi_observation: 'Output reliability on Line 3 swings week to week. How do we hold 92% without overtime?',
    soi_implication: 'Fix the sequence rule and frozen-zone changes first.', kpi_name: 'Output reliability', kpi_before: '85', kpi_after: '90', kpi_unit: '%', evidence_url: '', value_vnd: '0', value_basis: 'Demo only',
    lessons: 'Demo only.', submitted_by: 'DEMO-X', submitted_at: iso(t0 - 4 * D), stage: 'pitch' }, capstone: null };
  return s;
}
let state = null;
async function load() {
  if (state) return state;
  try { const raw = localStorage.getItem(STORE); if (raw) state = JSON.parse(raw); } catch (e) { state = null; }
  if (!state || state.version !== 1) { state = await seedState(); save(); }
  return state;
}
function save() { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* storage full or blocked */ } }
export function reset() { state = null; try { localStorage.removeItem(STORE); } catch (e) { /* ignore */ } }

const TEAMS = {
  'TEAM-DEMO': { team_id: 'TEAM-DEMO', project_title: 'MT fill rate on our top 5 accounts from 87% to 93% (demo)', members: ['DEMO-L', 'DEMO-M', 'DEMO-N'], sponsor: 'DEMO-M' },
  'TEAM-DEMO-2': { team_id: 'TEAM-DEMO-2', project_title: 'Line 3 output reliability from 85% to 92% (demo)', members: ['DEMO-X'], sponsor: 'DEMO-M' },
};

// ---------- derived views ----------
function profileOf(u) {
  return { code: u.code, first_name: u.first_name, role_area: u.role_area, is_manager: u.is_manager, roles: u.roles.slice(), lang: u.lang,
    must_change_pin: u.must_change_pin, consent_needed: !u.consent_at, certificate: u.certificate };
}
function tokenFor(u) { return { token: `mock.${u.code}.${u.sv}.${now()}`, expires_at: iso(now() + SESSION_MS) }; }
function userFromToken(token) {
  const m = /^mock\.([A-Z0-9_-]+)\.(\d+)\.(\d+)$/.exec(token || '');
  if (!m) return null;
  const u = state.users[m[1]];
  if (!u || String(u.sv) !== m[2] || now() - Number(m[3]) > SESSION_MS) return null;
  return u;
}
const mine = (code, pred) => state.attempts.filter((a) => a.code === code && pred(a));
const baselineWindow = () => ({ wave: '2026-11', open_from: day(now() - 3 * D), open_to: day(now() + 10 * D) });

function expireBaseline(code) {
  for (const a of mine(code, (x) => x.assessment === 'baseline' && x.status === 'open')) {
    if (now() > Date.parse(a.started_at) + (BASELINE_MIN + 10) * 60000) gradeAttempt(a, a.answers, a.self, true);
  }
}

async function courseRows(code) {
  const cat = await getCatalog();
  const today = day(now());
  return cat.courses.slice().sort((a, b) => a.order - b.order).map((c) => {
    const cps = mine(code, (a) => a.assessment === 'checkpoint' && a.course === c.code);
    const done = cps.filter((a) => a.status === 'submitted');
    const open = cps.find((a) => a.status === 'open');
    const passedA = done.find((a) => a.passed);
    const last = done.slice().sort((x, y) => Date.parse(y.submitted_at) - Date.parse(x.submitted_at))[0];
    const unlocks = state.unlocks.filter((u) => u.code === code && u.course === c.code).length;
    const lateUntil = addDays(c.forum_date, 7);
    let status = 'not_started';
    if (passedA) status = 'passed'; else if (open) status = 'in_progress'; else if (done.length) status = 'not_yet';
    const next = !passedA && last ? iso(Date.parse(last.submitted_at) + RETAKE_MS) : null;
    const prs = mine(code, (a) => a.assessment === 'predict' && a.course === c.code && a.status === 'submitted');
    const watched = (state.watched[code] && state.watched[code][c.code]) || [];
    const eps = (c.has_trailer ? [0] : []).concat(c.episodes.map((e) => e.ep));
    return {
      code: c.code, order: c.order, cycle: c.cycle, open: true, online_from: c.online_from, checkpoint_close: c.checkpoint_close,
      forum_date: c.forum_date, field_until: c.field_until, late_until: lateUntil, blink_url: '',
      episodes: eps.map((ep) => ({ ep, minutes: ep === 0 ? 1 : 5, blink_url: '', embed_url: '', watched: watched.includes(ep) })),
      predict: { done: prs.length > 0, attempts: prs.length, last_pct: prs.length ? prs[prs.length - 1].score_pct : null },
      checkpoint: {
        status, attempts: done.length, best_pct: done.length ? Math.max(...done.map((a) => a.score_pct)) : null,
        passed_at: passedA ? passedA.submitted_at : null, next_retake_at: status === 'not_yet' ? next : null,
        needs_unlock: !passedA && !open && done.length >= 2 + unlocks, gate_closed: !passedA && today > lateUntil && done.length >= 2 + unlocks,
        open_attempt_id: open ? open.attempt_id : null, last_attempt_id: last ? last.attempt_id : null,
      },
      recall: state.recall.filter((r) => r.code === code && r.course === c.code).map((r) => ({
        day: r.day, due_date: r.due_date, status: r.status === 'done' ? 'done' : (r.due_date <= today ? 'due' : 'upcoming'), score_pct: r.score_pct, attempt_id: r.attempt_id || null })),
    };
  });
}

function weekIndex(ms) { return Math.floor((Date.parse(`${day(ms)}T00:00:00+07:00`) - Date.parse('1970-01-05T00:00:00+07:00')) / (7 * D)); }
function streakOf(code) {
  const stamps = (state.activity[code] || []).concat(mine(code, (a) => a.status === 'submitted').map((a) => a.submitted_at));
  const weeks = new Set(stamps.map((s) => weekIndex(Date.parse(s))));
  const cur = weekIndex(now());
  const activeNow = weeks.has(cur);
  let w = activeNow ? cur : cur - 1; let n = 0;
  while (weeks.has(w)) { n += 1; w -= 1; }
  return { current_weeks: n, active_this_week: activeNow, active_weeks_total: weeks.size, multiplier: Math.round(1.01 ** weeks.size * 100) / 100 };
}
function touch(code) { (state.activity[code] = state.activity[code] || []).push(iso(now())); }

function baselineView(code) {
  expireBaseline(code);
  const w = baselineWindow();
  const a = mine(code, (x) => x.assessment === 'baseline' && x.wave === w.wave).sort((x, y) => Date.parse(y.started_at) - Date.parse(x.started_at))[0];
  const out = { ...w, window: 'open', status: 'not_started' };
  if (a && a.status === 'open') Object.assign(out, { status: 'in_progress', attempt_id: a.attempt_id, started_at: a.started_at, deadline_at: iso(Date.parse(a.started_at) + BASELINE_MIN * 60000) });
  if (a && (a.status === 'submitted' || a.status === 'expired')) Object.assign(out, { status: 'submitted', attempt_id: a.attempt_id, started_at: a.started_at, submitted_at: a.submitted_at, result: baselineResult(a) });
  return out;
}
function baselineResult(a) {
  const codes = ORDER.slice().sort((x, y) => (a.by_course[x] - a.by_course[y]) || ((a.self[x] || 0) - (a.self[y] || 0)) || (ORDER.indexOf(x) - ORDER.indexOf(y)));
  return { score_pct: a.score_pct, by_course: a.by_course, self: a.self, gaps: codes.slice(0, 2) };
}

// ---------- grading ----------
function reviewRows(a, items, reveal) {
  return a.served.map((id) => {
    const it = items.find((x) => x.item_id === id);
    const yourId = a.answers[id] || null;
    const your = yourId ? it.options.find((o) => o.id === yourId) : null;
    const correct = it.options.find((o) => o.id === it.mockCorrect);
    return { item_id: id, course: it.course, objective: it.objective, stem_en: it.stem_en, stem_vi: it.stem_vi, your: your ? clone(your) : null,
      correct: reveal ? clone(correct) : null, why_en: reveal ? it.why_en : '', why_vi: reveal ? it.why_vi : '', is_correct: yourId === it.mockCorrect };
  });
}
function gradeAttempt(a, answers, self, expired = false) {
  const items = bank;
  a.answers = answers || {};
  if (self) a.self = self;
  let n = 0;
  const byObj = {}; const byCourse = {}; const byCourseN = {};
  for (const id of a.served) {
    const it = items.find((x) => x.item_id === id);
    const right = a.answers[id] === it.mockCorrect;
    if (right) n += 1;
    const o = (byObj[it.objective] = byObj[it.objective] || { n: 0, correct: 0 }); o.n += 1; if (right) o.correct += 1;
    byCourse[it.course] = (byCourse[it.course] || 0) + (right ? 1 : 0); byCourseN[it.course] = (byCourseN[it.course] || 0) + 1;
  }
  a.n_items = a.served.length; a.n_correct = n; a.score_pct = Math.round((100 * n) / Math.max(1, a.served.length));
  a.by_objective = byObj;
  if (a.assessment === 'baseline') { a.by_course = {}; ORDER.forEach((c) => { a.by_course[c] = byCourseN[c] ? Math.round((100 * byCourse[c]) / byCourseN[c]) : 0; }); }
  if (a.assessment === 'checkpoint') a.passed = a.score_pct >= PASS * 100;
  a.status = expired ? 'expired' : 'submitted';
  a.submitted_at = iso(now());
  touch(a.code);
  if (a.assessment === 'checkpoint' && a.passed && !state.recall.some((r) => r.code === a.code && r.course === a.course)) {
    [[2, 0], [7, 5], [30, 28]].forEach(([d, off]) => state.recall.push({ code: a.code, course: a.course, day: d, due_date: day(now() + off * D), status: off === 0 ? 'due' : 'upcoming', score_pct: null, attempt_id: '' }));
  }
  if (a.assessment === 'recall') {
    const r = state.recall.find((x) => x.code === a.code && x.course === a.course && x.day === a.day);
    if (r) { r.status = 'done'; r.score_pct = a.score_pct; r.attempt_id = a.attempt_id; }
  }
}
async function resultOf(a) {
  const items = await getBank();
  const cat = await getCatalog();
  if (a.assessment === 'baseline') return { assessment: 'baseline', ...baselineResult(a) };
  if (a.assessment === 'predict') return { assessment: 'predict', course: a.course, n_items: a.n_items, n_correct: a.n_correct, score_pct: a.score_pct, review: reviewRows(a, items, true) };
  if (a.assessment === 'recall') return { assessment: 'recall', course: a.course, day: a.day, n_items: a.n_items, n_correct: a.n_correct, score_pct: a.score_pct, review: reviewRows(a, items, true) };
  const c = cat.courses.find((x) => x.code === a.course);
  const passedEver = mine(a.code, (x) => x.assessment === 'checkpoint' && x.course === a.course && x.passed).length > 0;
  const reveal = passedEver || day(now()) > addDays(c.forum_date, 7);
  const weak = Object.entries(a.by_objective || {}).filter(([, v]) => v.correct < v.n).map(([k]) => Number(k)).sort((x, y) => x - y);
  const done = mine(a.code, (x) => x.assessment === 'checkpoint' && x.course === a.course && x.status === 'submitted').length;
  const unlocks = state.unlocks.filter((u) => u.code === a.code && u.course === a.course).length;
  const recall = state.recall.filter((r) => r.code === a.code && r.course === a.course).map((r) => r.due_date);
  return {
    assessment: 'checkpoint', course: a.course, form: a.form, attempt_no: a.attempt_no, n_items: a.n_items, n_correct: a.n_correct, score_pct: a.score_pct,
    passed: !!a.passed, reveal, by_objective: a.by_objective, weak_objectives: weak,
    missed: reviewRows(a, items, reveal).filter((r) => !r.is_correct),
    next_retake_at: a.passed ? null : iso(Date.parse(a.submitted_at) + RETAKE_MS), needs_unlock: !a.passed && done >= 2 + unlocks,
    forum_date: c.forum_date, ...(a.passed ? { recall_dates: recall } : {}),
  };
}
const servedItem = (it) => ({ item_id: it.item_id, course: it.course, objective: it.objective, case_id: it.case_id, stem_en: it.stem_en, stem_vi: it.stem_vi, options: it.options.map((o) => ({ id: o.id, en: o.en, vi: o.vi })) });
function serve(a, items) {
  return a.served.map((id, i) => {
    const it = items.find((x) => x.item_id === id);
    const s = servedItem(it);
    s.options = shuffle(s.options, a.seed + i);
    return s;
  });
}

// ---------- actions ----------
const ACTIONS = {
  async login(p) {
    const code = String(p.code || '').trim().toUpperCase();
    const u = state.users[code];
    if (!u) return fail('auth_failed');
    if (u.locked_until && now() < Date.parse(u.locked_until)) return fail('locked', null, { until: u.locked_until });
    if (String(p.pin || '') !== u.pin) {
      u.fails += 1;
      if (u.fails >= 5) { u.locked_until = iso(now() + 15 * 60000); u.fails = 0; save(); return fail('locked', null, { until: u.locked_until }); }
      save(); return fail('auth_failed');
    }
    u.fails = 0; u.locked_until = null; save();
    return ok({ ...tokenFor(u), profile: profileOf(u) });
  },
  async change_pin(p, u) {
    if (String(p.old_pin) !== u.pin) return fail('auth_failed');
    const n = String(p.new_pin || '');
    if (!/^\d{6}$/.test(n) || /^(\d)\1{5}$/.test(n) || ['123456', '654321'].includes(n) || n === u.pin) return fail('pin_weak');
    u.pin = n; u.sv += 1; u.must_change_pin = false; save();
    return ok({ ...tokenFor(u), profile: profileOf(u) });
  },
  async consent(p, u) { u.consent_at = iso(now()); save(); return ok({ consent_at: u.consent_at }); },
  async set_lang(p, u) { if (['en', 'vi'].includes(p.lang)) { u.lang = p.lang; save(); } return ok({ lang: u.lang }); },
  async me(p, u) {
    const courses = await courseRows(u.code);
    const team = Object.values(TEAMS).find((tm) => tm.members.includes(u.code));
    const sub = team ? state.capstone[team.team_id] || {} : {};
    const passed = courses.filter((c) => c.checkpoint.status === 'passed').length;
    const out = ok({
      profile: profileOf(u), baseline: baselineView(u.code), courses,
      capstone: { team_id: team ? team.team_id : null, project_title: team ? team.project_title : null, pitch_submitted_at: sub.pitch ? sub.pitch.submitted_at : null,
        capstone_submitted_at: sub.capstone ? sub.capstone.submitted_at : null, pitch_deadline: '2027-06-21', capstone_deadline: '2027-12-20' },
      streak: streakOf(u.code),
      certificates: { level: u.certificate, checkpoints_passed: passed, checkpoints_total: 10, pitch_submitted: !!sub.pitch, capstone_submitted: !!sub.capstone },
    });
    save();
    return out;
  },
  async watch(p, u) {
    const w = (state.watched[u.code] = state.watched[u.code] || {});
    const list = new Set(w[p.course] || []);
    if (p.watched) list.add(Number(p.ep)); else list.delete(Number(p.ep));
    w[p.course] = [...list].sort((a, b) => a - b);
    if (p.watched) touch(u.code);
    save();
    return ok({ course: p.course, watched: w[p.course] });
  },
  async start(p, u) {
    const items = await getBank();
    const cat = await getCatalog();
    const kind = p.assessment;
    if (!['baseline', 'predict', 'checkpoint', 'recall'].includes(kind)) return fail('bad_request');
    if (kind !== 'baseline' && !cat.courses.some((c) => c.code === p.course)) return fail('not_found');
    if (kind === 'baseline') expireBaseline(u.code);
    const openA = mine(u.code, (a) => a.status === 'open' && a.assessment === kind && (kind === 'baseline' || a.course === p.course) && (kind !== 'recall' || a.day === Number(p.day)))[0];
    let a = openA;
    if (!a) {
      let served; let form = 'PR'; let attemptNo = 1;
      if (kind === 'baseline') {
        if (mine(u.code, (x) => x.assessment === 'baseline' && x.status !== 'open').length) return fail('already_submitted');
        const partB = ORDER.flatMap((code, ci) => shuffle(items.filter((i) => i.assessment === 'baseline' && i.course === code && !i.case_id), hash(u.code) + ci));
        const partC = items.filter((i) => i.assessment === 'baseline' && i.case_id);
        served = partB.concat(partC).map((i) => i.item_id); form = 'BL';
      } else if (kind === 'predict') {
        served = items.filter((i) => i.assessment === 'predict' && i.course === p.course).map((i) => i.item_id);
        attemptNo = mine(u.code, (x) => x.assessment === 'predict' && x.course === p.course).length + 1;
      } else if (kind === 'checkpoint') {
        const prev = mine(u.code, (x) => x.assessment === 'checkpoint' && x.course === p.course && x.status === 'submitted').sort((x, y) => x.attempt_no - y.attempt_no);
        if (prev.some((x) => x.passed)) return fail('already_passed');
        const last = prev[prev.length - 1];
        if (last && now() < Date.parse(last.submitted_at) + RETAKE_MS) return fail('retake_too_soon', null, { next_retake_at: iso(Date.parse(last.submitted_at) + RETAKE_MS) });
        const unlocks = state.unlocks.filter((x) => x.code === u.code && x.course === p.course).length;
        if (prev.length >= 2 + unlocks) return fail('unlock_needed');
        form = last ? (last.form === 'A' ? 'B' : 'A') : 'abcd'.length && (hash(u.code + p.course) % 2 ? 'B' : 'A');
        served = shuffle(items.filter((i) => i.assessment === 'checkpoint' && i.course === p.course && i.form === form), hash(u.code + p.course + prev.length)).map((i) => i.item_id);
        attemptNo = prev.length + 1;
      } else {
        const r = state.recall.find((x) => x.code === u.code && x.course === p.course && x.day === Number(p.day));
        if (!r || r.status === 'done' || r.due_date > day(now())) return fail('not_due');
        const taken = mine(u.code, (x) => x.assessment === 'checkpoint' && x.course === p.course && x.status === 'submitted').map((x) => x.form);
        const other = taken.includes('A') && !taken.includes('B') ? 'B' : 'A';
        const pool = shuffle(items.filter((i) => i.assessment === 'checkpoint' && i.course === p.course && i.form === other), hash(u.code + p.course));
        const offset = { 2: 0, 7: 3, 30: 6 }[r.day] || 0;
        served = pool.slice(offset, offset + 3).map((i) => i.item_id); form = other;
      }
      state.seq += 1;
      a = { attempt_id: `MA-${Date.now().toString(36)}-${state.seq}`, code: u.code, assessment: kind, course: kind === 'baseline' ? '' : p.course, form, attempt_no: attemptNo,
        status: 'open', started_at: iso(now()), last_saved_at: null, submitted_at: null, served, seed: hash(`${u.code}${now()}`), answers: {}, self: {},
        wave: kind === 'baseline' ? baselineWindow().wave : '', day: kind === 'recall' ? Number(p.day) : null };
      state.attempts.push(a);
      save();
    }
    const out = { attempt_id: a.attempt_id, assessment: a.assessment, course: a.course, form: a.form, attempt_no: a.attempt_no, started_at: a.started_at, resumed: !!openA,
      answers: clone(a.answers || {}), items: serve(a, items) };
    if (kind === 'baseline') {
      Object.assign(out, {
        deadline_at: iso(Date.parse(a.started_at) + BASELINE_MIN * 60000), time_limit_min: BASELINE_MIN, self_ratings: clone(a.self || {}),
        self: cat.courses.slice().sort((x, y) => x.order - y.order).map((c) => ({ course: c.code, en: c.self_en, vi: c.self_vi })),
        scale: cat.scale.map((s) => ({ level: s.level, en: `${s.level} · ${s.en}${s.abbr ? ` (${s.abbr})` : ''}`, vi: `${s.level} · ${s.vi}${s.abbr ? ` (${s.abbr})` : ''}`, desc_en: s.desc_en, desc_vi: s.desc_vi })),
        case: clone(CASE), parts: { A: 10, B: 40, C: 6 },
      });
    }
    return ok(out);
  },
  async save(p, u) {
    const a = state.attempts.find((x) => x.attempt_id === p.attempt_id && x.code === u.code);
    if (!a) return fail('not_found');
    if (a.status !== 'open') return fail('already_submitted');
    a.answers = p.answers || {}; if (p.self_ratings) a.self = p.self_ratings; a.last_saved_at = iso(now());
    save();
    return ok({ saved_at: a.last_saved_at });
  },
  async submit(p, u) {
    await getBank();
    const a = state.attempts.find((x) => x.attempt_id === p.attempt_id && x.code === u.code);
    if (!a) return fail('not_found');
    if (a.status === 'open') {
      if (a.assessment === 'baseline') {
        const self = p.self_ratings || a.self || {};
        if (ORDER.some((c) => self[c] === undefined || self[c] === null || self[c] === '')) return fail('bad_request', 'All 10 self-ratings are required');
      }
      gradeAttempt(a, p.answers || a.answers, p.self_ratings);
      save();
    }
    return ok(await resultOf(a));
  },
  async review(p, u) {
    const a = state.attempts.find((x) => x.attempt_id === p.attempt_id && x.code === u.code);
    if (!a || a.status === 'open') return fail('not_found');
    return ok(await resultOf(a));
  },
  async team_summary() {
    const courses = (vals) => Object.fromEntries(ORDER.map((c, i) => [c, vals(i)]));
    const base = (seed, n, group) => ({ group, n, courses: courses((i) => ({ self: Math.round((1 + ((seed + i * 7) % 20) / 10) * 10) / 10, pct: 30 + ((seed * 3 + i * 11) % 45) })) });
    const cps = (group, n, upto) => ({ group, n, courses: courses((i) => (i < upto ? { first_try_pass: 55 + ((i * 13 + n) % 40), passed_by_forum: 80 + ((i * 7 + n) % 21) } : { first_try_pass: null, passed_by_forum: null })) });
    return ok({ updated_at: iso(now() - 2 * H), min_n: 3, wave: '2026-11',
      baseline: [base(5, 18, 'all'), base(9, 6, 'demand'), base(3, 5, 'supply'), base(12, 4, 'cs')],
      checkpoints: [cps('all', 18, 2), cps('demand', 6, 2), cps('supply', 5, 2), cps('cs', 4, 2)] });
  },
  async team_status(p, u) {
    if (!u.is_manager) return fail('forbidden');
    const me = state.users['DEMO-L'];
    const rows = await courseRows(me.code);
    const st = (c) => (c.checkpoint.status === 'passed' ? 'passed' : (c.checkpoint.attempts > 0 ? 'not_yet' : 'not_started'));
    const fake = (code, name, passedUpto, notYet) => ({ code, first_name: name, baseline: 'done', courses: Object.fromEntries(ORDER.map((c, i) => [c, i < passedUpto ? 'passed' : (i === notYet ? 'not_yet' : 'not_started')])) });
    return ok({ reports: [
      { code: me.code, first_name: me.first_name, baseline: mine(me.code, (a) => a.assessment === 'baseline' && a.status !== 'open').length ? 'done' : 'not_done', courses: Object.fromEntries(rows.map((c) => [c.code, st(c)])) },
      fake('DEMO-P1', 'Peer 1', 2, 2), fake('DEMO-P2', 'Peer 2', 1, 1),
    ] });
  },
  async capstone_get(p, u) {
    const team = Object.values(TEAMS).find((tm) => tm.members.includes(u.code));
    if (!team) return ok({ team: null, submissions: { pitch: null, capstone: null }, deadlines: { pitch: '2027-06-21', capstone: '2027-12-20' } });
    const names = { 'DEMO-L': 'Linh', 'DEMO-M': 'Minh', 'DEMO-N': 'An', 'DEMO-X': 'Demo' };
    const sub = state.capstone[team.team_id] || {};
    return ok({ team: { team_id: team.team_id, project_title: team.project_title, members: team.members.map((c) => ({ code: c, first_name: names[c] || c })), sponsor: { code: team.sponsor, first_name: names[team.sponsor] } },
      submissions: { pitch: sub.pitch || null, capstone: sub.capstone || null }, deadlines: { pitch: '2027-06-21', capstone: '2027-12-20' } });
  },
  async capstone_submit(p, u) {
    const team = TEAMS[p.team_id];
    if (!team || !team.members.includes(u.code)) return fail('forbidden');
    if (!['pitch', 'capstone'].includes(p.stage)) return fail('bad_request');
    const f = p.fields || {};
    const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
    if (['soi_situation', 'soi_observation', 'soi_implication'].some((k) => words(f[k]) > 60)) return fail('bad_request', 'Each SOI part must be 60 words or fewer');
    if (f.evidence_url && !/^https:\/\//i.test(f.evidence_url)) return fail('bad_request', 'Evidence link must start with https://');
    if (f.value_vnd && !/^\d+$/.test(String(f.value_vnd))) return fail('bad_request', 'Value must be digits only');
    const keys = ['project_title', 'soi_situation', 'soi_observation', 'soi_implication', 'kpi_name', 'kpi_before', 'kpi_after', 'kpi_unit', 'evidence_url', 'value_vnd', 'value_basis', 'lessons'];
    const submission = Object.fromEntries(keys.map((k) => [k, String(f[k] == null ? '' : f[k])]));
    Object.assign(submission, { submitted_by: u.code, submitted_at: iso(now()), stage: p.stage });
    (state.capstone[team.team_id] = state.capstone[team.team_id] || {})[p.stage] = submission;
    touch(u.code); save();
    return ok({ submitted_at: submission.submitted_at, submission });
  },
  async panel_list(p, u) {
    if (!u.roles.includes('panel') && !u.roles.includes('admin')) return fail('forbidden');
    const stage = p.stage === 'capstone' ? 'capstone' : 'pitch';
    return ok({ stage, teams: Object.values(TEAMS).map((tm) => ({ team_id: tm.team_id, project_title: tm.project_title,
      submission: (state.capstone[tm.team_id] || {})[stage] || null, my_score: state.panel[`${tm.team_id}|${stage}|${u.code}`] || null })) });
  },
  async panel_score(p, u) {
    if (!u.roles.includes('panel') && !u.roles.includes('admin')) return fail('forbidden');
    const sc = p.scores || {};
    if (['c1', 'c2', 'c3', 'c4', 'c5'].some((k) => !(Number(sc[k]) >= 1 && Number(sc[k]) <= 5))) return fail('bad_request', 'Five scores from 1 to 5 are required');
    const rec = { c1: Number(sc.c1), c2: Number(sc.c2), c3: Number(sc.c3), c4: Number(sc.c4), c5: Number(sc.c5), comment: String(p.comment || ''), scored_at: iso(now()) };
    state.panel[`${p.team_id}|${p.stage}|${u.code}`] = rec; save();
    return ok({ scored_at: rec.scored_at });
  },
};

const OPEN_ACTIONS = new Set(['login']);
const PIN_EXEMPT = new Set(['login', 'change_pin', 'me']);

/** Entry point used by api.js in demo mode. */
export async function handle(payload) {
  await sleep(120 + Math.floor(Math.random() * 220));
  await load();
  await getBank();
  const fn = ACTIONS[payload && payload.action];
  if (!fn) return fail('bad_request', 'Unknown action');
  let u = null;
  if (!OPEN_ACTIONS.has(payload.action)) {
    u = userFromToken(payload.token);
    if (!u) return fail('session_expired');
    if (u.must_change_pin && !PIN_EXEMPT.has(payload.action)) return fail('pin_change_required');
  }
  try { return await fn(payload, u); } catch (e) { console.error(e); return fail('server_error', String(e && e.message)); }
}
