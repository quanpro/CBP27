// rate.html — manager rating for the baseline (specs/22 §3–4: rate_list, rate_get, rate_save). Managers
// and admins only. List of reports with status → the rater guide → the statements in manager wording,
// each 1–4 or "N/A – not observed". Every tap is kept as a draft on this device at once and saved to the
// Hub a moment later ("Saved 10:42"); offline, the draft waits on the device and is sent when the
// connection is back. Leaving with unsaved ratings asks first (as the panel page does).
// Sheet text (names, statements, anchors, the guide) is inserted as text only; the guide via md.js.
import { mountShell, h, icon, chip, render, loading, emptyState, errorState, errorMessage, toast, confirmDialog } from '../ui.js';
import { guideBox } from '../guide.js';
import { t, pick, getLang, onLangChange } from '../i18n.js';
import { api } from '../api.js';
import { fmtDateTime } from '../courses.js';
import { fmtTime } from '../quiz.js';
import { mdBlocks } from '../md.js';
import { waveLabel } from '../bl2.js';

const { app, session } = await mountShell({ page: 'rate' });
app.classList.add('narrow');

const profile = (session && session.profile) || {};
const roles = profile.roles || [];
const allowed = roles.includes('manager') || roles.includes('admin');
const rater = profile.code || 'me';
const SAVE_DELAY = 900;
const RETRY_MS = 20000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const S = {
  list: null, listErr: null,
  cur: null, curErr: null, ratee: null,
  values: {}, status: { kind: 'idle' }, unsaved: false, saving: null, timer: null, retry: null,
  view: 'list', // list | guide | form
};

// ---------- local drafts ----------
const draftKey = (ratee) => `hub.ratedraft.${rater}.${ratee}`;
function readDraft(ratee) { try { const d = JSON.parse(localStorage.getItem(draftKey(ratee)) || 'null'); return d && typeof d === 'object' && d.values ? d : null; } catch (e) { return null; } }
function writeDraft(ratee, values) { try { localStorage.setItem(draftKey(ratee), JSON.stringify({ values, at: Date.now() })); return true; } catch (e) { return false; } }
function dropDraft(ratee) { try { localStorage.removeItem(draftKey(ratee)); } catch (e) { /* storage blocked */ } }
const okVal = (v) => v === 'NA' || ([1, 2, 3, 4].includes(Number(v)) && v !== null && v !== '' && v !== true);
function cleanValues(m, items) {
  const ids = new Set((items || []).map((i) => i.item_id));
  return Object.fromEntries(Object.entries(m && typeof m === 'object' ? m : {}).filter(([k, v]) => ids.has(k) && okVal(v)).map(([k, v]) => [k, v === 'NA' ? 'NA' : Number(v)]));
}
const sameVals = (a, b) => { const ka = Object.keys(a); return ka.length === Object.keys(b).length && ka.every((k) => String(a[k]) === String(b[k])); };

