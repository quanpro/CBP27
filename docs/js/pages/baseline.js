// baseline.html — the 60-minute baseline (specs/14, specs/19 F7/F8/F9).
// Intro (privacy, parts, timing) → Part A self-rating (all 10 before Part B) → Part B (40 items by
// course) → Part C (mini case, case panel sticky on desktop / collapsible on phones) → review → submit.
// Timer from deadline_at and the server clock; at 0:00 the answers (with self-ratings) are submitted.
// Result: overall %, readiness bars per course with the self-rating marker, the two largest gaps.
// No item feedback and no answer key, ever.
import { mountShell, h, icon, chip, codeBadge, render, loading, emptyState, errorState, errorMessage, toast, confirmDialog, modal } from '../ui.js';
import { t, pick, getLang, onLangChange } from '../i18n.js';
import { api, serverNow } from '../api.js';
import { loadCatalog, fmtLongDate } from '../courses.js';
import { QuizRunner, buildTop, createTimer, timerChip, announce, scrollToEl } from '../quiz.js';

const { app } = await mountShell({ page: 'baseline', focus: true, exitHref: 'index.html' });
app.classList.add('narrow');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cat = null; let me = null; let start = null; let runner = null; let timer = null; let tchip = null;
let current = null; let itemsB = []; let itemsC = []; let groupsB = [];
let caseOpen = true; let submitting = false;
const spoken = new Set();

function show(fn) {
  if (runner) runner.hide();
  current = fn;
  fn();
}
onLangChange(() => {
  if (tchip) tchip.repaint();
  if (runner && runner.active) { runner.rerender(); return; }
  if (current) keepPlace(current);
});
/** Re-draw a page-level view keeping the scroll position and focus (language switch). */
function keepPlace(fn) {
  const fk = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fk : null;
  const limit = (document.querySelector('.app-header') || { offsetHeight: 64 }).offsetHeight + ((document.querySelector('.qz-top') || {}).offsetHeight || 0);
  const anchors = Array.from(app.querySelectorAll('[data-anchor]'));
  const a = anchors.find((el) => el.getBoundingClientRect().bottom > limit + 8);
  const key = a ? a.dataset.anchor : null; const top = a ? a.getBoundingClientRect().top : 0;
  fn();
  if (key) { const el = app.querySelector(`[data-anchor="${CSS.escape(key)}"]`); if (el) window.scrollBy(0, el.getBoundingClientRect().top - top); }
  if (fk) { const el = Array.from(app.querySelectorAll('[data-fk]')).find((x) => x.dataset.fk === fk); if (el) el.focus({ preventScroll: true }); }
}

// ---------- data helpers ----------
const catCourse = (code) => (cat && cat.courses.find((c) => c.code === code)) || null;
const courseName = (code) => { const c = catCourse(code); return c ? pick(c, 'name') : code; };
const ORDER = () => (cat ? cat.courses.slice().sort((a, b) => a.order - b.order).map((c) => c.code) : []);
const selfList = () => (start && start.self) || [];
const isRated = (v) => v !== undefined && v !== null && v !== '';
const ratedCount = () => selfList().filter((s) => isRated(runner.self[s.course])).length;
const allRated = () => selfList().length > 0 && ratedCount() === selfList().length;
function waveLabel(wave) {
  if (!/^\d{4}-\d{2}$/.test(wave || '')) return wave || '';
  return new Intl.DateTimeFormat(getLang() === 'vi' ? 'vi-VN' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(`${wave}-15T12:00:00+07:00`));
}
function scaleList() {
  const catScale = (cat && cat.scale) || [];
  const src = start && Array.isArray(start.scale) && start.scale.length ? start.scale : catScale;
  const strip = (v) => String(v || '').replace(/^\s*\d+\s*[·.:-]\s*/, '').replace(/\s*\([A-Z]{2}\)\s*$/, '').trim();
  return src.map((s) => {
    const c = catScale.find((x) => Number(x.level) === Number(s.level)) || {};
    const label = strip(s[getLang()] || s.en) || c[getLang()] || c.en || '';
    return { level: Number(s.level), label, abbr: c.abbr || '', short: c.abbr || label, desc: pick(s, 'desc') || pick(c, 'desc') };
  }).sort((a, b) => a.level - b.level);
}
const levelOf = (n) => scaleList().find((s) => s.level === Number(n));

