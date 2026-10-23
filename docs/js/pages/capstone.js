// capstone.html — team submission for Pitch Day and the capstone (specs/15, specs/20 capstone_get/submit).
// One form, two stages (tabs). SOI parts ≤ 60 words with live counters; KPI before/after; evidence link
// (internal SharePoint, https); value in VND (digits) with a live preview and its basis; lessons.
// Unsaved text is kept on this device until it is saved. Past the deadline the form is read-only.
import { mountShell, h, icon, chip, render, loading, emptyState, errorState, errorMessage, toast } from '../ui.js';
import { t, getLang, onLangChange } from '../i18n.js';
import { api } from '../api.js';
import { loadCatalog, fmtLongDate, fmtShortDate, fmtDateTime, todayVN } from '../courses.js';
import { rubricCard, announce, fmtVND, countWords } from '../quiz.js';

const { app } = await mountShell({ page: 'capstone' });

const STAGES = ['pitch', 'capstone'];
const FIELDS = ['project_title', 'soi_situation', 'soi_observation', 'soi_implication', 'kpi_name', 'kpi_before', 'kpi_after', 'kpi_unit', 'evidence_url', 'value_vnd', 'value_basis', 'lessons'];
const SOI = ['soi_situation', 'soi_observation', 'soi_implication'];
const MAX_WORDS = 60;
const DRAFT = (team, stage) => `hub.capdraft.${team}.${stage}`;

let data = null; let program = {};
let stage = 'pitch';
const vals = {}; const base = {}; const notes = {}; const errors = {}; let serverErr = null;

function readLocal(key) { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }
function writeLocal(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }
function dropLocal(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }

const pastDeadline = (s) => { const d = data && data.deadlines ? data.deadlines[s] : null; return !!d && todayVN() > d; };
const pick12 = (sub) => Object.fromEntries(FIELDS.map((k) => [k, sub && sub[k] != null ? String(sub[k]) : '']));
const same = (a, b) => FIELDS.every((k) => (a[k] || '') === (b[k] || ''));
const isDirty = (s) => !!vals[s] && !!base[s] && !same(vals[s], base[s]);
const memberName = (code) => {
  const m = data && data.team ? [...(data.team.members || []), data.team.sponsor || {}].find((x) => x && x.code === code) : null;
  return (m && m.first_name) || code || '';
};

function initStage(s) {
  const team = data.team;
  const sub = data.submissions ? data.submissions[s] : null;
  notes[s] = null;
  let start;
  if (sub) start = pick12(sub);
  else if (s === 'capstone' && data.submissions && data.submissions.pitch) { start = pick12(data.submissions.pitch); notes[s] = 'from_pitch'; }
  else start = { ...pick12(null), project_title: team.project_title || '' };
  base[s] = { ...start };
  vals[s] = { ...start };
  const d = readLocal(DRAFT(team.team_id, s));
  if (d && d.vals && !pastDeadline(s)) {
    const draftVals = { ...pick12(null), ...pick12(d.vals) };
    if (!same(draftVals, start)) { vals[s] = draftVals; notes[s] = 'restored'; notes[`${s}_at`] = d.at; }
    else dropLocal(DRAFT(team.team_id, s));
  }
}

let draftTimer = null;
function onInput(key, value) {
  vals[stage][key] = value;
  if (errors[stage] && errors[stage][key]) { delete errors[stage][key]; paintFieldError(key); }
  clearTimeout(draftTimer);
  const s = stage;
  draftTimer = setTimeout(() => {
    if (isDirty(s)) writeLocal(DRAFT(data.team.team_id, s), { vals: vals[s], at: Date.now() });
    else dropLocal(DRAFT(data.team.team_id, s));
  }, 400);
  paintDirty();
}
window.addEventListener('beforeunload', (e) => {
  if (data && data.team && STAGES.some((s) => isDirty(s) && !pastDeadline(s))) { e.preventDefault(); e.returnValue = ''; }
});

