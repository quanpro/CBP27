// quiz.html?type=predict|checkpoint|recall&c=CODE[&day=N][&review=ATTEMPT_ID]
// Intro (honest framing per type) → questions (docs/js/quiz.js runner) → review → submit → result.
// Results follow specs/14 + decision D5: a checkpoint that is not yet passed shows the learner's own
// answers only; the right answer and "why" appear after a pass or once the late window closes.
import { mountShell, h, icon, chip, codeBadge, render, qs, loading, emptyState, errorState, errorMessage, toast, confirmDialog } from '../ui.js';
import { t, pick, getLang, onLangChange } from '../i18n.js';
import { api, serverNow } from '../api.js';
import { loadCatalog, objectiveEpisodes, familyClass, fmtShortDate, fmtLongDate, fmtDateTime, daysUntil, todayVN } from '../courses.js';
import { QuizRunner, buildTop, answerLine, announce, fmtTime } from '../quiz.js';

const TYPES = ['predict', 'checkpoint', 'recall'];
const type = (qs('type') || '').toLowerCase();
const code = (qs('c') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const dayParam = Number(qs('day')) || null;
let reviewId = qs('review');
const courseHref = code ? `course.html?c=${encodeURIComponent(code)}` : 'index.html';
const episodesHref = code ? `course.html?c=${encodeURIComponent(code)}#episodes` : 'index.html';

const { app } = await mountShell({ page: 'quiz', focus: true, exitHref: courseHref });
app.classList.add('narrow');

let cat = null; let course = null; let live = null;
let runner = null; let startRes = null;
let current = null;
let nextRecall = null; // {day, due_date} | 'none' | null (unknown)

function show(fn) {
  if (runner) runner.hide();
  current = fn;
  fn();
}
onLangChange(() => {
  if (runner && runner.active) runner.rerender();
  else if (current) current();
});

// ---------- helpers ----------
const objText = (n) => {
  const o = course && (course.objectives || []).find((x) => Number(x.n) === Number(n));
  return o ? (o[getLang()] || o.en) : t('result.objective_n', { n });
};
const epTitle = (ep) => {
  const e = course && (course.episodes || []).find((x) => Number(x.ep) === Number(ep));
  return e ? pick(e, 'title') : '';
};
/** "09:30 today" / "09:30 tomorrow" / "Tue 26 Jan, 09:30" (Vietnam time). */
function fmtWhen(iso) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const d = daysUntil(todayVN(ms));
  if (d === 0) return t('quiz.when_today', { time: fmtTime(ms) });
  if (d === 1) return t('quiz.when_tomorrow', { time: fmtTime(ms) });
  return fmtDateTime(iso);
}
const typeLabel = (k = type) => t(`quiz.type.${k}`);
const courseName = () => (course ? pick(course, 'name') : code);
function backToCourse(variant = 'btn-ghost') {
  return h('a', { class: `btn ${variant}`, href: courseHref }, icon('chevron-left'), h('span', { text: t('quiz.state.back_course') }));
}
function focusHeading() {
  const el = app.querySelector('h1');
  if (el) { el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); }
  window.scrollTo({ top: 0, behavior: 'auto' });
}