// ---------- window states ----------
function stateView(kind, info = {}) {
  const S = {
    before: ['calendar', t('baseline.state.before_title', { date: fmtLongDate(info.open_from) }), t('baseline.state.before_body', { from: fmtLongDate(info.open_from), to: fmtLongDate(info.open_to) })],
    after: ['lock', t('baseline.state.after_title'), t('baseline.state.after_body', { date: fmtLongDate(info.open_to) })],
    grading: ['clock', t('baseline.state.grading_title'), t('baseline.state.grading_body')],
  };
  const [ic, title, body] = S[kind] || S.after;
  render(app, h('div', { class: 'qz bl stack lg' },
    h('section', { class: 'card qz-state' }, emptyState({ iconName: ic, title, body, action: h('a', { class: 'btn btn-primary', href: 'index.html' }, t('baseline.back_home')) }))));
}
function fatal(err, retry) {
  render(app, h('div', { class: 'qz bl stack lg' }, h('section', { class: 'card pad stack' }, h('h1', { class: 'qz-h1', text: t('baseline.error_title') }), errorState(err, retry),
    h('a', { class: 'btn btn-ghost', href: 'index.html' }, t('baseline.back_home')))));
}

// ---------- intro ----------
function introView(err) {
  const b = me.baseline || {};
  const resuming = b.status === 'in_progress';
  const minsLeft = resuming && b.deadline_at ? Math.max(0, Math.ceil((Date.parse(b.deadline_at) - serverNow()) / 60000)) : null;
  const parts = [
    ['A', 'baseline.part_a_name', 'baseline.part_a_what', 6],
    ['B', 'baseline.part_b_name', 'baseline.part_b_what', 40],
    ['C', 'baseline.part_c_name', 'baseline.part_c_what', 14],
  ];
  const btn = h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: (e) => begin(e.currentTarget, resuming) },
    h('span', { text: resuming ? t('baseline.continue') : t('baseline.start') }), icon('arrow-right'));
  render(app, h('div', { class: 'qz bl qz-intro stack lg fam-A' },
    h('article', { class: 'card qz-intro-card', 'aria-labelledby': 'bl-title' },
      h('div', { class: 'qz-band', 'aria-hidden': 'true' }),
      h('div', { class: 'pad stack' },
        h('p', { class: 'eyebrow', text: t('baseline.eyebrow', { wave: waveLabel(b.wave) }) }),
        h('h1', { id: 'bl-title', text: resuming ? t('baseline.title_back') : t('baseline.title') }),
        h('p', { class: 'lead', text: resuming ? t('baseline.lead_back', { count: minsLeft }) : t('baseline.lead') }),
        h('div', { class: 'callout info bl-privacy' }, icon('shield'), h('div', { class: 'stack sm' }, h('b', { text: t('baseline.privacy_title') }), h('span', { text: t('baseline.privacy_body') }))),
        h('h2', { class: 'bl-h2', text: t('baseline.parts_title') }),
        h('ol', { class: 'bl-parts' }, parts.map(([k, name, what, min]) => h('li', { class: 'bl-part' },
          h('span', { class: 'bl-part-k', 'aria-hidden': 'true', text: k }),
          h('div', { class: 'stack sm' }, h('b', { class: 'ink', text: t(name) }), h('span', { class: 'small muted', text: t(what) })),
          h('span', { class: 'chip', title: t('baseline.minutes_aria', { n: min }) }, icon('clock'), t('baseline.about_min', { n: min }))))),
        h('h2', { class: 'bl-h2', text: t('baseline.how_title') }),
        h('ul', { class: 'qz-facts' }, [
          ['clock', t('baseline.how_timer')],
          ['cloud', t('baseline.how_save')],
          ['eye-off', t('baseline.how_feedback')],
          ['target', t('baseline.how_alone')],
          ['calendar', t('baseline.how_window', { date: fmtLongDate(b.open_to) })],
        ].map(([ic, text]) => h('li', null, h('span', { class: 'qz-fact-ico', 'aria-hidden': 'true' }, icon(ic)), h('span', { text })))),
        err ? errorState(err) : null,
        h('div', { class: 'row qz-actions' }, btn, h('span', { class: 'small muted', text: resuming ? t('baseline.left_note', { count: minsLeft }) : t('baseline.start_note') }))))));
}

