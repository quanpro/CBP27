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

// ---------- demo calendar ----------
// The real 2027 calendar (courses.json) moved so that the day the demo was seeded sits in cycle 2:
// the A2 + A3 forum was 9 days earlier (its late week has closed), A1 has been online for 4 days and
// P1 … P6 open later on real-looking dates. Recall dates, the baseline window and the capstone
// deadlines all follow from these dates, so everything the demo shows adds up.
const DATE_KEYS = ['prework_from', 'online_from', 'online_to', 'checkpoint_close', 'forum_date', 'field_until'];
const LATE_DAYS = 7;
const MAX_FREE = 2;
const diffDays = (a, b) => Math.round((Date.parse(`${a}T12:00:00+07:00`) - Date.parse(`${b}T12:00:00+07:00`)) / D);
const dayEndMs = (dateStr) => Date.parse(`${dateStr}T23:59:59+07:00`);
let calCache = null;
function calendar() {
  if (calCache && calCache.t0 === state.t0) return calCache.cal;
  const cat = catalog;
  const base = day(state.t0);
  const find = (code) => cat.courses.find((c) => c.code === code);
  const shift1 = diffDays(addDays(base, -9), find('A2').forum_date); // cycle 1: forum 9 days before the seed
  const shift2 = diffDays(addDays(base, -4), find('A1').online_from); // cycle 2 on: A1 online 4 days before
  const courses = {};
  for (const c of cat.courses) {
    const sh = c.cycle === 1 ? shift1 : shift2;
    const o = {};
    DATE_KEYS.forEach((k) => { if (c[k]) o[k] = addDays(c[k], sh); });
    o.late_until = addDays(o.forum_date, LATE_DAYS);
    courses[c.code] = o;
  }
  const blFrom = addDays(courses.A2.online_from, -35); // the program baseline ran before cycle 1
  const pitchDay = courses.C1.forum_date;
  const capstoneDay = cat.program.capstone_day; // the War Room and graduation stay on their real December dates
  const cal = {
    courses,
    baseline: { wave: blFrom.slice(0, 7), open_from: blFrom, open_to: addDays(blFrom, 11) },
    // DEMO-M and DEMO-N joined late: a make-up window is open now, so testers can take the baseline.
    makeup: { wave: day(state.t0 - 3 * D).slice(0, 7), open_from: day(state.t0 - 3 * D), open_to: day(state.t0 + 10 * D) },
    pitch_deadline: addDays(pitchDay, -1), capstone_deadline: addDays(capstoneDay, -1),
  };
  calCache = { t0: state.t0, cal };
  return cal;
}

