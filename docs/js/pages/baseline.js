// baseline.html?part=1|2|3 — Baseline v2, one part per sitting (specs/22, design in specs/21).
// Intro (privacy, timing, calculator, no penalty for guessing) → sitting → review → submit →
// "Part N done · time used" (no score, no item feedback: that keeps the December 2027 re-test valid).
// - One timer per part from deadline_at and the server clock; it can be hidden, comes back at 10 and
//   5 minutes left, and submits the saved answers at 0:00.
// - Local-first autosave (quiz.js createAutosave): every change is written to the device at once and
//   to the Hub at most every 20 s, on page hide (keepalive) and before leaving. Resume after reload.
// - Part 1: Sections A and B with free navigation, a question navigator, the exhibits of each item
//   (sticky beside the question on desktop, collapsible above it on phones) and the case titles.
// - Part 2: 2A situational judgement (most + least effective, never the same option) is locked with
//   baseline_next before the 2B self-rating statements are sent. Charter names are never shown.
// - Part 3: the ten course self-ratings first, then CORE and the role module; the KPI glossary is
//   always one tap away.
// Every Sheet text is inserted as text (h() / textContent; exhibits via md.js), never as HTML.
// Items never carry answer keys and this file never looks for them.
import { mountShell, h, icon, chip, codeBadge, render, loading, errorState, errorMessage, toast, confirmDialog, modal, qs } from '../ui.js';
import { t, pick, getLang, onLangChange } from '../i18n.js';
import { api, serverNow } from '../api.js';
import { loadCatalog } from '../courses.js';
import { buildTop, createTimer, timerChip, announce, scrollToEl, createAutosave, createSavePill, readDraft, writeDraft, clearDraft, optionText, LETTERS } from '../quiz.js';
import { mdBlocks } from '../md.js';
import { PARTS, partTile, partName, partOf, waveLabel, fmtDuration, usedSeconds, minutesLeft } from '../bl2.js';

const { app } = await mountShell({ page: 'baseline', focus: true, exitHref: 'index.html' });
app.classList.add('narrow');

const WIDE = window.matchMedia('(min-width: 960px)');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const okLevel = (v) => v !== undefined && v !== null && v !== '' && Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 4;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const S = {
  part: null, cat: null, me: null, start: null,
  sections: [], items: new Map(), order: [],
  answers: {}, self: {}, changedAt: 0, syncedAt: 0, savedAt: null,
  pos: {}, pill: null, autosave: null, timer: null, tchip: null,
  view: null, submitting: false, locking: false, finished: false, spoken: new Set(),
};

// ---------- view plumbing ----------
function show(fn) { S.view = fn; fn(); }
function keepPlace(fn) {
  const fk = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fk : null;
  const limit = (document.querySelector('.app-header') || { offsetHeight: 64 }).offsetHeight + ((document.querySelector('.qz-top') || {}).offsetHeight || 0);
  const a = Array.from(app.querySelectorAll('[data-anchor]')).find((el) => el.getBoundingClientRect().bottom > limit + 8);
  const key = a ? a.dataset.anchor : null; const top = a ? a.getBoundingClientRect().top : 0;
  fn();
  if (key) { const el = app.querySelector(`[data-anchor="${CSS.escape(key)}"]`); if (el) window.scrollBy(0, el.getBoundingClientRect().top - top); }
  if (fk) { const el = Array.from(app.querySelectorAll('[data-fk]')).find((x) => x.dataset.fk === fk); if (el) el.focus({ preventScroll: true }); }
}
onLangChange(() => {
  if (S.tchip) S.tchip.repaint();
  if (S.pill) S.pill.repaint();
  if (S.view) keepPlace(S.view);
});
WIDE.addEventListener('change', () => { if (S.view && S.pos.view === 'q') keepPlace(S.view); });
const toTop = () => window.scrollTo({ top: 0, behavior: 'auto' });
function focusH1() { const el = app.querySelector('h1'); if (el) { el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); } }

// ---------- data helpers ----------
const sec = (id) => S.sections.find((s) => s.id === id) || null;
const secItems = (id) => (sec(id) ? sec(id).items : []);
const qSections = () => S.sections.filter((s) => s.id !== 'RATE' && !(s.id === 'SJT' && s.locked));
const numOf = (id) => S.order.indexOf(id) + 1;
const total = () => S.order.length;
const answerable = (it) => it && (it.type === 'mcq' || it.type === 'sjt' || it.type === 'rating');
function isDone(it) {
  const v = S.answers[it.item_id];
  if (it.type === 'sjt') return !!(v && v.most && v.least && v.most !== v.least);
  if (it.type === 'rating') return v === 'NR' ? !!it.allow_nr : [1, 2, 3, 4].includes(Number(v)) && v !== null && v !== '';
  return !!v;
}
const doneIn = (items) => items.filter(isDone).length;
const selfList = () => (S.start && S.start.self) || [];
const ratedCount = () => selfList().filter((s) => okLevel(S.self[s.course])).length;
const allRated = () => selfList().length > 0 && ratedCount() === selfList().length;
const catCourse = (code) => (S.cat && S.cat.courses.find((c) => c.code === code)) || null;
const courseName = (code) => { const c = catCourse(code); return c ? pick(c, 'name') : code; };
const secTitle = (s) => pick(s, 'title') || t(`baseline.sec.${s.id}`);
const ps = () => partOf(S.me && S.me.baseline, S.part);

function validAnswer(it, v) {
  if (!it) return false;
  const opt = (x) => typeof x === 'string' && (it.options || []).some((o) => o.id === x);
  if (it.type === 'mcq') return opt(v);
  if (it.type === 'sjt') return !!v && typeof v === 'object' && (opt(v.most) || opt(v.least)) && (v.most == null || opt(v.most)) && (v.least == null || opt(v.least)) && !(v.most && v.most === v.least);
  if (it.type === 'rating') return (v === 'NR' && !!it.allow_nr) || ([1, 2, 3, 4].includes(Number(v)) && v !== null && v !== '' && v !== true);
  return false;
}
const cleanAnswers = (m) => Object.fromEntries(Object.entries(m && typeof m === 'object' ? m : {})
  .filter(([k, v]) => validAnswer(S.items.get(k), v))
  .map(([k, v]) => { const it = S.items.get(k); return [k, it.type === 'rating' && v !== 'NR' ? Number(v) : (it.type === 'sjt' ? { ...(v.most ? { most: v.most } : {}), ...(v.least ? { least: v.least } : {}) } : v)]; }));
const cleanSelf = (m) => Object.fromEntries(Object.entries(m && typeof m === 'object' ? m : {}).filter(([k, v]) => selfList().some((s) => s.course === k) && okLevel(v)).map(([k, v]) => [k, Number(v)]));

// ---------- local draft + autosave ----------
function persist() {
  if (!S.start) return;
  writeDraft(S.start.attempt_id, { v: 2, answers: S.answers, self_ratings: S.self, changed_at: S.changedAt, synced_at: S.syncedAt, saved_at: S.savedAt, pos: S.pos });
}
function setPos(patch) { Object.assign(S.pos, patch); persist(); }
function changed() {
  S.changedAt = Math.max(serverNow(), S.changedAt + 1);
  persist();
  if (S.autosave) S.autosave.touch();
}
function setAnswer(id, v) {
  if (S.finished) return;
  if (v === null || v === undefined) delete S.answers[id]; else S.answers[id] = v;
  changed();
}
function setSelf(course, level) {
  if (S.finished || S.self[course] === level) return;
  S.self[course] = level;
  changed();
}
const payload = () => JSON.parse(JSON.stringify(S.answers));
async function saveNow() {
  const at = S.changedAt;
  const res = await api.save(S.start.attempt_id, payload(), S.part === 3 ? { ...S.self } : undefined);
  S.syncedAt = Math.max(S.syncedAt, at);
  if (res && res.saved_at) S.savedAt = res.saved_at;
  persist();
  return res;
}
/** Server answers + the device draft: unsaved local changes win per key, otherwise the server wins. */
function mergeResume(start, draft) {
  const sa = cleanAnswers(start.answers);
  const ss = cleanSelf(start.self_ratings);
  if (!draft) return { answers: sa, self: ss, dirty: false, pos: {}, changed: 0, synced: 0, saved: null };
  const da = cleanAnswers(draft.answers);
  const ds = cleanSelf(draft.self_ratings);
  const changedAt = Number(draft.changed_at) || 0; const syncedAt = Number(draft.synced_at) || 0;
  const localNewer = changedAt > syncedAt;
  const answers = localNewer ? { ...sa, ...da } : { ...da, ...sa };
  const sjtLocked = sec('SJT') && sec('SJT').locked;
  if (sjtLocked) secItems('SJT').forEach((it) => { if (sa[it.item_id]) answers[it.item_id] = sa[it.item_id]; else delete answers[it.item_id]; }); // frozen on the server
  const self = localNewer ? { ...ss, ...ds } : { ...ds, ...ss };
  const dirty = !same(answers, sa) || !same(self, ss);
  return { answers, self, dirty, pos: draft.pos || {}, changed: changedAt, synced: dirty ? Math.min(syncedAt, changedAt - 1) : changedAt, saved: draft.saved_at || null };
}