async function begin(btn, resuming) {
  if (!resuming) {
    const ok = await confirmDialog({ title: t('baseline.confirm_title'), body: t('baseline.confirm_body'), confirm: t('baseline.confirm_yes'), cancel: t('baseline.confirm_no') });
    if (!ok) return;
  }
  btn.disabled = true;
  try {
    start = await api.start('baseline');
  } catch (e) {
    btn.disabled = false;
    if (e.code === 'already_submitted') { await boot(); return; }
    if (e.code === 'not_open') { show(() => stateView('before', me.baseline || {})); return; }
    show(() => introView(e));
    return;
  }
  setup();
}

// ---------- attempt ----------
function setup() {
  const items = start.items || [];
  itemsC = items.filter((i) => i.case_id);
  itemsB = items.filter((i) => !i.case_id);
  groupsB = [];
  for (const it of itemsB) {
    const last = groupsB[groupsB.length - 1];
    if (last && last.code === it.course) last.items.push(it); else groupsB.push({ code: it.course, items: [it] });
  }
  runner = new QuizRunner({ start, withSelf: true, onGone: () => gone() });
  tchip = timerChip();
  timer = createTimer({
    deadlineAt: start.deadline_at,
    onTick: (ms) => { tchip.set(ms); milestones(ms); },
    onLow: () => toast(t('baseline.low_toast')),
    onExpire: () => autoSubmit(),
  });
  if (start.resumed) announce(t('baseline.resumed'));
  const part = runner.pos.part;
  if (allRated() && (part === 'B' || part === 'C')) viewQ(part);
  else if (allRated() && part === 'review') viewReview();
  else viewA();
}
function milestones(ms) {
  for (const m of [10, 5, 1]) {
    if (ms <= m * 60000 && ms > (m - 1) * 60000 && !spoken.has(m)) { spoken.add(m); announce(t('baseline.minutes_left', { count: m })); }
  }
}

function partHeader(part) {
  const min = { A: 6, B: 40, C: 14 }[part];
  return h('header', { class: 'bl-part-head stack sm', 'data-anchor': `head-${part}` },
    h('div', { class: 'row tight' }, h('span', { class: 'bl-part-k', 'aria-hidden': 'true', text: part }), h('span', { class: 'eyebrow', text: t('baseline.part_n', { part }) }), h('span', { class: 'xs muted bl-pace', text: t('baseline.pace', { n: min }) })),
    h('h1', { class: 'qz-h1', text: t(`baseline.part_${part.toLowerCase()}_name`) }),
    h('p', { class: 'muted', text: t(`baseline.part_${part.toLowerCase()}_hint`) }));
}

