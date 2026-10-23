// Reusable assessment runner (specs/13 quiz + baseline, specs/19 F4 autosave, F7 clock, F9 resume).
// - Local-first: every change is written to localStorage `hub.draft.<attempt_id>` before anything else.
// - Autosave: debounced (2 s), at most once every 20 s, an interval flush when dirty, and on page hide.
//   Never two saves in flight. A failed save never blocks answering.
// - Items render as fieldset.q-card + legend with radios inside labels; letters follow display order.
// - Phones (< 900 px): one screen at a time (an item or a group) with Prev/Next, q-dots and keys
//   1–4 / A–D / ← →. Desktop: list view with a sticky progress bar.
// Items never carry `answer`, `why` or `correct`, and this file never reads them.
import { h, icon, chip, render, progressBar } from './ui.js';
import { t, pick, getLang } from './i18n.js';
import { api, serverNow } from './api.js';

export const LETTERS = ['A', 'B', 'C', 'D'];
const DRAFT_PREFIX = 'hub.draft.';
export const DEBOUNCE_MS = 2000;
export const MIN_GAP_MS = 20000;
const WIDE_MQ = '(min-width: 900px)';
const TZ = 'Asia/Ho_Chi_Minh';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Formatting ----------
const localeOf = () => (getLang() === 'vi' ? 'vi-VN' : 'en-GB');
/** "09:41" in Vietnam time. */
export function fmtTime(v) {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(localeOf(), { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
}
/** Milliseconds → "59:07". */
export function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
/** Option {id, en, vi} → text in the current language. */
export const optionText = (o) => (o && (o[getLang()] || o.en)) || '';
const sameMap = (a, b) => {
  const ka = Object.keys(a); const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => String(a[k]) === String(b[k]));
};
const validLevel = (v) => v !== null && v !== undefined && v !== '' && Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 4;

// ---------- Screen-reader announcements ----------
let liveEl = null;
export function announce(text) {
  if (!liveEl || !liveEl.isConnected) {
    liveEl = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    document.body.append(liveEl);
  }
  liveEl.textContent = '';
  setTimeout(() => { liveEl.textContent = text; }, 60);
}

// ---------- Local drafts ----------
export function readDraft(id) {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + id);
    const d = raw ? JSON.parse(raw) : null;
    return d && typeof d === 'object' ? d : null;
  } catch (e) { return null; }
}
export function writeDraft(id, d) {
  try { localStorage.setItem(DRAFT_PREFIX + id, JSON.stringify(d)); return true; } catch (e) { return false; }
}
export function clearDraft(id) {
  try { localStorage.removeItem(DRAFT_PREFIX + id); } catch (e) { /* storage blocked */ }
}

/**
 * Merge what the server returned on `start` with the local draft. The draft records when it last
 * changed (changed_at) and which change the last successful save carried (synced_at): if the draft
 * has unsaved changes it wins per key, otherwise the server wins (it may hold a newer device's save).
 */
export function mergeResume(start, draft) {
  const items = new Map((start.items || []).map((i) => [i.item_id, i]));
  const okAnswer = (k, v) => items.has(k) && (items.get(k).options || []).some((o) => o.id === v);
  const clean = (m, ok) => Object.fromEntries(Object.entries(m && typeof m === 'object' ? m : {}).filter(([k, v]) => ok(k, v)));
  const sa = clean(start.answers, okAnswer);
  const ss = clean(start.self_ratings, (k, v) => validLevel(v));
  Object.keys(ss).forEach((k) => { ss[k] = Number(ss[k]); });
  if (!draft) return { answers: { ...sa }, self_ratings: { ...ss }, dirty: false, pos: null, changed_at: 0, synced_at: 0, saved_at: null };
  const da = clean(draft.answers, okAnswer);
  const ds = clean(draft.self_ratings, (k, v) => validLevel(v));
  Object.keys(ds).forEach((k) => { ds[k] = Number(ds[k]); });
  const changed = Number(draft.changed_at) || 0;
  const synced = Number(draft.synced_at) || 0;
  const localNewer = changed > synced;
  const answers = localNewer ? { ...sa, ...da } : { ...da, ...sa };
  const self = localNewer ? { ...ss, ...ds } : { ...ds, ...ss };
  const dirty = !sameMap(answers, sa) || !sameMap(self, ss);
  return { answers, self_ratings: self, dirty, pos: draft.pos || null, changed_at: changed, synced_at: dirty ? Math.min(synced, changed - 1) : changed, saved_at: draft.saved_at || null };
}