// Leaving with unsaved answers: save first (at most 2.5 s), then go.
document.addEventListener('click', (e) => {
  const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank') return;
  if (!S.autosave || S.finished || !S.autosave.isDirty()) return;
  e.preventDefault();
  const href = a.href;
  Promise.race([S.autosave.flush(), sleep(2500)]).finally(() => { location.href = href; });
}, true);

// ---------- states ----------
function stateCard({ iconName, title, body, actions }) {
  render(app, h('div', { class: 'qz bl bl2 stack lg' },
    h('section', { class: 'card qz-state' }, h('div', { class: 'empty' },
      h('div', { class: 'em-icon' }, icon(iconName, 'lg')), h('h1', { class: 'qz-h1', text: title }), body ? h('p', { text: body }) : null,
      h('div', { class: 'row qz-actions' }, actions || h('a', { class: 'btn btn-primary', href: 'index.html' }, t('baseline.back_home')))))));
  focusH1();
}
function fatal(err, retry) {
  render(app, h('div', { class: 'qz bl bl2 stack lg' }, h('section', { class: 'card pad stack' }, h('h1', { class: 'qz-h1', text: t('baseline.error_title') }), errorState(err, retry),
    h('a', { class: 'btn btn-ghost', href: 'index.html' }, t('baseline.back_home')))));
}
function closedView() {
  stateCard({ iconName: 'lock', title: t('baseline.closed_title', { name: partName(S.part) }), body: t('baseline.closed_body') });
}
/** No (or an unknown) ?part=: the three tiles. */
function chooserView() {
  const b = S.me.baseline;
  render(app, h('div', { class: 'qz bl bl2 stack lg' },
    h('header', { class: 'stack sm' },
      h('p', { class: 'eyebrow', text: t('baseline.eyebrow', { wave: waveLabel(b.wave) }) }),
      h('h1', { id: 'bl-title', class: 'qz-h1', text: t('baseline.chooser_title') }),
      h('p', { class: 'muted', text: t('baseline.chooser_lead') })),
    h('div', { class: 'bl2-tiles' }, PARTS.map((n) => partTile(n, partOf(b, n), { heading: 'h2' }))),
    h('div', { class: 'row qz-actions' }, h('a', { class: 'btn btn-ghost', href: 'index.html' }, icon('chevron-left'), h('span', { text: t('baseline.back_home') })))));
}

// ---------- intro ----------
function introView(err) {
  const p = ps() || {};
  const n = S.part;
  const resuming = p.status === 'in_progress';
  const left = resuming ? minutesLeft(p.deadline_at) : null;
  const facts = [
    ['clock', t('baseline.how_timer', { n: p.minutes || '' })],
    n !== 2 ? ['grid', t('baseline.how_calc')] : null,
    n !== 2 ? ['check-circle', t('baseline.how_guess')] : ['check-circle', t('baseline.how_p2_all')],
    ['cloud', t('baseline.how_save')],
    ['eye-off', t('baseline.how_feedback')],
    ['target', t('baseline.how_alone')],
  ].filter(Boolean);
  const structure = {
    1: [['A', t('baseline.p1.sec_a'), t('baseline.p1.sec_a_what')], ['B', t('baseline.p1.sec_b'), t('baseline.p1.sec_b_what')]],
    2: [['2A', t('baseline.p2.sec_sjt'), t('baseline.p2.sec_sjt_what')], ['2B', t('baseline.p2.sec_rate'), t('baseline.p2.sec_rate_what')]],
    3: [['0', t('baseline.p3.sec_self'), t('baseline.p3.sec_self_what')], ['1', t('baseline.p3.sec_core'), t('baseline.p3.sec_core_what')], ['2', t('baseline.p3.sec_mod'), t('baseline.p3.sec_mod_what')]],
  }[n];
  const btn = h('button', { class: 'btn btn-primary btn-lg', type: 'button', 'data-fk': 'begin', onclick: (e) => begin(e.currentTarget, resuming) },
    h('span', { text: resuming ? t('baseline.continue') : t('baseline.start', { n }) }), icon('arrow-right'));
  render(app, h('div', { class: 'qz bl bl2 qz-intro stack lg fam-A' },
    h('article', { class: 'card qz-intro-card', 'aria-labelledby': 'bl-title' },
      h('div', { class: 'qz-band', 'aria-hidden': 'true' }),
      h('div', { class: 'pad stack' },
        h('p', { class: 'eyebrow', text: t('baseline.eyebrow_part', { n, wave: waveLabel(S.me.baseline.wave) }) }),
        h('h1', { id: 'bl-title', text: partName(n) }),
        h('p', { class: 'lead', text: resuming ? t('baseline.lead_back', { count: left || 0 }) : t(`baseline.p${n}.lead`) }),
        h('p', { class: 'row tight bl2-intro-meta' }, chip(t('baseline.dur_min', { n: p.minutes || '' }), 'info', 'clock'), n === 1 && p.n_items ? chip(t('baseline.n_questions', { count: p.n_items }), '', 'list') : null),
        h('div', { class: 'callout info bl-privacy' }, icon('shield'), h('div', { class: 'stack sm' }, h('b', { text: t('baseline.privacy_title') }), h('span', { text: t('baseline.privacy_body') }))),
        h('h2', { class: 'bl-h2', text: t('baseline.structure_title') }),
        h('ol', { class: 'bl-parts bl2-structure' }, structure.map(([k, name, what]) => h('li', { class: 'bl-part' },
          h('span', { class: 'bl-part-k', 'aria-hidden': 'true', text: k }),
          h('div', { class: 'stack sm' }, h('b', { class: 'ink', text: name }), h('span', { class: 'small muted', text: what }))))),
        h('h2', { class: 'bl-h2', text: t('baseline.how_title') }),
        h('ul', { class: 'qz-facts' }, facts.map(([ic, text]) => h('li', null, h('span', { class: 'qz-fact-ico', 'aria-hidden': 'true' }, icon(ic)), h('span', { text })))),
        err ? errorState(err) : null,
        h('div', { class: 'row qz-actions' }, btn, h('span', { class: 'small muted', text: resuming ? t('baseline.left_note', { count: left || 0 }) : t('baseline.start_note', { n: p.minutes || '' }) }))))));
}

async function begin(btn, resuming) {
  if (!resuming) {
    const p = ps() || {};
    const ok = await confirmDialog({ title: t('baseline.confirm_title', { n: p.minutes || '' }), body: t('baseline.confirm_body', { n: p.minutes || '' }), confirm: t('baseline.confirm_yes'), cancel: t('baseline.confirm_no') });
    if (!ok) return;
  }
  btn.disabled = true;
  let st;
  try { st = await api.baselineStart(S.part); } catch (e) {
    btn.disabled = false;
    if (e.code === 'already_submitted') { await boot(); return; }
    if (e.code === 'not_open') { show(closedView); return; }
    if (e.code === 'not_found' && S.part === 3) { show(() => stateCard({ iconName: 'users', title: t('baseline.p3.no_module_title'), body: t('baseline.p3.no_module_body') })); return; }
    show(() => introView(e));
    return;
  }
  setup(st);
}