// ---------- states (not open, retake wait, unlock, closed, passed, not due, not found) ----------
function stateView(kind, info = {}) {
  const S = {
    not_open: ['lock', t('quiz.state.not_open_title'), info.date ? t('quiz.state.not_open_body', { date: fmtLongDate(info.date) }) : t('quiz.state.not_open_body_nodate')],
    retake_too_soon: ['clock', t('quiz.state.retake_title', { time: fmtWhen(info.next_retake_at) }), t('quiz.state.retake_body')],
    unlock_needed: ['users', t('quiz.state.unlock_title'), t('quiz.state.unlock_body')],
    gate_closed: ['alert', t('quiz.state.closed_title'), t('quiz.state.closed_body')],
    already_passed: ['check-circle', t('quiz.state.passed_title'), t('quiz.state.passed_body')],
    not_due: ['calendar', t('quiz.state.not_due_title'), info.date ? t('quiz.state.not_due_body', { date: fmtLongDate(info.date) }) : t('quiz.state.not_due_body_nodate')],
    recall_done: ['check-circle', t('quiz.state.recall_done_title'), t('quiz.state.recall_done_body')],
    already_submitted: ['check-circle', t('quiz.state.submitted_title'), t('quiz.state.submitted_body')],
    not_found: ['help', t('quiz.state.not_found_title'), t('quiz.state.not_found_body')],
  };
  const [ic, title, body] = S[kind] || S.not_found;
  const actions = [];
  if ((kind === 'already_passed' || kind === 'recall_done' || kind === 'retake_too_soon') && info.attempt) {
    actions.push(h('a', { class: `btn ${kind === 'retake_too_soon' ? 'btn-secondary' : 'btn-primary'}`, href: reviewHref(info.attempt) }, icon('eye'), h('span', { text: t(kind === 'retake_too_soon' ? 'quiz.state.see_last' : 'quiz.state.see_result') })));
  }
  if (kind === 'retake_too_soon') actions.push(h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => location.reload() }, icon('refresh'), h('span', { text: t('quiz.state.retake_check') })));
  if (kind === 'retake_too_soon' || kind === 'unlock_needed') actions.unshift(h('a', { class: 'btn btn-primary', href: episodesHref }, icon('play'), h('span', { text: t('quiz.state.rewatch') })));
  actions.push(code && course ? backToCourse(actions.length ? 'btn-ghost' : 'btn-primary') : h('a', { class: 'btn btn-primary', href: 'index.html' }, t('quiz.state.back_home')));
  render(app, h('div', { class: `qz stack lg ${familyClass(code)}` },
    course ? kicker() : null,
    h('section', { class: 'card qz-state' }, emptyState({ iconName: ic, title, body, action: h('div', { class: 'row qz-actions' }, actions) }))));
  const h3 = app.querySelector('.qz-state h3');
  if (h3) { h3.setAttribute('tabindex', '-1'); h3.focus({ preventScroll: true }); }
}
function reviewHref(attemptId) {
  return `quiz.html?type=${encodeURIComponent(type || 'checkpoint')}&c=${encodeURIComponent(code)}&review=${encodeURIComponent(attemptId)}`;
}
function kicker(extra) {
  return h('div', { class: 'row tight qz-kicker' }, codeBadge(code), h('span', { class: 'strong ink', text: courseName() }), extra ? h('span', { class: 'muted', text: `· ${extra}` }) : null);
}

function preState() {
  if (!live) return null; // let `start` decide
  if (!live.open) return { kind: 'not_open', date: live.online_from };
  if (type === 'checkpoint') {
    const cp = live.checkpoint || {};
    if (cp.status === 'passed') return { kind: 'already_passed', attempt: cp.last_attempt_id };
    if (cp.status === 'in_progress') return null;
    if (cp.gate_closed) return { kind: 'gate_closed' };
    if (cp.needs_unlock) return { kind: 'unlock_needed' };
    if (cp.next_retake_at && Date.parse(cp.next_retake_at) > serverNow()) return { kind: 'retake_too_soon', next_retake_at: cp.next_retake_at, attempt: cp.last_attempt_id };
  }
  if (type === 'recall') {
    const r = (live.recall || []).find((x) => Number(x.day) === dayParam);
    if (!dayParam || !r) return { kind: 'not_found' };
    if (r.status === 'done') return { kind: 'recall_done', attempt: r.attempt_id };
    if (r.status === 'upcoming') return { kind: 'not_due', date: r.due_date };
  }
  return null;
}

