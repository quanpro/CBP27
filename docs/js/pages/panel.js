// panel.html — judges score each team (specs/15, specs/20 panel_list/panel_score). Panel/admin only.
// Stage tabs; one card per team: submission summary, then the rubric (5 criteria × 1–5 with the 1/3/5
// anchors), a comment ("one thing to keep, one thing to change"), the stage weighting and Save.
// Scores are saved per judge and stay editable.
import { mountShell, h, icon, chip, render, loading, emptyState, errorState, errorMessage, toast } from '../ui.js';
import { t, onLangChange } from '../i18n.js';
import { api } from '../api.js';
import { fmtDateTime, fmtShortDate } from '../courses.js';
import { CRITERIA, isDouble, rubricAnchors, announce, fmtVND, fmtTime } from '../quiz.js';

const { app, session } = await mountShell({ page: 'panel' });

const STAGES = ['pitch', 'capstone'];
let stage = STAGES.includes((location.hash || '').slice(1)) ? location.hash.slice(1) : 'pitch';
const lists = {}; // stage → teams
const picks = {}; // `${stage}|${team}` → {c1..c5, comment}
const status = {}; // `${stage}|${team}` → {kind: saved|dirty|error|saving, at, msg}
let loadErr = null;

const roles = (session && session.profile && session.profile.roles) || [];
const allowed = roles.includes('panel') || roles.includes('admin');
const key = (teamId) => `${stage}|${teamId}`;

function forbidden() {
  render(app, h('div', { class: 'pn stack lg' }, h('section', { class: 'card' },
    emptyState({ iconName: 'lock', title: t('panel.forbidden_title'), body: t('panel.forbidden_body'), action: h('a', { class: 'btn btn-primary', href: 'index.html' }, t('panel.back_home')) }))));
}

function tabs() {
  const list = h('div', { class: 'tabs', role: 'tablist', 'aria-label': t('panel.tabs_aria') },
    STAGES.map((s) => h('button', { role: 'tab', type: 'button', id: `pn-tab-${s}`, 'aria-selected': String(s === stage), 'aria-controls': 'pn-panel', tabindex: s === stage ? '0' : '-1', onclick: () => switchTab(s) }, t(`capstone.stage_${s}`))));
  list.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const i = STAGES.indexOf(stage);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? STAGES.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + STAGES.length) % STAGES.length;
    switchTab(STAGES[next], true);
  });
  return list;
}
async function switchTab(s, focus) {
  if (s === stage) return;
  stage = s;
  try { history.replaceState(null, '', `#${s}`); } catch (e) { /* ignore */ }
  if (!lists[s]) await load(); else renderPage();
  if (focus) { const b = document.getElementById(`pn-tab-${s}`); if (b) b.focus(); }
}

function submissionSummary(sub) {
  const v = fmtVND(sub.value_vnd);
  const url = String(sub.evidence_url || '').trim();
  const safeUrl = /^https:\/\//i.test(url) ? url : '';
  const soi = [['soi_situation', 'S'], ['soi_observation', 'O'], ['soi_implication', 'I']];
  return h('div', { class: 'pn-sum stack' },
    h('dl', { class: 'pn-soi' }, soi.map(([k, letter]) => h('div', { class: 'pn-soi-row' },
      h('dt', null, h('span', { class: 'pn-soi-k', 'aria-hidden': 'true', text: letter }), h('span', { text: t(`capstone.f.${k}`) })),
      h('dd', { text: sub[k] || '–' })))),
    h('div', { class: 'pn-facts' },
      h('div', { class: 'pn-fact' }, h('span', { class: 'pn-k', text: t('panel.kpi') }),
        h('span', { class: 'pn-v' }, h('b', { text: sub.kpi_name || '–' }), sub.kpi_before || sub.kpi_after ? h('span', { class: 'pn-kpi' }, ` ${sub.kpi_before || '–'} `, icon('arrow-right', 'sm'), ` ${sub.kpi_after || '–'} ${sub.kpi_unit || ''}`) : null)),
      h('div', { class: 'pn-fact' }, h('span', { class: 'pn-k', text: t('panel.value') }),
        h('span', { class: 'pn-v' }, h('b', { text: v.full || '–' }), v.approx ? h('span', { class: 'muted', text: ` · ${v.approx}` }) : null)),
      sub.value_basis ? h('div', { class: 'pn-fact' }, h('span', { class: 'pn-k', text: t('panel.basis') }), h('span', { class: 'pn-v', text: sub.value_basis })) : null,
      h('div', { class: 'pn-fact' }, h('span', { class: 'pn-k', text: t('panel.evidence') }),
        safeUrl ? h('a', { class: 'pn-v', href: safeUrl, target: '_blank', rel: 'noopener noreferrer' }, h('span', { text: t('panel.open_evidence') }), icon('external', 'sm'), h('span', { class: 'sr-only', text: t('panel.new_tab') })) : h('span', { class: 'pn-v muted', text: t('panel.no_evidence') }))),
    sub.lessons ? h('details', { class: 'pn-more' }, h('summary', { text: t('capstone.f.lessons') }), h('p', { text: sub.lessons })) : null,
    h('p', { class: 'xs muted', text: t('panel.submitted_at', { time: fmtDateTime(sub.submitted_at) }) }));
}