// ---------- attempt ----------
function setup(st) {
  S.start = st;
  S.sections = (st.sections || []).map((s) => ({ ...s, items: (s.items || []).filter(answerable) }));
  indexItems();
  const m = mergeResume(st, readDraft(st.attempt_id));
  S.answers = m.answers; S.self = m.self; S.pos = { idx: {}, ...m.pos }; S.pos.idx = { ...(S.pos.idx || {}) };
  S.changedAt = m.changed; S.syncedAt = m.synced; S.savedAt = m.saved;
  S.finished = false; S.submitting = false;
  S.pill = createSavePill();
  if (S.savedAt && !m.dirty) S.pill.set('saved', S.savedAt);
  S.autosave = createAutosave({ save: saveNow, onStatus: (s, x) => S.pill.set(s, s === 'saved' && x ? x.saved_at : null), onGone: () => gone() });
  persist();
  if (m.dirty) S.autosave.touch();
  S.tchip = timerChip({ hidden: !!S.pos.timerHidden, onHide: (hidden, ms) => setPos({ timerHidden: hidden, timerHiddenAt: hidden ? Math.round(ms) : null }) });
  S.timer = createTimer({
    deadlineAt: st.deadline_at,
    onTick: (ms) => { S.tchip.set(ms); milestones(ms); },
    onLow: () => toast(t('baseline.low_toast')),
    onExpire: () => autoSubmit(),
  });
  if (st.resumed) announce(t('baseline.resumed'));
  route(S.pos.view);
}
function indexItems() {
  S.items = new Map();
  S.order = [];
  S.sections.forEach((s) => s.items.forEach((it) => { S.items.set(it.item_id, { ...it, sec: s.id }); S.order.push(it.item_id); }));
  S.sections.forEach((s) => { s.items = s.items.map((it) => S.items.get(it.item_id)); });
}
/** Open the view the learner was on (or the natural first one). */
function route(view) {
  const sjt = sec('SJT');
  if (S.part === 2) {
    if (sjt && sjt.locked) { if (view === 'review') viewReview(); else viewRate(); return; }
    viewQ('SJT');
    return;
  }
  if (S.part === 3 && (!allRated() || view === 'opener' || !view)) { viewOpener(); return; }
  if (view === 'review') { viewReview(); return; }
  viewQ(S.pos.sec && sec(S.pos.sec) ? S.pos.sec : qSections()[0].id);
}
function milestones(ms) {
  if (S.tchip && S.tchip.hidden) {
    const at = Number(S.pos.timerHiddenAt) || Infinity;
    const m = [10, 5].find((x) => at > x * 60000 && ms <= x * 60000);
    if (m) {
      S.tchip.reveal();
      setPos({ timerHidden: false, timerHiddenAt: null });
      S.spoken.add(m);
      announce(t('baseline.timer_back', { count: Math.max(1, Math.ceil(ms / 60000)) }));
      return;
    }
  }
  for (const m of [10, 5, 1]) {
    if (ms <= m * 60000 && ms > (m - 1) * 60000 && !S.spoken.has(m)) { S.spoken.add(m); announce(t('baseline.minutes_left', { count: m })); }
  }
}

// ---------- shared pieces ----------
function topBar(title, n, tot, countText) {
  return buildTop({ title, pill: S.pill.el, timerEl: S.tchip.el, n, total: tot, countText });
}
function glossaryButton() {
  const g = S.start && S.start.glossary;
  if (!g || !((g.en || []).length || (g.vi || []).length)) return null;
  return h('button', { class: 'btn btn-secondary btn-sm bl2-gloss-btn', type: 'button', 'data-fk': 'glossary', onclick: openGlossary }, icon('book', 'sm'), h('span', { text: t('baseline.glossary') }));
}
function openGlossary() {
  const g = S.start.glossary || {};
  const lines = (getLang() === 'vi' && (g.vi || []).length ? g.vi : g.en) || [];
  let dlg;
  const close = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => dlg.close() }, t('common.close'));
  dlg = modal({ title: t('baseline.glossary_title'), body: h('ul', { class: 'bl2-gloss' }, lines.map((line) => {
    const m = /^([^:]{1,48}):\s*(.+)$/.exec(String(line));
    return h('li', null, m ? [h('b', { text: m[1] }), `: ${m[2]}`] : String(line));
  })), actions: [close] });
  close.focus();
}
function exhibitsFor(it) {
  const ex = (S.start && S.start.exhibits) || {};
  return (it.exhibit_ids || []).map((id) => (ex[id] ? { id, ...ex[id] } : null)).filter(Boolean);
}
function exhibitBlock(x) {
  const title = pick(x, 'title');
  return h('section', { class: 'bl2-ex', 'aria-label': title || null, 'data-anchor': `ex-${x.id}` },
    title ? h('h3', { class: 'bl2-ex-title', text: title }) : null,
    h('div', { class: 'md bl2-ex-body' }, mdBlocks(pick(x, 'md'), { caption: title })));
}
function exhibitsPanel(list) {
  if (!list.length) return null;
  const body = h('div', { class: 'stack bl2-ex-list' }, list.map(exhibitBlock));
  const label = t('baseline.exhibits', { count: list.length });
  if (WIDE.matches) {
    return h('aside', { class: 'case-panel bl2-ex-panel is-sticky', 'aria-label': label }, h('p', { class: 'eyebrow', text: label }), body);
  }
  const open = S.pos.exOpen !== false;
  const d = h('details', { class: 'case-panel bl-case bl2-ex-panel', open },
    h('summary', { class: 'bl-case-sum', 'data-fk': 'ex-toggle' },
      h('span', { class: 'eyebrow', text: label }),
      h('span', { class: 'bl-case-toggle small' }, h('span', { class: 'when-open', text: t('baseline.ex_hide') }), h('span', { class: 'when-closed', text: t('baseline.ex_show') }), icon('chevron-down', 'sm'))),
    body);
  d.addEventListener('toggle', () => { if (S.pos.exOpen !== d.open) setPos({ exOpen: d.open }); });
  return d;
}