// ---------- intro ----------
function introView(err) {
  const cp = (live && live.checkpoint) || {};
  const close = (live && live.checkpoint_close) || course.checkpoint_close;
  const forum = (live && live.forum_date) || course.forum_date;
  const recallRow = type === 'recall' && live ? (live.recall || []).find((x) => Number(x.day) === dayParam) : null;
  let kick; let title; let lead; let facts; let cta; let note = null;
  if (type === 'predict') {
    kick = typeLabel();
    title = t('quiz.intro.predict_title');
    lead = t('quiz.intro.predict_lead');
    facts = [['list', t('quiz.intro.predict_f1')], ['zap', t('quiz.intro.predict_f2')], ['eye', t('quiz.intro.predict_f3')], ['refresh', t('quiz.intro.predict_f4')]];
    cta = t('quiz.intro.predict_start');
  } else if (type === 'checkpoint') {
    kick = typeLabel();
    title = t('quiz.intro.checkpoint_title');
    lead = forum ? t('quiz.intro.checkpoint_lead', { date: fmtShortDate(forum) }) : t('quiz.intro.checkpoint_lead_nodate');
    facts = [['target', t('quiz.intro.cp_pass')], ['cloud', t('quiz.intro.cp_time')], ['refresh', t('quiz.intro.cp_retake')], ['users', t('quiz.intro.cp_unlock')]];
    if (close) facts.push(['calendar', t('quiz.intro.cp_close', { date: fmtLongDate(close) })]);
    if (cp.status === 'in_progress') {
      cta = t('quiz.intro.continue');
      note = h('div', { class: 'callout success' }, icon('check-circle'), h('span', { text: t('quiz.intro.continue_note') }));
    } else {
      cta = t('quiz.intro.checkpoint_start');
      if (cp.attempts > 0) note = h('div', { class: 'callout info' }, icon('info'), h('span', { text: t('quiz.intro.cp_try', { n: cp.attempts + 1 }) }));
    }
  } else {
    kick = t('quiz.intro.recall_kicker', { day: dayParam });
    title = t('quiz.intro.recall_title');
    lead = t('quiz.intro.recall_lead', { day: dayParam });
    facts = [['list', t('quiz.intro.recall_f1')], ['eye', t('quiz.intro.recall_f2')]];
    if (recallRow && recallRow.due_date) facts.push(['calendar', t('quiz.intro.recall_due', { date: fmtLongDate(recallRow.due_date) })]);
    cta = t('quiz.intro.recall_start');
  }
  const startBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: (e) => begin(e.currentTarget) }, h('span', { text: cta }), icon('arrow-right'));
  render(app, h('div', { class: `qz qz-intro stack lg ${familyClass(code)}` },
    h('article', { class: 'card qz-intro-card', 'aria-labelledby': 'qz-intro-title' },
      h('div', { class: 'qz-band', 'aria-hidden': 'true' }),
      h('div', { class: 'pad stack' },
        kicker(),
        h('p', { class: 'eyebrow qz-eyebrow', text: kick }),
        h('h1', { id: 'qz-intro-title', text: title }),
        h('p', { class: 'lead', text: lead }),
        h('ul', { class: 'qz-facts' }, facts.map(([ic, text]) => h('li', null, h('span', { class: 'qz-fact-ico', 'aria-hidden': 'true' }, icon(ic)), h('span', { text })))),
        note,
        err ? errorState(err) : null,
        h('div', { class: 'row qz-actions' }, startBtn, backToCourse())))));
}

async function begin(btn) {
  btn.disabled = true;
  const label = btn.querySelector('span');
  const prev = label.textContent;
  label.textContent = t('quiz.intro.starting');
  try {
    startRes = await api.start(type, code, type === 'recall' ? dayParam : undefined);
  } catch (e) {
    btn.disabled = false; label.textContent = prev;
    if (['not_open', 'retake_too_soon', 'unlock_needed', 'gate_closed', 'already_passed', 'not_due', 'not_found', 'already_submitted'].includes(e.code)) {
      const cp = (live && live.checkpoint) || {};
      return show(() => stateView(e.code, { ...e, date: e.opens_at || (e.code === 'not_open' && live ? live.online_from : null), attempt: cp.last_attempt_id }));
    }
    return show(() => introView(e));
  }
  if (startRes.resumed) announce(t('quiz.resumed'));
  runQuestions();
  return undefined;
}

// ---------- questions ----------
function runQuestions(startAt) {
  if (!runner) runner = new QuizRunner({ start: startRes, onGone: () => gone() });
  current = null;
  runner.show(app, {
    key: 'q',
    groups: [{ key: 'all', items: startRes.items || [] }],
    paging: 'item',
    title: () => `${typeLabel()} · ${code}`,
    doneLabel: t('quiz.review_btn'),
    reviewLinkLabel: t('quiz.review.link'),
    onDone: () => show(reviewView),
    startAt,
  });
}