// ---------- Part A: self-rating ----------
function viewA() {
  show(() => renderA());
  runner.setPos({ part: 'A' });
}
function renderA() {
  app.classList.add('narrow');
  const self = selfList();
  const scale = scaleList();
  const total = self.length;
  const top = buildTop({ title: t('baseline.top', { part: 'A' }), pill: runner.pill.el, timerEl: tchip.el, n: ratedCount(), total, countText: t('baseline.rated', { n: ratedCount(), total }) });
  const err = h('p', { class: 'err bl-err', role: 'alert', hidden: true });
  const onRated = () => {
    const n = ratedCount();
    top.update(n, total, t('baseline.rated', { n, total }));
    if (n === total) err.hidden = true;
  };
  render(app, h('div', { class: 'qz bl stack lg' }, top.el,
    partHeader('A'),
    scaleLegend(scale),
    h('div', { class: 'stack' }, self.map((s, i) => rateCard(s, i, scale, onRated))),
    h('div', { class: 'stack sm' }, err,
      h('div', { class: 'q-nav' }, h('span'), h('button', { class: 'btn btn-primary btn-lg', type: 'button', 'data-fk': 'to-b', onclick: () => continueA(err) }, h('span', { text: t('baseline.to_b') }), icon('arrow-right'))))));
}
function scaleLegend(scale) {
  return h('section', { class: 'card pad bl-scale', 'aria-labelledby': 'bl-scale-h', 'data-anchor': 'scale' },
    h('h2', { id: 'bl-scale-h', class: 'bl-h3', text: t('baseline.scale_title') }),
    h('ol', { class: 'bl-scale-list' }, scale.map((lv) => h('li', { id: `bl-lv-${lv.level}` },
      h('span', { class: 'bl-lv', 'aria-hidden': 'true', text: String(lv.level) }),
      h('span', null, h('b', { class: 'ink', text: lv.abbr ? `${lv.label} (${lv.abbr})` : lv.label }), h('span', { class: 'muted', text: ` · ${lv.desc}` }))))));
}
function rateCard(s, i, scale, onRated) {
  const sid = `bl-stmt-${s.course}`;
  const picked = h('p', { class: 'bl-picked small' });
  const status = h('span', { class: 'bl-rate-status small' });
  const buttons = scale.map((lv) => {
    const b = h('button', { type: 'button', 'aria-pressed': 'false', 'data-fk': `rate|${s.course}|${lv.level}`, 'aria-describedby': `bl-lv-${lv.level}` },
      h('b', { text: String(lv.level) }), h('span', { class: 'bl-lbl-full', text: lv.label }), h('span', { class: 'bl-lbl-short', text: lv.short }));
    b.addEventListener('click', () => choose(lv.level));
    return b;
  });
  const row = h('div', { class: 'scale-row bl-scale-row', role: 'group', 'aria-labelledby': sid }, buttons);
  row.addEventListener('keydown', (e) => {
    const idx = buttons.indexOf(document.activeElement);
    if (idx < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = Math.min(buttons.length - 1, idx + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = Math.max(0, idx - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = buttons.length - 1;
    else if (/^[0-4]$/.test(e.key)) { e.preventDefault(); choose(Number(e.key)); buttons[Number(e.key)].focus(); return; }
    if (next >= 0) { e.preventDefault(); buttons[next].focus(); }
  });
  const card = h('section', { class: 'card bl-rate', id: `rate-${s.course}`, 'aria-labelledby': sid, 'data-anchor': `rate-${s.course}` },
    h('div', { class: 'bl-rate-head' }, codeBadge(s.course), h('span', { class: 'bl-rate-course small', text: courseName(s.course) }), status),
    h('p', { class: 'bl-stmt', id: sid }, h('span', { class: 'sr-only', text: t('baseline.stmt_n', { n: i + 1, total: selfList().length }) }), s[getLang()] || s.en),
    row, picked);
  function paint() {
    const v = runner.self[s.course];
    const has = isRated(v);
    buttons.forEach((b, k) => {
      const on = has && Number(v) === scale[k].level;
      b.setAttribute('aria-pressed', String(on));
      b.tabIndex = (has ? on : k === 0) ? 0 : -1;
    });
    const lv = has ? scale.find((x) => x.level === Number(v)) : null;
    picked.textContent = lv ? `${lv.level} · ${lv.label} — ${lv.desc}` : t('baseline.pick_one');
    picked.classList.toggle('muted', !lv);
    render(status, has ? h('span', { class: 'bl-ok' }, icon('check', 'sm'), t('baseline.rated_one')) : h('span', { class: 'muted', text: t('baseline.not_rated') }));
    card.classList.toggle('is-rated', has);
  }
  function choose(level) { runner.setSelf(s.course, level); paint(); onRated(); }
  paint();
  return card;
}
function continueA(err) {
  const self = selfList();
  const missing = self.filter((s) => !isRated(runner.self[s.course]));
  if (missing.length) {
    err.hidden = false;
    render(err, icon('alert', 'sm'), h('span', { text: t('baseline.rate_all', { count: missing.length, total: self.length }) }));
    const card = document.getElementById(`rate-${missing[0].course}`);
    if (card) { scrollToEl(card); const b = card.querySelector('.scale-row button'); if (b) b.focus({ preventScroll: true }); }
    return;
  }
  viewQ('B', 'first');
}

// ---------- Parts B and C (runner) ----------
function viewQ(part, startAt) {
  if (!allRated()) { viewA(); return; }
  if (runner) runner.hide();
  current = null;
  app.classList.toggle('narrow', part !== 'C');
  runner.show(app, part === 'B' ? cfgB(startAt) : cfgC(startAt));
}
function groupHeader(g) {
  return h('header', { class: `bl-group-head fam-${g.code.charAt(0)}` }, codeBadge(g.code),
    h('div', null, h('h2', { class: 'bl-group-title', text: courseName(g.code) }), h('p', { class: 'small muted', text: t('baseline.group_n', { count: g.items.length }) })));
}
function cfgB(startAt) {
  return {
    key: 'B',
    groups: groupsB.map((g) => ({ key: g.code, items: g.items, label: courseName(g.code), header: () => groupHeader(g) })),
    paging: 'group',
    title: () => t('baseline.top', { part: 'B' }),
    timerEl: tchip.el,
    intro: () => partHeader('B'),
    dotLabel: (sc) => sc.key,
    dotAria: (sc, i, answered) => t('baseline.dot_group', { code: sc.key, n: answered, total: sc.items.length }),
    backLabel: t('baseline.back_a'), onBack: () => viewA(),
    doneLabel: t('baseline.to_c'), onDone: () => viewQ('C', 'first'),
    reviewLinkLabel: t('baseline.review_link'), onReviewLink: () => viewReview(),
    startAt,
  };
}
function cfgC(startAt) {
  return {
    key: 'C',
    groups: [{ key: 'case', items: itemsC }],
    paging: 'item',
    title: () => t('baseline.top', { part: 'C' }),
    timerEl: tchip.el,
    metaKey: 'baseline.case_q_of',
    intro: () => partHeader('C'),
    aside: (mode) => casePanel(mode),
    backLabel: t('baseline.back_b'), onBack: () => viewQ('B', 'last'),
    doneLabel: t('baseline.to_review'), onDone: () => viewReview(),
    reviewLinkLabel: t('baseline.review_link'), onReviewLink: () => viewReview(),
    startAt,
  };
}
function casePanel(mode) {
  const c = (start && start.case) || {};
  const paras = String(pick(c, 'context') || '').split(/\n+/).map((p) => p.trim()).filter(Boolean).map((p) => h('p', { text: p }));
  const title = pick(c, 'title');
  if (mode === 'list') {
    return h('aside', { class: 'case-panel sticky bl-case', 'aria-labelledby': 'bl-case-h' },
      h('p', { class: 'eyebrow', text: t('baseline.case_eyebrow') }),
      h('h2', { id: 'bl-case-h', class: 'bl-case-title', text: title }),
      h('div', { class: 'stack sm bl-case-body' }, paras));
  }
  const d = h('details', { class: 'case-panel bl-case', open: caseOpen },
    h('summary', { class: 'bl-case-sum' },
      h('span', { class: 'stack sm' }, h('span', { class: 'eyebrow', text: t('baseline.case_eyebrow') }), h('span', { class: 'bl-case-title', text: title })),
      h('span', { class: 'bl-case-toggle small' }, h('span', { class: 'when-open', text: t('baseline.case_hide') }), h('span', { class: 'when-closed', text: t('baseline.case_show') }), icon('chevron-down', 'sm'))),
    h('div', { class: 'stack sm bl-case-body' }, paras));
  d.addEventListener('toggle', () => { caseOpen = d.open; });
  return d;
}

// ---------- review ----------
function viewReview(err) {
  show(() => renderReview(err));
  runner.setPos({ part: 'review' });
}
function renderReview(err) {
  app.classList.add('narrow');
  const self = selfList();
  const nA = ratedCount();
  const leftB = runner.unanswered(itemsB); const leftC = runner.unanswered(itemsC);
  const total = itemsB.length + itemsC.length; const n = total - leftB.length - leftC.length;
  const top = buildTop({ title: t('baseline.top_review'), pill: runner.pill.el, timerEl: tchip.el, n, total });
  const jumpB = (it) => { viewQ('B', it.item_id); runner.jumpTo(it.item_id); };
  const jumpC = (it) => { viewQ('C', it.item_id); runner.jumpTo(it.item_id); };
  const rowFor = (part, done, all, left, onOpen, jump, labelOf) => h('li', { class: `bl-rev-row${left.length ? ' has-left' : ''}` },
    h('span', { class: 'bl-rev-ico', 'aria-hidden': 'true' }, icon(left.length ? 'alert' : 'check-circle')),
    h('div', { class: 'stack sm bl-rev-main' },
      h('div', { class: 'bl-rev-head' },
        h('b', { class: 'ink', text: `${t('baseline.part_n', { part })} · ${t(`baseline.part_${part.toLowerCase()}_name`)}` }),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: onOpen }, t('baseline.open_part'), icon('chevron-right', 'sm'))),
      h('span', { class: 'small', text: part === 'A' ? t('baseline.rated', { n: done, total: all }) : t('quiz.answered', { n: done, total: all }) }),
      part === 'B' && left.length ? h('span', { class: 'small muted', text: t('baseline.jump_course_hint') }) : null,
      left.length && jump ? h('div', { class: 'row tight qz-jumps' }, h('span', { class: 'small muted', text: t('quiz.review.jump_label') }),
        left.map((it) => h('button', { class: 'btn btn-secondary btn-sm', type: 'button', 'aria-label': t('baseline.jump_aria', { label: labelOf(it) }), onclick: () => jump(it) }, labelOf(it)))) : null));
  const numB = new Map(itemsB.map((it, i) => [it.item_id, i + 1]));
  const numC = new Map(itemsC.map((it, i) => [it.item_id, i + 1]));
  const leftTotal = leftB.length + leftC.length;
  render(app, h('div', { class: 'qz bl stack lg' }, top.el,
    h('section', { class: 'card pad stack', 'aria-labelledby': 'bl-rev-h' },
      h('h1', { id: 'bl-rev-h', class: 'qz-h1', text: t('baseline.review_title') }),
      h('ul', { class: 'bl-rev' },
        rowFor('A', nA, self.length, [], () => viewA()),
        rowFor('B', itemsB.length - leftB.length, itemsB.length, firstPerCourse(leftB), () => viewQ('B', 'first'), jumpB, (it) => t('baseline.jump_course', { code: it.course, count: leftB.filter((x) => x.course === it.course).length })),
        rowFor('C', itemsC.length - leftC.length, itemsC.length, leftC, () => viewQ('C', 'first'), jumpC, (it) => t('quiz.q_short', { n: numC.get(it.item_id) }))),
      h('div', { class: `callout ${leftTotal ? 'warn' : 'info'}` }, icon(leftTotal ? 'alert' : 'lock'),
        h('span', { text: leftTotal ? t('baseline.review_left', { count: leftTotal }) : t('baseline.review_done') })),
      err ? h('div', { class: 'callout bad qz-submit-err', role: 'alert', tabindex: '-1' }, icon('wifi-off'),
        h('span', { text: err.code === 'network' ? t('quiz.review.submit_offline') : `${t('quiz.review.submit_failed')} ${errorMessage(err)}` })) : null,
      h('div', { class: 'q-nav qz-actions' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => viewQ('C', 'last') }, icon('chevron-left'), h('span', { text: t('baseline.back_c') })),
        h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: () => doSubmit() }, icon('send'), h('span', { text: t('baseline.submit') }))))));
  const focusEl = err ? app.querySelector('.qz-submit-err') : app.querySelector('h1');
  if (focusEl) { focusEl.setAttribute('tabindex', '-1'); focusEl.focus({ preventScroll: true }); }
  window.scrollTo({ top: 0, behavior: 'auto' });
}