// ---------- question cards ----------
function mcqCard(it) {
  const id = it.item_id;
  const opts = (it.options || []).map((o, i) => {
    const input = h('input', { type: 'radio', name: `q-${id}`, value: o.id, checked: S.answers[id] === o.id, 'data-fk': `${id}|${o.id}` });
    input.addEventListener('change', () => { if (input.checked) { setAnswer(id, o.id); paintProgress(); } });
    return h('label', { class: 'opt' }, input, h('span', { class: 'letter', text: LETTERS[i] || String(i + 1) }), h('span', { class: 'txt', text: optionText(o) }));
  });
  return h('fieldset', { class: 'q-card qz-q', id: `q-${id}`, 'data-item': id, tabindex: '-1', 'data-fk': `card|${id}`, 'data-anchor': `q-${id}` },
    h('legend', null, h('span', { class: 'q-meta', text: t('baseline.q_of', { n: numOf(id), total: total() }) }), h('span', { class: 'qz-stem', text: pick(it, 'stem') })),
    h('div', { class: 'opts' }, opts));
}
function sjtCard(it) {
  const id = it.item_id;
  const list = secItems('SJT');
  const n = list.indexOf(it) + 1;
  const hint = h('p', { class: 'small muted bl2-sjt-hint', id: `hint-${id}` }, icon('info', 'sm'), h('span', { text: t('baseline.p2.not_both') }));
  const cur = () => S.answers[id] || {};
  const radios = { most: [], least: [] };
  const rows = (it.options || []).map((o, i) => {
    const cell = (kind) => {
      const other = kind === 'most' ? 'least' : 'most';
      const input = h('input', { type: 'radio', name: `${kind}-${id}`, value: o.id, 'data-fk': `${id}|${kind}|${o.id}`, 'aria-describedby': `hint-${id}` });
      input.addEventListener('change', () => {
        if (!input.checked) return;
        const v = { ...cur() };
        v[kind] = o.id;
        if (v[other] === o.id) delete v[other];
        setAnswer(id, v);
        paint(); paintProgress();
      });
      radios[kind].push({ input, o });
      return h('td', { class: `bl2-sjt-cell is-${kind}` }, h('label', { class: 'bl2-sjt-pick' }, input,
        h('span', { class: 'bl2-sjt-dot', 'aria-hidden': 'true' }),
        h('span', { class: 'sr-only', text: t(kind === 'most' ? 'baseline.p2.most_aria' : 'baseline.p2.least_aria', { letter: LETTERS[i] }) })));
    };
    return h('tr', { 'data-opt': o.id },
      h('th', { scope: 'row', class: 'bl2-sjt-opt' }, h('span', { class: 'letter', 'aria-hidden': 'true', text: LETTERS[i] }), h('span', { class: 'txt' }, h('span', { class: 'sr-only', text: `${LETTERS[i]}. ` }), optionText(o))),
      cell('most'), cell('least'));
  });
  function paint() {
    const v = cur();
    ['most', 'least'].forEach((kind) => {
      const other = kind === 'most' ? 'least' : 'most';
      radios[kind].forEach(({ input, o }) => {
        input.checked = v[kind] === o.id;
        const blocked = v[other] === o.id;
        input.disabled = blocked;
        input.closest('td').classList.toggle('is-blocked', blocked);
        input.closest('label').title = blocked ? t('baseline.p2.not_both') : '';
      });
    });
    rows.forEach((tr) => { tr.classList.toggle('is-most', v.most === tr.dataset.opt); tr.classList.toggle('is-least', v.least === tr.dataset.opt); });
  }
  const card = h('fieldset', { class: 'q-card qz-q bl2-sjt', id: `q-${id}`, 'data-item': id, tabindex: '-1', 'data-fk': `card|${id}`, 'data-anchor': `q-${id}` },
    h('legend', null, h('span', { class: 'q-meta', text: t('baseline.p2.sjt_of', { n, total: list.length }) }), h('span', { class: 'qz-stem', text: pick(it, 'stem') })),
    h('div', { class: 'bl2-sjt-wrap' }, h('table', { class: 'bl2-sjt-table' },
      h('caption', { class: 'sr-only', text: t('baseline.p2.table_caption') }),
      h('thead', null, h('tr', null,
        h('th', { scope: 'col', class: 'bl2-sjt-h-opt', text: t('baseline.p2.col_response') }),
        h('th', { scope: 'col', class: 'bl2-sjt-h is-most' }, h('span', { class: 'bl2-long', text: t('baseline.p2.col_most') }), h('span', { class: 'bl2-short', 'aria-hidden': 'true', text: t('baseline.p2.col_most_short') })),
        h('th', { scope: 'col', class: 'bl2-sjt-h is-least' }, h('span', { class: 'bl2-long', text: t('baseline.p2.col_least') }), h('span', { class: 'bl2-short', 'aria-hidden': 'true', text: t('baseline.p2.col_least_short') })))),
      h('tbody', null, rows))),
    hint);
  paint();
  return card;
}