async function gone() {
  toast(t('quiz.gone'));
  try { showResult(await api.review(startRes.attempt_id), startRes.attempt_id); } catch (e) { show(() => fatal(e, () => location.reload())); }
}

// ---------- review + submit ----------
function reviewView(err) {
  const items = startRes.items || [];
  const left = runner.unanswered(items);
  const total = items.length; const n = total - left.length;
  const top = buildTop({ title: `${typeLabel()} · ${code}`, pill: runner.pill.el, n, total });
  const jumpTo = (it) => { runQuestions(it.item_id); runner.jumpTo(it.item_id); };
  const submitBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: (e) => doSubmit(e.currentTarget) }, icon('send'), h('span', { text: t('quiz.review.submit') }));
  render(app, h('div', { class: 'qz stack lg' }, top.el,
    h('section', { class: 'card pad stack qz-review', 'aria-labelledby': 'qz-rev-title' },
      h('h1', { id: 'qz-rev-title', class: 'qz-h1', text: t('quiz.review.title') }),
      left.length
        ? h('div', { class: 'callout warn' }, icon('alert'), h('div', { class: 'stack sm' },
          h('b', { text: t('quiz.review.some_left', { n, total }) }),
          h('div', { class: 'row tight qz-jumps' }, h('span', { class: 'small', text: t('quiz.review.jump_label') }),
            left.map((it) => { const i = items.indexOf(it) + 1; return h('button', { class: 'btn btn-secondary btn-sm', type: 'button', 'aria-label': t('quiz.review.jump', { n: i }), onclick: () => jumpTo(it) }, String(i)); }))))
        : h('div', { class: 'callout success' }, icon('check-circle'), h('b', { text: t('quiz.review.all_done', { total }) })),
      err ? submitError(err) : null,
      runner.reviewList(items, { onJump: jumpTo }),
      h('p', { class: 'small muted', text: t(type === 'checkpoint' ? 'quiz.review.final_cp' : 'quiz.review.final') }),
      h('div', { class: 'q-nav qz-actions' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { runQuestions(); } }, icon('chevron-left'), h('span', { text: t('quiz.review.back') })),
        submitBtn))));
  if (err) { const a = app.querySelector('.qz-submit-err'); if (a) a.focus(); } else focusHeading();
}
function submitError(err) {
  const msg = err && err.code === 'network' ? t('quiz.review.submit_offline') : `${t('quiz.review.submit_failed')} ${errorMessage(err)}`;
  return h('div', { class: 'callout bad qz-submit-err', role: 'alert', tabindex: '-1' }, icon('wifi-off'), h('span', { text: msg }));
}
async function doSubmit(btn) {
  const left = runner.unanswered(startRes.items || []).length;
  const ok = await confirmDialog({
    title: t('quiz.review.confirm_title'),
    body: left ? t('quiz.review.confirm_left', { count: left }) : t('quiz.review.confirm_done'),
    confirm: t('quiz.review.confirm_yes'), cancel: t('quiz.review.confirm_no'),
  });
  if (!ok) return;
  btn.disabled = true;
  show(() => render(app, h('div', { class: 'qz' }, loading(t('quiz.review.submitting')))));
  try {
    const res = await runner.submit();
    const id = startRes.attempt_id;
    runner = null;
    try { history.replaceState(null, '', reviewHref(id) + (type === 'recall' && dayParam ? `&day=${dayParam}` : '')); } catch (e) { /* ignore */ }
    showResult(res, id);
  } catch (e) {
    show(() => reviewView(e));
  }
}

// ---------- results ----------
function showResult(res, attemptId) {
  reviewId = attemptId || reviewId;
  const kind = res.assessment || type;
  if (kind === 'predict') show(() => predictResult(res));
  else if (kind === 'recall') { show(() => recallResult(res)); loadNextRecall(res); }
  else show(() => checkpointResult(res));
  focusHeading();
  announce(app.querySelector('h1') ? app.querySelector('h1').textContent : '');
}