// ---------- Autosave ----------
/**
 * @param {object} o  save(): Promise (one network save) · onStatus(state, result|error) · onGone(err)
 * States: saving · saved · local (changed, waiting for the next save) · offline · error
 */
export function createAutosave({ save, onStatus, onGone, debounceMs = DEBOUNCE_MS, minGapMs = MIN_GAP_MS }) {
  let seq = 0; let savedSeq = 0; let inflight = null; let timer = null; let lastStart = -Infinity;
  let paused = false; let stopped = false; let cur = 'idle';
  const dirty = () => seq > savedSeq;
  const set = (s, x) => { cur = s; try { if (onStatus) onStatus(s, x); } catch (e) { console.error(e); } };
  function schedule(delay) {
    if (stopped || paused) return 0;
    const wait = Math.max(delay, lastStart + minGapMs - Date.now());
    clearTimeout(timer);
    timer = setTimeout(() => run(false), wait);
    return wait;
  }
  async function run(force) {
    clearTimeout(timer); timer = null;
    if (stopped || paused || !dirty()) return inflight || undefined;
    if (inflight) return inflight; // the follow-up after it settles picks up new changes
    if (!force && Date.now() - lastStart < minGapMs) { schedule(debounceMs); return undefined; }
    const mine = seq;
    lastStart = Date.now();
    set('saving');
    inflight = (async () => {
      try {
        const res = await save();
        savedSeq = Math.max(savedSeq, mine);
        set(dirty() ? 'local' : 'saved', res);
      } catch (e) {
        if (e && (e.code === 'already_submitted' || e.code === 'not_found')) {
          stop();
          if (onGone) onGone(e);
          return;
        }
        set(e && e.code === 'network' ? 'offline' : 'error', e);
      } finally { inflight = null; }
    })();
    await inflight;
    if (dirty() && !stopped && !paused) schedule(debounceMs);
    return undefined;
  }
  const iv = setInterval(() => { if (dirty() && !inflight && Date.now() - lastStart >= minGapMs) run(false); }, minGapMs);
  const onVis = () => { if (document.visibilityState === 'hidden') run(true); };
  const onHide = () => run(true);
  const onOnline = () => { if (dirty()) run(true); };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('pagehide', onHide);
  window.addEventListener('online', onOnline);
  function stop() {
    stopped = true; clearTimeout(timer); clearInterval(iv);
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('pagehide', onHide);
    window.removeEventListener('online', onOnline);
  }
  return {
    touch() {
      if (stopped) return;
      seq += 1;
      const wait = schedule(debounceMs);
      if (!inflight && (cur === 'saved' || cur === 'idle') && wait > debounceMs + 500) set('local');
    },
    /** Save now (ignores the 20 s spacing); resolves when the network call settles. */
    async flush() { await run(true); if (inflight) await inflight; },
    settle: () => inflight || Promise.resolve(),
    pause() { paused = true; clearTimeout(timer); },
    resume() { paused = false; if (dirty()) schedule(debounceMs); },
    stop,
    isDirty: dirty,
    status: () => cur,
  };
}