function scorePick(tm, c, onPick) {
  const k = key(tm.team_id);
  const labelId = `pn-${stage}-${tm.team_id}-${c}`;
  const cur = picks[k][c];
  const buttons = [1, 2, 3, 4, 5].map((n) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(cur === n), 'aria-label': t('panel.score_aria', { n, name: t(`rubric.${c}.name`) }), 'data-fk': `${labelId}-${n}`, tabindex: (cur ? cur === n : n === 1) ? '0' : '-1' }, String(n));
    b.addEventListener('click', () => { onPick(c, n); paint(); });
    return b;
  });
  function paint() {
    const v = picks[k][c];
    buttons.forEach((b, i) => { b.setAttribute('aria-pressed', String(v === i + 1)); b.tabIndex = (v ? v === i + 1 : i === 0) ? 0 : -1; });
  }
  const group = h('div', { class: 'score-pick', role: 'group', 'aria-labelledby': labelId }, buttons);
  group.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = Math.min(4, i + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = Math.max(0, i - 1);
    else if (e.key === 'Home') next = 0; else if (e.key === 'End') next = 4;
    else if (/^[1-5]$/.test(e.key)) { e.preventDefault(); onPick(c, Number(e.key)); paint(); buttons[Number(e.key) - 1].focus(); return; }
    if (next >= 0) { e.preventDefault(); buttons[next].focus(); }
  });
  return { group, labelId };
}

function statusEl(k) {
  const s = status[k] || {};
  const el = h('span', { class: `pn-status small${s.kind === 'saved' ? ' is-ok' : ''}${s.kind === 'error' ? ' is-bad' : ''}`, role: 'status', 'aria-live': 'polite' });
  const paint = () => {
    const st = status[k] || {};
    el.className = `pn-status small${st.kind === 'saved' ? ' is-ok' : ''}${st.kind === 'error' ? ' is-bad' : ''}${st.kind === 'dirty' ? ' is-warn' : ''}`;
    let text = t('panel.not_saved'); let ic = 'circle';
    if (st.kind === 'saved') { text = t('panel.saved', { time: fmtTime(st.at) }); ic = 'cloud'; }
    if (st.kind === 'dirty') { text = st.at ? t('panel.unsaved_since', { time: fmtTime(st.at) }) : t('panel.unsaved'); ic = 'edit'; }
    if (st.kind === 'saving') { text = t('panel.saving'); ic = 'refresh'; }
    if (st.kind === 'error') { text = st.msg; ic = 'alert'; }
    render(el, icon(ic, 'sm'), h('span', { text }));
  };
  paint();
  return { el, paint };
}