// ---------- question view (Part 1, Part 2A, Part 3 CORE/MOD) ----------
let qRefs = null;
function viewQ(secId, idx) {
  const s = sec(secId) || qSections()[0];
  if (!s) return;
  if (idx !== undefined) S.pos.idx[s.id] = idx;
  setPos({ view: 'q', sec: s.id });
  show(() => renderQ());
  toTop();
  const card = app.querySelector('.qz-q');
  if (card && idx !== undefined) card.focus({ preventScroll: true });
}
function renderQ(err) {
  const s = sec(S.pos.sec) || qSections()[0];
  const items = s.items;
  const i = Math.min(Math.max(0, S.pos.idx[s.id] || 0), Math.max(0, items.length - 1));
  S.pos.idx[s.id] = i;
  const it = items[i];
  const navSecs = qSections();
  const isSjt = s.id === 'SJT';
  const all = navSecs.flatMap((x) => x.items);
  const top = topBar(`${t('baseline.top', { n: S.part })} · ${secTitle(s)}`, doneIn(all), all.length, isSjt ? t('baseline.p2.chosen', { n: doneIn(all), total: all.length }) : null);
  const exList = it ? exhibitsFor(it) : [];
  const panel = exhibitsPanel(exList);
  const tabs = navSecs.length > 1 ? h('div', { class: 'bl2-sec-tabs', role: 'group', 'aria-label': t('baseline.sections_aria') },
    navSecs.map((x) => h('button', { type: 'button', class: 'bl2-sec-tab', 'aria-pressed': String(x.id === s.id), 'data-fk': `sec|${x.id}`, onclick: () => { if (x.id !== s.id) viewQ(x.id); } },
      h('span', { class: 'bl2-sec-name', text: secTitle(x) }), h('span', { class: 'bl2-sec-count', text: t('baseline.sec_count', { n: doneIn(x.items), total: x.items.length }) })))) : null;
  const partIntro = i === 0 && secIdxOf(s) === 0 && pick(S.start, 'intro') ? pick(S.start, 'intro') : '';
  const intro = i === 0 && (pick(s, 'intro') || partIntro) ? h('div', { class: 'bl2-sec-intro small' }, icon('info', 'sm'),
    h('div', { class: 'stack sm' }, partIntro ? h('p', { text: partIntro }) : null, pick(s, 'intro') ? h('p', { text: pick(s, 'intro') }) : null)) : null;
  const caseInfo = it && it.case_id && S.start.cases && S.start.cases[it.case_id] ? h('p', { class: 'bl2-case-line' }, icon('file', 'sm'), h('span', { text: pick(S.start.cases[it.case_id], 'title') })) : null;
  const card = it ? (it.type === 'sjt' ? sjtCard(it) : mcqCard(it)) : null;
  const last = i === items.length - 1;
  const secIdx = navSecs.indexOf(s);
  const nextSec = navSecs[secIdx + 1];
  const prevSec = navSecs[secIdx - 1];
  let prev;
  if (i > 0) prev = h('button', { class: 'btn btn-ghost', type: 'button', 'data-fk': 'nav-prev', onclick: () => go(i - 1) }, icon('chevron-left'), h('span', { text: t('quiz.prev') }));
  else if (prevSec) prev = h('button', { class: 'btn btn-ghost', type: 'button', 'data-fk': 'nav-prev', onclick: () => viewQ(prevSec.id, prevSec.items.length - 1) }, icon('chevron-left'), h('span', { text: secTitleShort(prevSec) }));
  else if (S.part === 3) prev = h('button', { class: 'btn btn-ghost', type: 'button', 'data-fk': 'nav-prev', onclick: () => viewOpener() }, icon('chevron-left'), h('span', { text: t('baseline.p3.back_self') }));
  else prev = h('span');
  let next;
  if (!last) next = h('button', { class: 'btn btn-primary', type: 'button', 'data-fk': 'nav-next', onclick: () => go(i + 1) }, h('span', { text: t('quiz.next') }), icon('chevron-right'));
  else if (isSjt) next = h('button', { class: 'btn btn-primary', type: 'button', 'data-fk': 'nav-lock', disabled: S.locking, onclick: () => lockSjt() }, icon('lock'), h('span', { text: t('baseline.p2.lock') }));
  else if (nextSec) next = h('button', { class: 'btn btn-primary', type: 'button', 'data-fk': 'nav-next', onclick: () => viewQ(nextSec.id, 0) }, h('span', { text: secTitleShort(nextSec) }), icon('chevron-right'));
  else next = h('button', { class: 'btn btn-primary', type: 'button', 'data-fk': 'nav-review', onclick: () => viewReview() }, h('span', { text: t('baseline.to_review') }), icon('arrow-right'));
  const dots = h('div', { class: 'q-dots' }, items.map((x, k) => h('button', {
    type: 'button', 'data-fk': `dot|${x.item_id}`, class: isDone(x) ? 'answered' : (x.type === 'sjt' && S.answers[x.item_id] ? 'partial' : null), 'aria-current': k === i ? 'step' : null,
    'aria-label': t(isDone(x) ? 'baseline.dot_done' : 'baseline.dot_open', { n: isSjt ? k + 1 : numOf(x.item_id) }), onclick: () => go(k),
  }, String(isSjt ? k + 1 : numOf(x.item_id)))));
  const foot = h('div', { class: 'qz-foot' },
    h('nav', { class: 'qz-dots', 'aria-label': t('baseline.nav_aria', { section: secTitle(s) }) }, dots),
    !isSjt && !(last && !nextSec) ? h('button', { class: 'link-btn qz-review-link', type: 'button', 'data-fk': 'nav-review-link', onclick: () => viewReview() }, t('baseline.review_link')) : null,
    isSjt ? h('p', { class: 'xs muted center', text: t('baseline.p2.lock_note') }) : null);
  const errEl = err ? h('div', { class: 'callout bad', role: 'alert', tabindex: '-1', 'data-fk': 'q-err' }, icon('alert'), h('span', { text: err })) : null;
  const tools = S.part === 3 ? h('div', { class: 'row bl2-tools' }, glossaryButton()) : null;
  const main = h('div', { class: 'bl2-main stack' },
    h('h1', { class: 'sr-only', text: it ? t('baseline.sr_h1', { name: partName(S.part), section: secTitle(s), n: i + 1, total: items.length }) : partName(S.part) }),
    intro, caseInfo, card, errEl,
    h('div', { class: 'q-nav' }, prev, next), foot);
  render(app, h('div', { class: `qz bl bl2 stack${panel ? ' has-ex' : ''}` }, top.el, tabs, tools,
    panel && WIDE.matches ? h('div', { class: 'bl2-grid' }, panel, main) : h('div', { class: 'stack' }, panel, main)));
  app.classList.toggle('narrow', !(panel && WIDE.matches));
  qRefs = { top, all, items, s };
  if (errEl) errEl.focus({ preventScroll: false });
}
const secTitleShort = (s) => t(`baseline.sec_short.${s.id}`);
const secIdxOf = (s) => qSections().indexOf(s);
function go(k) {
  const s = sec(S.pos.sec);
  S.pos.idx[s.id] = Math.max(0, Math.min(s.items.length - 1, k));
  persist();
  show(() => renderQ());
  const card = app.querySelector('.qz-q');
  const y = app.getBoundingClientRect().top + window.scrollY - (document.querySelector('.app-header') || { offsetHeight: 64 }).offsetHeight - 8;
  if (window.scrollY > y) window.scrollTo({ top: Math.max(0, y), behavior: 'auto' });
  if (card) card.focus({ preventScroll: true });
}
function paintProgress() {
  if (!qRefs || S.pos.view !== 'q') return;
  const n = doneIn(qRefs.all);
  qRefs.top.update(n, qRefs.all.length, qRefs.s.id === 'SJT' ? t('baseline.p2.chosen', { n, total: qRefs.all.length }) : null);
  app.querySelectorAll('.q-dots button[data-fk^="dot|"]').forEach((b) => {
    const it = S.items.get(b.dataset.fk.slice(4));
    if (!it) return;
    b.classList.toggle('answered', isDone(it));
    b.classList.toggle('partial', !isDone(it) && it.type === 'sjt' && !!S.answers[it.item_id]);
  });
  app.querySelectorAll('.bl2-sec-tab').forEach((b) => {
    const x = sec(b.dataset.fk.slice(4));
    const c = b.querySelector('.bl2-sec-count');
    if (x && c) c.textContent = t('baseline.sec_count', { n: doneIn(x.items), total: x.items.length });
  });
}
// Keys on question screens: 1–4 / A–D choose (Part 1 and 3), ← → move.
document.addEventListener('keydown', (e) => {
  if (S.pos.view !== 'q' || !S.start || S.finished || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  if (document.querySelector('dialog[open]')) return;
  const tg = e.target;
  if (tg && (tg.isContentEditable || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT' || (tg.tagName === 'INPUT' && tg.type !== 'radio'))) return;
  if (tg && tg.closest && tg.closest('details summary, .md-table-wrap, .bl2-sec-tabs')) return;
  const s = sec(S.pos.sec); if (!s) return;
  const i = S.pos.idx[s.id] || 0;
  if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !(tg && tg.type === 'radio')) {
    e.preventDefault();
    if (e.key === 'ArrowRight' && i < s.items.length - 1) go(i + 1);
    else if (e.key === 'ArrowLeft' && i > 0) go(i - 1);
    return;
  }
  if (s.id === 'SJT') return;
  let choice = -1;
  if (/^[1-4]$/.test(e.key)) choice = Number(e.key) - 1;
  else if (/^[a-dA-D]$/.test(e.key)) choice = e.key.toLowerCase().charCodeAt(0) - 97;
  if (choice < 0) return;
  const input = app.querySelectorAll('.qz-q input[type="radio"]')[choice];
  if (!input) return;
  e.preventDefault();
  input.checked = true;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.focus();
});

// ---------- Part 2: lock 2A ----------
async function lockSjt() {
  if (S.locking || S.finished) return;
  const list = secItems('SJT');
  const missing = list.find((it) => !isDone(it));
  if (missing) {
    const k = list.indexOf(missing);
    S.pos.idx.SJT = k; persist();
    show(() => renderQ(t('baseline.p2.lock_missing', { n: k + 1, count: list.filter((x) => !isDone(x)).length })));
    return;
  }
  const ok = await confirmDialog({ title: t('baseline.p2.lock_title'), body: t('baseline.p2.lock_body'), confirm: t('baseline.p2.lock_yes'), cancel: t('baseline.p2.lock_no') });
  if (!ok) return;
  S.locking = true;
  keepPlace(S.view);
  S.autosave.pause();
  await S.autosave.settle();
  const at = S.changedAt;
  try {
    const res = await api.baselineNext(S.start.attempt_id, payload());
    applyLock(res.section, at);
  } catch (e) {
    if (e.code === 'already_submitted' || e.code === 'not_found') { S.locking = false; gone(); return; }
    if (e.code === 'bad_request' && e.field && S.items.has(e.field)) {
      S.locking = false;
      S.pos.idx.SJT = Math.max(0, list.findIndex((x) => x.item_id === e.field)); persist();
      show(() => renderQ(t('baseline.p2.lock_server')));
    } else {
      // The lock may have reached the Hub even though the reply did not: check before showing an error.
      let st = null;
      try { st = await api.baselineStart(2); } catch (e2) { /* keep the first error */ }
      const rate = st && (st.sections || []).find((x) => x.id === 'RATE');
      const sjt = st && (st.sections || []).find((x) => x.id === 'SJT');
      if (sjt && sjt.locked && rate) { applyLock(rate, at); } else {
        S.locking = false;
        show(() => renderQ(e.code === 'network' ? t('baseline.p2.lock_offline') : `${t('baseline.p2.lock_failed')} ${errorMessage(e)}`));
      }
    }
  } finally {
    S.locking = false;
    if (S.autosave && !S.finished) S.autosave.resume();
  }
}
function applyLock(rateSection, at) {
  const sjt = sec('SJT'); if (sjt) sjt.locked = true;
  const rate = sec('RATE');
  const items = ((rateSection && rateSection.items) || []).filter(answerable);
  if (rate) Object.assign(rate, { ...rateSection, id: 'RATE', items }); else S.sections.push({ ...rateSection, id: 'RATE', items });
  indexItems();
  S.syncedAt = Math.max(S.syncedAt, at);
  S.savedAt = new Date(serverNow()).toISOString();
  S.pill.set('saved', S.savedAt);
  S.locking = false;
  persist();
  announce(t('baseline.p2.locked_announce'));
  viewRate(true);
}

// ---------- Part 2B: self-rating statements ----------
function viewRate(fresh) {
  setPos({ view: 'rate' });
  show(() => renderRate(null, fresh));
  toTop();
  focusH1();
}
function ratingScale() {
  const rs = (S.start && S.start.rating_scale) || {};
  const pts = Array.isArray(rs.points) && rs.points.length ? rs.points : [1, 2, 3, 4].map((v) => ({ v }));
  return { points: pts.map((p) => ({ v: Number(p.v), label: p[getLang()] || p.en || '' })), nr: rs.nr ? (rs.nr[getLang()] || rs.nr.en) : t('baseline.p2.nr') };
}
function renderRate(err, fresh) {
  const s = sec('RATE');
  const items = s ? s.items : [];
  const scale = ratingScale();
  const top = topBar(`${t('baseline.top', { n: 2 })} · ${secTitle(s || { id: 'RATE' })}`, doneIn(items), items.length, t('baseline.rated', { n: doneIn(items), total: items.length }));
  const errEl = h('p', { class: 'err bl-err', role: 'alert', hidden: !err }, err ? [icon('alert', 'sm'), h('span', { text: err })] : null);
  const onRated = () => { const n = doneIn(items); top.update(n, items.length, t('baseline.rated', { n, total: items.length })); if (n === items.length) errEl.hidden = true; };
  render(app, h('div', { class: 'qz bl bl2 stack lg' }, top.el,
    h('header', { class: 'bl-part-head stack sm', 'data-anchor': 'rate-head' },
      h('p', { class: 'eyebrow', text: t('baseline.p2.rate_eyebrow') }),
      h('h1', { class: 'qz-h1', text: secTitle(s || { id: 'RATE' }) }),
      pick(s, 'intro') ? h('p', { class: 'muted', text: pick(s, 'intro') }) : null,
      h('p', { class: 'small bl2-locked-line' }, icon('lock', 'sm'), h('span', { text: t('baseline.p2.locked_line') }))),
    fresh ? h('div', { class: 'callout success', role: 'status' }, icon('check-circle'), h('span', { text: t('baseline.p2.locked_done') })) : null,
    h('section', { class: 'card pad bl-scale', 'aria-labelledby': 'bl2-rs-h', 'data-anchor': 'rate-scale' },
      h('h2', { id: 'bl2-rs-h', class: 'bl-h3', text: t('baseline.scale_title') }),
      h('ol', { class: 'bl-scale-list' }, scale.points.map((p) => h('li', null, h('span', { class: 'bl-lv', 'aria-hidden': 'true', text: String(p.v) }), h('span', { class: 'ink', text: p.label }))))),
    h('div', { class: 'stack' }, items.map((it, k) => ratingCard(it, k, items.length, scale, onRated))),
    h('div', { class: 'stack sm' }, errEl,
      h('div', { class: 'q-nav qz-actions' }, h('span'), h('button', { class: 'btn btn-primary btn-lg', type: 'button', 'data-fk': 'to-review', onclick: () => viewReview() }, h('span', { text: t('baseline.to_review') }), icon('arrow-right'))))));
  if (err) { const first = items.find((x) => !isDone(x)); const c = first && document.getElementById(`rate-${first.item_id}`); if (c) { scrollToEl(c); const b = c.querySelector('button'); if (b) b.focus({ preventScroll: true }); } }
}
function ratingCard(it, k, tot, scale, onRated) {
  const sid = `bl2-st-${it.item_id}`;
  const buttons = scale.points.map((p) => {
    const b = h('button', { type: 'button', 'aria-pressed': 'false', 'data-fk': `r|${it.item_id}|${p.v}` }, h('b', { text: String(p.v) }), h('span', { class: 'bl2-r-lbl', text: p.label }));
    b.addEventListener('click', () => choose(p.v));
    return b;
  });
  const nr = it.allow_nr ? h('button', { type: 'button', class: 'bl2-nr', 'aria-pressed': 'false', 'data-fk': `r|${it.item_id}|NR` }, h('span', { text: scale.nr })) : null;
  if (nr) nr.addEventListener('click', () => choose('NR'));
  const all = buttons.concat(nr ? [nr] : []);
  const row = h('div', { class: 'scale-row bl2-r-row', role: 'group', 'aria-labelledby': sid }, buttons);
  const group = h('div', { class: 'stack sm' }, row,
    h('div', { class: 'bl2-anchors', 'aria-hidden': 'false' },
      h('p', { class: 'bl2-anchor is-1' }, h('b', { text: '1' }), h('span', { text: pick(it, 'anchor1') })),
      h('p', { class: 'bl2-anchor is-4' }, h('b', { text: '4' }), h('span', { text: pick(it, 'anchor4') }))),
    nr);
  [row, nr].filter(Boolean).forEach((el) => el.addEventListener('keydown', (e) => {
    const idx = all.indexOf(document.activeElement);
    if (idx < 0) return;
    let nx = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nx = Math.min(all.length - 1, idx + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') nx = Math.max(0, idx - 1);
    else if (/^[1-4]$/.test(e.key)) { e.preventDefault(); choose(Number(e.key)); buttons[Number(e.key) - 1].focus(); return; }
    if (nx >= 0) { e.preventDefault(); all[nx].focus(); }
  }));
  const status = h('span', { class: 'bl-rate-status small' });
  const card = h('section', { class: 'card bl-rate bl2-rate', id: `rate-${it.item_id}`, 'aria-labelledby': sid, 'data-anchor': `rate-${it.item_id}` },
    h('div', { class: 'bl-rate-head' }, h('span', { class: 'bl2-st-n', 'aria-hidden': 'true', text: String(k + 1) }), h('span', { class: 'grow' }), status),
    h('p', { class: 'bl-stmt', id: sid }, h('span', { class: 'sr-only', text: t('baseline.stmt_n', { n: k + 1, total: tot }) }), pick(it, 'text')),
    group);
  function paint() {
    const v = S.answers[it.item_id];
    const has = isDone(it);
    buttons.forEach((b, j) => { const on = v === scale.points[j].v; b.setAttribute('aria-pressed', String(on)); b.tabIndex = (has ? on : j === 0) ? 0 : -1; });
    if (nr) { nr.setAttribute('aria-pressed', String(v === 'NR')); nr.tabIndex = v === 'NR' ? 0 : -1; }
    render(status, has ? h('span', { class: 'bl-ok' }, icon('check', 'sm'), t('baseline.rated_one')) : h('span', { class: 'muted', text: t('baseline.not_rated') }));
    card.classList.toggle('is-rated', has);
  }
  function choose(v) { setAnswer(it.item_id, v); paint(); onRated(); }
  paint();
  return card;
}

// ---------- Part 3 opener: course self-ratings (as v1) ----------
function scaleList() {
  const catScale = (S.cat && S.cat.scale) || [];
  const src = S.start && Array.isArray(S.start.scale) && S.start.scale.length ? S.start.scale : catScale;
  const strip = (v) => String(v || '').replace(/^\s*\d+\s*[·.:-]\s*/, '').replace(/\s*\([A-Z]{2}\)\s*$/, '').trim();
  return src.map((s) => {
    const c = catScale.find((x) => Number(x.level) === Number(s.level)) || {};
    const label = strip(s[getLang()] || s.en) || c[getLang()] || c.en || '';
    return { level: Number(s.level), label, abbr: c.abbr || '', short: c.abbr || label, desc: pick(s, 'desc') || pick(c, 'desc') };
  }).sort((a, b) => a.level - b.level);
}
function viewOpener() {
  setPos({ view: 'opener' });
  show(() => renderOpener());
  toTop();
}
function renderOpener() {
  app.classList.add('narrow');
  const self = selfList();
  const scale = scaleList();
  const tot = self.length;
  const top = topBar(`${t('baseline.top', { n: 3 })} · ${t('baseline.p3.sec_self')}`, ratedCount(), tot, t('baseline.rated', { n: ratedCount(), total: tot }));
  const err = h('p', { class: 'err bl-err', role: 'alert', hidden: true });
  const onRated = () => { const n = ratedCount(); top.update(n, tot, t('baseline.rated', { n, total: tot })); if (n === tot) err.hidden = true; };
  render(app, h('div', { class: 'qz bl bl2 stack lg' }, top.el,
    h('header', { class: 'bl-part-head stack sm', 'data-anchor': 'head-self' },
      h('p', { class: 'eyebrow', text: t('baseline.p3.self_eyebrow') }),
      h('h1', { class: 'qz-h1', text: t('baseline.p3.self_title') }),
      h('p', { class: 'muted', text: t('baseline.p3.self_hint') }),
      pick(S.start, 'intro') ? h('p', { class: 'small bl2-sec-intro' }, icon('info', 'sm'), h('span', { text: pick(S.start, 'intro') })) : null),
    h('div', { class: 'row bl2-tools' }, glossaryButton()),
    h('section', { class: 'card pad bl-scale', 'aria-labelledby': 'bl-scale-h', 'data-anchor': 'scale' },
      h('h2', { id: 'bl-scale-h', class: 'bl-h3', text: t('baseline.scale_title') }),
      h('ol', { class: 'bl-scale-list' }, scale.map((lv) => h('li', { id: `bl-lv-${lv.level}` },
        h('span', { class: 'bl-lv', 'aria-hidden': 'true', text: String(lv.level) }),
        h('span', null, h('b', { class: 'ink', text: lv.abbr ? `${lv.label} (${lv.abbr})` : lv.label }), h('span', { class: 'muted', text: lv.desc ? ` · ${lv.desc}` : '' })))))),
    h('div', { class: 'stack' }, self.map((s, i) => selfCard(s, i, scale, onRated))),
    h('div', { class: 'stack sm' }, err,
      h('div', { class: 'q-nav qz-actions' }, h('span'), h('button', { class: 'btn btn-primary btn-lg', type: 'button', 'data-fk': 'to-q', onclick: () => continueOpener(err) }, h('span', { text: t('baseline.p3.to_questions') }), icon('arrow-right'))))));
}
function selfCard(s, i, scale, onRated) {
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
    else if (/^[0-4]$/.test(e.key)) { e.preventDefault(); choose(Number(e.key)); if (buttons[Number(e.key)]) buttons[Number(e.key)].focus(); return; }
    if (next >= 0) { e.preventDefault(); buttons[next].focus(); }
  });
  const card = h('section', { class: 'card bl-rate', id: `rate-${s.course}`, 'aria-labelledby': sid, 'data-anchor': `rate-${s.course}` },
    h('div', { class: 'bl-rate-head' }, codeBadge(s.course), h('span', { class: 'bl-rate-course small', text: courseName(s.course) }), status),
    h('p', { class: 'bl-stmt', id: sid }, h('span', { class: 'sr-only', text: t('baseline.stmt_n', { n: i + 1, total: selfList().length }) }), s[getLang()] || s.en),
    row, picked);
  function paint() {
    const v = S.self[s.course];
    const has = okLevel(v);
    buttons.forEach((b, k) => { const on = has && Number(v) === scale[k].level; b.setAttribute('aria-pressed', String(on)); b.tabIndex = (has ? on : k === 0) ? 0 : -1; });
    const lv = has ? scale.find((x) => x.level === Number(v)) : null;
    picked.textContent = lv ? `${lv.level} · ${lv.label}${lv.desc ? ` — ${lv.desc}` : ''}` : t('baseline.pick_one');
    picked.classList.toggle('muted', !lv);
    render(status, has ? h('span', { class: 'bl-ok' }, icon('check', 'sm'), t('baseline.rated_one')) : h('span', { class: 'muted', text: t('baseline.not_rated') }));
    card.classList.toggle('is-rated', has);
  }
  function choose(level) { setSelf(s.course, level); paint(); onRated(); }
  paint();
  return card;
}
function continueOpener(err) {
  const missing = selfList().filter((s) => !okLevel(S.self[s.course]));
  if (missing.length) {
    err.hidden = false;
    render(err, icon('alert', 'sm'), h('span', { text: t('baseline.rate_all', { count: missing.length, total: selfList().length }) }));
    const card = document.getElementById(`rate-${missing[0].course}`);
    if (card) { scrollToEl(card); const b = card.querySelector('.scale-row button'); if (b) b.focus({ preventScroll: true }); }
    return;
  }
  viewQ(qSections()[0].id, S.pos.idx[qSections()[0].id] || 0);
}

// ---------- review ----------
function viewReview(err) {
  setPos({ view: 'review' });
  show(() => renderReview(err));
  toTop();
  const el = err ? app.querySelector('.qz-submit-err') : app.querySelector('h1');
  if (el) { el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); }
}
function renderReview(err) {
  app.classList.add('narrow');
  const rows = [];
  let left = 0; let blocking = 0;
  const row = ({ title, done, all, label, openFn, jumps, ok, note }) => h('li', { class: `bl-rev-row${ok ? '' : ' has-left'}` },
    h('span', { class: 'bl-rev-ico', 'aria-hidden': 'true' }, icon(ok ? 'check-circle' : 'alert')),
    h('div', { class: 'stack sm bl-rev-main' },
      h('div', { class: 'bl-rev-head' }, h('b', { class: 'ink', text: title }),
        openFn ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: openFn }, t('baseline.open_part'), icon('chevron-right', 'sm')) : null),
      h('span', { class: 'small', text: label || t('quiz.answered', { n: done, total: all }) }),
      note ? h('span', { class: 'small muted', text: note }) : null,
      jumps && jumps.length ? h('div', { class: 'row tight qz-jumps' }, h('span', { class: 'small muted', text: t('quiz.review.jump_label') }), jumps) : null));
  const jumpBtn = (labelText, aria, fn) => h('button', { class: 'btn btn-secondary btn-sm', type: 'button', 'aria-label': aria, onclick: fn }, labelText);
  if (S.part === 3) {
    const n = ratedCount(); const tot = selfList().length;
    if (n < tot) blocking += tot - n;
    rows.push(row({ title: t('baseline.p3.sec_self'), label: t('baseline.rated', { n, total: tot }), openFn: () => viewOpener(), ok: n === tot, note: n < tot ? t('baseline.p3.self_required') : null }));
  }
  S.sections.forEach((s) => {
    const items = s.items;
    const open = items.filter((x) => !isDone(x));
    if (s.id === 'SJT' && s.locked) { rows.push(row({ title: secTitle(s), label: t('baseline.p2.locked_row', { total: items.length }), ok: true })); return; }
    if (s.id === 'SJT') { blocking += 1; rows.push(row({ title: secTitle(s), done: items.length - open.length, all: items.length, openFn: () => viewQ('SJT'), ok: false, note: t('baseline.p2.lock_first') })); return; }
    if (s.id === 'RATE') {
      if (!items.length) return;
      blocking += open.length;
      rows.push(row({ title: secTitle(s), label: t('baseline.rated', { n: items.length - open.length, total: items.length }), openFn: () => viewRate(), ok: !open.length,
        note: open.length ? t('baseline.p2.rate_required') : null,
        jumps: open.slice(0, 8).map((x) => jumpBtn(String(items.indexOf(x) + 1), t('baseline.jump_stmt', { n: items.indexOf(x) + 1 }), () => { viewRate(); const c = document.getElementById(`rate-${x.item_id}`); if (c) { scrollToEl(c); const b = c.querySelector('button'); if (b) b.focus({ preventScroll: true }); } })) }));
      return;
    }
    left += open.length;
    rows.push(row({ title: secTitle(s), done: items.length - open.length, all: items.length, openFn: () => viewQ(s.id, 0), ok: !open.length,
      jumps: open.slice(0, 12).map((x) => jumpBtn(t('quiz.q_short', { n: numOf(x.item_id) }), t('baseline.jump_q', { n: numOf(x.item_id) }), () => viewQ(s.id, items.indexOf(x)))) }));
  });
  const all = S.sections.flatMap((s) => s.items);
  const top = topBar(t('baseline.top_review', { n: S.part }), doneIn(all) + (S.part === 3 ? ratedCount() : 0), all.length + (S.part === 3 ? selfList().length : 0));
  const back = S.part === 2 ? (sec('SJT') && sec('SJT').locked ? () => viewRate() : () => viewQ('SJT')) : () => viewQ(S.pos.sec && sec(S.pos.sec) ? S.pos.sec : qSections()[0].id);
  render(app, h('div', { class: 'qz bl bl2 stack lg' }, top.el,
    h('section', { class: 'card pad stack', 'aria-labelledby': 'bl-rev-h' },
      h('h1', { id: 'bl-rev-h', class: 'qz-h1', text: t('baseline.review_title') }),
      h('ul', { class: 'bl-rev' }, rows),
      h('div', { class: `callout ${blocking ? 'bad' : left ? 'warn' : 'info'}` }, icon(blocking || left ? 'alert' : 'lock'),
        h('span', { text: blocking ? t('baseline.review_blocked') : left ? t('baseline.review_left', { count: left }) : t('baseline.review_done') })),
      err ? h('div', { class: 'callout bad qz-submit-err', role: 'alert', tabindex: '-1' }, icon('wifi-off'), h('span', { text: err })) : null,
      h('div', { class: 'q-nav qz-actions' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: back }, icon('chevron-left'), h('span', { text: t('baseline.back_questions') })),
        h('button', { class: 'btn btn-primary btn-lg', type: 'button', 'data-fk': 'submit', disabled: blocking > 0 || S.submitting, onclick: () => doSubmit(left) }, icon('send'), h('span', { text: t('baseline.submit', { n: S.part }) }))))));
}