// ---------- Save status pill ----------
const PILL_ICON = { idle: 'cloud', local: 'check', saving: 'refresh', saved: 'cloud', offline: 'wifi-off', error: 'alert' };
export function createSavePill() {
  const ico = h('span', { class: 'qz-pill-ico', 'aria-hidden': 'true' });
  const text = h('span', { class: 'qz-pill-text' });
  const el = h('span', { class: 'save-status qz-pill', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, ico, text);
  let state = 'idle'; let at = null;
  function paint() {
    el.className = `save-status qz-pill is-${state}${state === 'saved' ? ' ok' : ''}${state === 'offline' || state === 'error' ? ' off' : ''}`;
    render(ico, icon(PILL_ICON[state] || 'cloud', 'sm'));
    text.textContent = state === 'saved' && at ? t('quiz.save.saved', { time: fmtTime(at) }) : t(`quiz.save.${state === 'saved' ? 'saved_now' : state}`);
  }
  paint();
  return {
    el,
    set(s, savedAt) { state = s; if (savedAt) at = savedAt; paint(); },
    repaint: paint,
    get state() { return state; },
  };
}

// ---------- Timer (server clock, specs/19 F7) ----------
export function createTimer({ deadlineAt, lowMs = 5 * 60000, onTick, onLow, onExpire }) {
  const deadline = Date.parse(deadlineAt);
  let handle = null; let lowDone = false; let done = false;
  const left = () => deadline - serverNow();
  function tick() {
    if (done) return;
    const ms = left();
    try { if (onTick) onTick(Math.max(0, ms)); } catch (e) { console.error(e); }
    if (!lowDone && ms <= lowMs) { lowDone = true; if (ms > 0 && onLow) onLow(ms); }
    if (ms <= 0) { done = true; cleanup(); if (onExpire) onExpire(); return; }
    handle = setTimeout(tick, (ms % 1000 || 1000) + 15);
  }
  const onVis = () => { if (document.visibilityState === 'visible' && !done) { clearTimeout(handle); tick(); } };
  function cleanup() { clearTimeout(handle); document.removeEventListener('visibilitychange', onVis); }
  document.addEventListener('visibilitychange', onVis);
  setTimeout(tick, 0);
  return { left, stop() { done = true; cleanup(); }, get expired() { return done && left() <= 0; } };
}

/** The visible countdown chip (.timer, .low under 5 min). */
export function timerChip() {
  const num = h('span', { class: 'num' }, '60:00');
  const el = h('span', { class: 'timer qz-timer', role: 'timer' }, icon('clock', 'sm'), num);
  let lastMin = null;
  return {
    el,
    set(ms) {
      num.textContent = fmtClock(ms);
      el.classList.toggle('low', ms <= 5 * 60000);
      const min = Math.ceil(ms / 60000);
      if (min !== lastMin) { lastMin = min; el.setAttribute('aria-label', t('quiz.time_left', { n: min })); }
    },
    repaint() { lastMin = null; },
  };
}

// ---------- Sticky top bar ----------
/** quiz-top: title · save pill · timer, then the progress bar and "n of total answered". */
export function buildTop({ title, pill, timerEl, n = 0, total = 0, countText }) {
  const pct = total ? Math.round((100 * n) / total) : 0;
  const bar = progressBar(pct, { blue: true, label: t('quiz.progress_aria') });
  const count = h('span', { class: 'qz-count', text: countText || t('quiz.answered', { n, total }) });
  const el = h('div', { class: 'quiz-top qz-top' },
    h('div', { class: 'qz-top-row' }, h('span', { class: 'qz-top-title', text: title }), h('span', { class: 'qz-top-tools' }, pill || null, timerEl || null)),
    h('div', { class: 'qz-top-row qz-top-progress' }, bar, count));
  return {
    el,
    update(nn, tt, text) {
      const p = tt ? Math.round((100 * nn) / tt) : 0;
      bar.setAttribute('aria-valuenow', String(p));
      bar.firstChild.style.width = `${p}%`;
      count.textContent = text || t('quiz.answered', { n: nn, total: tt });
    },
  };
}

function stickyBottom() {
  const header = document.querySelector('.app-header');
  const top = document.querySelector('.qz-top');
  return (header ? header.getBoundingClientRect().bottom : 0) + (top ? top.offsetHeight : 0);
}
/** Scroll so `el` sits just under the sticky header + quiz bar. */
export function scrollToEl(el, gap = 12) {
  if (!el) return;
  const header = document.querySelector('.app-header');
  const top = document.querySelector('.qz-top');
  const off = (header ? header.offsetHeight : 64) + (top ? top.offsetHeight : 0) + gap;
  window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - off), behavior: 'auto' });
}