function teamCard(tm) {
  const k = key(tm.team_id);
  if (!picks[k]) {
    const s = tm.my_score || {};
    picks[k] = { c1: s.c1 || null, c2: s.c2 || null, c3: s.c3 || null, c4: s.c4 || null, c5: s.c5 || null, comment: s.comment || '' };
    if (tm.my_score) status[k] = { kind: 'saved', at: tm.my_score.scored_at };
  }
  const p = picks[k];
  const st = statusEl(k);
  const err = h('p', { class: 'err', role: 'alert', hidden: true });
  const markDirty = () => {
    const prev = status[k];
    status[k] = { kind: 'dirty', at: prev && (prev.kind === 'saved' || prev.kind === 'dirty') ? prev.at : null };
    st.paint();
    err.hidden = true;
  };
  const onPick = (c, n) => { if (p[c] === n) return; p[c] = n; markDirty(); paintScored(); };
  const rows = CRITERIA.map((c, i) => {
    const sp = scorePick(tm, c, onPick);
    return h('div', { class: 'rubric-row pn-crit', 'data-crit': c },
      h('div', { class: 'row tight' },
        h('span', { class: 'qz-crit-n', 'aria-hidden': 'true', text: String(i + 1) }),
        h('h4', { class: 'qz-crit-name', id: sp.labelId, text: t(`rubric.${c}.name`) }),
        isDouble(stage, c) ? chip(t('rubric.double'), 'info', 'star') : null),
      h('p', { class: 'small muted', text: t(`rubric.${c}.what`) }),
      sp.group,
      rubricAnchors(c));
  });
  const cid = `pn-c-${stage}-${tm.team_id}`;
  const comment = h('textarea', { class: 'textarea', id: cid, rows: 3, 'aria-describedby': `${cid}-hint` });
  comment.value = p.comment || '';
  comment.addEventListener('input', () => { p.comment = comment.value; markDirty(); });
  const scored = h('span', { class: 'chip' });
  function paintScored() {
    const n = CRITERIA.filter((c) => p[c]).length;
    scored.className = `chip ${n === 5 ? 'pass' : ''}`.trim();
    render(scored, icon(n === 5 ? 'check' : 'edit'), t('panel.scored_n', { n, total: 5 }));
  }
  paintScored();
  const saveBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, icon('cloud'), h('span', { text: t('panel.save') }));
  const form = h('form', { class: 'pn-form stack', novalidate: true, 'aria-labelledby': `pn-yours-${tm.team_id}` },
    h('div', { class: 'row between' }, h('h3', { id: `pn-yours-${tm.team_id}`, text: t('panel.your_scores') }), scored),
    h('p', { class: 'small muted', text: t(`rubric.weight_${stage}`) }),
    h('div', null, rows),
    h('div', { class: 'field' }, h('label', { for: cid, text: t('panel.comment') }), h('p', { class: 'hint', id: `${cid}-hint`, text: t('panel.comment_hint') }), comment),
    err,
    h('div', { class: 'row pn-foot' }, saveBtn, st.el));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const missing = CRITERIA.filter((c) => !p[c]);
    if (missing.length) {
      err.hidden = false;
      render(err, icon('alert', 'sm'), h('span', { text: t('panel.err_missing', { count: missing.length }) }));
      const first = form.querySelector(`[data-crit="${missing[0]}"] .score-pick button`);
      if (first) { first.scrollIntoView({ block: 'center' }); first.focus({ preventScroll: true }); }
      return;
    }
    saveBtn.disabled = true;
    status[k] = { kind: 'saving' }; st.paint();
    try {
      const scores = Object.fromEntries(CRITERIA.map((c) => [c, p[c]]));
      const res = await api.panelScore(stage, tm.team_id, scores, p.comment || '');
      tm.my_score = { ...scores, comment: p.comment || '', scored_at: res.scored_at };
      status[k] = { kind: 'saved', at: res.scored_at };
      toast(t('panel.saved_toast'), 'ok');
      paintHeader(); paintProgress();
    } catch (ex) {
      status[k] = { kind: 'error', msg: ex.code === 'network' ? t('panel.err_offline') : errorMessage(ex) };
    } finally { saveBtn.disabled = false; st.paint(); }
  });
  const headChips = h('div', { class: 'row tight' });
  function paintHeader() {
    render(headChips,
      tm.submission ? chip(t('panel.submitted_chip', { date: fmtShortDate(tm.submission.submitted_at) }), 'info', 'file') : chip(t('panel.not_submitted_chip'), 'warn', 'clock'),
      tm.my_score ? chip(t('panel.scored_chip'), 'pass', 'check') : null);
  }
  paintHeader();
  const title = (tm.submission && tm.submission.project_title) || tm.project_title || tm.team_id;
  return h('article', { class: 'card pn-team', id: `team-${tm.team_id}`, 'aria-labelledby': `pn-t-${tm.team_id}`, 'data-anchor': tm.team_id },
    h('header', { class: 'pn-head stack sm' }, h('h2', { id: `pn-t-${tm.team_id}`, class: 'pn-title', text: title }), headChips),
    h('div', { class: 'pad stack lg' },
      tm.submission ? submissionSummary(tm.submission)
        : h('div', { class: 'callout info' }, icon('clock'), h('div', { class: 'stack sm' }, h('b', { text: t('panel.not_submitted') }), h('span', { class: 'small', text: t('panel.not_submitted_body') }))),
      form));
}