// ---------- submit ----------
async function doSubmit(left) {
  if (S.submitting || S.finished) return;
  const ok = await confirmDialog({
    title: t('baseline.confirm_submit_title', { n: S.part }),
    body: left ? t('baseline.confirm_submit_left', { count: left }) : t('baseline.confirm_submit_done'),
    confirm: t('baseline.confirm_submit_yes'), cancel: t('quiz.review.confirm_no'),
  });
  if (!ok || S.submitting) return;
  S.submitting = true;
  show(() => render(app, h('div', { class: 'qz bl bl2' }, loading(t('baseline.submitting')))));
  try {
    const res = await submitNow();
    finish(res);
  } catch (e) {
    S.submitting = false;
    if (e.code === 'already_submitted' || e.code === 'not_found') { gone(); return; }
    let msg = e.code === 'network' ? t('quiz.review.submit_offline') : `${t('quiz.review.submit_failed')} ${errorMessage(e)}`;
    if (e.code === 'bad_request' && e.field === 'SJT') msg = t('baseline.p2.lock_first');
    else if (e.code === 'bad_request' && e.field === 'self_ratings') msg = t('baseline.p3.self_required');
    else if (e.code === 'bad_request' && e.field && S.items.has(e.field)) msg = t('baseline.review_server_missing');
    viewReview(msg);
  }
}
async function submitNow() {
  S.autosave.pause();
  await S.autosave.settle();
  try {
    const res = await api.submit(S.start.attempt_id, payload(), S.part === 3 ? { ...S.self } : undefined);
    return res;
  } catch (e) { if (S.autosave && !S.finished) S.autosave.resume(); throw e; }
}
function finish(res) {
  S.finished = true;
  if (S.timer) S.timer.stop();
  if (S.autosave) S.autosave.stop();
  if (S.start) clearDraft(S.start.attempt_id);
  const used = res && typeof res.time_used_s === 'number' ? res.time_used_s : Math.min((serverNow() - Date.parse(S.start.started_at)) / 1000, (S.start.time_limit_min || 999) * 60);
  refreshMe().then(() => show(() => doneView(used))).catch(() => show(() => doneView(used)));
}
async function refreshMe() { try { S.me = await api.me(); } catch (e) { /* the done screen works without it */ } }