// ---------- state ----------
const VERSION = 2;
function blankUser(code, first_name, role_area, extra = {}) {
  return { code, first_name, role_area, is_manager: false, manager: 'DEMO-M', roles: ['learner'], pin: PIN, must_change_pin: false,
    consent_at: iso(now() - 30 * D), lang: 'en', certificate: '', fails: 0, locked_until: null, locks: [], sv: 1, baseline: 'program', ...extra };
}
async function seedState() {
  const items = await getBank();
  const t0 = now();
  const s = {
    version: VERSION, t0,
    users: {
      'DEMO-L': blankUser('DEMO-L', 'Linh', 'demand'),
      'DEMO-M': blankUser('DEMO-M', 'Minh', 'supply', { is_manager: true, manager: '', roles: ['learner', 'manager', 'panel'], baseline: 'makeup' }),
      'DEMO-N': blankUser('DEMO-N', 'An', 'cs', { must_change_pin: true, consent_at: null, baseline: 'makeup' }),
    },
    attempts: [], watched: {}, recall: [], unlocks: [], activity: {}, capstone: {}, panel: {}, seq: 0,
  };
  state = s; // calendar() reads state.t0
  const cal = calendar();
  const at = (dateStr, hhmm = '09:30') => Date.parse(`${dateStr}T${hhmm}:00+07:00`);
  const T = (n, hhmm) => at(day(t0 + n * D), hhmm); // n days from the seed day, at a fixed time
  const served = (pred) => items.filter(pred).map((i) => i.item_id);
  const answersFor = (ids, nCorrect) => Object.fromEntries(ids.map((id, i) => {
    const it = items.find((x) => x.item_id === id);
    return [id, i < nCorrect ? it.mockCorrect : 'abcd'.split('').find((x) => x !== it.mockCorrect)];
  }));
  const push = (a) => { s.attempts.push({ last_saved_at: a.submitted_at, ...a }); return a; };
  const pr = (code, course, ms) => push({ attempt_id: `MA-SEED-${code}-PR-${course}`, code, assessment: 'predict', course, form: 'PR', attempt_no: 1, status: 'submitted',
    started_at: iso(ms - 4 * 60000), submitted_at: iso(ms), served: served((i) => i.assessment === 'predict' && i.course === course), seed: 7, answers: {}, n_items: 3, n_correct: 1, score_pct: 33 });
  const cp = (code, course, form, no, nCorrect, ms) => {
    const ids = shuffle(served((i) => i.assessment === 'checkpoint' && i.course === course && i.form === form), hash(code + course + no));
    return push({ attempt_id: `MA-SEED-${code}-${course}-${no}`, code, assessment: 'checkpoint', course, form, attempt_no: no, status: 'submitted',
      started_at: iso(ms - 22 * 60000), submitted_at: iso(ms), served: ids, seed: hash(`${code}${course}${no}`), answers: answersFor(ids, nCorrect),
      n_items: 10, n_correct: nCorrect, score_pct: nCorrect * 10, passed: nCorrect >= 8 });
  };
  const recallRows = (code, course, passMs) => {
    const c = cal.courses[course];
    const baseDay = [c.forum_date, day(passMs)].sort().pop(); // F11: max(forum_date, pass date) + 2 / 7 / 30
    [2, 7, 30].forEach((d) => s.recall.push({ code, course, day: d, due_date: addDays(baseDay, d), status: 'pending', score_pct: null, attempt_id: '' }));
  };
  const rc = (code, course, d, nCorrect, ms) => {
    const r = s.recall.find((x) => x.code === code && x.course === course && x.day === d);
    const ids = served((i) => i.assessment === 'checkpoint' && i.course === course && i.form === 'B').slice(0, 3);
    const a = push({ attempt_id: `MA-SEED-${code}-RC-${course}-${d}`, code, assessment: 'recall', course, form: 'B', attempt_no: 1, status: 'submitted', day: d,
      started_at: iso(ms - 3 * 60000), submitted_at: iso(ms), served: ids, seed: 3, answers: answersFor(ids, nCorrect), n_items: 3, n_correct: nCorrect, score_pct: Math.round((100 * nCorrect) / 3) });
    Object.assign(r, { status: 'done', score_pct: a.score_pct, attempt_id: a.attempt_id });
  };

  // DEMO-L · Linh, a planner in cycle 2. Took the baseline inside its window, passed A2 before the
  // forum and did the day-2 recall; A3: two tries not yet passed, so a third needs a chat with Minh
  // (her manager); A1 is online now (Predict done, three episodes ticked).
  const L = 'DEMO-L';
  const blMs = at(addDays(cal.baseline.open_from, 2), '14:05');
  push({ attempt_id: 'MA-SEED-BL', code: L, assessment: 'baseline', course: '', form: 'BL', attempt_no: 1, status: 'submitted',
    started_at: iso(blMs - 52 * 60000), submitted_at: iso(blMs), served: [], seed: 1, answers: {},
    self: { A2: 2, A3: 1, A1: 2, P1: 1, C1: 2, P2: 1, P3: 1, P4: 2, P5: 1, P6: 3 },
    n_items: 46, n_correct: 22, score_pct: 48, by_course: { A2: 70, A3: 55, A1: 50, P1: 40, C1: 60, P2: 35, P3: 30, P4: 45, P5: 25, P6: 50 }, wave: cal.baseline.wave });
  pr(L, 'A2', at(addDays(cal.courses.A2.online_from, 1), '20:10'));
  pr(L, 'A3', at(addDays(cal.courses.A3.online_from, 2), '20:40'));
  cp(L, 'A3', 'B', 1, 7, T(-16, '10:15'));
  cp(L, 'A2', 'A', 1, 9, T(-14, '16:20'));
  recallRows(L, 'A2', T(-14));
  cp(L, 'A3', 'A', 2, 6, T(-12, '11:40'));
  rc(L, 'A2', 2, 2, at(addDays(cal.courses.A2.forum_date, 2), '08:50'));
  pr(L, 'A1', T(-3, '19:30'));
  s.watched[L] = { A2: [1, 2, 3, 4, 5, 6, 7, 8], A3: [1, 2, 3, 4, 5, 6], A1: [0, 1, 2] };
  s.activity[L] = [10, 7, 3, 1].map((w) => iso(T(-7 * w - 1, '20:00'))).concat([iso(T(-1, '21:00'))]);

  // DEMO-M · Minh, a manager who also learns: cycle 1 passed, A1 just started.
  const M = 'DEMO-M';
  pr(M, 'A2', at(addDays(cal.courses.A2.online_from, 3), '07:40'));
  pr(M, 'A3', at(addDays(cal.courses.A3.online_from, 3), '07:55'));
  cp(M, 'A2', 'B', 1, 8, T(-15, '08:10'));
  cp(M, 'A3', 'A', 1, 9, T(-14, '08:30'));
  recallRows(M, 'A2', T(-15)); recallRows(M, 'A3', T(-14));
  rc(M, 'A2', 2, 3, at(addDays(cal.courses.A2.forum_date, 2), '07:30'));
  rc(M, 'A3', 2, 2, at(addDays(cal.courses.A3.forum_date, 2), '07:45'));
  s.watched[M] = { A2: [1, 2, 3, 4, 5, 6, 7, 8], A3: [1, 2, 3, 4, 5, 6], A1: [0] };
  s.activity[M] = [5, 4, 2, 1].map((w) => iso(T(-7 * w - 2, '07:30')));

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
  await getCatalog();
  try { const raw = localStorage.getItem(STORE); if (raw) state = JSON.parse(raw); } catch (e) { state = null; }
  if (!state || state.version !== VERSION || !state.t0) { state = await seedState(); save(); }
  return state;
}
function save() { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* storage full or blocked */ } }
export function reset() { state = null; calCache = null; try { localStorage.removeItem(STORE); } catch (e) { /* ignore */ } }

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
const baselineWindow = (u) => (u && u.baseline === 'makeup' ? calendar().makeup : calendar().baseline);
const courseOpen = (code) => { const c = calendar().courses[code]; return !!c && day(now()) >= c.online_from; };

