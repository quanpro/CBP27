// Demo backend for the Hub (specs/20 "Demo mode", specs/22 §5 for the baseline). Runs in the browser;
// state lives in localStorage. Invented questions only: ids MOCK-001… (courses) and MOCK-BL-… (baseline);
// the keys are in `mockCorrect` / `mockMost` / `mockLeast` (plus step, move, gate, level and charter)
// and are stripped before any item reaches page code. No real item text, names or codes appear here.

const STORE = 'hub.mock.v1';
const PIN = '270127';
const RETAKE_MS = 60 * 1000; // demo: 1 minute instead of 24 h
const SESSION_MS = 6 * 3600 * 1000;
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
const ORDER = ['A1', 'A2', 'A3', 'C1', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6']; // courses.json order (A1 opens the year)
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
    const label = { predict: ['Predict', 'Dự đoán'], checkpoint: ['Checkpoint', 'Checkpoint'] }[assessment];
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
  }
  bank = items;
  return bank;
}

// ---------- demo calendar ----------
// The real 2027 calendar (courses.json) moved so that the day the demo was seeded sits in cycle 3:
// cycles 1–2 (A1, then A2 + A3) are behind, the A2 + A3 forum was 9 days earlier (its late week has
// closed), C1 + P1 have been online for 4 days and P2 … P6 open later on real-looking dates. The
// offline sessions move with their courses; Pitch Day moves with cycle 3 on; the War Room keeps its
// real December date. Recall dates and the capstone deadlines follow from these dates, so everything
// the demo shows adds up. The baseline has no dates: its parts open by switch.
const DATE_KEYS = ['online_from', 'online_to', 'checkpoint_close', 'forum_date', 'field_until'];
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
  const shift1 = diffDays(addDays(base, -9), find('A2').forum_date); // cycles 1–2: the A2 + A3 forum 9 days before the seed
  const shift2 = diffDays(addDays(base, -4), find('P1').online_from); // cycle 3 on: C1 + P1 online 4 days before
  const shiftOf = (code) => ((find(code) || {}).cycle <= 2 ? shift1 : shift2);
  const courses = {};
  for (const c of cat.courses) {
    const sh = shiftOf(c.code);
    const o = {};
    DATE_KEYS.forEach((k) => { if (c[k]) o[k] = addDays(c[k], sh); });
    o.late_until = addDays(o.forum_date, LATE_DAYS);
    courses[c.code] = o;
  }
  const sessions = (cat.program.sessions || []).map((x) => ({
    date: x.kind === 'warroom' ? x.date : addDays(x.date, x.courses.length ? shiftOf(x.courses[0]) : shift2),
    kind: x.kind, courses: x.courses.slice(), title_en: x.title_en, title_vi: x.title_vi, start: x.start || '', end: x.end || '',
    place: x.kind === 'warroom' ? 'Demo: the War Room venue' : 'Demo: the training room', note_en: '', note_vi: '',
  })).sort((a, b) => (a.date < b.date ? -1 : 1));
  const pitchDay = (sessions.find((x) => x.kind === 'pitch') || {}).date || addDays(cat.program.pitch_day, shift2);
  const capstoneDay = cat.program.capstone_day; // the War Room and graduation stay on their real December dates
  const cal = {
    courses, sessions,
    pitch_deadline: addDays(pitchDay, -1), capstone_deadline: addDays(capstoneDay, -1),
  };
  calCache = { t0: state.t0, cal };
  return cal;
}