// ---------- validation ----------
function validate(v) {
  const errs = {};
  if (!v.project_title.trim()) errs.project_title = t('capstone.err_title');
  SOI.forEach((k) => { const n = countWords(v[k]); if (n > MAX_WORDS) errs[k] = t('capstone.err_words', { n, max: MAX_WORDS }); });
  const url = v.evidence_url.trim();
  if (url) {
    if (!/^https:\/\//i.test(url)) errs.evidence_url = t('capstone.err_https');
    else { try { new URL(url); } catch (e) { errs.evidence_url = t('capstone.err_url'); } }
  }
  if (v.value_vnd && !/^\d+$/.test(v.value_vnd)) errs.value_vnd = t('capstone.err_digits');
  return errs;
}
const fieldLabel = (k) => t(`capstone.f.${k}`);

// ---------- rendering ----------
const refs = {};
function paintFieldError(key) {
  const r = refs[key]; if (!r) return;
  const msg = errors[stage] && errors[stage][key];
  r.err.hidden = !msg;
  render(r.err, msg ? [icon('alert', 'sm'), h('span', { text: msg })] : []);
  if (msg) r.input.setAttribute('aria-invalid', 'true'); else r.input.removeAttribute('aria-invalid');
}
function paintDirty() {
  const el = refs.dirty; if (!el) return;
  el.hidden = !isDirty(stage);
}

function field(key, { textarea = false, rows = 3, hint, inputmode, autocomplete = 'off', type = 'text', words = false, wide = false, placeholder } = {}) {
  const ro = pastDeadline(stage);
  const id = `cap-${stage}-${key}`;
  const ids = { hint: `${id}-hint`, cnt: `${id}-cnt`, err: `${id}-err`, extra: `${id}-extra` };
  const describedby = [hint ? ids.hint : null, words ? ids.cnt : null, key === 'value_vnd' || key === 'evidence_url' ? ids.extra : null, ids.err].filter(Boolean).join(' ');
  const attrs = { id, name: key, 'aria-describedby': describedby, readonly: ro, autocomplete, placeholder: placeholder || null };
  const input = textarea ? h('textarea', { class: 'textarea', rows, ...attrs }) : h('input', { class: 'input', type, inputmode: inputmode || null, ...attrs });
  input.value = vals[stage][key] || '';
  const err = h('p', { class: 'err', id: ids.err, hidden: true });
  const cnt = words ? h('span', { class: 'counter', id: ids.cnt }) : null;
  let extra = null;
  const paintCount = (announceOver) => {
    if (!cnt) return;
    const n = countWords(input.value);
    const over = n > MAX_WORDS;
    const was = cnt.classList.contains('over');
    cnt.classList.toggle('over', over);
    cnt.textContent = over ? t('capstone.words_over', { n, max: MAX_WORDS, over: n - MAX_WORDS }) : t('capstone.words', { n, max: MAX_WORDS });
    if (announceOver && over && !was) announce(t('capstone.over_announce', { field: fieldLabel(key), max: MAX_WORDS }));
  };
  if (key === 'value_vnd') {
    extra = h('p', { class: 'cap-vnd small', id: ids.extra });
    const paintV = () => { const v = fmtVND(input.value); extra.textContent = v.full ? `${v.full}${v.approx ? ` · ${v.approx}` : ''}` : t('capstone.vnd_empty'); };
    input.addEventListener('input', () => {
      const clean = input.value.replace(/\D/g, '');
      if (clean !== input.value) {
        const pos = input.selectionStart - (input.value.slice(0, input.selectionStart).length - input.value.slice(0, input.selectionStart).replace(/\D/g, '').length);
        input.value = clean;
        try { input.setSelectionRange(pos, pos); } catch (e) { /* ignore */ }
      }
      paintV();
    });
    paintV();
  }
  if (key === 'evidence_url') {
    extra = h('p', { class: 'cap-warn small', id: ids.extra, hidden: true });
    const paintW = () => {
      const v = input.value.trim(); let warn = '';
      if (v && /^https:\/\//i.test(v)) { try { const host = new URL(v).hostname.toLowerCase(); if (!/(^|\.)sharepoint\.com$/.test(host)) warn = t('capstone.warn_sharepoint'); } catch (e) { /* invalid → caught on save */ } }
      extra.hidden = !warn; render(extra, warn ? [icon('alert', 'sm'), h('span', { text: warn })] : []);
    };
    input.addEventListener('input', paintW);
    paintW();
  }
  input.addEventListener('input', () => { onInput(key, input.value); paintCount(true); });
  paintCount(false);
  refs[key] = { input, err };
  const wrap = h('div', { class: `field${wide ? ' cap-wide' : ''}`, 'data-anchor': key },
    h('div', { class: 'cap-label-row' }, h('label', { for: id, text: fieldLabel(key) }), cnt),
    hint ? h('p', { class: 'hint', id: ids.hint, text: hint }) : null,
    input, extra, err);
  setTimeout(() => paintFieldError(key), 0);
  return wrap;
}

function header() {
  const team = data.team;
  const members = (team.members || []).map((m) => m.first_name || m.code);
  return h('section', { class: 'hero cap-hero', 'aria-labelledby': 'cap-title' },
    h('div', { class: 'pad stack sm' },
      h('p', { class: 'eyebrow', text: t('capstone.eyebrow') }),
      h('h1', { id: 'cap-title', text: team.project_title || t('capstone.untitled') }),
      h('div', { class: 'row tight cap-people' },
        h('span', { class: 'sr-only', text: t('capstone.members_label') }),
        members.map((n) => h('span', { class: 'chip cap-person' }, h('span', { class: 'cap-initial', 'aria-hidden': 'true', text: String(n).charAt(0).toUpperCase() }), n))),
      team.sponsor ? h('p', { class: 'sub small', text: t('capstone.sponsor', { name: team.sponsor.first_name || team.sponsor.code }) }) : null));
}

function tabs() {
  const list = h('div', { class: 'tabs cap-tabs', role: 'tablist', 'aria-label': t('capstone.tabs_aria') },
    STAGES.map((s) => h('button', { role: 'tab', type: 'button', id: `cap-tab-${s}`, 'aria-selected': String(s === stage), 'aria-controls': `cap-panel-${s}`, tabindex: s === stage ? '0' : '-1', onclick: () => switchTab(s) },
      h('span', { class: 'cap-tab-name', text: t(`capstone.stage_${s}`) }),
      h('span', { class: 'cap-tab-due', text: data.deadlines && data.deadlines[s] ? t('capstone.due_short', { date: fmtShortDate(data.deadlines[s]) }) : '' }))));
  list.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const i = STAGES.indexOf(stage);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? STAGES.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + STAGES.length) % STAGES.length;
    switchTab(STAGES[next], true);
  });
  return list;
}
function switchTab(s, focus) {
  if (s === stage) return;
  stage = s;
  try { history.replaceState(null, '', `#${s}`); } catch (e) { /* ignore */ }
  renderPage();
  if (focus) { const b = document.getElementById(`cap-tab-${s}`); if (b) b.focus(); }
}