function expireBaseline(code) {
  for (const a of mine(code, (x) => x.assessment === 'baseline' && x.status === 'open')) {
    if (now() > Date.parse(a.started_at) + (BASELINE_MIN + 10) * 60000) gradeAttempt(a, a.answers, a.self, true);
  }
}

/** Mirrors backend checkpointState_: attempts, unlock accounting (F13), retake wait. */
function cpState(code, course) {
  const c = calendar().courses[course];
  const atts = mine(code, (a) => a.assessment === 'checkpoint' && a.course === course).sort((x, y) => x.attempt_no - y.attempt_no);
  const done = atts.filter((a) => a.status !== 'open');
  const open = atts.find((a) => a.status === 'open') || null;
  const passedA = done.find((a) => a.passed) || null;
  const last = done.slice().sort((x, y) => Date.parse(y.submitted_at) - Date.parse(x.submitted_at))[0] || null;
  const lateMs = dayEndMs(c.late_until);
  const rows = state.unlocks.filter((x) => x.code === code && x.course === course).length;
  const used = atts.filter((a) => a.attempt_no > MAX_FREE || Date.parse(a.started_at) > lateMs).length;
  const unused = Math.max(0, rows - used);
  const nextNo = done.length + 1;
  const t = now();
  const needsUnlock = !passedA && !open && nextNo > MAX_FREE && unused < 1;
  const gateClosed = !passedA && t > lateMs && unused < 1;
  return {
    c, atts, done, open, passedA, last, lateMs, unused, nextNo, needsUnlock, gateClosed,
    needsChat: !passedA && !open && (needsUnlock || gateClosed),
    status: passedA ? 'passed' : open ? 'in_progress' : done.length ? 'not_yet' : 'not_started',
  };
}