// ---------- The runner ----------
export class QuizRunner {
  /**
   * @param {object} o  start: the `start` response · withSelf: send self_ratings (baseline)
   *                    onGone(err): the attempt was submitted elsewhere · onChange(): any answer/rating changed
   */
  constructor({ start, withSelf = false, onGone, onChange }) {
    this.start = start;
    this.id = start.attempt_id;
    this.withSelf = withSelf;
    this.items = start.items || [];
    this.onChange = onChange || null;
    const m = mergeResume(start, readDraft(this.id));
    this.answers = m.answers;
    this.self = m.self_ratings;
    this.pos = m.pos || {};
    this.index = { ...((m.pos && m.pos.index) || {}) };
    this.changedAt = m.changed_at;
    this.syncedAt = m.synced_at;
    this.savedAt = m.saved_at;
    this.view = null;
    this.refs = null;
    this.submitted = false;
    this.pill = createSavePill();
    if (this.savedAt && !m.dirty) this.pill.set('saved', this.savedAt);
    this.autosave = createAutosave({
      save: () => this.saveNow(),
      onStatus: (s, x) => this.pill.set(s, s === 'saved' && x ? x.saved_at : null),
      onGone: (e) => { if (onGone) onGone(e); },
    });
    this.mq = window.matchMedia(WIDE_MQ);
    this.mode = this.mq.matches ? 'list' : 'paged';
    this.onMq = () => {
      const next = this.mq.matches ? 'list' : 'paged';
      if (next === this.mode) return;
      const a = this.captureAnchor();
      this.mode = next;
      if (this.view) { this.renderView({ anchor: a, toAnchor: true }); }
    };
    this.mq.addEventListener('change', this.onMq);
    this.onKey = (e) => this.handleKey(e);
    document.addEventListener('keydown', this.onKey);
    this.onDocClick = (e) => this.guardLeave(e);
    document.addEventListener('click', this.onDocClick, true);
    this.persist();
    if (m.dirty) this.autosave.touch();
  }

  // ----- state -----
  persist() {
    writeDraft(this.id, {
      v: 1, answers: this.answers, self_ratings: this.self, changed_at: this.changedAt, synced_at: this.syncedAt,
      saved_at: this.savedAt, pos: { ...this.pos, index: this.index },
    });
  }
  setPos(patch) { Object.assign(this.pos, patch); this.persist(); }
  async saveNow() {
    const changedAt = this.changedAt;
    const res = await api.save(this.id, { ...this.answers }, this.withSelf ? { ...this.self } : undefined);
    this.syncedAt = Math.max(this.syncedAt, changedAt);
    if (res && res.saved_at) this.savedAt = res.saved_at;
    this.persist();
    return res;
  }
  changed() {
    this.changedAt = Math.max(serverNow(), this.changedAt + 1);
    this.persist();
    this.autosave.touch();
    if (this.onChange) { try { this.onChange(); } catch (e) { console.error(e); } }
  }
  setAnswer(itemId, optId) {
    if (this.submitted || this.answers[itemId] === optId) return;
    this.answers[itemId] = optId;
    this.changed();
    this.paintProgress();
  }
  setSelf(course, level) {
    if (this.submitted || this.self[course] === level) return;
    this.self[course] = level;
    this.changed();
  }
  answeredCount(items) { return items.filter((i) => this.answers[i.item_id]).length; }
  unanswered(items) { return items.filter((i) => !this.answers[i.item_id]); }

  // ----- items -----
  renderItem(item, n, total, metaKey = 'quiz.q_of') {
    const id = item.item_id;
    const name = `q-${id}`;
    const opts = (item.options || []).map((o, i) => {
      const input = h('input', { type: 'radio', name, value: o.id, checked: this.answers[id] === o.id, 'data-fk': `${id}|${o.id}` });
      input.addEventListener('change', () => { if (input.checked) this.setAnswer(id, o.id); });
      return h('label', { class: 'opt' }, input, h('span', { class: 'letter', text: LETTERS[i] || String(i + 1) }), h('span', { class: 'txt', text: optionText(o) }));
    });
    return h('fieldset', { class: 'q-card qz-q', id: `q-${id}`, 'data-item': id, tabindex: '-1', 'data-fk': `card|${id}` },
      h('legend', null, h('span', { class: 'q-meta', text: t(metaKey, { n, total }) }), h('span', { class: 'qz-stem', text: pick(item, 'stem') })),
      h('div', { class: 'opts' }, opts));
  }

  // ----- question views -----
  /**
   * Show one part as questions.
   * cfg: key, groups:[{key, items, header?()}], paging:'item'|'group', title(), timerEl?, metaKey?,
   *      intro?(mode), aside?(mode), countLabel?(n,total), dotLabel?(screen,i),
   *      backLabel?, onBack?, doneLabel, onDone, startAt?: 'first'|'last'|itemId
   */
  show(container, cfg) {
    this.view = { container, cfg };
    this.pos.part = cfg.key;
    const screens = this.screensOf(cfg);
    if (cfg.startAt === 'last') this.index[cfg.key] = screens.length - 1;
    else if (cfg.startAt === 'first') this.index[cfg.key] = 0;
    else if (cfg.startAt) this.index[cfg.key] = Math.max(0, screens.findIndex((s) => s.items.some((i) => i.item_id === cfg.startAt)));
    if (this.index[cfg.key] === undefined) this.index[cfg.key] = 0;
    this.persist();
    this.renderView({ toTop: true });
  }
  hide() { this.view = null; this.refs = null; }
  get active() { return !!(this.view && this.view.container.isConnected); }
  screensOf(cfg) {
    if (cfg.paging === 'group') return cfg.groups.map((g) => ({ key: g.key, group: g, items: g.items }));
    const out = [];
    cfg.groups.forEach((g) => g.items.forEach((it) => out.push({ key: it.item_id, group: g, items: [it] })));
    return out;
  }
  /** Re-draw the current view in place (language change), keeping answers, position, scroll and focus. */
  rerender() { this.pill.repaint(); if (this.active) this.renderView({}); }