window.addEventListener('beforeunload', (e) => { if (S.unsaved) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('online', () => { if (S.unsaved) saveSoon(0); });
window.addEventListener('popstate', () => route(false));
onLangChange(() => draw(true));

// ---------- routing ----------
function urlFor(view, ratee) {
  if (view === 'list' || !ratee) return 'rate.html';
  return `rate.html?r=${encodeURIComponent(ratee)}${view === 'guide' ? '&v=guide' : ''}`;
}
async function nav(view, ratee) {
  if (S.view === 'form' && S.unsaved && (view !== 'form' || ratee !== S.ratee)) {
    const done = await flush();
    if (!done) {
      const ok = await confirmDialog({ title: t('rate.leave_title'), body: t('rate.leave_body'), confirm: t('rate.leave_yes'), cancel: t('rate.leave_no') });
      if (!ok) return;
    }
  }
  try { history.pushState(null, '', urlFor(view, ratee)); } catch (e) { /* ignore */ }
  route(true);
}
async function route(scroll) {
  const p = new URLSearchParams(location.search);
  const r = (p.get('r') || '').trim().toUpperCase();
  if (!r) { S.view = 'list'; await ensureList(); draw(); if (scroll) window.scrollTo(0, 0); focusH1(); return; }
  const v = p.get('v') === 'guide' ? 'guide' : 'form';
  if (S.ratee !== r || !S.cur) await loadRatee(r);
  S.view = S.curErr ? 'list' : v;
  draw();
  if (scroll) window.scrollTo(0, 0);
  focusH1();
}
function focusH1() { const el = app.querySelector('h1'); if (el) { el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); } }

// ---------- data ----------
async function ensureList(force) {
  if (S.list && !force) return;
  render(app, loading());
  S.listErr = null;
  try { S.list = await api.rateList(); } catch (e) { S.listErr = e; }
}
async function loadRatee(code) {
  render(app, loading());
  S.curErr = null; S.cur = null; S.ratee = code; S.unsaved = false; S.status = { kind: 'idle' };
  clearTimeout(S.timer);
  try {
    const res = await api.rateGet(code);
    S.cur = res;
    const server = cleanValues(res.values, res.items);
    S.values = { ...server };
    S.status = res.saved_at ? { kind: 'saved', at: res.saved_at } : { kind: 'idle' };
    const d = readDraft(code);
    if (d) {
      const draft = cleanValues(d.values, res.items);
      const newer = !res.saved_at || d.at > Date.parse(res.saved_at);
      if (sameVals(draft, server) || !newer) dropDraft(code);
      else {
        S.values = draft; S.unsaved = true; S.status = { kind: 'draft' };
        saveSoon(300);
      }
    }
  } catch (e) {
    S.curErr = e;
    if (e.code === 'not_open') { S.list = null; try { history.replaceState(null, '', 'rate.html'); } catch (e2) { /* ignore */ } }
    if (!S.list) { try { S.list = await api.rateList(); } catch (e2) { S.listErr = e2; } }
  }
}

// ---------- saving ----------
function saveSoon(delay = SAVE_DELAY) {
  clearTimeout(S.timer);
  S.timer = setTimeout(() => { saveNow(); }, delay);
}
async function saveNow() {
  clearTimeout(S.timer);
  if (!S.cur || !S.unsaved || !S.cur.open) return true;
  if (S.saving) { await S.saving; return S.unsaved ? saveNow() : true; }
  const ratee = S.ratee; const sent = { ...S.values };
  setStatus({ kind: 'saving' });
  let okDone = false;
  S.saving = (async () => {
    try {
      const res = await api.rateSave(ratee, sent);
      if (ratee !== S.ratee) return;
      if (sameVals(sent, S.values)) { S.unsaved = false; dropDraft(ratee); }
      setStatus({ kind: S.unsaved ? 'dirty' : 'saved', at: res.saved_at, complete: res.complete });
      const row = S.list && (S.list.reports || []).find((x) => x.code === ratee);
      if (row) { row.saved_at = res.saved_at; row.status = res.complete ? 'complete' : (Object.keys(sent).length ? 'in_progress' : 'not_started'); }
      okDone = true;
    } catch (e) {
      if (e.code === 'not_open') { if (S.cur) S.cur.open = false; setStatus({ kind: 'closed' }); draw(true); return; }
      setStatus({ kind: e.code === 'network' ? 'offline' : 'error', msg: errorMessage(e) });
      clearTimeout(S.retry);
      S.retry = setTimeout(() => { if (S.unsaved) saveNow(); }, RETRY_MS);
    }
  })();
  await S.saving;
  S.saving = null;
  if (okDone && S.unsaved) saveSoon();
  return okDone && !S.unsaved;
}
/** Save now, at most 4 s; true when nothing is left unsaved. */
async function flush() {
  if (!S.unsaved) return true;
  const r = await Promise.race([saveNow(), sleep(4000).then(() => false)]);
  return !!r && !S.unsaved;
}
let statusEls = [];
function setStatus(st) { S.status = st; statusEls.forEach((p) => p()); }
function statusLine() {
  const el = h('span', { class: 'pn-status small rt-status', role: 'status', 'aria-live': 'polite' });
  const paint = () => {
    const st = S.status;
    let text = t('rate.st_idle'); let ic = 'cloud'; let cls = '';
    if (st.kind === 'saved') { text = t('rate.st_saved', { time: fmtTime(st.at) }); ic = 'cloud'; cls = ' is-ok'; }
    if (st.kind === 'saving') { text = t('rate.st_saving'); ic = 'refresh'; }
    if (st.kind === 'dirty') { text = t('rate.st_dirty'); ic = 'edit'; cls = ' is-warn'; }
    if (st.kind === 'draft') { text = t('rate.st_draft'); ic = 'edit'; cls = ' is-warn'; }
    if (st.kind === 'offline') { text = t('rate.st_offline'); ic = 'wifi-off'; cls = ' is-warn'; }
    if (st.kind === 'error') { text = t('rate.st_error'); ic = 'alert'; cls = ' is-bad'; }
    if (st.kind === 'closed') { text = t('rate.st_closed'); ic = 'lock'; cls = ' is-warn'; }
    el.className = `pn-status small rt-status${cls}`;
    render(el, icon(ic, 'sm'), h('span', { text }));
  };
  paint();
  statusEls.push(paint);
  return el;
}

// ---------- views ----------
function draw(keep) {
  statusEls = [];
  const y = window.scrollY;
  const fk = keep && document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fk : null;
  if (!allowed) { render(app, forbiddenView()); return; }
  const v = { list: listView, guide: guideView, form: formView }[S.view] || listView;
  render(app, v());
  if (keep) {
    window.scrollTo(0, y);
    if (fk) { const el = Array.from(app.querySelectorAll('[data-fk]')).find((x) => x.dataset.fk === fk); if (el) el.focus({ preventScroll: true }); }
  }
}
function forbiddenView() {
  return h('div', { class: 'rt stack lg' }, h('section', { class: 'card qz-state' },
    h('div', { class: 'empty' }, h('div', { class: 'em-icon' }, icon('lock', 'lg')), h('h1', { class: 'qz-h1', text: t('rate.forbidden_title') }), h('p', { text: t('rate.forbidden_body') }),
      h('a', { class: 'btn btn-primary', href: 'index.html' }, t('rate.back_home')))));
}
const ST = { not_started: ['locked', 'circle', 'rate.status_not_started'], in_progress: ['warn', 'edit', 'rate.status_in_progress'], complete: ['pass', 'check', 'rate.status_complete'] };
function listView() {
  const L = S.list;
  const head = h('header', { class: 'page-head stack sm' },
    h('p', { class: 'eyebrow', text: L && L.wave ? t('rate.eyebrow', { wave: waveLabel(L.wave) }) : t('rate.eyebrow_plain') }),
    h('h1', { text: t('rate.title') }),
    h('p', { class: 'lead muted', text: t('rate.lead') }),
    h('p', { class: 'privacy-chip' }, icon('shield', 'sm'), h('span', { text: t('rate.privacy') })),
    guideBox({ id: 'rate', page: t('guide.rate.page'), now: t('guide.rate.now'), next: t('guide.rate.next') }));
  if (!L) return h('div', { class: 'rt stack lg' }, head, S.listErr && S.listErr.code === 'forbidden' ? h('div', { class: 'callout info' }, icon('lock'), h('p', { text: t('rate.forbidden_body') })) : errorState(S.listErr || {}, async () => { await ensureList(true); draw(); }));
  const reports = L.reports || [];
  const done = reports.filter((r) => r.status === 'complete').length;
  return h('div', { class: 'rt stack lg' }, head,
    S.curErr && S.curErr.code !== 'not_open' ? errorState(S.curErr) : null,
    L.open ? null : h('div', { class: 'callout warn', role: 'status' }, icon('lock'), h('div', { class: 'stack sm' }, h('b', { text: t('rate.closed_title') }), h('span', { text: t('rate.closed_body') }))),
    reports.length ? h('p', { class: 'small strong ink', text: t('rate.progress', { n: done, total: reports.length }) }) : null,
    reports.length ? h('ul', { class: 'rt-list' }, reports.map((r) => {
      const d = ST[r.status] || ST.not_started;
      const action = r.status === 'complete' ? t('rate.review') : r.status === 'in_progress' ? t('rate.continue') : t('rate.start');
      // While rating is closed the list is read only: the statements are not served (rate_get → not_open).
      if (!L.open) {
        return h('li', null, h('div', { class: 'card rt-row' },
          h('span', { class: 'avatar', 'aria-hidden': 'true', text: String(r.first_name || r.code || '?').trim().charAt(0).toUpperCase() }),
          h('span', { class: 'rt-row-main' },
            h('b', { class: 'ink rt-name', text: r.first_name || r.code }),
            h('span', { class: 'small muted', text: r.role_area ? t(`role.${r.role_area}`) : '' }),
            h('span', { class: 'row tight' }, chip(t(d[2]), d[0], d[1]), r.saved_at ? h('span', { class: 'xs muted', text: t('rate.saved_on', { time: fmtDateTime(r.saved_at) }) }) : null))));
      }
      return h('li', null, h('a', { class: 'card hover card-link rt-row', href: urlFor(r.status === 'not_started' && L.open ? 'guide' : 'form', r.code), 'data-fk': `row|${r.code}`,
        onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); nav(r.status === 'not_started' && L.open ? 'guide' : 'form', r.code); } },
        h('span', { class: 'avatar', 'aria-hidden': 'true', text: String(r.first_name || r.code || '?').trim().charAt(0).toUpperCase() }),
        h('span', { class: 'rt-row-main' },
          h('b', { class: 'ink rt-name', text: r.first_name || r.code }),
          h('span', { class: 'small muted', text: r.role_area ? t(`role.${r.role_area}`) : '' }),
          h('span', { class: 'row tight' }, chip(t(d[2]), d[0], d[1]), r.saved_at ? h('span', { class: 'xs muted', text: t('rate.saved_on', { time: fmtDateTime(r.saved_at) }) }) : null)),
        h('span', { class: 'rt-go' }, h('span', { text: action }), icon('chevron-right', 'sm'))));
    })) : h('div', { class: 'card' }, emptyState({ iconName: 'users', title: t('rate.empty_title'), body: t('rate.empty_body') })),
    h('p', { class: 'xs muted note-line' }, icon('info', 'sm'), ' ', t('rate.note')));
}
function backBtn() {
  return h('button', { class: 'btn btn-ghost', type: 'button', 'data-fk': 'back', onclick: () => nav('list') }, icon('chevron-left'), h('span', { text: t('rate.back_list') }));
}
function guideView() {
  const c = S.cur;
  const name = c.ratee.first_name || c.ratee.code;
  return h('div', { class: 'rt stack lg' },
    h('div', null, backBtn()),
    h('article', { class: 'card pad stack', 'aria-labelledby': 'rt-guide-h' },
      h('p', { class: 'eyebrow', text: t('rate.guide_eyebrow', { name }) }),
      h('h1', { id: 'rt-guide-h', class: 'qz-h1', text: t('rate.guide_title') }),
      h('div', { class: 'md rt-guide' }, mdBlocks(pick(c, 'guide'))),
      h('div', { class: 'row qz-actions' }, h('button', { class: 'btn btn-primary btn-lg', type: 'button', 'data-fk': 'start', onclick: () => nav('form', c.ratee.code) }, h('span', { text: t('rate.start_name', { name }) }), icon('arrow-right')))));
}
function scaleOf(c) {
  const sc = c.scale || {};
  const pts = Array.isArray(sc.points) && sc.points.length ? sc.points : [1, 2, 3, 4].map((v) => ({ v }));
  return { points: pts.map((p) => ({ v: Number(p.v), label: p[getLang()] || p.en || '' })), na: sc.na ? (sc.na[getLang()] || sc.na.en) : t('rate.na') };
}
function formView() {
  const c = S.cur;
  const name = c.ratee.first_name || c.ratee.code;
  const items = c.items || [];
  const scale = scaleOf(c);
  const ro = !c.open;
  const count = () => items.filter((i) => okVal(S.values[i.item_id])).length;
  const countEl = h('span', { class: 'small strong ink', text: t('rate.rated_n', { n: count(), total: items.length }) });
  const onChange = () => { countEl.textContent = t('rate.rated_n', { n: count(), total: items.length }); };
  const cards = items.map((it, k) => rateCard(it, k, items.length, scale, ro, onChange));
  return h('div', { class: 'rt stack lg' },
    h('div', null, backBtn()),
    h('header', { class: 'stack sm' },
      h('p', { class: 'eyebrow', text: t('rate.form_eyebrow') }),
      h('h1', { class: 'qz-h1', text: t('rate.form_title', { name }) }),
      h('p', { class: 'muted', text: t('rate.form_lead', { name }) })),
    ro ? h('div', { class: 'callout warn', role: 'status' }, icon('lock'), h('span', { text: t('rate.closed_body') })) : null,
    h('details', { class: 'card rt-guide-fold' }, h('summary', null, icon('book', 'sm'), h('span', { class: 'grow', text: t('rate.guide_title') }), icon('chevron-down', 'fold-chev')),
      h('div', { class: 'pad md rt-guide' }, mdBlocks(pick(c, 'guide')))),
    h('div', { class: 'rt-bar' }, countEl, h('span', { class: 'spacer' }), statusLine()),
    h('section', { class: 'card pad bl-scale', 'aria-labelledby': 'rt-scale-h' },
      h('h2', { id: 'rt-scale-h', class: 'bl-h3', text: t('rate.scale_title') }),
      h('ol', { class: 'bl-scale-list' }, scale.points.map((p) => h('li', null, h('span', { class: 'bl-lv', 'aria-hidden': 'true', text: String(p.v) }), h('span', { class: 'ink', text: p.label }))),
        h('li', null, h('span', { class: 'bl-lv rt-na-k', 'aria-hidden': 'true', text: '–' }), h('span', { class: 'ink', text: scale.na })))),
    h('div', { class: 'stack' }, cards),
    h('div', { class: 'rt-bar rt-bar-foot' }, statusLine(), h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-primary btn-lg', type: 'button', 'data-fk': 'done', onclick: () => finishForm(items) }, icon('check'), h('span', { text: t('rate.done') }))));
}
function rateCard(it, k, tot, scale, ro, onChange) {
  const sid = `rt-st-${it.item_id}`;
  const btns = scale.points.map((p) => {
    const b = h('button', { type: 'button', 'aria-pressed': 'false', disabled: ro, 'data-fk': `v|${it.item_id}|${p.v}` }, h('b', { text: String(p.v) }), h('span', { class: 'bl2-r-lbl', text: p.label }));
    b.addEventListener('click', () => choose(p.v));
    return b;
  });
  const na = h('button', { type: 'button', class: 'bl2-nr', 'aria-pressed': 'false', disabled: ro, 'data-fk': `v|${it.item_id}|NA` }, h('span', { text: scale.na }));
  na.addEventListener('click', () => choose('NA'));
  const all = btns.concat([na]);
  const row = h('div', { class: 'scale-row bl2-r-row', role: 'group', 'aria-labelledby': sid }, btns);
  [row, na].forEach((el) => el.addEventListener('keydown', (e) => {
    const i = all.indexOf(document.activeElement);
    if (i < 0) return;
    let nx = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nx = Math.min(all.length - 1, i + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') nx = Math.max(0, i - 1);
    else if (/^[1-4]$/.test(e.key) && !ro) { e.preventDefault(); choose(Number(e.key)); btns[Number(e.key) - 1].focus(); return; }
    if (nx >= 0) { e.preventDefault(); all[nx].focus(); }
  }));
  const status = h('span', { class: 'bl-rate-status small' });
  const card = h('section', { class: 'card bl-rate bl2-rate', id: `rt-${it.item_id}`, 'aria-labelledby': sid },
    h('div', { class: 'bl-rate-head' }, h('span', { class: 'bl2-st-n', 'aria-hidden': 'true', text: String(k + 1) }), h('span', { class: 'grow' }), status),
    h('p', { class: 'bl-stmt', id: sid }, h('span', { class: 'sr-only', text: t('rate.stmt_n', { n: k + 1, total: tot }) }), pick(it, 'text')),
    row,
    h('div', { class: 'bl2-anchors' },
      h('p', { class: 'bl2-anchor is-1' }, h('b', { text: '1' }), h('span', { text: pick(it, 'anchor1') })),
      h('p', { class: 'bl2-anchor is-4' }, h('b', { text: '4' }), h('span', { text: pick(it, 'anchor4') }))),
    na);
  function paint() {
    const v = S.values[it.item_id];
    const has = okVal(v);
    btns.forEach((b, j) => { const on = v === scale.points[j].v; b.setAttribute('aria-pressed', String(on)); b.tabIndex = (has ? on : j === 0) ? 0 : -1; });
    na.setAttribute('aria-pressed', String(v === 'NA')); na.tabIndex = v === 'NA' ? 0 : -1;
    render(status, has ? h('span', { class: 'bl-ok' }, icon('check', 'sm'), t('rate.rated_one')) : h('span', { class: 'muted', text: t('rate.not_rated') }));
    card.classList.toggle('is-rated', has);
  }
  function choose(v) {
    if (ro || !S.cur || !S.cur.open) return;
    if (S.values[it.item_id] === v) return;
    S.values[it.item_id] = v;
    S.unsaved = true;
    writeDraft(S.ratee, S.values);
    setStatus({ kind: 'dirty' });
    paint(); onChange();
    saveSoon();
  }
  paint();
  return card;
}
async function finishForm(items) {
  const missing = items.filter((i) => !okVal(S.values[i.item_id]));
  const saved = await flush();
  if (!saved && S.unsaved) { toast(t('rate.st_offline'), 'bad'); return; }
  if (missing.length && S.cur && S.cur.open) {
    const ok = await confirmDialog({ title: t('rate.incomplete_title'), body: t('rate.incomplete_body', { count: missing.length }), confirm: t('rate.incomplete_yes'), cancel: t('rate.incomplete_no') });
    if (!ok) { const c = document.getElementById(`rt-${missing[0].item_id}`); if (c) { c.scrollIntoView({ block: 'center' }); const b = c.querySelector('button'); if (b) b.focus({ preventScroll: true }); } return; }
  } else if (S.cur && S.cur.open) toast(t('rate.done_toast', { name: S.cur.ratee.first_name || S.cur.ratee.code }), 'ok');
  nav('list');
}

// ---------- start ----------
if (!allowed) draw();
else route(false);