function stageInfo() {
  const sub = data.submissions ? data.submissions[stage] : null;
  const closed = pastDeadline(stage);
  const status = sub ? chip(t('capstone.status_saved', { date: fmtShortDate(sub.submitted_at) }), 'pass', 'check')
    : closed ? chip(t('capstone.status_closed'), 'bad', 'lock') : chip(t('capstone.status_none'), 'warn', 'clock');
  const day = stage === 'pitch' ? program.pitch_day : program.capstone_day;
  const facts = [
    ['calendar', t('capstone.when'), day ? t(`capstone.when_${stage}`, { date: fmtLongDate(day) }) : t(`capstone.when_${stage}_nodate`)],
    ['clock', t('capstone.deadline'), data.deadlines && data.deadlines[stage] ? t('capstone.deadline_value', { date: fmtLongDate(data.deadlines[stage]) }) : '–'],
    ['file', t('capstone.bring'), t(`capstone.bring_${stage}`)],
    ['users', t('capstone.panel'), t('capstone.panel_who')],
    ['star', t('capstone.weighting'), t(`rubric.weight_${stage}`)],
  ];
  return h('section', { class: 'card pad stack', 'aria-labelledby': 'cap-stage-h' },
    h('div', { class: 'row between' }, h('h2', { id: 'cap-stage-h', text: t(`capstone.stage_${stage}`) }), status),
    h('dl', { class: 'cap-facts' }, facts.map(([ic, k, v]) => h('div', { class: 'cap-fact' },
      h('dt', null, icon(ic, 'sm'), h('span', { text: k })), h('dd', { text: v })))));
}