  renderView({ anchor, toAnchor = false, toTop = false, focusScreen = false } = {}) {
    if (!this.view) return;
    const { container, cfg } = this.view;
    const keep = toTop || toAnchor ? null : this.captureAnchor();
    const fk = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fk : null;
    const all = cfg.groups.flatMap((g) => g.items);
    const num = new Map(all.map((it, i) => [it.item_id, i + 1]));
    const screens = this.screensOf(cfg);
    let idx = Math.min(Math.max(0, this.index[cfg.key] || 0), Math.max(0, screens.length - 1));
    const anc = anchor || keep;
    if (anc && this.mode === 'paged') {
      const si = screens.findIndex((s) => s.items.some((i) => i.item_id === anc.id));
      if (si >= 0) idx = si;
    }
    this.index[cfg.key] = idx;
    this.persist();
    const n = this.answeredCount(all);
    const top = buildTop({ title: cfg.title(), pill: this.pill.el, timerEl: cfg.timerEl, n, total: all.length, countText: cfg.countLabel ? cfg.countLabel(n, all.length) : null });
    this.refs = { top, dots: [], all, screens };
    const body = this.mode === 'paged' ? this.renderPaged(cfg, screens, idx, num, all.length) : this.renderList(cfg, num, all.length);
    render(container, h('div', { class: `qz-run is-${this.mode}` }, top.el, body));
    // restore position
    if (toAnchor && anc) {
      const el = document.getElementById(`q-${anc.id}`);
      if (el) scrollToEl(el);
    } else if (toTop || focusScreen) {
      const y = container.getBoundingClientRect().top + window.scrollY - (document.querySelector('.app-header') || { offsetHeight: 64 }).offsetHeight - 8;
      if (window.scrollY > y) window.scrollTo({ top: Math.max(0, y), behavior: 'auto' });
    } else if (keep) {
      const el = document.getElementById(`q-${keep.id}`);
      if (el) window.scrollBy(0, el.getBoundingClientRect().top - keep.top);
    }
    if (focusScreen) {
      const first = container.querySelector('.qz-screen .qz-q');
      if (first) first.focus({ preventScroll: true });
    } else if (fk) {
      const el = Array.from(container.querySelectorAll('[data-fk]')).find((x) => x.dataset.fk === fk);
      if (el) el.focus({ preventScroll: true });
    }
  }