function scoreBlock(res) {
  return h('div', { class: 'qz-score', role: 'img', 'aria-label': t('result.score_aria', { n: res.n_correct, total: res.n_items, pct: res.score_pct }) },
    h('span', { class: 'score-big', text: `${res.n_correct}/${res.n_items}` }),
    h('span', { class: 'qz-score-pct', text: `${res.score_pct}%` }));
}
function hero({ variant, iconName, eyebrow, title, body, actions, res, extra }) {
  return h('section', { class: `result-hero ${variant} qz-hero`, 'aria-labelledby': 'res-title' },
    h('div', { class: 'qz-hero-head' },
      h('span', { class: 'qz-hero-icon', 'aria-hidden': 'true' }, icon(iconName, 'lg')),
      h('div', { class: 'qz-hero-meta' }, h('p', { class: 'eyebrow', text: eyebrow }), scoreBlock(res))),
    h('h1', { id: 'res-title', class: 'qz-hero-title', text: title }),
    body ? h('p', { class: 'qz-hero-body', text: body }) : null,
    extra || null,
    actions && actions.length ? h('div', { class: 'row qz-actions' }, actions) : null);
}
function reviewCard(r, n, { reveal, missed = false }) {
  const ok = !!r.is_correct;
  const lines = [answerLine('your', r.your, { correct: ok })];
  if (!ok && reveal && r.correct) lines.push(answerLine('right', r.correct));
  const why = reveal ? pick(r, 'why') : '';
  const label = missed ? t('result.missed_n', { n }) : t('quiz.q_short', { n });
  return h('article', { class: 'q-card qz-rcard', 'aria-label': label },
    h('div', { class: 'row tight qz-rcard-head' },
      missed ? null : h('span', { class: 'q-meta', text: label }),
      missed ? null : chip(ok ? t('result.correct_chip') : t('result.wrong_chip'), ok ? 'pass' : 'warn', ok ? 'check' : 'x'),
      r.objective ? chip(missed ? t('result.objective_n_text', { n: r.objective, text: objText(r.objective) }) : t('result.objective_n', { n: r.objective }), missed ? 'qz-obj-chip' : '') : null),
    h('p', { class: 'qz-rstem', text: pick(r, 'stem') }),
    h('div', { class: 'opts' }, lines),
    why ? h('div', { class: 'qz-why' }, icon('info', 'sm'), h('p', null, h('b', { text: `${t('result.why')} ` }), h('span', { text: why }))) : null);
}

function predictResult(res) {
  const watch = () => h('a', { class: 'btn btn-primary', href: episodesHref }, icon('play'), h('span', { text: t('result.watch') }));
  render(app, h('div', { class: `qz stack lg ${familyClass(res.course || code)}` },
    hero({ variant: 'neutral', iconName: 'zap', eyebrow: t('result.predict_eyebrow', { code: res.course || code }), res,
      title: t('result.predict_title'), body: t('result.predict_body', { n: res.n_correct, total: res.n_items }),
      actions: [watch(), backToCourse()] }),
    h('section', { class: 'stack', 'aria-labelledby': 'qz-ans-h' },
      h('h2', { id: 'qz-ans-h', text: t('result.review_title') }),
      h('p', { class: 'muted', text: t('result.predict_review_hint') }),
      (res.review || []).map((r, i) => reviewCard(r, i + 1, { reveal: true }))),
    h('div', { class: 'row qz-actions' }, watch())));
}