async function autoSubmit() {
  if (S.submitting || S.finished || !S.start) return;
  S.submitting = true;
  const msg = h('span', { class: 'small muted', text: t('baseline.timeup_sending') });
  const dlg = modal({ title: t('baseline.timeup_title'), dismissable: false,
    body: h('div', { class: 'stack' }, h('p', { text: t('baseline.timeup_body') }), h('div', { class: 'row', role: 'status', 'aria-live': 'polite' }, h('span', { class: 'spinner' }), msg)) });
  announce(t('baseline.timeup_title'));
  for (let i = 0; i < 30; i += 1) {
    try {
      const res = await submitNow();
      dlg.close();
      finish(res);
      return;
    } catch (e) {
      if (['network', 'busy', 'server_error'].includes(e.code)) {
        msg.textContent = t('baseline.timeup_retry');
        await sleep(Math.min(15000, 3000 * (i + 1)));
        continue;
      }
      break; // e.g. an unfinished Part 2: the Hub submits what was saved when the grace period ends (specs/22 §3)
    }
  }
  dlg.close();
  finish(null);
}
async function gone() {
  if (S.finished) return;
  S.finished = true;
  if (S.timer) S.timer.stop();
  if (S.autosave) S.autosave.stop();
  toast(t('baseline.gone'));
  await boot();
}