  renderPaged(cfg, screens, idx, num, total) {
    const s = screens[idx];
    const isFirst = idx === 0; const isLast = idx === screens.length - 1;
    const showHeader = s && s.group && s.group.header && (cfg.paging === 'group' || s.group.items[0] === s.items[0]);
    const screen = h('div', { class: 'qz-screen stack', 'data-screen': String(idx) },
      isFirst && cfg.intro ? cfg.intro('paged') : null,
      cfg.aside ? cfg.aside('paged') : null,
      showHeader ? s.group.header() : null,
      s ? s.items.map((it) => this.renderItem(it, num.get(it.item_id), total, cfg.metaKey)) : null);
    const prev = isFirst
      ? (cfg.onBack
        ? h('button', { class: 'btn btn-ghost', type: 'button', 'data-fk': 'nav-prev', onclick: () => cfg.onBack() }, icon('chevron-left'), h('span', { text: cfg.backLabel }))
        : h('button', { class: 'btn btn-ghost', type: 'button', disabled: true }, icon('chevron-left'), h('span', { text: t('quiz.prev') })))
      : h('button', { class: 'btn btn-ghost', type: 'button', 'data-fk': 'nav-prev', onclick: () => this.go(idx - 1) }, icon('chevron-left'), h('span', { text: t('quiz.prev') }));
    const next = isLast
      ? h('button', { class: 'btn btn-primary', type: 'button', 'data-fk': 'nav-done', onclick: () => cfg.onDone() }, h('span', { text: cfg.doneLabel }), icon('arrow-right'))
      : h('button', { class: 'btn btn-primary', type: 'button', 'data-fk': 'nav-next', onclick: () => this.go(idx + 1) }, h('span', { text: t('quiz.next') }), icon('chevron-right'));
    const dots = screens.map((sc, i) => {
      const btn = h('button', { type: 'button', 'data-fk': `dot|${i}`, 'aria-current': i === idx ? 'step' : null, onclick: () => this.go(i) },
        cfg.dotLabel ? cfg.dotLabel(sc, i) : String(i + 1));
      this.refs.dots.push({ btn, screen: sc, i });
      return btn;
    });
    this.paintDots();
    const foot = h('div', { class: 'qz-foot' },
      h('nav', { class: 'qz-dots', 'aria-label': t('quiz.dots_aria') }, h('div', { class: 'q-dots' }, dots)),
      !isLast && cfg.reviewLinkLabel ? h('button', { class: 'link-btn qz-review-link', type: 'button', 'data-fk': 'nav-review', onclick: () => (cfg.onReviewLink || cfg.onDone)() }, cfg.reviewLinkLabel) : null,
      hasKeyboard() ? h('p', { class: 'qz-keys xs muted', text: t('quiz.keys_hint') }) : null);
    return h('div', { class: 'qz-paged stack' }, screen, h('div', { class: 'q-nav' }, prev, next), foot);
  }

  renderList(cfg, num, total) {
    const groups = cfg.groups.map((g) => h('section', { class: 'qz-group stack', 'aria-label': g.label || null },
      g.header ? g.header() : null,
      g.items.map((it) => this.renderItem(it, num.get(it.item_id), total, cfg.metaKey))));
    const foot = h('div', { class: 'q-nav qz-list-foot' },
      cfg.onBack ? h('button', { class: 'btn btn-ghost', type: 'button', 'data-fk': 'nav-prev', onclick: () => cfg.onBack() }, icon('chevron-left'), h('span', { text: cfg.backLabel })) : h('span'),
      h('button', { class: 'btn btn-primary btn-lg', type: 'button', 'data-fk': 'nav-done', onclick: () => cfg.onDone() }, h('span', { text: cfg.doneLabel }), icon('arrow-right')));
    const intro = cfg.intro ? cfg.intro('list') : null;
    if (cfg.aside) return h('div', { class: 'stack lg' }, intro, h('div', { class: 'qz-case-grid' }, cfg.aside('list'), h('div', { class: 'qz-list stack lg' }, groups, foot)));
    return h('div', { class: 'qz-list stack lg' }, intro, groups, foot);
  }

  paintDots() {
    if (!this.refs) return;
    const cfg = this.view && this.view.cfg;
    for (const { btn, screen, i } of this.refs.dots) {
      const answered = screen.items.filter((it) => this.answers[it.item_id]).length;
      const done = answered === screen.items.length;
      btn.classList.toggle('answered', done);
      btn.classList.toggle('partial', !done && answered > 0);
      const label = cfg && cfg.dotAria ? cfg.dotAria(screen, i, answered) : t(done ? 'quiz.dot_answered' : 'quiz.dot_unanswered', { n: i + 1 });
      btn.setAttribute('aria-label', label);
    }
  }
  paintProgress() {
    if (!this.active || !this.refs) return;
    const { cfg } = this.view;
    const n = this.answeredCount(this.refs.all); const total = this.refs.all.length;
    this.refs.top.update(n, total, cfg.countLabel ? cfg.countLabel(n, total) : null);
    this.paintDots();
  }

  go(i) {
    if (!this.view) return;
    const screens = this.screensOf(this.view.cfg);
    this.index[this.view.cfg.key] = Math.max(0, Math.min(screens.length - 1, i));
    this.persist();
    this.renderView({ focusScreen: true });
  }
  /** Show the screen holding `itemId` and focus that question. */
  jumpTo(itemId) {
    if (!this.view) return;
    const screens = this.screensOf(this.view.cfg);
    const si = screens.findIndex((s) => s.items.some((i) => i.item_id === itemId));
    if (si >= 0) this.index[this.view.cfg.key] = si;
    this.renderView({ toTop: true });
    const card = document.getElementById(`q-${itemId}`);
    if (card) { scrollToEl(card); card.focus({ preventScroll: true }); }
  }
  captureAnchor() {
    if (!this.active) return null;
    const limit = stickyBottom();
    for (const c of this.view.container.querySelectorAll('.qz-q')) {
      const r = c.getBoundingClientRect();
      if (r.bottom > limit + 8) return { id: c.dataset.item, top: r.top };
    }
    return null;
  }