function objectivesCard(res) {
  const objs = (course && course.objectives) || [];
  const by = res.by_objective || {};
  const weak = new Set((res.weak_objectives || []).map(Number));
  if (!objs.length) return null;
  const rewatch = (n) => {
    const eps = objectiveEpisodes(course, n);
    if (!eps.length) return null;
    return h('div', { class: 'qz-rewatch' }, eps.map((ep) => h('a', { href: episodesHref }, icon('play', 'sm'), h('span', { text: t('result.rewatch', { ep, title: epTitle(ep) }) }))));
  };
  const row = (o) => {
    const n = Number(o.n);
    const s = by[String(n)] || by[n];
    const isWeak = weak.has(n);
    const status = isWeak
      ? chip(s ? t('result.obj_revisit_n', { correct: s.correct, n: s.n }) : t('result.obj_revisit'), 'warn', 'refresh')
      : chip(t('result.obj_ok'), 'pass', 'check');
    return h('li', { class: `qz-obj${isWeak ? ' is-weak' : ''}` },
      h('span', { class: 'qz-obj-n', 'aria-hidden': 'true', text: String(n) }),
      h('div', { class: 'stack sm qz-obj-main' }, h('span', { class: 'qz-obj-text', text: o[getLang()] || o.en }), status, isWeak ? rewatch(n) : null));
  };
  const weakList = objs.filter((o) => weak.has(Number(o.n)));
  const okList = objs.filter((o) => !weak.has(Number(o.n)));
  if (!weakList.length) {
    return h('section', { class: 'card pad stack', 'aria-labelledby': 'qz-obj-h' },
      h('h2', { id: 'qz-obj-h', text: t('result.objectives_title') }),
      h('p', { class: 'qz-ok-line' }, icon('check-circle'), h('span', { text: t('result.objectives_all') })),
      h('ol', { class: 'qz-objs' }, okList.map(row)));
  }
  return h('section', { class: 'card pad stack', 'aria-labelledby': 'qz-obj-h' },
    h('h2', { id: 'qz-obj-h', text: t('result.revisit_title', { count: weakList.length }) }),
    h('p', { class: 'muted', text: t(res.passed ? 'result.revisit_body_passed' : 'result.revisit_body') }),
    h('ol', { class: 'qz-objs' }, weakList.map(row)),
    okList.length ? h('details', { class: 'qz-more' }, h('summary', { text: t('result.shown_title', { count: okList.length }) }), h('ol', { class: 'qz-objs' }, okList.map(row))) : null);
}

function checkpointResult(res) {
  const passed = !!res.passed;
  const reveal = !!res.reveal;
  const forum = res.forum_date || (course && course.forum_date);
  const eyebrow = t('result.cp_eyebrow', { code: res.course || code, form: res.form || '', n: res.attempt_no || 1 });
  const retakeMs = res.next_retake_at ? Date.parse(res.next_retake_at) : NaN;
  const canRetakeNow = !passed && !res.needs_unlock && !Number.isNaN(retakeMs) && retakeMs <= serverNow();
  let title; let body; let variant; let iconName; const actions = [];
  if (passed) {
    variant = 'pass'; iconName = 'check-circle';
    title = forum ? t('result.passed_title', { date: fmtLongDate(forum) }) : t('result.passed_title_nodate');
    body = t('result.passed_body', { n: res.n_correct, total: res.n_items });
    actions.push(backToCourse('btn-primary'));
  } else {
    variant = 'notyet'; iconName = 'refresh';
    if (res.needs_unlock) title = t('result.notyet_title_unlock');
    else if (canRetakeNow) title = t('result.notyet_title_now');
    else if (!Number.isNaN(retakeMs)) title = t('result.notyet_title', { time: fmtWhen(res.next_retake_at) });
    else title = t('result.notyet_title_plain');
    body = t('result.notyet_body', { n: res.n_correct, total: res.n_items });
    if (canRetakeNow) actions.push(h('a', { class: 'btn btn-primary', href: `quiz.html?type=checkpoint&c=${encodeURIComponent(res.course || code)}` }, icon('refresh'), h('span', { text: t('result.retake_now') })));
    else if ((res.weak_objectives || []).length) actions.push(h('a', { class: 'btn btn-primary', href: episodesHref }, icon('play'), h('span', { text: t('result.rewatch_cta') })));
    actions.push(backToCourse(actions.length ? 'btn-ghost' : 'btn-primary'));
  }
  const missed = res.missed || [];
  const recallDates = (res.recall_dates || []).filter(Boolean);
  const extra = !passed && res.needs_unlock ? h('div', { class: 'callout warn' }, icon('users'), h('span', { text: t('result.unlock_note') })) : null;
  render(app, h('div', { class: `qz stack lg ${familyClass(res.course || code)}` },
    hero({ variant, iconName, eyebrow, title, body, actions, res, extra }),
    objectivesCard(res),
    passed && recallDates.length ? h('section', { class: 'card pad stack', 'aria-labelledby': 'qz-recall-h' },
      h('h2', { id: 'qz-recall-h', text: t('result.recall_title') }),
      h('p', { class: 'muted', text: t('result.recall_body') }),
      h('ul', { class: 'qz-dates' }, recallDates.map((d, i) => h('li', null, icon('calendar', 'sm'), h('b', { text: t('result.recall_day', { day: [2, 7, 30][i] || '' }) }), h('span', { text: fmtLongDate(d) }))))) : null,
    h('section', { class: 'stack', 'aria-labelledby': 'qz-missed-h' },
      h('h2', { id: 'qz-missed-h', text: missed.length ? t('result.missed_title', { count: missed.length }) : t('result.missed_none_title') }),
      !missed.length ? h('p', { class: 'muted', text: t('result.missed_none') }) : null,
      missed.length && !reveal ? h('div', { class: 'callout info' }, icon('lock'), h('span', { text: t('result.locked_note') })) : null,
      missed.map((r, i) => reviewCard(r, i + 1, { reveal, missed: true }))),
    h('div', { class: 'row qz-actions' }, backToCourse())));
}