function formCard() {
  const ro = pastDeadline(stage);
  const sub = data.submissions ? data.submissions[stage] : null;
  const errs = errors[stage] || {};
  const errKeys = FIELDS.filter((k) => errs[k]);
  const saveBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'submit', 'data-fk': 'save' }, icon('cloud'), h('span', { text: t('capstone.save') }));
  refs.dirty = h('span', { class: 'chip warn cap-dirty', hidden: true }, icon('edit'), t('capstone.unsaved'));
  const lastSaved = sub ? t('capstone.last_saved', { name: memberName(sub.submitted_by), time: fmtDateTime(sub.submitted_at) }) : t('capstone.never_saved');
  const notesEl = [];
  if (ro) notesEl.push(h('div', { class: 'callout warn' }, icon('lock'), h('span', { text: sub ? t('capstone.readonly', { date: fmtLongDate(data.deadlines[stage]) }) : t('capstone.readonly_none', { date: fmtLongDate(data.deadlines[stage]) }) })));
  if (!ro && notes[stage] === 'from_pitch') notesEl.push(h('div', { class: 'callout info' }, icon('info'), h('span', { text: t('capstone.from_pitch') })));
  if (!ro && notes[stage] === 'restored') {
    notesEl.push(h('div', { class: 'callout info' }, icon('refresh'), h('div', { class: 'stack sm' },
      h('span', { text: t('capstone.restored', { time: notes[`${stage}_at`] ? fmtDateTime(new Date(notes[`${stage}_at`]).toISOString()) : '' }) }),
      h('div', null, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => discardDraft() }, icon('x'), t('capstone.discard'))))));
  }
  const summary = errKeys.length ? h('div', { class: 'callout bad cap-summary', role: 'alert', tabindex: '-1' }, icon('alert'),
    h('div', { class: 'stack sm' }, h('b', { text: t('capstone.fix_n', { count: errKeys.length }) }),
      h('ul', { class: 'cap-errlist' }, errKeys.map((k) => h('li', null, h('a', { href: `#cap-${stage}-${k}`, onclick: (e) => { e.preventDefault(); const el = document.getElementById(`cap-${stage}-${k}`); if (el) { el.focus(); } } }, `${fieldLabel(k)}: ${errs[k]}`)))))) : null;
  const form = h('form', { class: 'card cap-form', novalidate: true, 'aria-labelledby': 'cap-form-h' },
    h('div', { class: 'pad stack lg' },
      h('div', { class: 'stack sm' }, h('h2', { id: 'cap-form-h', text: t('capstone.form_title') }), h('p', { class: 'muted small', text: t('capstone.form_intro') })),
      notesEl, summary,
      serverErr ? h('div', { class: 'callout bad', role: 'alert' }, icon('alert'), h('span', { text: serverErr })) : null,
      h('fieldset', { class: 'cap-set stack' }, h('legend', { class: 'cap-legend', text: t('capstone.set_project') }),
        field('project_title', { hint: t('capstone.h.project_title'), wide: true })),
      h('fieldset', { class: 'cap-set stack' }, h('legend', { class: 'cap-legend', text: t('capstone.set_soi') }),
        h('p', { class: 'small muted', text: t('capstone.soi_intro') }),
        field('soi_situation', { textarea: true, words: true, hint: t('capstone.h.soi_situation') }),
        field('soi_observation', { textarea: true, words: true, hint: t('capstone.h.soi_observation') }),
        field('soi_implication', { textarea: true, words: true, hint: t('capstone.h.soi_implication') })),
      h('fieldset', { class: 'cap-set stack' }, h('legend', { class: 'cap-legend', text: t('capstone.set_kpi') }),
        h('p', { class: 'small muted', text: t('capstone.kpi_intro') }),
        h('div', { class: 'cap-kpi' },
          field('kpi_name', { wide: true, placeholder: t('capstone.ph.kpi_name') }),
          field('kpi_before', { inputmode: 'decimal', placeholder: t('capstone.ph.kpi_before') }),
          field('kpi_after', { inputmode: 'decimal', placeholder: t('capstone.ph.kpi_after') }),
          field('kpi_unit', { placeholder: t('capstone.ph.kpi_unit') }))),
      h('fieldset', { class: 'cap-set stack' }, h('legend', { class: 'cap-legend', text: t('capstone.set_value') }),
        field('evidence_url', { type: 'url', inputmode: 'url', hint: t('capstone.h.evidence_url'), placeholder: 'https://…sharepoint.com/…' }),
        field('value_vnd', { inputmode: 'numeric', hint: t('capstone.h.value_vnd') }),
        field('value_basis', { textarea: true, rows: 3, hint: t(stage === 'capstone' ? 'capstone.h.value_basis_cap' : 'capstone.h.value_basis') })),
      h('fieldset', { class: 'cap-set stack' }, h('legend', { class: 'cap-legend', text: t('capstone.set_lessons') }),
        field('lessons', { textarea: true, rows: 4, hint: t('capstone.h.lessons') }))),
    h('div', { class: 'card-foot cap-foot' },
      ro ? null : saveBtn,
      h('div', { class: 'stack sm cap-saved' },
        h('span', { class: 'small', role: 'status', 'aria-live': 'polite', id: 'cap-saved-line' }, icon(sub ? 'cloud' : 'info', 'sm'), h('span', { text: lastSaved })),
        refs.dirty)));
  form.addEventListener('submit', (e) => { e.preventDefault(); if (!ro) save(saveBtn); });
  if (ro) form.querySelectorAll('input, textarea').forEach((el) => { el.readOnly = true; });
  return form;
}