// ---------- done ----------
function doneView(usedS) {
  app.classList.add('narrow');
  const b = (S.me && S.me.baseline) || {};
  const p = partOf(b, S.part) || {};
  const used = usedS !== undefined && usedS !== null ? usedS : usedSeconds(p);
  const others = PARTS.filter((n) => n !== S.part).map((n) => ({ n, ps: partOf(b, n) })).filter((x) => x.ps && x.ps.status !== 'submitted' && (x.ps.open || x.ps.status === 'in_progress'));
  const allDone = PARTS.every((n) => (partOf(b, n) || {}).status === 'submitted');
  render(app, h('div', { class: 'qz bl bl2 stack lg' },
    h('section', { class: 'result-hero neutral qz-hero bl-hero bl2-done', 'aria-labelledby': 'bl-done-h' },
      h('div', { class: 'qz-hero-head' },
        h('span', { class: 'qz-hero-icon', 'aria-hidden': 'true' }, icon('check-circle', 'lg')),
        h('p', { class: 'eyebrow', text: t('baseline.eyebrow', { wave: waveLabel(b.wave) }) })),
      h('h1', { id: 'bl-done-h', class: 'qz-hero-title', text: t('baseline.done_title', { n: S.part }) }),
      used !== null && used !== undefined ? h('p', { class: 'bl-overall' }, icon('clock', 'sm'), h('span', { text: t('baseline.time_used', { time: fmtDuration(used) }) })) : null,
      h('p', { class: 'qz-hero-body', text: allDone ? t('baseline.done_all') : t('baseline.done_body') })),
    b.results_open && b.profile_ready ? h('a', { class: 'card hover card-link bl2-cta', href: 'profile.html' },
      h('span', { class: 'tile-icon' }, icon('trend-up')), h('span', { class: 'grow stack sm' }, h('b', { class: 'ink', text: t('baseline.profile_cta') }), h('span', { class: 'small muted', text: t('baseline.profile_cta_sub') })), icon('arrow-right')) : null,
    others.length ? h('section', { class: 'stack', 'aria-labelledby': 'bl-next-h' },
      h('h2', { id: 'bl-next-h', class: 'bl-h2', text: t('baseline.next_parts') }),
      h('div', { class: 'bl2-tiles' }, others.map(({ n, ps: x }) => partTile(n, x)))) : null,
    h('p', { class: 'small muted bl-nofeedback' }, icon('eye-off', 'sm'), h('span', { text: t('baseline.no_feedback') })),
    h('div', { class: 'row qz-actions' }, h('a', { class: 'btn btn-primary', href: 'index.html' }, icon('home'), h('span', { text: t('baseline.back_home') })))));
  focusH1();
  toTop();
}

// ---------- boot ----------
async function boot() {
  render(app, loading());
  S.view = null;
  S.part = [1, 2, 3].includes(Number(qs('part'))) ? Number(qs('part')) : null;
  try {
    const [c, m] = await Promise.all([loadCatalog(), api.me()]);
    S.cat = c; S.me = m;
  } catch (e) { show(() => fatal(e, () => boot())); return; }
  const b = S.me.baseline;
  if (!b || !b.parts) { show(() => stateCard({ iconName: 'lock', title: t('baseline.unavailable_title'), body: t('baseline.unavailable_body') })); return; }
  if (!S.part) { show(chooserView); return; }
  const p = partOf(b, S.part);
  if (p && p.status === 'submitted') { show(() => doneView()); return; }
  if (!p || (p.status !== 'in_progress' && !p.open)) { show(closedView); return; }
  show(() => introView());
}

boot();