/** One jump per course: its first unanswered question. */
function firstPerCourse(items) {
  const seen = new Set();
  return items.filter((it) => (seen.has(it.course) ? false : (seen.add(it.course), true)));
}

async function doSubmit() {
  const left = runner.unanswered(itemsB).length + runner.unanswered(itemsC).length;
  if (!allRated()) { viewA(); return; }
  const ok = await confirmDialog({
    title: t('baseline.confirm_submit_title'),
    body: left ? t('baseline.confirm_submit_left', { count: left }) : t('baseline.confirm_submit_done'),
    confirm: t('baseline.confirm_submit_yes'), cancel: t('quiz.review.confirm_no'),
  });
  if (!ok || submitting) return;
  submitting = true;
  show(() => render(app, h('div', { class: 'qz bl' }, loading(t('baseline.submitting')))));
  try {
    const res = await runner.submit();
    if (timer) timer.stop();
    showResult(res);
  } catch (e) {
    submitting = false;
    show(() => renderReview(e));
  }
}

async function autoSubmit() {
  if (submitting || !runner || runner.submitted) return;
  submitting = true;
  const msg = h('span', { class: 'small muted', text: t('baseline.timeup_sending') });
  const dlg = modal({ title: t('baseline.timeup_title'), dismissable: false,
    body: h('div', { class: 'stack' }, h('p', { text: t('baseline.timeup_body') }), h('div', { class: 'row', role: 'status', 'aria-live': 'polite' }, h('span', { class: 'spinner' }), msg)) });
  announce(t('baseline.timeup_title'));
  for (let i = 0; i < 30; i += 1) {
    try {
      const res = await runner.submit();
      dlg.close();
      showResult(res);
      return;
    } catch (e) {
      if (['network', 'busy', 'server_error'].includes(e.code)) {
        msg.textContent = t('baseline.timeup_retry');
        await sleep(Math.min(15000, 3000 * (i + 1)));
        continue;
      }
      break; // the server grades from the last save (specs/19 F8)
    }
  }
  dlg.close();
  if (runner) runner.destroy();
  await boot({ graded: true });
}