function recallResult(res) {
  let next = null;
  if (nextRecall && nextRecall !== 'none') next = t('result.next_recall', { day: nextRecall.day, date: fmtLongDate(nextRecall.due_date) });
  else if (nextRecall === 'none') next = t('result.recall_last');
  render(app, h('div', { class: `qz stack lg ${familyClass(res.course || code)}` },
    hero({ variant: 'neutral', iconName: 'refresh', eyebrow: t('result.recall_eyebrow', { day: res.day || dayParam || '', code: res.course || code }), res,
      title: t('result.recall_heading'), body: t('result.recall_body_score', { n: res.n_correct, total: res.n_items }),
      extra: next ? h('p', { class: 'qz-next' }, icon('calendar', 'sm'), h('span', { text: next })) : null,
      actions: [backToCourse('btn-primary')] }),
    h('section', { class: 'stack', 'aria-labelledby': 'qz-ans-h' },
      h('h2', { id: 'qz-ans-h', text: t('result.review_title') }),
      (res.review || []).map((r, i) => reviewCard(r, i + 1, { reveal: true })))));
}
async function loadNextRecall(res) {
  try {
    const me = await api.me();
    const row = (me.courses || []).find((c) => c.code === (res.course || code));
    const day = Number(res.day || dayParam || 0);
    const nxt = row ? (row.recall || []).filter((r) => Number(r.day) > day && r.status !== 'done').sort((a, b) => a.day - b.day)[0] : null;
    nextRecall = nxt || 'none';
    if (current && app.querySelector('.qz-hero')) current();
  } catch (e) { /* optional line */ }
}

function fatal(err, retry) {
  render(app, h('div', { class: 'qz stack lg' }, h('section', { class: 'card pad stack' }, h('h1', { class: 'qz-h1', text: t('quiz.error_title') }), errorState(err, retry), backToCourse())));
}

// ---------- boot ----------
async function openReview(id) {
  render(app, loading());
  try {
    const [c, res] = await Promise.all([loadCatalog(), api.review(id)]);
    cat = c;
    course = cat.courses.find((x) => x.code === (res.course || code)) || null;
    showResult(res, id);
  } catch (e) {
    if (e.code === 'not_found') { show(() => stateView('not_found')); return; }
    show(() => fatal(e, () => openReview(id)));
  }
}

async function init() {
  render(app, loading());
  if (reviewId) { await openReview(reviewId); return; }
  if (!TYPES.includes(type) || !code) { show(() => stateView('not_found')); return; }
  let me;
  try {
    [cat, me] = await Promise.all([loadCatalog(), api.me()]);
  } catch (e) { show(() => fatal(e, init)); return; }
  course = cat.courses.find((c) => c.code === code) || null;
  live = ((me && me.courses) || []).find((c) => c.code === code) || null;
  if (!course) { show(() => stateView('not_found')); return; }
  const pre = preState();
  if (pre) { show(() => stateView(pre.kind, pre)); return; }
  show(() => introView());
}

init();