// ---------- state ----------
const VERSION = 4; // 4: A1 opens the year, sessions; 3: baseline v2 (three parts, manager rating, profile); older demo state is replaced
function blankUser(code, first_name, role_area, extra = {}) {
  return { code, first_name, role_area, is_manager: false, manager: 'DEMO-M', roles: ['learner'], pin: PIN, must_change_pin: false,
    consent_at: iso(now() - 30 * D), lang: 'en', certificate: '', fails: 0, locked_until: null, locks: [], sv: 1, ...extra };
}
async function seedState() {
  const items = await getBank();
  const cat = await getCatalog();
  const t0 = now();
  const s = {
    version: VERSION, t0,
    users: {
      'DEMO-L': blankUser('DEMO-L', 'Linh', 'demand'),
      'DEMO-M': blankUser('DEMO-M', 'Minh', 'supply', { is_manager: true, manager: '', roles: ['learner', 'manager', 'panel'] }),
      'DEMO-N': blankUser('DEMO-N', 'An', 'cs', { must_change_pin: true, consent_at: null }),
    },
    attempts: [], watched: {}, recall: [], unlocks: [], activity: {}, capstone: {}, panel: {}, seq: 0,
    bl: { wave: BL_WAVE, p1_open: true, p2_open: true, p3_open: true, rating_open: true, results_open: true },
    ratings: {}, // `${rater}|${ratee}` → { values: {item_id: 1..4|"NA"}, saved_at } (manager form)
    selfRatings: {}, // code → { item_id: 1..4|"NR" } (Part 2B, written at submit)
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

  const allEps = (code) => { const c = cat.courses.find((x) => x.code === code); return (c.has_trailer ? [0] : []).concat(c.episodes.map((e) => e.ep)); };
  const passA1 = (code, form, hhmm) => {
    const ms = at(addDays(cal.courses.A1.checkpoint_close, -2), hhmm);
    pr(code, 'A1', at(addDays(cal.courses.A1.online_from, 1), hhmm));
    cp(code, 'A1', form, 1, 9, ms);
    recallRows(code, 'A1', ms);
    [2, 7, 30].forEach((d) => rc(code, 'A1', d, 3, at(addDays(cal.courses.A1.forum_date, d), hhmm)));
  };

  // DEMO-L · Linh, a planner in cycle 3. Has done all three baseline parts (results are open, so her
  // profile shows) and Minh has rated her. A1 passed with every recall done; passed A2 before the
  // forum and did the day-2 recall (day 7 is due); A3: two tries not yet passed, so a third needs a
  // chat with Minh (her manager); P1 is online now (Predict done, three episodes ticked).
  const L = 'DEMO-L';
  seedBaselineL(s, T);
  passA1(L, 'B', '20:05');
  pr(L, 'A2', at(addDays(cal.courses.A2.online_from, 1), '20:10'));
  pr(L, 'A3', at(addDays(cal.courses.A3.online_from, 2), '20:40'));
  cp(L, 'A3', 'B', 1, 7, T(-16, '10:15'));
  cp(L, 'A2', 'A', 1, 9, T(-14, '16:20'));
  recallRows(L, 'A2', T(-14));
  cp(L, 'A3', 'A', 2, 6, T(-12, '11:40'));
  rc(L, 'A2', 2, 2, at(addDays(cal.courses.A2.forum_date, 2), '08:50'));
  pr(L, 'P1', T(-3, '19:30'));
  s.watched[L] = { A1: allEps('A1'), A2: [1, 2, 3, 4, 5, 6, 7, 8], A3: [1, 2, 3, 4, 5, 6], P1: [0, 1, 2] };
  s.activity[L] = [10, 7, 3, 1].map((w) => iso(T(-7 * w - 1, '20:00'))).concat([iso(T(-1, '21:00'))]);

  // DEMO-M · Minh, a manager who also learns: cycles 1 and 2 passed, P1 just started.
  const M = 'DEMO-M';
  passA1(M, 'A', '07:20');
  pr(M, 'A2', at(addDays(cal.courses.A2.online_from, 3), '07:40'));
  pr(M, 'A3', at(addDays(cal.courses.A3.online_from, 3), '07:55'));
  cp(M, 'A2', 'B', 1, 8, T(-15, '08:10'));
  cp(M, 'A3', 'A', 1, 9, T(-14, '08:30'));
  recallRows(M, 'A2', T(-15)); recallRows(M, 'A3', T(-14));
  rc(M, 'A2', 2, 3, at(addDays(cal.courses.A2.forum_date, 2), '07:30'));
  rc(M, 'A3', 2, 2, at(addDays(cal.courses.A3.forum_date, 2), '07:45'));
  s.watched[M] = { A1: allEps('A1'), A2: [1, 2, 3, 4, 5, 6, 7, 8], A3: [1, 2, 3, 4, 5, 6], P1: [0] };
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
const courseOpen = (code) => { const c = calendar().courses[code]; return !!c && day(now()) >= c.online_from; };

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
      online_to: d.online_to,
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
function gradeAttempt(a, answers, expired = false) {
  const items = bank;
  a.answers = answers || {};
  let n = 0;
  const byObj = {};
  for (const id of a.served) {
    const it = items.find((x) => x.item_id === id);
    const right = a.answers[id] === it.mockCorrect;
    if (right) n += 1;
    const o = (byObj[it.objective] = byObj[it.objective] || { n: 0, correct: 0 }); o.n += 1; if (right) o.correct += 1;
  }
  a.n_items = a.served.length; a.n_correct = n; a.score_pct = Math.round((100 * n) / Math.max(1, a.served.length));
  a.by_objective = byObj;
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

// ---------- Baseline v2 (specs/22): three parts, manager rating, profile ----------
// Invented content only (MOCK-BL-… ids, generic planning wording). Demo timers: P1 10, P2 6, P3 8 min.
const BL_WAVE = '2026-11';
const BL_KINDS = ['baseline_p1', 'baseline_p2', 'baseline_p3'];
const BL_MIN = { 1: 10, 2: 6, 3: 8 };
const BL_GRACE_MIN = 5;
const P1_LIVE = ['B', 'C'];
const W_SJT = 0.5; const W_MGR = 0.5;
const MODULE_OF = { demand: 'DP', supply: 'SP', materials: 'RPM', cs: 'CS' };
const BL_MOVES = ['ASK', 'SHAPE', 'SIZE', 'CHECK', 'SO WHAT'];
const BL_LEVELS = ['BA', 'WK', 'FO', 'LE'];
const BL_GATES = ['Data ready', 'Demand review', 'Supply review', 'Decision'];
const BL_TXT = {
  p1_title: ['Part 1 · Problem solving with data (demo)', 'Phần 1 · Giải quyết vấn đề bằng dữ liệu (demo)'],
  p1_intro: ['Two short cases with exhibits, then logic questions. (demo)', 'Hai tình huống ngắn kèm bảng số liệu, sau đó là các câu hỏi logic. (demo)'],
  p2_title: ['Part 2 · Leadership behaviours (demo)', 'Phần 2 · Hành vi lãnh đạo (demo)'],
  p2_intro: ['Scenarios first, then statements about your own behaviour. (demo)', 'Các tình huống trước, sau đó là các nhận định về hành vi của bạn. (demo)'],
  p3_title: ['Part 3 · Core planning (demo)', 'Phần 3 · Hoạch định cốt lõi (demo)'],
  p1_sec_A: ['Section A · Case questions', 'Mục A · Câu hỏi tình huống'],
  p1_sec_B: ['Section B · Logic questions', 'Mục B · Câu hỏi tư duy logic'],
  p1_sec_B_intro: ['Short questions on reasoning with numbers. No exhibits needed. (demo)', 'Các câu hỏi ngắn về suy luận với con số. Không cần bảng số liệu. (demo)'],
  p1_case_C1: ['Case 1 · The slow mover (demo)', 'Tình huống 1 · Mã hàng bán chậm (demo)'],
  p1_case_C2: ['Case 2 · The busy line (demo)', 'Tình huống 2 · Dây chuyền quá tải (demo)'],
  p2_sec_SJT: ['2A · What would you do?', '2A · Bạn sẽ làm gì?'],
  p2_sec_SJT_intro: ['For each scenario, pick the most effective and the least effective response. (demo)', 'Với mỗi tình huống, chọn cách phản hồi hiệu quả nhất và kém hiệu quả nhất. (demo)'],
  p2_sec_RATE: ['2B · How often do you do this?', '2B · Bạn làm điều này thường xuyên đến đâu?'],
  p2_sec_RATE_intro: ['Rate how often you show each behaviour today, from 1 (rarely) to 4 (almost always). (demo)', 'Chấm mức độ thường xuyên bạn thể hiện mỗi hành vi hiện nay, từ 1 (hiếm khi) đến 4 (gần như luôn luôn). (demo)'],
  p3_intro: ['Core planning questions first, then your role module. The KPI glossary is always one tap away. (demo)', 'Các câu hỏi hoạch định cốt lõi trước, sau đó là phần theo vai trò của bạn. Bảng thuật ngữ KPI luôn sẵn một chạm. (demo)'],
  p3_sec_CORE: ['Core · S&OP basics', 'Cốt lõi · Nền tảng S&OP'],
  p3_sec_DP: ['Module · Demand planning', 'Phần vai trò · Demand planning'],
  p3_sec_SP: ['Module · Supply planning', 'Phần vai trò · Supply planning'],
  p3_sec_RPM: ['Module · Materials planning', 'Phần vai trò · Materials planning'],
  p3_sec_CS: ['Module · Customer service', 'Phần vai trò · Customer service'],
};
const BL_CHARTERS = {
  1: ['Owns outcomes (demo)', 'Làm chủ kết quả (demo)'],
  2: ['Works across teams (demo)', 'Phối hợp liên phòng ban (demo)'],
  3: ['Decides with data (demo)', 'Quyết định bằng dữ liệu (demo)'],
  4: ['Grows people (demo)', 'Phát triển con người (demo)'],
  5: ['Keeps it simple (demo)', 'Giữ mọi việc đơn giản (demo)'],
  QWS: ['Ways of working (demo)', 'Cách làm việc (demo)'],
};
const BL_EXHIBITS = {
  'MOCK-BL-EX1': {
    title_en: 'Exhibit 1 · Forecast and sales, six SKUs, last 4 weeks (demo)',
    title_vi: 'Bảng 1 · Forecast và doanh số, sáu SKU, 4 tuần gần nhất (demo)',
    md_en: '| SKU | Forecast (cases) | Sales (cases) | Stock cover (weeks) |\n|---|---|---|---|\n| SKU-01 | 1,200 | 1,050 | 3.1 |\n| SKU-02 | 800 | 910 | 1.4 |\n| SKU-03 | 450 | 210 | 9.8 |\n| SKU-04 | 2,000 | 1,960 | 2.2 |\n| SKU-05 | 300 | 330 | 1.9 |\n| SKU-06 | 650 | 400 | 6.5 |\n\nAll numbers are invented for the demo.',
    md_vi: '| SKU | Forecast (thùng) | Doanh số (thùng) | Số tuần tồn kho |\n|---|---|---|---|\n| SKU-01 | 1.200 | 1.050 | 3,1 |\n| SKU-02 | 800 | 910 | 1,4 |\n| SKU-03 | 450 | 210 | 9,8 |\n| SKU-04 | 2.000 | 1.960 | 2,2 |\n| SKU-05 | 300 | 330 | 1,9 |\n| SKU-06 | 650 | 400 | 6,5 |\n\nMọi con số đều là số giả định cho bản demo.',
  },
  'MOCK-BL-EX2': {
    title_en: 'Exhibit 2 · Line plan, next week (demo)',
    title_vi: 'Bảng 2 · Kế hoạch dây chuyền, tuần tới (demo)',
    md_en: '- Weekly capacity: 4,800 cases\n- Planned output: 4,350 cases\n- Changeovers planned: 6\n- Frozen zone: 2 weeks\n- Target fill rate: 95%\n\n**Note:** a changeover costs about *3 hours* of output.',
    md_vi: '- Công suất tuần: 4.800 thùng\n- Sản lượng kế hoạch: 4.350 thùng\n- Số lần chuyển đổi: 6\n- Vùng đóng băng: 2 tuần\n- Fill rate mục tiêu: 95%\n\n**Lưu ý:** mỗi lần chuyển đổi tốn khoảng *3 giờ* sản lượng.',
  },
};
const BL_GLOSSARY = [
  ['Fill rate: cases shipped ÷ cases ordered (demo definition).', 'Fill rate: số thùng đã giao ÷ số thùng được đặt (định nghĩa demo).'],
  ['Forecast accuracy: 1 − |sales − forecast| ÷ sales (demo definition).', 'Forecast accuracy: 1 − |doanh số − forecast| ÷ doanh số (định nghĩa demo).'],
  ['Stock cover: stock ÷ average weekly demand, in weeks (demo definition).', 'Số tuần tồn kho: tồn kho ÷ nhu cầu trung bình mỗi tuần (định nghĩa demo).'],
];
const SJT_OPTS = [
  ['The most effective response (demo)', 'Cách phản hồi hiệu quả nhất (demo)'],
  ['A reasonable response (demo)', 'Một cách phản hồi khá ổn (demo)'],
  ['A weak response (demo)', 'Một cách phản hồi còn yếu (demo)'],
  ['The least effective response (demo)', 'Cách phản hồi kém hiệu quả nhất (demo)'],
];
const SJT_STEMS = [
  ['Demo scenario 1. A colleague in sales asks for your plan numbers one day before the monthly review.', 'Tình huống demo 1. Một đồng nghiệp bên sales xin số liệu kế hoạch của bạn một ngày trước buổi họp tháng.'],
  ['Demo scenario 2. You notice a mistake in last week\'s plan that nobody else has spotted.', 'Tình huống demo 2. Bạn phát hiện một lỗi trong kế hoạch tuần trước mà chưa ai nhận ra.'],
  ['Demo scenario 3. Two teams give you different numbers for the same SKU.', 'Tình huống demo 3. Hai bộ phận đưa cho bạn hai con số khác nhau cho cùng một SKU.'],
  ['Demo scenario 4. A new team member keeps asking you the same question.', 'Tình huống demo 4. Một thành viên mới cứ hỏi bạn cùng một câu hỏi.'],
];
const BL_RATINGS = [
  { charter: '1', self: ['I say what I will deliver and by when, and flag early if it slips. (demo)', 'Tôi nói rõ mình sẽ làm gì và khi nào xong, và báo sớm nếu bị trễ. (demo)'],
    mgr: ['Says what they will deliver and by when, and flags early if it slips. (demo)', 'Nói rõ sẽ làm gì và khi nào xong, và báo sớm nếu bị trễ. (demo)'],
    a1: ['Commitments are vague; delays come as a surprise.', 'Cam kết mơ hồ; chậm trễ thường bất ngờ.'], a4: ['Clear commitments; early warning every time.', 'Cam kết rõ ràng; luôn báo trước khi có rủi ro.'] },
  { charter: '1', self: ['I follow an issue through to the fix, not just the report. (demo)', 'Tôi theo một vấn đề đến khi được khắc phục, không chỉ dừng ở báo cáo. (demo)'],
    mgr: ['Follows an issue through to the fix, not just the report. (demo)', 'Theo một vấn đề đến khi được khắc phục, không chỉ dừng ở báo cáo. (demo)'],
    a1: ['Reports the issue and moves on.', 'Báo cáo vấn đề rồi chuyển sang việc khác.'], a4: ['Owns it until it is fixed and checked.', 'Theo đến khi vấn đề được xử lý và kiểm tra lại.'] },
  { charter: '2', nr: true, self: ['I bring sales and supply colleagues together before a decision. (demo)', 'Tôi kết nối đồng nghiệp sales và supply trước khi ra quyết định. (demo)'],
    mgr: ['Brings sales and supply colleagues together before a decision. (demo)', 'Kết nối đồng nghiệp sales và supply trước khi ra quyết định. (demo)'],
    a1: ['Decides alone, then informs others.', 'Tự quyết rồi mới thông báo.'], a4: ['Gets the right people in the room first.', 'Mời đúng người cùng bàn trước.'] },
  { charter: '2', self: ['I share my numbers and assumptions openly with other teams. (demo)', 'Tôi chia sẻ số liệu và giả định của mình một cách cởi mở với các bộ phận khác. (demo)'],
    mgr: ['Shares their numbers and assumptions openly with other teams. (demo)', 'Chia sẻ số liệu và giả định một cách cởi mở với các bộ phận khác. (demo)'],
    a1: ['Keeps numbers to themselves.', 'Giữ số liệu cho riêng mình.'], a4: ['Numbers and assumptions are always visible.', 'Số liệu và giả định luôn minh bạch.'] },
  { charter: '3', self: ['I check the data before I act on it. (demo)', 'Tôi kiểm tra dữ liệu trước khi hành động. (demo)'],
    mgr: ['Checks the data before acting on it. (demo)', 'Kiểm tra dữ liệu trước khi hành động. (demo)'],
    a1: ['Acts on the first number seen.', 'Hành động theo con số đầu tiên nhìn thấy.'], a4: ['Always checks source and size first.', 'Luôn kiểm tra nguồn và độ lớn trước.'] },
  { charter: '3', self: ['I lead with the answer, then the evidence. (demo)', 'Tôi nói kết luận trước, rồi mới đến bằng chứng. (demo)'],
    mgr: ['Leads with the answer, then the evidence. (demo)', 'Nói kết luận trước, rồi mới đến bằng chứng. (demo)'],
    a1: ['Walks through every detail first.', 'Kể hết chi tiết trước.'], a4: ['One clear answer, backed by the right numbers.', 'Một kết luận rõ ràng, có đúng số liệu chứng minh.'] },
];
const RATE_POINTS = [[1, 'Rarely', 'Hiếm khi'], [2, 'Sometimes', 'Đôi khi'], [3, 'Often', 'Thường xuyên'], [4, 'Almost always', 'Gần như luôn luôn']];
const RATE_NR = { en: 'Not part of my role', vi: 'Không thuộc vai trò của tôi' };
const RATE_NA = { en: 'N/A – not observed', vi: 'Không áp dụng – chưa quan sát' };
const RATER_GUIDE = {
  en: '**Before you rate** (demo guide)\n\nRate what you have *seen* this person do over the last six months, not what you expect from them.\n\n1. Read each statement and its two anchors.\n2. Pick 1–4 for how often you see the behaviour.\n3. Choose **N/A – not observed** when you have not had the chance to see it.\n\nYour ratings are saved as you go and stay editable while rating is open. The learner sees averages by charter only, never a single rating.',
  vi: '**Trước khi chấm** (hướng dẫn demo)\n\nHãy chấm những gì bạn đã *thấy* người này làm trong sáu tháng qua, không phải điều bạn kỳ vọng.\n\n1. Đọc từng nhận định và hai mô tả mốc của nó.\n2. Chọn 1–4 theo mức độ bạn thấy hành vi đó.\n3. Chọn **Không áp dụng – chưa quan sát** khi bạn chưa có dịp thấy hành vi đó.\n\nĐiểm được lưu liên tục và bạn vẫn sửa được trong thời gian mở chấm. Người được chấm chỉ thấy điểm trung bình theo nhóm hành vi, không bao giờ thấy từng điểm riêng.',
};
const BL_GAP_NAMES = {
  p1_A: ['Part 1 · Case questions (Section A)', 'Phần 1 · Câu hỏi tình huống (Mục A)'],
  p1_B: ['Part 1 · Logic questions (Section B)', 'Phần 1 · Câu hỏi logic (Mục B)'],
  p3_core: ['Part 3 · Core planning', 'Phần 3 · Hoạch định cốt lõi'],
  p3_mod: ['Part 3 · Your role module', 'Phần 3 · Phần theo vai trò'],
};

let blBankCache = null;
function blBank() {
  if (blBankCache) return blBankCache;
  const items = [];
  const mcq = (o) => {
    const correct = 'abcd'[hash(o.item_id) % 4];
    const others = 'abcd'.split('').filter((x) => x !== correct);
    const options = [{ id: correct, en: OPTS[0][0], vi: OPTS[0][1] }].concat(others.map((oid, i) => ({ id: oid, en: OPTS[i + 1][0], vi: OPTS[i + 1][1] })));
    options.sort((x, y) => x.id.localeCompare(y.id));
    items.push({ type: 'mcq', module: '', case_id: '', exhibit_ids: [], ...o, options, mockCorrect: correct });
  };
  const stem = (en, vi) => ({
    stem_en: `${en} In the live Hub this is a real planning question; here, pick “${OPTS[0][0]}”.`,
    stem_vi: `${vi} Trên Hub thật đây là một câu hỏi hoạch định thực tế; ở đây, hãy chọn “${OPTS[0][1]}”.`,
  });
  ['A', 'B', 'C'].forEach((form) => {
    for (let i = 1; i <= 6; i += 1) {
      const caseId = i <= 3 ? 'C1' : 'C2';
      const ex = caseId === 'C1' ? ['MOCK-BL-EX1'] : (i === 6 ? ['MOCK-BL-EX2', 'MOCK-BL-EX1'] : ['MOCK-BL-EX2']);
      mcq({ item_id: `MOCK-BL-1${form}-A${i}`, part: 1, section: 'A', form, order: i, case_id: caseId, exhibit_ids: ex, step: String(((i - 1) % 7) + 1), move: BL_MOVES[(i - 1) % 5],
        ...stem(`Demo case question ${i} · form ${form}. Use the exhibit.`, `Câu hỏi tình huống demo ${i} · đề ${form}. Dùng bảng số liệu.`) });
    }
    for (let i = 1; i <= 6; i += 1) {
      mcq({ item_id: `MOCK-BL-1${form}-B${i}`, part: 1, section: 'B', form, order: 6 + i, step: String(((i + 3) % 7) + 1), move: BL_MOVES[(i + 1) % 5],
        ...stem(`Demo logic question ${i} · form ${form}.`, `Câu hỏi logic demo ${i} · đề ${form}.`) });
    }
  });
  SJT_STEMS.forEach(([en, vi], k) => {
    const id = `MOCK-BL-2S${k + 1}`;
    const ids = shuffle('abcd'.split(''), hash(id));
    const options = SJT_OPTS.map((o, j) => ({ id: ids[j], en: o[0], vi: o[1] })).sort((x, y) => x.id.localeCompare(y.id));
    items.push({ item_id: id, part: 2, section: 'SJT', type: 'sjt', form: 'ONE', order: k + 1, charter: String(k + 1), options, mockMost: ids[0], mockLeast: ids[3],
      stem_en: `${en} In the live Hub this is a real workplace scenario.`, stem_vi: `${vi} Trên Hub thật đây là một tình huống công việc thực tế.` });
  });
  BL_RATINGS.forEach((r, k) => items.push({ item_id: `MOCK-BL-2R${k + 1}`, part: 2, section: 'RATE', type: 'rating', form: 'ONE', order: k + 1, charter: r.charter, allow_nr: !!r.nr,
    self_en: r.self[0], self_vi: r.self[1], mgr_en: r.mgr[0], mgr_vi: r.mgr[1], anchor1_en: r.a1[0], anchor1_vi: r.a1[1], anchor4_en: r.a4[0], anchor4_vi: r.a4[1] }));
  for (let i = 1; i <= 3; i += 1) {
    mcq({ item_id: `MOCK-BL-3CORE${i}`, part: 3, section: 'CORE', form: 'ONE', order: i, exhibit_ids: i === 3 ? ['MOCK-BL-EX1'] : [], level: BL_LEVELS[i - 1], gate: BL_GATES[i - 1],
      ...stem(`Demo core question ${i}.`, `Câu hỏi cốt lõi demo ${i}.`) });
  }
  ['DP', 'SP', 'RPM', 'CS'].forEach((m) => {
    for (let i = 1; i <= 4; i += 1) {
      mcq({ item_id: `MOCK-BL-3${m}${i}`, part: 3, section: 'MOD', module: m, form: 'ONE', order: i, level: BL_LEVELS[i - 1], gate: BL_GATES[i % 4],
        ...stem(`Demo ${m} module question ${i}.`, `Câu hỏi demo phần ${m} số ${i}.`) });
    }
  });
  blBankCache = items;
  return items;
}
const blItem = (id) => blBank().find((i) => i.item_id === id);
const blSecOrder = { A: 0, B: 1, SJT: 0, RATE: 1, CORE: 0, MOD: 1 };
function blServedIds(part, form, module) {
  return blBank().filter((i) => i.part === part && (part !== 1 || i.form === form) && (part !== 3 || i.section === 'CORE' || i.module === module))
    .sort((x, y) => (blSecOrder[x.section] - blSecOrder[y.section]) || (x.order - y.order)).map((i) => i.item_id);
}
const blAtts = (code, part) => mine(code, (a) => a.assessment === `baseline_p${part}` && a.wave === state.bl.wave && a.status !== 'void');
const blDone = (a) => a && (a.status === 'submitted' || a.status === 'expired');
const blModule = (u) => u.p3_module || MODULE_OF[u.role_area] || 'DP';
const isRater = (u) => u.roles.includes('manager') || u.roles.includes('admin');
const blRateItems = () => blBank().filter((i) => i.type === 'rating');

/** Part 1 form: the live form with fewer starts in the same role_area this wave; tie → hash(code + wave). */
function blForm(u) {
  const starts = (f) => state.attempts.filter((a) => a.assessment === 'baseline_p1' && a.wave === state.bl.wave && a.status !== 'void' && a.form === f
    && (state.users[a.code] || {}).role_area === u.role_area).length;
  const [x, y] = P1_LIVE;
  const sx = starts(x); const sy = starts(y);
  if (sx !== sy) return sx < sy ? x : y;
  return P1_LIVE[hash(u.code + state.bl.wave) % 2];
}
function blExpire(code) {
  for (const a of mine(code, (x) => BL_KINDS.includes(x.assessment) && x.status === 'open')) {
    if (now() > Date.parse(a.deadline_at) + BL_GRACE_MIN * 60000) blGrade(a, true);
  }
}

function blServe(it, seed) {
  if (it.type === 'rating') {
    return { item_id: it.item_id, type: 'rating', text_en: it.self_en, text_vi: it.self_vi, anchor1_en: it.anchor1_en, anchor1_vi: it.anchor1_vi,
      anchor4_en: it.anchor4_en, anchor4_vi: it.anchor4_vi, allow_nr: !!it.allow_nr };
  }
  const options = shuffle(it.options.map((o) => ({ id: o.id, en: o.en, vi: o.vi })), seed + hash(it.item_id));
  if (it.type === 'sjt') return { item_id: it.item_id, type: 'sjt', stem_en: it.stem_en, stem_vi: it.stem_vi, options };
  return { item_id: it.item_id, type: 'mcq', section: it.section, case_id: it.case_id, exhibit_ids: it.exhibit_ids.slice(), stem_en: it.stem_en, stem_vi: it.stem_vi, options };
}
function blSection(a, id, title, intro, list, locked = false) {
  return { id, title_en: title[0], title_vi: title[1], intro_en: intro ? intro[0] : '', intro_vi: intro ? intro[1] : '', locked, items: list.map((it) => blServe(it, a.seed)) };
}
const blRateSection = (a, items) => blSection(a, 'RATE', BL_TXT.p2_sec_RATE, BL_TXT.p2_sec_RATE_intro, items);
function blStartOut(a, resumed, cat) {
  const items = a.served.map(blItem);
  const out = { attempt_id: a.attempt_id, assessment: a.assessment, part: a.part, form: a.form, module: a.module, started_at: a.started_at, deadline_at: a.deadline_at,
    time_limit_min: BL_MIN[a.part], resumed, answers: clone(a.answers || {}),
    title_en: BL_TXT[`p${a.part}_title`][0], title_vi: BL_TXT[`p${a.part}_title`][1], intro_en: BL_TXT[`p${a.part}_intro`][0], intro_vi: BL_TXT[`p${a.part}_intro`][1] };
  if (a.part === 1) {
    out.sections = [
      blSection(a, 'A', BL_TXT.p1_sec_A, null, items.filter((i) => i.section === 'A')),
      blSection(a, 'B', BL_TXT.p1_sec_B, BL_TXT.p1_sec_B_intro, items.filter((i) => i.section === 'B')),
    ];
    out.cases = { C1: { title_en: BL_TXT.p1_case_C1[0], title_vi: BL_TXT.p1_case_C1[1] }, C2: { title_en: BL_TXT.p1_case_C2[0], title_vi: BL_TXT.p1_case_C2[1] } };
  } else if (a.part === 2) {
    const locked = (a.locked || []).includes('SJT');
    out.sections = [
      blSection(a, 'SJT', BL_TXT.p2_sec_SJT, BL_TXT.p2_sec_SJT_intro, items.filter((i) => i.type === 'sjt'), locked),
      blRateSection(a, locked ? items.filter((i) => i.type === 'rating') : []),
    ];
    out.rating_scale = { points: RATE_POINTS.map(([v, en, vi]) => ({ v, en, vi })), nr: clone(RATE_NR) };
  } else {
    out.sections = [
      blSection(a, 'CORE', BL_TXT.p3_sec_CORE, null, items.filter((i) => i.section === 'CORE')),
      blSection(a, 'MOD', BL_TXT[`p3_sec_${a.module}`] || BL_TXT.p3_sec_DP, null, items.filter((i) => i.section === 'MOD')),
    ];
    out.glossary = { en: BL_GLOSSARY.map((g) => g[0]), vi: BL_GLOSSARY.map((g) => g[1]) };
    out.self_ratings = clone(a.self || {});
    out.self = cat.courses.slice().sort((x, y) => x.order - y.order).map((c) => ({ course: c.code, en: c.self_en, vi: c.self_vi }));
    out.scale = cat.scale.map((s) => ({ level: s.level, en: `${s.level} · ${s.en}${s.abbr ? ` (${s.abbr})` : ''}`, vi: `${s.level} · ${s.vi}${s.abbr ? ` (${s.abbr})` : ''}`, desc_en: s.desc_en, desc_vi: s.desc_vi }));
  }
  if (a.part !== 2) {
    const ids = new Set(items.flatMap((i) => i.exhibit_ids || []));
    out.exhibits = Object.fromEntries([...ids].filter((id) => BL_EXHIBITS[id]).map((id) => [id, clone(BL_EXHIBITS[id])]));
  }
  return out;
}

const okOpt = (v) => typeof v === 'string' && /^[abcd]$/.test(v);
function blClean(a, answers) {
  const ids = new Set(a.served);
  const out = {};
  for (const [k, v] of Object.entries(answers && typeof answers === 'object' ? answers : {})) {
    if (!ids.has(k)) continue;
    const it = blItem(k);
    if (it.type === 'mcq' && okOpt(v)) out[k] = v;
    else if (it.type === 'sjt' && v && typeof v === 'object') {
      const x = {};
      if (okOpt(v.most)) x.most = v.most;
      if (okOpt(v.least)) x.least = v.least;
      if (x.most || x.least) out[k] = x;
    } else if (it.type === 'rating') {
      if (v === 'NR' && it.allow_nr) out[k] = 'NR';
      else if ([1, 2, 3, 4].includes(Number(v)) && v !== '' && v !== null) out[k] = Number(v);
    }
  }
  if ((a.locked || []).includes('SJT')) { // 2A is frozen once locked
    a.served.filter((id) => blItem(id).type === 'sjt').forEach((id) => { if (a.answers[id]) out[id] = clone(a.answers[id]); else delete out[id]; });
  }
  return out;
}
function blCleanSelf(v) {
  const out = {};
  for (const c of ORDER) { const x = v && v[c]; if (x !== undefined && x !== null && x !== '' && Number.isInteger(Number(x)) && Number(x) >= 0 && Number(x) <= 4) out[c] = Number(x); }
  return out;
}
const blPastGrace = (a) => now() > Date.parse(a.deadline_at) + BL_GRACE_MIN * 60000;

async function blStart(u, part) {
  const cat = await getCatalog();
  blExpire(u.code);
  const list = blAtts(u.code, part);
  const open = list.find((a) => a.status === 'open');
  if (open) return ok(blStartOut(open, true, cat));
  if (list.some(blDone)) return fail('already_submitted');
  if (!state.bl[`p${part}_open`]) return fail('not_open');
  const form = part === 1 ? blForm(u) : 'ONE';
  const module = part === 3 ? blModule(u) : '';
  state.seq += 1;
  const t0 = now();
  const a = { attempt_id: `MA-BL${part}-${t0.toString(36)}-${state.seq}`, code: u.code, assessment: `baseline_p${part}`, part, form, module, wave: state.bl.wave,
    status: 'open', started_at: iso(t0), deadline_at: iso(t0 + BL_MIN[part] * 60000), last_saved_at: null, submitted_at: null,
    served: blServedIds(part, form, module), seed: hash(`${u.code}${t0}`), answers: {}, self: {}, locked: [] };
  state.attempts.push(a);
  save();
  return ok(blStartOut(a, false, cat));
}
function blSave(a, p) {
  if (a.status !== 'open') return fail('already_submitted');
  if (blPastGrace(a)) { blGrade(a, true); save(); return fail('already_submitted'); }
  a.answers = blClean(a, p.answers);
  if (a.part === 3 && p.self_ratings) a.self = blCleanSelf(p.self_ratings);
  a.last_saved_at = iso(now());
  save();
  return ok({ saved_at: a.last_saved_at });
}
function blNext(a, p) {
  if (a.part !== 2) return fail('bad_request', 'Only Part 2 has a lock step');
  if (a.status !== 'open') return fail('already_submitted');
  if (blPastGrace(a)) { blGrade(a, true); save(); return fail('already_submitted'); }
  const rate = a.served.map(blItem).filter((i) => i.type === 'rating');
  if (!(a.locked || []).includes('SJT')) {
    a.answers = blClean(a, p.answers);
    a.last_saved_at = iso(now());
    for (const id of a.served.filter((x) => blItem(x).type === 'sjt')) {
      const v = a.answers[id];
      if (!v || !v.most || !v.least || v.most === v.least) { save(); return fail('bad_request', 'Pick a most and a different least effective response for every scenario', { field: id }); }
    }
    a.locked = ['SJT'];
    save();
  }
  return ok({ locked: ['SJT'], section: blRateSection(a, rate) });
}
function blSubmit(a, p) {
  if (a.status === 'open') {
    if (blPastGrace(a)) blGrade(a, true); // too late: the saved answers count
    else {
      a.answers = blClean(a, p.answers);
      if (a.part === 3 && p.self_ratings) a.self = blCleanSelf(p.self_ratings);
      // Once the timer has run out (inside the grace window) the saved answers are graded as they are.
      const timeUp = now() >= Date.parse(a.deadline_at);
      if (!timeUp && a.part === 2) {
        if (!(a.locked || []).includes('SJT')) return fail('bad_request', 'Lock Part 2A first', { field: 'SJT' });
        const missing = a.served.map(blItem).find((i) => i.type === 'rating' && a.answers[i.item_id] === undefined);
        if (missing) return fail('bad_request', 'Rate every statement', { field: missing.item_id });
      }
      if (!timeUp && a.part === 3 && ORDER.some((c) => a.self[c] === undefined)) return fail('bad_request', 'All 10 self-ratings are required', { field: 'self_ratings' });
      blGrade(a, timeUp);
    }
    save();
  }
  return ok({ assessment: a.assessment, part: a.part, submitted_at: a.submitted_at, time_used_s: a.time_used_s });
}

function blGrade(a, expired = false) {
  const items = a.served.map(blItem);
  const tally = (m, k, right) => { if (!k) return; const o = (m[k] = m[k] || { n: 0, correct: 0 }); o.n += 1; if (right) o.correct += 1; };
  const pct = (c, n) => (n ? Math.round((100 * c) / n) : 0);
  const right = (it) => a.answers[it.item_id] === it.mockCorrect;
  if (a.part === 1) {
    a.by_step = {}; a.by_move = {};
    const sec = { A: [0, 0], B: [0, 0] };
    items.forEach((it) => { const r = right(it); tally(a.by_step, it.step, r); tally(a.by_move, it.move, r); sec[it.section][1] += 1; if (r) sec[it.section][0] += 1; });
    a.raw_pct = pct(sec.A[0] + sec.B[0], items.length);
    a.scaled_pct = a.raw_pct; // the demo has one wave: no equating
    a.section_A_pct = pct(...sec.A); a.section_B_pct = pct(...sec.B);
  } else if (a.part === 2) {
    a.by_charter = {};
    let pts = 0; let n = 0;
    items.filter((i) => i.type === 'sjt').forEach((it) => {
      const v = a.answers[it.item_id] || {};
      const p = (v.most === it.mockMost ? 1 : 0) + (v.least === it.mockLeast ? 1 : 0);
      pts += p; n += 1;
      const c = (a.by_charter[it.charter] = a.by_charter[it.charter] || { sjt_points: 0, sjt_max: 0, self_mean: null });
      c.sjt_points += p; c.sjt_max += 2;
    });
    a.sjt_pct = pct(pts, 2 * n);
    const self = {};
    items.filter((i) => i.type === 'rating').forEach((it) => { if (a.answers[it.item_id] !== undefined) self[it.item_id] = a.answers[it.item_id]; });
    state.selfRatings[a.code] = self;
    Object.keys(a.by_charter).forEach((c) => {
      const vals = items.filter((i) => i.type === 'rating' && i.charter === c).map((i) => self[i.item_id]).filter((v) => typeof v === 'number');
      a.by_charter[c].self_mean = vals.length ? Math.round((100 * vals.reduce((x, y) => x + y, 0)) / vals.length) / 100 : null;
    });
  } else {
    a.by_level = {}; a.by_gate = {};
    const core = [0, 0]; const mod = [0, 0];
    items.forEach((it) => { const r = right(it); tally(a.by_level, it.level, r); tally(a.by_gate, it.gate, r); const b = it.section === 'CORE' ? core : mod; b[1] += 1; if (r) b[0] += 1; });
    a.total_pct = pct(core[0] + mod[0], items.length); a.core_pct = pct(...core); a.module_pct = pct(...mod);
  }
  const end = Math.min(now(), Date.parse(a.deadline_at) + (expired ? BL_GRACE_MIN * 60000 : 0));
  a.status = expired ? 'expired' : 'submitted';
  a.submitted_at = iso(end);
  a.time_used_s = Math.max(0, Math.round((Math.min(end, Date.parse(a.deadline_at)) - Date.parse(a.started_at)) / 1000));
  touch(a.code);
}

function blRateStatus(rater, ratee) {
  const r = state.ratings[`${rater}|${ratee}`];
  const k = r ? Object.keys(r.values || {}).length : 0;
  return { status: !k ? 'not_started' : (k >= blRateItems().length ? 'complete' : 'in_progress'), saved_at: r ? r.saved_at : null };
}
const blReports = (u) => Object.values(state.users).filter((x) => x.manager === u.code && !x.is_manager && x.code !== u.code);
function blMe(u) {
  blExpire(u.code);
  const counts = { 1: 12, 2: 4 + BL_RATINGS.length, 3: 7 };
  const parts = {};
  for (const n of [1, 2, 3]) {
    const list = blAtts(u.code, n);
    const a = list.find((x) => x.status === 'open') || list.find(blDone);
    const ps = { open: !!state.bl[`p${n}_open`], status: 'not_started', minutes: BL_MIN[n], n_items: counts[n] };
    if (a) {
      Object.assign(ps, { status: a.status === 'open' ? 'in_progress' : 'submitted', attempt_id: a.attempt_id, started_at: a.started_at, deadline_at: a.deadline_at });
      if (blDone(a)) ps.submitted_at = a.submitted_at;
      if (n === 1) ps.form = a.form;
    }
    parts[`p${n}`] = ps;
  }
  const anyDone = Object.values(parts).some((p) => p.status === 'submitted');
  const reps = blReports(u);
  return {
    wave: state.bl.wave, parts, results_open: !!state.bl.results_open, profile_ready: !!state.bl.results_open && anyDone,
    rating: isRater(u) ? { open: !!state.bl.rating_open, to_rate: reps.length, done: reps.filter((x) => blRateStatus(u.code, x.code).status === 'complete').length } : null,
  };
}
function blTeamStatus(code) {
  blExpire(code);
  return Object.fromEntries([1, 2, 3].map((n) => {
    const list = blAtts(code, n);
    return [`p${n}`, list.some(blDone) ? 'done' : list.some((a) => a.status === 'open') ? 'in_progress' : 'not_done'];
  }));
}

function blProfile(u) {
  blExpire(u.code);
  const done = (n) => blAtts(u.code, n).find(blDone) || null;
  const a1 = done(1); const a2 = done(2); const a3 = done(3);
  const pctOf = (o) => (o && o.n ? Math.round((100 * o.correct) / o.n) : null);
  const mapPct = (m) => Object.fromEntries(Object.entries(m || {}).map(([k, v]) => [k, pctOf(v)]));
  const mean = (arr) => (arr.length ? Math.round((100 * arr.reduce((x, y) => x + y, 0)) / arr.length) / 100 : null);
  const itemPct = (a, pred) => {
    if (!a) return null;
    const list = a.served.map(blItem).filter(pred);
    return list.length ? Math.round((100 * list.filter((it) => a.answers[it.item_id] === it.mockCorrect).length) / list.length) : null;
  };
  const p1 = a1 ? { form: a1.form, raw_pct: a1.raw_pct, scaled_pct: a1.scaled_pct, section_A_pct: a1.section_A_pct, section_B_pct: a1.section_B_pct,
    by_step: mapPct(a1.by_step), by_move: mapPct(a1.by_move) } : null;
  let p2 = null;
  const areas = [];
  if (p1) areas.push({ area: 'p1_A', pct: p1.section_A_pct }, { area: 'p1_B', pct: p1.section_B_pct });
  if (a2) {
    const self = state.selfRatings[u.code] || {};
    const rec = Object.entries(state.ratings).find(([k]) => k.endsWith(`|${u.code}`));
    const mgr = rec ? rec[1].values || {} : {};
    const rate = blRateItems();
    const num = (v) => (typeof v === 'number' ? v : null);
    const by = {};
    Object.keys(BL_CHARTERS).forEach((c) => {
      const s = a2.by_charter[c];
      const inC = rate.filter((i) => i.charter === c);
      if (!s && !inC.length) return;
      const sjt = s && s.sjt_max ? Math.round((100 * s.sjt_points) / s.sjt_max) : null;
      const selfVals = inC.map((i) => num(self[i.item_id])).filter((v) => v !== null);
      const mgrVals = inC.map((i) => num(mgr[i.item_id])).filter((v) => v !== null);
      const selfMean = mean(selfVals);
      const mgrMean = mgrVals.length >= (c === 'QWS' ? 3 : 2) ? mean(mgrVals) : null;
      const index = mgrMean !== null && sjt !== null ? Math.round(W_SJT * sjt + (W_MGR * (mgrMean - 1) * 100) / 3) : null;
      const flags = [];
      if (selfMean !== null && mgrMean !== null && selfMean - mgrMean >= 1) flags.push('blind_spot');
      if (selfMean !== null && mgrMean !== null && mgrMean - selfMean >= 1) flags.push('hidden_strength');
      if (sjt !== null && sjt >= 67 && mgrMean !== null && mgrMean < 2.5) flags.push('knowing_doing');
      by[c] = { name_en: BL_CHARTERS[c][0], name_vi: BL_CHARTERS[c][1], sjt_band: sjt === null ? null : (sjt <= 33 ? 'low' : sjt >= 83 ? 'high' : 'mid'),
        self_mean: selfMean, mgr_mean: mgrMean, index, flags };
      areas.push({ area: `p2_${c}`, pct: index !== null ? index : sjt, self: selfMean, name: [BL_CHARTERS[c][0], BL_CHARTERS[c][1]].map((x, k) => `${k ? 'Phần 2' : 'Part 2'} · ${x}`) });
    });
    const topDev = rate.filter((i) => num(mgr[i.item_id]) !== null)
      .map((i) => ({ i, m: mgr[i.item_id], gap: (num(self[i.item_id]) || 0) - mgr[i.item_id] }))
      .sort((x, y) => (x.m - y.m) || (y.gap - x.gap)).slice(0, 2)
      .map(({ i }) => ({ item_id: i.item_id, text_en: i.self_en, text_vi: i.self_vi }));
    p2 = { sjt_pct: a2.sjt_pct, self_mean: mean(Object.values(self).filter((v) => typeof v === 'number')), mgr_mean: mean(Object.values(mgr).filter((v) => typeof v === 'number')), by_charter: by, top_dev: topDev };
  }
  let p3 = null;
  if (a3) {
    const byLevel = mapPct(a3.by_level);
    let level = null;
    for (const L of BL_LEVELS) { if (byLevel[L] !== undefined && byLevel[L] !== null && byLevel[L] >= 70) level = L; else break; }
    p3 = { module: a3.module, total_pct: a3.total_pct, core_pct: a3.core_pct, module_pct: a3.module_pct, by_level: byLevel, by_gate: mapPct(a3.by_gate), level };
    areas.push({ area: 'p3_core', pct: a3.core_pct }, { area: 'p3_mod', pct: a3.module_pct });
  }
  const selfC = a3 ? a3.self || {} : {};
  const modPct = (m) => (p3 && p3.module === m ? p3.module_pct : null);
  const link = {
    A2: itemPct(a1, (it) => ['SHAPE', 'SIZE', 'CHECK'].includes(it.move)),
    A3: null,
    A1: itemPct(a1, (it) => ['1', '2', '3', '4'].includes(it.step)),
    P1: p3 ? p3.core_pct : null,
    C1: itemPct(a1, (it) => it.move === 'SO WHAT' || it.step === '6'),
    P2: modPct('SP'), P3: modPct('RPM'), P4: modPct('DP'), P5: modPct('RPM'), P6: modPct('CS'),
  };
  const courses = Object.fromEntries(ORDER.map((c) => {
    const s = selfC[c] !== undefined ? selfC[c] : null;
    const sc = link[c];
    return [c, { self: s, score_pct: sc, flag: s !== null && s >= 3 && sc !== null && sc < 50 }];
  }));
  const gaps = areas.filter((x) => x.pct !== null && x.pct !== undefined)
    .map((x, i) => ({ ...x, i, s: x.self !== undefined && x.self !== null ? x.self : 9 }))
    .sort((x, y) => (x.pct - y.pct) || (x.s - y.s) || (x.i - y.i)).slice(0, 2)
    .map((x) => { const nm = x.name || BL_GAP_NAMES[x.area]; return { area: x.area, name_en: nm[0], name_vi: nm[1], pct: x.pct }; });
  return { wave: state.bl.wave, built_at: iso(now() - 40 * 60000), p1, p2, p3, courses, gaps };
}

/** DEMO-L has done all three parts (form B, module DP) and Minh has rated her. */
function seedBaselineL(s, T) {
  const code = 'DEMO-L';
  const wrong = (it) => 'abcd'.split('').find((x) => x !== it.mockCorrect);
  const mk = (part, form, module, dayOff, hhmm, minutes, answer, self) => {
    const startMs = T(dayOff, hhmm);
    const a = { attempt_id: `MA-SEED-BL${part}`, code, assessment: `baseline_p${part}`, part, form, module, wave: BL_WAVE, status: 'open', started_at: iso(startMs),
      deadline_at: iso(startMs + BL_MIN[part] * 60000), last_saved_at: null, submitted_at: null, served: blServedIds(part, form, module), seed: 11 + part,
      answers: {}, self: self || {}, locked: part === 2 ? ['SJT'] : [] };
    a.served.forEach((id, i) => { const v = answer(blItem(id), i); if (v !== undefined) a.answers[id] = v; });
    s.attempts.push(a);
    blGrade(a);
    a.submitted_at = iso(startMs + minutes * 60000); a.last_saved_at = a.submitted_at; a.time_used_s = minutes * 60;
  };
  mk(1, 'B', '', -6, '14:05', 9, (it, i) => (it.section === 'A' ? (i % 3 !== 2 ? it.mockCorrect : wrong(it)) : (i % 2 ? it.mockCorrect : wrong(it))));
  const sjt = { 1: [1, 1], 2: [1, 0], 3: [0, 0], 4: [1, 1] };
  const selfR = { '2R1': 4, '2R2': 3, '2R3': 'NR', '2R4': 3, '2R5': 1, '2R6': 3 };
  mk(2, 'ONE', '', -5, '09:40', 5, (it) => {
    if (it.type === 'sjt') {
      const [m, l] = sjt[it.charter];
      const other = (k) => 'abcd'.split('').find((x) => x !== it.mockMost && x !== it.mockLeast && x !== k);
      return { most: m ? it.mockMost : other(''), least: l ? it.mockLeast : other(m ? it.mockMost : other('')) };
    }
    return selfR[it.item_id.split('-').pop()];
  });
  mk(3, 'ONE', 'DP', -4, '15:30', 7, (it) => (it.section === 'CORE' ? (it.order < 3 ? it.mockCorrect : wrong(it)) : (it.order === 1 ? it.mockCorrect : wrong(it))),
    { A2: 3, A3: 2, A1: 2, P1: 3, C1: 1, P2: 1, P3: 1, P4: 3, P5: 1, P6: 2 });
  s.ratings['DEMO-M|DEMO-L'] = { values: { 'MOCK-BL-2R1': 2, 'MOCK-BL-2R2': 2, 'MOCK-BL-2R3': 3, 'MOCK-BL-2R4': 'NA', 'MOCK-BL-2R5': 4, 'MOCK-BL-2R6': 4 }, saved_at: iso(T(-2, '17:20')) };
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
      profile: profileOf(u), baseline: blMe(u), courses,
      sessions: calendar().sessions.map((x) => ({ ...x, courses: x.courses.slice() })),
      charters: [], // the live Hub sends the five charter names from the private Sheet; the demo shows "Charter 1–5"
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
    if (BL_KINDS.includes(kind)) return blStart(u, Number(kind.slice(-1)));
    if (!['predict', 'checkpoint', 'recall'].includes(kind)) return fail('bad_request'); // v1 "baseline" is gone (specs/22)
    if (!cat.courses.some((c) => c.code === p.course)) return fail('not_found');
    if ((kind === 'predict' || kind === 'checkpoint') && !courseOpen(p.course)) return fail('not_open', null, { opens_at: calendar().courses[p.course].online_from });
    const openA = mine(u.code, (a) => a.status === 'open' && a.assessment === kind && a.course === p.course && (kind !== 'recall' || a.day === Number(p.day)))[0];
    let a = openA;
    if (!a) {
      let served; let form = 'PR'; let attemptNo = 1;
      if (kind === 'predict') {
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
        if (!r || r.status === 'done' || r.due_date > day(now())) return fail('not_due', null, r && r.status !== 'done' ? { due_date: r.due_date } : {});
        const taken = mine(u.code, (x) => x.assessment === 'checkpoint' && x.course === p.course && x.status === 'submitted').map((x) => x.form);
        const other = taken.includes('A') && !taken.includes('B') ? 'B' : 'A';
        const pool = shuffle(items.filter((i) => i.assessment === 'checkpoint' && i.course === p.course && i.form === other), hash(u.code + p.course));
        const offset = { 2: 0, 7: 3, 30: 6 }[r.day] || 0;
        served = pool.slice(offset, offset + 3).map((i) => i.item_id); form = other;
      }
      state.seq += 1;
      a = { attempt_id: `MA-${Date.now().toString(36)}-${state.seq}`, code: u.code, assessment: kind, course: p.course, form, attempt_no: attemptNo,
        status: 'open', started_at: iso(now()), last_saved_at: null, submitted_at: null, served, seed: hash(`${u.code}${now()}`), answers: {},
        day: kind === 'recall' ? Number(p.day) : null };
      state.attempts.push(a);
      save();
    }
    const out = { attempt_id: a.attempt_id, assessment: a.assessment, course: a.course, form: a.form, attempt_no: a.attempt_no, started_at: a.started_at, resumed: !!openA,
      answers: clone(a.answers || {}), items: serve(a, items) };
    return ok(out);
  },
  async save(p, u) {
    const a = state.attempts.find((x) => x.attempt_id === p.attempt_id && x.code === u.code);
    if (!a) return fail('not_found');
    if (BL_KINDS.includes(a.assessment)) return blSave(a, p);
    if (a.status !== 'open') return fail('already_submitted');
    a.answers = p.answers || {}; a.last_saved_at = iso(now());
    save();
    return ok({ saved_at: a.last_saved_at });
  },
  async submit(p, u) {
    await getBank();
    const a = state.attempts.find((x) => x.attempt_id === p.attempt_id && x.code === u.code);
    if (!a) return fail('not_found');
    if (BL_KINDS.includes(a.assessment)) return blSubmit(a, p);
    if (a.status === 'open') {
      gradeAttempt(a, p.answers || a.answers);
      save();
    }
    return ok(await resultOf(a));
  },
  async review(p, u) {
    const a = state.attempts.find((x) => x.attempt_id === p.attempt_id && x.code === u.code);
    if (!a || a.status === 'open' || BL_KINDS.includes(a.assessment)) return fail('not_found'); // no item review for the baseline
    return ok(await resultOf(a));
  },
  async team_summary() {
    const cal = calendar();
    const t = now();
    const courses = (vals) => Object.fromEntries(ORDER.map((c, i) => [c, vals(c, i)]));
    // specs/22: baseline groups are { group, n, p1_pct, p2_sjt_pct, p2_mgr_mean, p3_core_pct }, published with results_open.
    const base = (seed, n, group) => ({ group, n, p1_pct: 38 + ((seed * 7) % 30), p2_sjt_pct: 45 + ((seed * 11) % 35), p2_mgr_mean: Math.round((2.1 + ((seed * 3) % 12) / 10) * 10) / 10, p3_core_pct: 35 + ((seed * 5) % 40) });
    // F21: a course's checkpoint rates appear only after its late window has closed.
    const published = (c) => t > dayEndMs(cal.courses[c].late_until);
    const cps = (group, n) => ({ group, n, courses: courses((c, i) => (published(c)
      ? { first_try_pass: 55 + ((i * 13 + n) % 40), passed_by_forum: 80 + ((i * 7 + n) % 21), n_first_try: n, n_by_forum: n }
      : { first_try_pass: null, passed_by_forum: null, n_first_try: 0, n_by_forum: 0 })) });
    const blPublished = !!state.bl.results_open;
    return ok({ updated_at: iso(t - 2 * H), min_n: 3, wave: state.bl.wave, baseline_published: blPublished,
      baseline: blPublished ? [base(5, 18, 'all'), base(9, 6, 'demand'), base(3, 5, 'supply'), base(12, 4, 'cs')] : [],
      checkpoints: [cps('all', 18), cps('demand', 6), cps('supply', 5), cps('cs', 4)] });
  },
  async team_status(p, u) {
    if (!u.is_manager) return fail('forbidden');
    const me = state.users['DEMO-L'];
    const st = (code) => { const s2 = cpState(me.code, code); return s2.passedA ? 'passed' : s2.needsChat ? 'needs_chat' : s2.done.length ? 'not_yet' : 'not_started'; };
    const fake = (code, name, passed, bl) => ({ code, first_name: name, baseline: bl, courses: Object.fromEntries(ORDER.map((c) => [c, passed.includes(c) ? 'passed' : 'not_started'])) });
    return ok({ reports: [
      { code: me.code, first_name: me.first_name, baseline: blTeamStatus(me.code), courses: Object.fromEntries(ORDER.map((c) => [c, st(c)])) },
      fake('DEMO-P1', 'Peer 1', ['A2', 'A3'], { p1: 'done', p2: 'done', p3: 'in_progress' }), fake('DEMO-P2', 'Peer 2', ['A2', 'A3', 'A1'], { p1: 'done', p2: 'not_done', p3: 'not_done' }),
    ] });
  },
  async baseline_next(p, u) {
    const a = state.attempts.find((x) => x.attempt_id === p.attempt_id && x.code === u.code);
    if (!a || !BL_KINDS.includes(a.assessment)) return fail('not_found');
    return blNext(a, p);
  },
  async rate_list(p, u) {
    if (!isRater(u)) return fail('forbidden');
    return ok({ open: !!state.bl.rating_open, wave: state.bl.wave, reports: blReports(u).map((x) => ({ code: x.code, first_name: x.first_name, role_area: x.role_area, ...blRateStatus(u.code, x.code) })) });
  },
  async rate_get(p, u) {
    if (!isRater(u)) return fail('forbidden');
    const r = blReports(u).find((x) => x.code === String(p.ratee || '').trim().toUpperCase());
    if (!r) return fail('forbidden');
    if (!state.bl.rating_open) return fail('not_open'); // the statements describe what Part 2A rewards
    const rec = state.ratings[`${u.code}|${r.code}`] || { values: {}, saved_at: null };
    return ok({ open: !!state.bl.rating_open, ratee: { code: r.code, first_name: r.first_name }, guide_en: RATER_GUIDE.en, guide_vi: RATER_GUIDE.vi,
      scale: { points: RATE_POINTS.map(([v, en, vi]) => ({ v, en, vi })), na: clone(RATE_NA) },
      items: blRateItems().map((i) => ({ item_id: i.item_id, text_en: i.mgr_en, text_vi: i.mgr_vi, anchor1_en: i.anchor1_en, anchor1_vi: i.anchor1_vi, anchor4_en: i.anchor4_en, anchor4_vi: i.anchor4_vi })),
      values: clone(rec.values), saved_at: rec.saved_at });
  },
  async rate_save(p, u) {
    if (!isRater(u)) return fail('forbidden');
    const r = blReports(u).find((x) => x.code === String(p.ratee || '').trim().toUpperCase());
    if (!r) return fail('forbidden');
    if (!state.bl.rating_open) return fail('not_open');
    const ids = new Set(blRateItems().map((i) => i.item_id));
    const values = {};
    for (const [k, v] of Object.entries(p.values && typeof p.values === 'object' ? p.values : {})) {
      if (!ids.has(k)) return fail('bad_request', 'Unknown statement', { field: k });
      if (v === null || v === '') continue; // clears the value
      if (v === 'NA') values[k] = 'NA';
      else if ([1, 2, 3, 4].includes(Number(v)) && v !== '' && v !== null) values[k] = Number(v);
      else return fail('bad_request', 'Ratings are 1–4 or NA', { field: k });
    }
    const rec = { values, saved_at: iso(now()) };
    state.ratings[`${u.code}|${r.code}`] = rec;
    save();
    return ok({ saved_at: rec.saved_at, complete: Object.keys(values).length >= ids.size });
  },
  async profile(p, u) {
    if (!state.bl.results_open) return fail('not_open');
    return ok(blProfile(u));
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