async function courseRows(code) {
  const cat = await getCatalog();
  const cal = calendar();
  const today = day(now());
  return cat.courses.slice().sort((a, b) => a.order - b.order).map((c) => {
    const d = cal.courses[c.code];
    const st = cpState(code, c.code);
    const prs = mine(code, (a) => a.assessment === 'predict' && a.course === c.code && a.status === 'submitted');
    const watched = (state.watched[code] && state.watched[code][c.code]) || [];
    const eps = (c.has_trailer ? [0] : []).concat(c.episodes.map((e) => e.ep));
    return {
      code: c.code, order: c.order, cycle: c.cycle, open: today >= d.online_from, online_from: d.online_from, checkpoint_close: d.checkpoint_close,
      forum_date: d.forum_date, field_until: d.field_until, late_until: d.late_until, blink_url: '',
      online_to: d.online_to, ...(d.prework_from ? { prework_from: d.prework_from } : {}), // demo extras: the shifted calendar
      episodes: eps.map((ep) => ({ ep, minutes: ep === 0 ? 1 : 5, blink_url: '', embed_url: '', watched: watched.includes(ep) })),
      predict: { done: prs.length > 0, attempts: prs.length, last_pct: prs.length ? prs[prs.length - 1].score_pct : null },
      checkpoint: {
        status: st.status, attempts: st.done.length, best_pct: st.done.length ? Math.max(...st.done.map((a) => a.score_pct)) : null,
        passed_at: st.passedA ? st.passedA.submitted_at : null,
        next_retake_at: st.status === 'not_yet' && st.last ? iso(Date.parse(st.last.submitted_at) + RETAKE_MS) : null,
        needs_unlock: st.needsUnlock, gate_closed: st.gateClosed,
        open_attempt_id: st.open ? st.open.attempt_id : null, last_attempt_id: st.last ? st.last.attempt_id : null,
      },
      recall: state.recall.filter((r) => r.code === code && r.course === c.code).sort((x, y) => x.day - y.day).map((r) => ({
        day: r.day, due_date: r.due_date, status: r.status === 'done' ? 'done' : (r.due_date <= today ? 'due' : 'upcoming'), score_pct: r.score_pct, attempt_id: r.attempt_id || null })),
    };
  });
}

// Weeks run Monday to Sunday in Vietnam time (as the backend's weekIndex7).
function weekIndex(ms) { return Math.floor((Date.parse(`${day(ms)}T00:00:00+07:00`) - Date.parse('1970-01-05T00:00:00+07:00')) / (7 * D)); }
function streakOf(code) {
  const stamps = (state.activity[code] || []).concat(mine(code, (a) => a.status === 'submitted' || a.status === 'expired').map((a) => a.submitted_at));
  const weeks = new Set(stamps.filter(Boolean).map((s) => weekIndex(Date.parse(s))));
  const cur = weekIndex(now());
  const activeNow = weeks.has(cur);
  let w = activeNow ? cur : cur - 1; let n = 0;
  while (weeks.has(w)) { n += 1; w -= 1; }
  const recent = Array.from({ length: 12 }, (_, i) => weeks.has(cur - 11 + i)); // oldest first, this week last
  return { current_weeks: n, active_this_week: activeNow, active_weeks_total: weeks.size, multiplier: Math.round(1.01 ** weeks.size * 100) / 100,
    weeks_total_program: 52, recent };
}
function touch(code) { (state.activity[code] = state.activity[code] || []).push(iso(now())); }