let progressEl = null;
function paintProgress() {
  if (!progressEl) return;
  const teams = lists[stage] || [];
  const n = teams.filter((tm) => tm.my_score).length;
  progressEl.textContent = t('panel.progress', { n, total: teams.length });
}

function renderPage() {
  const teams = lists[stage] || [];
  progressEl = h('p', { class: 'muted', role: 'status' });
  render(app, h('div', { class: 'pn stack lg' },
    h('header', { class: 'stack sm' }, h('p', { class: 'eyebrow', text: t('panel.eyebrow') }), h('h1', { text: t('panel.title') }), h('p', { class: 'lead', text: t('panel.intro') })),
    tabs(),
    h('div', { id: 'pn-panel', role: 'tabpanel', 'aria-labelledby': `pn-tab-${stage}`, class: 'stack lg' },
      h('div', { class: 'row between pn-bar' }, progressEl, h('span', { class: 'chip info' }, icon('star'), t(`rubric.weight_${stage}`))),
      loadErr ? errorState(loadErr, () => load()) : null,
      teams.length ? h('nav', { class: 'pn-jump', 'aria-label': t('panel.jump_aria') }, teams.map((tm) => h('a', { href: `#team-${tm.team_id}`, class: 'chip' }, (tm.submission && tm.submission.project_title) || tm.project_title || tm.team_id))) : null,
      !teams.length && !loadErr ? h('section', { class: 'card' }, emptyState({ iconName: 'users', title: t('panel.no_teams_title'), body: t('panel.no_teams_body') })) : null,
      teams.map(teamCard))));
  paintProgress();
  app.querySelectorAll('.pn-jump a').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    const el = document.getElementById(a.getAttribute('href').slice(1));
    if (el) { el.scrollIntoView({ block: 'start' }); el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); }
  }));
}

function keepPlace(fn) {
  const fk = document.activeElement && (document.activeElement.dataset.fk || document.activeElement.id);
  const limit = (document.querySelector('.app-header') || { offsetHeight: 64 }).offsetHeight;
  const a = Array.from(app.querySelectorAll('[data-anchor], .pn-crit')).find((el) => el.getBoundingClientRect().bottom > limit + 8);
  const top = a ? a.getBoundingClientRect().top : 0;
  const sel = a ? (a.dataset.anchor ? `[data-anchor="${CSS.escape(a.dataset.anchor)}"]` : null) : null;
  fn();
  if (sel) { const el = app.querySelector(sel); if (el) window.scrollBy(0, el.getBoundingClientRect().top - top); }
  if (fk) { const el = Array.from(app.querySelectorAll('[data-fk], [id]')).find((x) => x.dataset.fk === fk || x.id === fk); if (el) el.focus({ preventScroll: true }); }
}
onLangChange(() => { if (allowed) keepPlace(renderPage); else forbidden(); });

async function load() {
  render(app, loading());
  loadErr = null;
  try {
    const res = await api.panelList(stage);
    lists[stage] = res.teams || [];
  } catch (e) {
    if (e.code === 'forbidden') { forbidden(); return; }
    loadErr = e;
  }
  renderPage();
  if (location.hash.startsWith('#team-')) { const el = document.getElementById(location.hash.slice(1)); if (el) el.scrollIntoView(); }
}

if (!allowed) forbidden(); else load();