function renderPage() {
  render(app, h('div', { class: 'cap stack lg' },
    header(),
    tabs(),
    h('div', { id: `cap-panel-${stage}`, role: 'tabpanel', 'aria-labelledby': `cap-tab-${stage}`, class: 'layout-side cap-layout' },
      h('div', { class: 'stack lg' }, stageInfo(), formCard()),
      h('div', { class: 'side cap-side' }, rubricCard(stage)))));
  paintDirty();
}
function keepPlace(fn) {
  const fk = document.activeElement && document.activeElement.id;
  const limit = (document.querySelector('.app-header') || { offsetHeight: 64 }).offsetHeight;
  const a = Array.from(app.querySelectorAll('[data-anchor]')).find((el) => el.getBoundingClientRect().bottom > limit + 8);
  const key = a ? a.dataset.anchor : null; const top = a ? a.getBoundingClientRect().top : 0;
  fn();
  if (key) { const el = app.querySelector(`[data-anchor="${CSS.escape(key)}"]`); if (el) window.scrollBy(0, el.getBoundingClientRect().top - top); }
  if (fk) { const el = document.getElementById(fk); if (el) el.focus({ preventScroll: true }); }
}
onLangChange(() => { if (data && data.team) keepPlace(renderPage); else if (data) renderEmpty(); });

function discardDraft() {
  dropLocal(DRAFT(data.team.team_id, stage));
  vals[stage] = { ...base[stage] };
  notes[stage] = null;
  errors[stage] = {};
  renderPage();
}

async function save(btn) {
  serverErr = null;
  const v = vals[stage];
  const errs = validate(v);
  errors[stage] = errs;
  if (Object.keys(errs).length) {
    keepPlace(renderPage);
    const s = app.querySelector('.cap-summary');
    if (s) { s.scrollIntoView({ block: 'center' }); s.focus({ preventScroll: true }); }
    return;
  }
  btn.disabled = true;
  const label = btn.querySelector('span'); label.textContent = t('capstone.saving');
  const fields = Object.fromEntries(FIELDS.map((k) => [k, k === 'value_vnd' ? v[k].replace(/\D/g, '') : String(v[k] || '').trim()]));
  try {
    const res = await api.capstoneSubmit(stage, data.team.team_id, fields);
    data.submissions[stage] = res.submission;
    base[stage] = pick12(res.submission);
    vals[stage] = { ...base[stage] };
    notes[stage] = null;
    dropLocal(DRAFT(data.team.team_id, stage));
    toast(t('capstone.saved_toast'), 'ok');
    keepPlace(renderPage);
    const line = document.getElementById('cap-saved-line');
    if (line) announce(line.textContent);
  } catch (e) {
    btn.disabled = false; label.textContent = t('capstone.save');
    if (e.code === 'gate_closed') {
      data.deadlines[stage] = data.deadlines[stage] || todayVN();
      serverErr = t('capstone.err_closed');
    } else if (e.code === 'forbidden') serverErr = t('capstone.err_forbidden');
    else if (e.code === 'network') serverErr = t('capstone.err_offline');
    else serverErr = errorMessage(e);
    keepPlace(renderPage);
  }
}

function renderEmpty() {
  render(app, h('div', { class: 'cap stack lg' },
    h('section', { class: 'card' }, emptyState({ iconName: 'users', title: t('capstone.no_team_title'), body: t('capstone.no_team_body'),
      action: h('a', { class: 'btn btn-secondary', href: 'index.html' }, t('capstone.back_home')) })),
    rubricCard('pitch')));
}

async function boot() {
  render(app, loading());
  try {
    const [res, cat] = await Promise.all([api.capstoneGet(), loadCatalog().catch(() => ({}))]);
    data = res;
    program = (cat && cat.program) || {};
  } catch (e) {
    render(app, h('div', { class: 'cap stack lg' }, h('section', { class: 'card pad stack' }, h('h1', { text: t('capstone.title') }), errorState(e, boot))));
    return;
  }
  data.submissions = data.submissions || { pitch: null, capstone: null };
  data.deadlines = data.deadlines || {};
  if (!data.team) { renderEmpty(); return; }
  const fromHash = (location.hash || '').replace('#', '');
  stage = STAGES.includes(fromHash) ? fromHash : (pastDeadline('pitch') ? 'capstone' : 'pitch');
  STAGES.forEach(initStage);
  renderPage();
}

boot();