async function gone() {
  if (timer) timer.stop();
  toast(t('quiz.gone'));
  await boot({ graded: true });
}

// ---------- result ----------
function showResult(res) {
  if (timer) timer.stop();
  runner = null;
  const prev = me && me.baseline ? me.baseline.previous : null;
  show(() => renderResult(res, prev));
  const h1 = app.querySelector('h1');
  if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
  window.scrollTo({ top: 0, behavior: 'auto' });
}
function renderResult(res, prev) {
  app.classList.add('narrow');
  const order = ORDER();
  const by = res.by_course || {};
  const self = res.self || {};
  const gaps = (res.gaps || []).slice(0, 2);
  const lvText = (n) => { const lv = levelOf(n); return lv ? `${lv.level} · ${lv.abbr || lv.label}` : '–'; };
  const lvFull = (n) => { const lv = levelOf(n); return lv ? `${lv.level} · ${lv.label}` : '–'; };
  const bars = order.filter((c) => by[c] !== undefined).map((c) => {
    const pct = Math.max(0, Math.min(100, Number(by[c]) || 0));
    const lv = isRated(self[c]) ? Number(self[c]) : null;
    const fill = h('i'); fill.style.width = `${pct}%`;
    const mark = lv !== null ? h('b', { class: 'bl-mark' }) : null;
    if (mark) mark.style.left = lv === 0 ? '0px' : `calc(${Math.min(100, lv * 25)}% - 3px)`;
    return h('div', { class: 'bar-row bl-bar', 'data-anchor': `bar-${c}` },
      codeBadge(c),
      h('div', { class: 'bl-bar-main' },
        h('span', { class: 'bl-bar-name', 'aria-hidden': 'true', text: courseName(c) }),
        h('div', { class: 'track', 'aria-hidden': 'true' }, fill, mark),
        h('span', { class: 'sr-only', text: t('baseline.bar_sr', { name: courseName(c), pct, lv: lv !== null ? lvText(lv) : '–' }) })),
      h('span', { class: 'bl-bar-val', 'aria-hidden': 'true' }, h('b', { text: `${pct}%` }), lv !== null ? h('span', { class: 'bl-bar-self', text: t('baseline.self_short', { lv: lv.toString() }) }) : null));
  });
  const delta = prev && typeof prev.score_pct === 'number' ? res.score_pct - prev.score_pct : null;
  render(app, h('div', { class: 'qz bl stack lg' },
    h('section', { class: 'result-hero neutral qz-hero', 'aria-labelledby': 'bl-res-h' },
      h('div', { class: 'qz-hero-head' },
        h('span', { class: 'qz-hero-icon', 'aria-hidden': 'true' }, icon('flag', 'lg')),
        h('div', { class: 'qz-hero-meta' },
          h('p', { class: 'eyebrow', text: t('baseline.eyebrow', { wave: waveLabel(me && me.baseline ? me.baseline.wave : '') }) }),
          h('div', { class: 'qz-score', role: 'img', 'aria-label': t('baseline.score_aria', { pct: res.score_pct }) }, h('span', { class: 'score-big', text: `${res.score_pct}%` }), h('span', { class: 'qz-score-pct', text: t('baseline.overall') })))),
      h('h1', { id: 'bl-res-h', class: 'qz-hero-title', text: t('baseline.result_title') }),
      h('p', { class: 'qz-hero-body', text: t('baseline.result_body') }),
      delta !== null ? h('p', { class: 'qz-next' }, icon('trend-up', 'sm'), h('span', { text: t('baseline.result_prev', { prev: prev.score_pct, wave: waveLabel(prev.wave), delta: delta >= 0 ? `+${delta}` : String(delta) }) })) : null),
    gaps.length ? h('section', { class: 'callout warn bl-gap-card', 'aria-labelledby': 'bl-gaps-h' }, icon('target'),
      h('div', { class: 'stack sm' },
        h('h2', { id: 'bl-gaps-h', class: 'bl-h3', text: t('baseline.gaps_title') }),
        h('ol', { class: 'bl-gap-list' }, gaps.map((c) => h('li', null, codeBadge(c),
          h('span', { class: 'stack sm' }, h('b', { class: 'ink', text: courseName(c) }),
            h('span', { class: 'small', text: t('baseline.gap_score', { pct: by[c] !== undefined ? by[c] : '–' }) }),
            h('span', { class: 'small', text: t('baseline.gap_self', { lv: isRated(self[c]) ? lvFull(self[c]) : '–' }) }))))),
        h('p', { class: 'strong ink', text: t('baseline.gaps_idp') }))) : null,
    h('section', { class: 'card pad stack', 'aria-labelledby': 'bl-bars-h' },
      h('h2', { id: 'bl-bars-h', text: t('baseline.bars_title') }),
      h('p', { class: 'small muted', text: t('baseline.bars_body') }),
      h('div', { class: 'legend bl-legend', 'aria-hidden': 'true' },
        h('span', { class: 'bl-key' }, h('i', { class: 'bl-key-bar' }), t('baseline.legend_bar')),
        h('span', { class: 'bl-key' }, h('i', { class: 'bl-key-line' }), t('baseline.legend_line'))),
      h('div', { class: 'bars bl-bars' }, bars),
      h('p', { class: 'xs muted', text: t('baseline.scale_note') })),
    h('p', { class: 'small muted bl-nofeedback' }, icon('eye-off', 'sm'), h('span', { text: t('baseline.no_feedback') })),
    h('div', { class: 'row qz-actions' }, h('a', { class: 'btn btn-primary', href: 'index.html' }, icon('home'), h('span', { text: t('baseline.back_home') })))));
}

// ---------- boot ----------
async function boot({ graded = false } = {}) {
  render(app, loading());
  try {
    const [c, m] = await Promise.all([loadCatalog(), api.me()]);
    cat = c; me = m;
  } catch (e) { show(() => fatal(e, () => boot())); return; }
  const b = me.baseline || {};
  submitting = false;
  if (b.status === 'submitted' && b.result) { showResult({ assessment: 'baseline', ...b.result }); return; }
  if (b.status === 'submitted' || graded) { show(() => stateView('grading', b)); return; }
  if (b.status !== 'in_progress' && b.window === 'before') { show(() => stateView('before', b)); return; }
  if (b.status !== 'in_progress' && b.window === 'after') { show(() => stateView('after', b)); return; }
  show(() => introView());
}

boot();