  // ----- keyboard: 1–4 / A–D choose, ← → move (phones) -----
  handleKey(e) {
    if (!this.active || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    if (document.querySelector('dialog[open]')) return;
    const tg = e.target;
    const inView = tg === document.body || (tg && tg.id === 'main') || this.view.container.contains(tg);
    if (!inView) return;
    if (tg && (tg.isContentEditable || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT' || (tg.tagName === 'INPUT' && tg.type !== 'radio'))) return;
    const key = e.key;
    if (this.mode === 'paged' && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      e.preventDefault();
      const idx = this.index[this.view.cfg.key] || 0;
      const n = this.screensOf(this.view.cfg).length;
      if (key === 'ArrowRight' && idx < n - 1) this.go(idx + 1);
      else if (key === 'ArrowLeft' && idx > 0) this.go(idx - 1);
      return;
    }
    let choice = -1;
    if (/^[1-4]$/.test(key)) choice = Number(key) - 1;
    else if (/^[a-dA-D]$/.test(key)) choice = key.toLowerCase().charCodeAt(0) - 97;
    if (choice < 0) return;
    let card = tg && tg.closest ? tg.closest('.qz-q') : null;
    if (!card && this.mode === 'paged') {
      const cards = this.view.container.querySelectorAll('.qz-screen .qz-q');
      if (cards.length === 1) [card] = cards;
    }
    if (!card) return;
    const input = card.querySelectorAll('input[type="radio"]')[choice];
    if (!input) return;
    e.preventDefault();
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.focus();
  }

  // ----- leaving with unsaved changes: save first (bounded), then go -----
  guardLeave(e) {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank') return;
    if (this.submitted || !this.autosave.isDirty()) return;
    const href = a.href;
    if (!href || href.startsWith('javascript:')) return;
    e.preventDefault();
    Promise.race([this.autosave.flush(), sleep(2500)]).finally(() => { location.href = href; });
  }

  // ----- review list (generic) -----
  reviewList(items, { onJump, metaKey = 'quiz.q_short', startAt = 1 } = {}) {
    return h('ol', { class: 'qz-rev' }, items.map((it, i) => {
      const a = this.answers[it.item_id];
      const oi = (it.options || []).findIndex((o) => o.id === a);
      const n = i + startAt;
      const ans = oi >= 0
        ? h('span', { class: 'qz-rev-ans' }, h('span', { class: 'qz-rev-letter', 'aria-hidden': 'true', text: LETTERS[oi] }), h('span', { class: 'qz-rev-opt', text: optionText(it.options[oi]) }))
        : chip(t('quiz.review.not_answered'), 'warn', 'alert');
      const label = oi >= 0 ? t('quiz.review.row_answered', { n, letter: LETTERS[oi] }) : t('quiz.review.row_unanswered', { n });
      return h('li', null, h('button', { type: 'button', class: `qz-rev-row${oi >= 0 ? '' : ' is-open'}`, 'aria-label': label, onclick: () => onJump(it) },
        h('span', { class: 'qz-rev-num', 'aria-hidden': 'true', text: String(n) }),
        h('span', { class: 'qz-rev-main' }, h('span', { class: 'qz-rev-stem', text: pick(it, 'stem') }), ans),
        icon('chevron-right', 'qz-rev-go')));
    }));
  }

  // ----- submit (idempotent on the server, safe to retry) -----
  async submit() {
    this.autosave.pause();
    await this.autosave.settle();
    try {
      const res = await api.submit(this.id, { ...this.answers }, this.withSelf ? { ...this.self } : undefined);
      this.submitted = true;
      this.autosave.stop();
      clearDraft(this.id);
      this.destroy();
      return res;
    } catch (e) {
      this.autosave.resume();
      throw e;
    }
  }
  destroy() {
    this.mq.removeEventListener('change', this.onMq);
    document.removeEventListener('keydown', this.onKey);
    document.removeEventListener('click', this.onDocClick, true);
    this.autosave.stop();
    this.view = null;
  }
}

function hasKeyboard() {
  try { return window.matchMedia('(hover: hover) and (pointer: fine)').matches; } catch (e) { return false; }
}

// ---------- Result helpers (shared by quiz results) ----------
/** One answer line: kind 'your' | 'right' | 'none' with icon + label + text (colour is never the only signal). */
export function answerLine(kind, option, { correct = null } = {}) {
  const blank = kind === 'your' && !option;
  const cls = kind === 'right' || (kind === 'your' && correct === true) ? 'is-correct' : (kind === 'your' && correct === false ? 'is-wrong' : 'is-neutral');
  const ico = cls === 'is-correct' ? 'check' : (cls === 'is-wrong' ? 'x' : 'circle');
  const label = kind === 'right' ? t('result.right_answer') : t('result.your_answer');
  let status = '';
  if (blank) status = t('result.blank_suffix');
  else if (cls === 'is-correct') status = kind === 'right' ? '' : t('result.correct_suffix');
  else if (cls === 'is-wrong') status = t('result.wrong_suffix');
  return h('div', { class: `opt qz-static ${cls}` },
    h('span', { class: 'letter', 'aria-hidden': 'true' }, icon(ico, 'sm')),
    h('span', { class: 'txt' }, h('span', { class: 'qz-ans-label', text: `${label}${status ? ` · ${status}` : ''}` }), h('span', { class: 'qz-ans-text', text: option ? optionText(option) : t('result.no_answer') })));
}

// ---------- Rubric (capstone + panel, templates/capstone_rubric.md) ----------
export const CRITERIA = ['c1', 'c2', 'c3', 'c4', 'c5'];
export const DOUBLE = { pitch: ['c5'], capstone: ['c3', 'c4'] };
export const isDouble = (stage, c) => (DOUBLE[stage] || []).includes(c);

/** Anchors 1 / 3 / 5 for one criterion. */
export function rubricAnchors(c) {
  return h('div', { class: 'anchors qz-anchors' }, [1, 3, 5].map((n) => h('div', { class: 'qz-anchor' }, h('b', { text: String(n) }), h('span', { text: t(`rubric.${c}.a${n}`) }))));
}

/** The rubric explained for teams (capstone page) or as a reference. */
export function rubricCard(stage, { headingLevel = 'h2' } = {}) {
  const rows = CRITERIA.map((c, i) => h('div', { class: 'rubric-row' },
    h('div', { class: 'row tight qz-crit-head' },
      h('span', { class: 'qz-crit-n', 'aria-hidden': 'true', text: String(i + 1) }),
      h('h3', { class: 'qz-crit-name', text: t(`rubric.${c}.name`) }),
      isDouble(stage, c) ? chip(t('rubric.double'), 'info', 'star') : null),
    h('p', { class: 'small', text: t(`rubric.${c}.what`) }),
    rubricAnchors(c)));
  return h('section', { class: 'card qz-rubric', 'aria-labelledby': `rubric-h-${stage}` },
    h('div', { class: 'pad stack sm' },
      h(headingLevel, { id: `rubric-h-${stage}`, text: t('rubric.title') }),
      h('p', { class: 'small muted', text: t('rubric.intro') }),
      h('div', { class: 'callout info small' }, icon('star'), h('span', { text: t(`rubric.weight_${stage}`) })),
      h('div', null, rows)));
}


// ---------- Money (capstone + panel) ----------
/** "1250000000" → { full: "1,250,000,000 ₫", approx: "≈ 1.25 billion VND" } in the current language. */
export function fmtVND(digits) {
  const s = String(digits || '').replace(/\D/g, '');
  if (!s) return { full: '', approx: '' };
  const vi = getLang() === 'vi';
  let full;
  try { full = `${new Intl.NumberFormat(vi ? 'vi-VN' : 'en-GB').format(BigInt(s))} ₫`; } catch (e) { full = `${s} ₫`; }
  const n = Number(s);
  const nf = new Intl.NumberFormat(vi ? 'vi-VN' : 'en-GB', { maximumFractionDigits: 2 });
  let approx = '';
  if (n >= 1e9) approx = t('capstone.vnd_billion', { n: nf.format(n / 1e9) });
  else if (n >= 1e6) approx = t('capstone.vnd_million', { n: nf.format(n / 1e6) });
  else if (n >= 1e3) approx = t('capstone.vnd_thousand', { n: nf.format(n / 1e3) });
  return { full, approx };
}
/** Count words the way the backend does (whitespace-separated). */
export const countWords = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