function baselineView(u) {
  const code = u.code;
  expireBaseline(code);
  const w = baselineWindow(u);
  const today = day(now());
  const a = mine(code, (x) => x.assessment === 'baseline' && x.wave === w.wave).sort((x, y) => Date.parse(y.started_at) - Date.parse(x.started_at))[0];
  const out = { ...w, window: today < w.open_from ? 'before' : today > w.open_to ? 'after' : 'open', status: 'not_started' };
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
    // F11: recall dates are max(forum_date, pass date) + 2 / 7 / 30 days.
    const forum = calendar().courses[a.course].forum_date;
    const baseDay = [forum, day(now())].sort().pop();
    [2, 7, 30].forEach((d) => state.recall.push({ code: a.code, course: a.course, day: d, due_date: addDays(baseDay, d), status: 'pending', score_pct: null, attempt_id: '' }));
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
  const c = calendar().courses[a.course];
  // Decision D5 (as tightened after the security review): the key is shown only once the learner has passed.
  const reveal = mine(a.code, (x) => x.assessment === 'checkpoint' && x.course === a.course && x.passed).length > 0;
  const weak = Object.entries(a.by_objective || {}).filter(([, v]) => v.correct < v.n).map(([k]) => Number(k)).sort((x, y) => x - y);
  const st = cpState(a.code, a.course);
  const recall = state.recall.filter((r) => r.code === a.code && r.course === a.course).map((r) => r.due_date);
  return {
    assessment: 'checkpoint', course: a.course, form: a.form, attempt_no: a.attempt_no, n_items: a.n_items, n_correct: a.n_correct, score_pct: a.score_pct,
    passed: !!a.passed, reveal, by_objective: a.by_objective, weak_objectives: weak,
    missed: reviewRows(a, items, reveal).filter((r) => !r.is_correct),
    next_retake_at: a.passed ? null : iso(Date.parse(a.submitted_at) + RETAKE_MS), needs_unlock: st.needsUnlock,
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
    // F2/F22: 5 wrong PINs lock the code (15, 30, 60 … min); the third lock in 7 days needs an admin (until: null).
    if (u.locked_until === 'admin') return fail('locked', null, { until: null });
    if (u.locked_until && now() < Date.parse(u.locked_until)) return fail('locked', null, { until: u.locked_until });
    if (String(p.pin || '') !== u.pin) {
      u.fails += 1;
      if (u.fails >= 5) {
        u.fails = 0;
        u.locks = (u.locks || []).filter((ms) => ms > now() - 7 * D).concat(now());
        if (u.locks.length >= 3) { u.locked_until = 'admin'; save(); return fail('locked', null, { until: null }); }
        u.locked_until = iso(now() + 15 * 2 ** (u.locks.length - 1) * 60000); save();
        return fail('locked', null, { until: u.locked_until });
      }
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
  async logout(p, u) { u.sv += 1; save(); return ok({}); },
  async consent(p, u) { u.consent_at = iso(now()); save(); return ok({ consent_at: u.consent_at }); },
  async set_lang(p, u) { if (['en', 'vi'].includes(p.lang)) { u.lang = p.lang; save(); } return ok({ lang: u.lang }); },
  async me(p, u) {
    const courses = await courseRows(u.code);
    const team = Object.values(TEAMS).find((tm) => tm.members.includes(u.code));
    const sub = team ? state.capstone[team.team_id] || {} : {};
    const passed = courses.filter((c) => c.checkpoint.status === 'passed').length;
    const out = ok({
      profile: profileOf(u), baseline: baselineView(u), courses,
      capstone: { team_id: team ? team.team_id : null, project_title: team ? team.project_title : null, pitch_submitted_at: sub.pitch ? sub.pitch.submitted_at : null,
        capstone_submitted_at: sub.capstone ? sub.capstone.submitted_at : null, pitch_deadline: calendar().pitch_deadline, capstone_deadline: calendar().capstone_deadline },
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
    if ((kind === 'predict' || kind === 'checkpoint') && !courseOpen(p.course)) return fail('not_open', null, { opens_at: calendar().courses[p.course].online_from });
    if (kind === 'baseline') expireBaseline(u.code);
    const openA = mine(u.code, (a) => a.status === 'open' && a.assessment === kind && (kind === 'baseline' || a.course === p.course) && (kind !== 'recall' || a.day === Number(p.day)))[0];
    let a = openA;
    if (!a) {
      let served; let form = 'PR'; let attemptNo = 1;
      if (kind === 'baseline') {
        const w = baselineWindow(u);
        if (mine(u.code, (x) => x.assessment === 'baseline' && x.wave === w.wave && x.status !== 'open').length) return fail('already_submitted');
        if (day(now()) < w.open_from || day(now()) > w.open_to) return fail('not_open', null, day(now()) < w.open_from ? { opens_at: w.open_from } : {});
        const partB = ORDER.flatMap((code, ci) => shuffle(items.filter((i) => i.assessment === 'baseline' && i.course === code && !i.case_id), hash(u.code) + ci));
        const partC = items.filter((i) => i.assessment === 'baseline' && i.case_id);
        served = partB.concat(partC).map((i) => i.item_id); form = 'BL';
      } else if (kind === 'predict') {
        served = items.filter((i) => i.assessment === 'predict' && i.course === p.course).map((i) => i.item_id);
        attemptNo = mine(u.code, (x) => x.assessment === 'predict' && x.course === p.course).length + 1;
      } else if (kind === 'checkpoint') {
        // Contract order (backend checkpointGate): already_passed → retake_too_soon → unlock_needed → gate_closed.
        const st = cpState(u.code, p.course);
        const prev = st.done;
        if (st.passedA) return fail('already_passed');
        const last = prev[prev.length - 1];
        if (last && now() < Date.parse(last.submitted_at) + RETAKE_MS) return fail('retake_too_soon', null, { next_retake_at: iso(Date.parse(last.submitted_at) + RETAKE_MS) });
        const overFree = st.nextNo > MAX_FREE;
        if ((overFree || now() > st.lateMs) && st.unused < 1) return fail(overFree ? 'unlock_needed' : 'gate_closed');
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
        wave: kind === 'baseline' ? baselineWindow(u).wave : '', day: kind === 'recall' ? Number(p.day) : null };
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
    const cal = calendar();
    const t = now();
    const courses = (vals) => Object.fromEntries(ORDER.map((c, i) => [c, vals(c, i)]));
    const base = (seed, n, group) => ({ group, n, courses: courses((c, i) => ({ self: Math.round((1 + ((seed + i * 7) % 20) / 10) * 10) / 10, pct: 30 + ((seed * 3 + i * 11) % 45) })) });
    // F21: a course's checkpoint rates appear only after its late window has closed.
    const published = (c) => t > dayEndMs(cal.courses[c].late_until);
    const cps = (group, n) => ({ group, n, courses: courses((c, i) => (published(c)
      ? { first_try_pass: 55 + ((i * 13 + n) % 40), passed_by_forum: 80 + ((i * 7 + n) % 21), n_first_try: n, n_by_forum: n }
      : { first_try_pass: null, passed_by_forum: null, n_first_try: 0, n_by_forum: 0 })) });
    const blPublished = day(t) > cal.baseline.open_to;
    return ok({ updated_at: iso(t - 2 * H), min_n: 3, wave: cal.baseline.wave, baseline_published: blPublished, baseline_publish_after: cal.baseline.open_to,
      baseline: blPublished ? [base(5, 18, 'all'), base(9, 6, 'demand'), base(3, 5, 'supply'), base(12, 4, 'cs')] : [],
      checkpoints: [cps('all', 18), cps('demand', 6), cps('supply', 5), cps('cs', 4)] });
  },
  async team_status(p, u) {
    if (!u.is_manager) return fail('forbidden');
    const me = state.users['DEMO-L'];
    const st = (code) => { const s2 = cpState(me.code, code); return s2.passedA ? 'passed' : s2.needsChat ? 'needs_chat' : s2.done.length ? 'not_yet' : 'not_started'; };
    const fake = (code, name, passed) => ({ code, first_name: name, baseline: 'done', courses: Object.fromEntries(ORDER.map((c) => [c, passed.includes(c) ? 'passed' : 'not_started'])) });
    return ok({ reports: [
      { code: me.code, first_name: me.first_name, baseline: mine(me.code, (a) => a.assessment === 'baseline' && a.status !== 'open').length ? 'done' : 'not_done', courses: Object.fromEntries(ORDER.map((c) => [c, st(c)])) },
      fake('DEMO-P1', 'Peer 1', ['A2', 'A3']), fake('DEMO-P2', 'Peer 2', ['A2', 'A3', 'A1']),
    ] });
  },
  // A manager records the 15-minute coaching chat; one Unlocks row = one more checkpoint attempt.
  async unlock_retake(p, u) {
    if (!u.is_manager) return fail('forbidden', 'Only managers can unlock a retake.');
    const code = String(p.code || '').trim().toUpperCase();
    const course = String(p.course || '').trim().toUpperCase();
    const rep = state.users[code];
    if (!rep || rep.code === u.code || rep.manager !== u.code || rep.is_manager) return fail('forbidden', 'You can unlock retakes only for your own team members.');
    if (!ORDER.includes(course)) return fail('bad_request', 'Unknown course', { field: 'course' });
    if (!cpState(code, course).needsChat) return fail('bad_request', 'This checkpoint does not need a coaching chat now.', { field: 'course' });
    const at = iso(now());
    state.unlocks.push({ code, course, unlocked_by: u.code, unlocked_at: at, note: String(p.note == null ? '' : p.note).trim().slice(0, 300) });
    save();
    return ok({ unlocked_at: at });
  },
  async capstone_get(p, u) {
    const team = Object.values(TEAMS).find((tm) => tm.members.includes(u.code));
    if (!team) return ok({ team: null, submissions: { pitch: null, capstone: null }, deadlines: { pitch: calendar().pitch_deadline, capstone: calendar().capstone_deadline } });
    const names = { 'DEMO-L': 'Linh', 'DEMO-M': 'Minh', 'DEMO-N': 'An', 'DEMO-X': 'Demo' };
    const sub = state.capstone[team.team_id] || {};
    return ok({ team: { team_id: team.team_id, project_title: team.project_title, members: team.members.map((c) => ({ code: c, first_name: names[c] || c })), sponsor: { code: team.sponsor, first_name: names[team.sponsor] } },
      submissions: { pitch: sub.pitch || null, capstone: sub.capstone || null }, deadlines: { pitch: calendar().pitch_deadline, capstone: calendar().capstone_deadline } });
  },
  async capstone_submit(p, u) {
    const team = TEAMS[p.team_id];
    if (!team || !team.members.includes(u.code)) return fail('forbidden');
    if (!['pitch', 'capstone'].includes(p.stage)) return fail('bad_request');
    const deadline = p.stage === 'pitch' ? calendar().pitch_deadline : calendar().capstone_deadline;
    if (now() > dayEndMs(deadline)) return fail('gate_closed', null, { deadline });
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
    return ok({ stage, teams: Object.values(TEAMS).map((tm) => ({ team_id: tm.team_id, project_title: tm.project_title, is_sponsor: tm.sponsor === u.code,
      submission: (state.capstone[tm.team_id] || {})[stage] || null, my_score: state.panel[`${tm.team_id}|${stage}|${u.code}`] || null })) });
  },
  async panel_score(p, u) {
    if (!u.roles.includes('panel') && !u.roles.includes('admin')) return fail('forbidden');
    const team = TEAMS[p.team_id];
    if (!team) return fail('not_found');
    if (team.members.includes(u.code)) return fail('forbidden', 'Judges do not score their own team');
    const sc = p.scores || {};
    if (['c1', 'c2', 'c3', 'c4', 'c5'].some((k) => !(Number(sc[k]) >= 1 && Number(sc[k]) <= 5))) return fail('bad_request', 'Five scores from 1 to 5 are required');
    const rec = { c1: Number(sc.c1), c2: Number(sc.c2), c3: Number(sc.c3), c4: Number(sc.c4), c5: Number(sc.c5), comment: String(p.comment || ''), scored_at: iso(now()) };
    state.panel[`${p.team_id}|${p.stage}|${u.code}`] = rec; save();
    return ok({ scored_at: rec.scored_at });
  },
};

const OPEN_ACTIONS = new Set(['login']);
const PIN_EXEMPT = new Set(['login', 'change_pin', 'me', 'logout']);
const CONSENT_EXEMPT = new Set(['login', 'change_pin', 'me', 'consent', 'set_lang', 'logout']);

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
    if (!u.consent_at && !CONSENT_EXEMPT.has(payload.action)) return fail('consent_required');
  }
  try { return await fn(payload, u); } catch (e) { console.error(e); return fail('server_error', String(e && e.message)); }
}
