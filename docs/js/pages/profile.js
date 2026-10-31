// profile.html — the learner's baseline profile (specs/22 §4 `profile`), shown only while results are
// open. Part 1 by step and by move, Part 2 by charter (SJT band, own mean, manager mean, index, flags in
// plain words, the two behaviours to develop), Part 3 by level and gate with the indicative level, the
// course self-ratings next to the linked scores ("rates high, scores low") and the two IDP gaps.
// Bars always carry their value as text; colour is never the only signal. Sheet text is text only.
import { mountShell, h, icon, chip, codeBadge, render, loading, errorState } from '../ui.js';
import { t, pick, getLang, has, onLangChange } from '../i18n.js';
import { api } from '../api.js';
import { loadCatalog, fmtDateTime } from '../courses.js';
import { waveLabel } from '../bl2.js';

const { app } = await mountShell({ page: 'profile' });

const S = { data: null, err: null, cat: null, me: null };
const ORDER = ['A2', 'A3', 'A1', 'P1', 'C1', 'P2', 'P3', 'P4', 'P5', 'P6'];
const STEP_ORDER = ['1', '2', '3', '4', '5', '6', '7', '8'];
const MOVE_ORDER = ['ASK', 'SHAPE', 'SIZE', 'CHECK', 'SO WHAT'];
const LEVELS = ['BA', 'WK', 'FO', 'LE'];
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const loc = () => (getLang() === 'vi' ? 'vi-VN' : 'en-GB');
const fmt1 = (x) => new Intl.NumberFormat(loc(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(x);
const pctText = (x) => (isNum(x) ? `${Math.round(x)}%` : '–');
const catCourse = (code) => (S.cat && S.cat.courses.find((c) => c.code === code)) || null;
const courseName = (code) => { const c = catCourse(code); return c ? pick(c, 'name') : code; };

onLangChange(() => draw(true));

/** Keys of a map in a preferred order, then any others (Sheet keys we do not know yet) as they come. */
function ordered(map, prefer) {
  const keys = Object.keys(map || {});
  return prefer.filter((k) => keys.includes(k)).concat(keys.filter((k) => !prefer.includes(k)));
}
const stepLabel = (k) => (has(`profile.step.${k}`) ? t('profile.step_n', { n: k, name: t(`profile.step.${k}`) }) : String(k));
const moveLabel = (k) => String(k);
const levelLabel = (k) => (has(`profile.level.${k}`) ? t(`profile.level.${k}`) : String(k));

/** One labelled bar: name · track · "64%" (the value is always written out). */
function bar(label, pct, { sub, warn = false, id } = {}) {
  const p = isNum(pct) ? Math.max(0, Math.min(100, pct)) : 0;
  const fill = h('i'); fill.style.width = `${p}%`;
  return h('div', { class: `pf-bar${warn ? ' is-warn' : ''}${isNum(pct) ? '' : ' is-na'}`, id },
    h('span', { class: 'pf-bar-name' }, h('span', { text: label }), sub ? h('span', { class: 'pf-bar-sub', text: sub }) : null),
    h('span', { class: 'pf-track', 'aria-hidden': 'true' }, fill),
    h('span', { class: 'pf-bar-val' }, isNum(pct) ? pctText(pct) : h('span', { class: 'muted', text: t('profile.no_score') })));
}
function card(id, title, sub, ...body) {
  return h('section', { class: 'card pad stack pf-card', 'aria-labelledby': id },
    h('div', { class: 'stack sm' }, h('h2', { id, text: title }), sub ? h('p', { class: 'small muted', text: sub }) : null),
    ...body);
}
function kpi(label, value, note) {
  return h('div', { class: 'pf-kpi' }, h('span', { class: 'pf-kpi-k', text: label }), h('b', { class: 'pf-kpi-v', text: value }), note ? h('span', { class: 'pf-kpi-n', text: note }) : null);
}
function notTaken(id, title) {
  return card(id, title, null, h('p', { class: 'muted', text: t('profile.not_taken') }));
}

// ---------- sections ----------
function gapsCard(d) {
  const gaps = (d.gaps || []).slice(0, 2);
  if (!gaps.length) return null;
  return h('section', { class: 'card pad stack pf-gaps', 'aria-labelledby': 'pf-gaps-h' },
    h('h2', { id: 'pf-gaps-h' }, icon('target', 'sm'), h('span', { text: t('profile.gaps_title') })),
    h('ol', { class: 'pf-gap-list' }, gaps.map((g, i) => h('li', null,
      h('span', { class: 'pf-gap-n', 'aria-hidden': 'true', text: String(i + 1) }),
      h('span', { class: 'stack sm grow' }, h('b', { class: 'ink', text: pick(g, 'name') || g.area }),
        isNum(g.pct) ? h('span', { class: 'small', text: t('profile.gap_pct', { pct: Math.round(g.pct) }) }) : null)))),
    h('p', { class: 'pf-idp' }, icon('calendar', 'sm'), h('span', { class: 'strong ink', text: t('profile.gaps_idp') })));
}
function p1Card(p1) {
  const title = t('profile.p1_title');
  if (!p1) return notTaken('pf-p1', title);
  const score = isNum(p1.scaled_pct) ? p1.scaled_pct : p1.raw_pct;
  const scaled = isNum(p1.scaled_pct) && isNum(p1.raw_pct) && Math.round(p1.scaled_pct) !== Math.round(p1.raw_pct);
  return card('pf-p1', title, t('profile.p1_sub'),
    h('div', { class: 'pf-kpis' },
      kpi(t('profile.overall'), pctText(score), scaled ? t('profile.raw_note', { pct: pctText(p1.raw_pct) }) : null),
      kpi(t('profile.sec_a'), pctText(p1.section_A_pct)),
      kpi(t('profile.sec_b'), pctText(p1.section_B_pct))),
    h('h3', { class: 'pf-h3', text: t('profile.by_step') }),
    h('div', { class: 'pf-bars' }, ordered(p1.by_step, STEP_ORDER).map((k) => bar(stepLabel(k), p1.by_step[k]))),
    h('h3', { class: 'pf-h3', text: t('profile.by_move') }),
    h('div', { class: 'pf-bars' }, ordered(p1.by_move, MOVE_ORDER).map((k) => bar(moveLabel(k), p1.by_move[k], { sub: has(`profile.move.${k.replace(/\s+/g, '_')}`) ? t(`profile.move.${k.replace(/\s+/g, '_')}`) : null }))));
}
const FLAG_ICON = { blind_spot: 'eye-off', hidden_strength: 'star', knowing_doing: 'zap' };
function charterCard(c, key) {
  const name = pick(c, 'name') || t('profile.charter_n', { n: key });
  const band = c.sjt_band ? chip(t(`profile.band.${c.sjt_band}`), c.sjt_band === 'high' ? 'pass' : c.sjt_band === 'low' ? 'warn' : 'info') : chip(t('profile.band.none'), 'locked');
  const idx = isNum(c.index) ? c.index : null;
  const fill = h('i'); fill.style.width = `${idx === null ? 0 : Math.max(0, Math.min(100, idx))}%`;
  return h('li', { class: 'pf-charter' },
    h('h3', { class: 'pf-charter-name', text: name }),
    h('dl', { class: 'pf-dl' },
      h('div', null, h('dt', { text: t('profile.sjt') }), h('dd', null, band)),
      h('div', null, h('dt', { text: t('profile.self_mean') }), h('dd', { text: isNum(c.self_mean) ? t('profile.mean_of4', { v: fmt1(c.self_mean) }) : '–' })),
      h('div', null, h('dt', { text: t('profile.mgr_mean') }), h('dd', { text: isNum(c.mgr_mean) ? t('profile.mean_of4', { v: fmt1(c.mgr_mean) }) : t('profile.mgr_none') }))),
    h('div', { class: `pf-index${idx === null ? ' is-na' : ''}` },
      h('span', { class: 'pf-bar-name', text: t('profile.index') }),
      h('span', { class: 'pf-track', 'aria-hidden': 'true' }, fill),
      h('span', { class: 'pf-bar-val' }, idx === null ? h('span', { class: 'muted', text: t('profile.index_none') }) : t('profile.index_val', { n: Math.round(idx) }))),
    (c.flags || []).length ? h('ul', { class: 'pf-flags' }, c.flags.map((f) => h('li', { class: `pf-flag is-${f}` }, icon(FLAG_ICON[f] || 'info', 'sm'),
      h('span', null, h('b', { text: has(`profile.flag.${f}`) ? t(`profile.flag.${f}`) : f }), has(`profile.flag.${f}_body`) ? ` ${t(`profile.flag.${f}_body`)}` : '')))) : null);
}
function p2Card(p2) {
  const title = t('profile.p2_title');
  if (!p2) return notTaken('pf-p2', title);
  const by = p2.by_charter || {};
  const keys = ordered(by, ['1', '2', '3', '4', '5', 'QWS']);
  return card('pf-p2', title, t('profile.p2_sub'),
    h('div', { class: 'pf-kpis' },
      kpi(t('profile.sjt_overall'), pctText(p2.sjt_pct)),
      kpi(t('profile.self_mean'), isNum(p2.self_mean) ? t('profile.mean_of4', { v: fmt1(p2.self_mean) }) : '–'),
      kpi(t('profile.mgr_mean'), isNum(p2.mgr_mean) ? t('profile.mean_of4', { v: fmt1(p2.mgr_mean) }) : t('profile.mgr_none'))),
    h('ul', { class: 'pf-charters' }, keys.map((k) => charterCard(by[k], k))),
    h('p', { class: 'xs muted', text: t('profile.p2_note') }),
    (p2.top_dev || []).length ? h('div', { class: 'pf-dev stack sm' },
      h('h3', { class: 'pf-h3' }, icon('trend-up', 'sm'), h('span', { text: t('profile.top_dev') })),
      h('ol', { class: 'pf-dev-list' }, p2.top_dev.slice(0, 2).map((x) => h('li', { text: pick(x, 'text') })))) : null);
}
function p3Card(p3) {
  const title = t('profile.p3_title');
  if (!p3) return notTaken('pf-p3', title);
  const mod = p3.module ? (has(`profile.module_name.${p3.module}`) ? t(`profile.module_name.${p3.module}`) : p3.module) : '';
  return card('pf-p3', title, mod ? t('profile.p3_sub', { module: mod }) : null,
    h('div', { class: 'pf-kpis' },
      kpi(t('profile.overall'), pctText(p3.total_pct)),
      kpi(t('profile.core'), pctText(p3.core_pct)),
      kpi(t('profile.module'), pctText(p3.module_pct))),
    h('p', { class: 'pf-level' }, icon('award', 'sm'),
      h('span', { text: p3.level ? t('profile.level_line', { level: levelLabel(p3.level) }) : t('profile.level_none') })),
    h('h3', { class: 'pf-h3', text: t('profile.by_level') }),
    h('div', { class: 'pf-bars' }, ordered(p3.by_level, LEVELS).map((k) => bar(levelLabel(k), p3.by_level[k], { warn: isNum(p3.by_level[k]) && p3.by_level[k] < 70 }))),
    h('p', { class: 'xs muted', text: t('profile.level_note') }),
    Object.keys(p3.by_gate || {}).length ? h('h3', { class: 'pf-h3', text: t('profile.by_gate') }) : null,
    Object.keys(p3.by_gate || {}).length ? h('div', { class: 'pf-bars' }, ordered(p3.by_gate, []).map((k) => bar(String(k), p3.by_gate[k]))) : null);
}
function coursesCard(courses) {
  const codes = ordered(courses || {}, ORDER);
  if (!codes.length) return null;
  const scaleName = (n) => {
    const s = S.cat && (S.cat.scale || []).find((x) => Number(x.level) === Number(n));
    return s ? `${n} · ${s.abbr || s[getLang()] || s.en}` : String(n);
  };
  const flagged = codes.filter((c) => courses[c] && courses[c].flag);
  return card('pf-courses', t('profile.courses_title'), t('profile.courses_sub'),
    flagged.length ? h('div', { class: 'callout warn' }, icon('alert'), h('span', { text: t('profile.flag_summary', { codes: flagged.join(', ') }) })) : null,
    h('ul', { class: 'pf-courses' }, codes.map((code) => {
      const x = courses[code] || {};
      const fill = h('i'); fill.style.width = `${isNum(x.score_pct) ? Math.max(0, Math.min(100, x.score_pct)) : 0}%`;
      return h('li', { class: `pf-course fam-${code.charAt(0)}${x.flag ? ' is-flag' : ''}` },
        codeBadge(code),
        h('span', { class: 'pf-course-main' },
          h('b', { class: 'ink pf-course-name', text: courseName(code) }),
          h('span', { class: 'pf-course-line' },
            h('span', { class: 'pf-course-self', text: t('profile.self_short', { v: x.self !== null && x.self !== undefined ? scaleName(x.self) : '–' }) }),
            h('span', { class: 'pf-track', 'aria-hidden': 'true' }, fill),
            h('span', { class: 'pf-bar-val' }, isNum(x.score_pct) ? pctText(x.score_pct) : h('span', { class: 'muted', text: code === 'A3' ? t('profile.no_test') : t('profile.no_score') }))),
          x.flag ? h('span', { class: 'pf-flag-chip' }, chip(t('profile.rates_high'), 'warn', 'alert')) : null));
    })),
    h('p', { class: 'xs muted', text: t('profile.courses_note') }));
}

function draw(keep) {
  const y = window.scrollY;
  if (!S.data) {
    if (S.err && S.err.code === 'not_found') {
      render(app, h('div', { class: 'pf stack lg' }, h('section', { class: 'card qz-state' }, h('div', { class: 'empty' },
        h('div', { class: 'em-icon' }, icon('target', 'lg')), h('h1', { class: 'qz-h1', text: t('profile.title') }), h('p', { text: t('profile.empty') }),
        h('a', { class: 'btn btn-primary', href: 'baseline.html' }, t('profile.to_baseline'))))));
      return;
    }
    if (S.err && S.err.code === 'not_open') {
      render(app, h('div', { class: 'pf stack lg' }, h('section', { class: 'card qz-state' }, h('div', { class: 'empty' },
        h('div', { class: 'em-icon' }, icon('lock', 'lg')), h('h1', { class: 'qz-h1', text: t('profile.closed_title') }), h('p', { text: t('profile.closed_body') }),
        h('a', { class: 'btn btn-primary', href: 'index.html' }, t('profile.back_home'))))));
      return;
    }
    render(app, h('div', { class: 'pf stack lg' }, h('h1', { text: t('profile.title') }), errorState(S.err || {}, () => load())));
    return;
  }
  const d = S.data;
  const any = d.p1 || d.p2 || d.p3;
  render(app, h('div', { class: 'pf stack xl' },
    h('header', { class: 'page-head stack sm' },
      h('p', { class: 'eyebrow', text: t('profile.eyebrow', { wave: waveLabel(d.wave) }) }),
      h('h1', { text: t('profile.title') }),
      h('p', { class: 'lead muted', text: t('profile.lead') }),
      h('p', { class: 'privacy-chip' }, icon('shield', 'sm'), h('span', { text: t('profile.privacy') }))),
    any ? null : h('div', { class: 'callout info' }, icon('info'), h('span', { text: t('profile.empty') })),
    gapsCard(d),
    h('div', { class: 'pf-grid' }, p1Card(d.p1), p2Card(d.p2), p3Card(d.p3), coursesCard(d.courses)),
    h('p', { class: 'xs muted note-line' }, icon('info', 'sm'), ' ', t('profile.note'), d.built_at ? ` ${t('profile.built', { time: fmtDateTime(d.built_at) })}` : '')));
  if (keep) window.scrollTo(0, y);
}

async function load() {
  render(app, loading());
  S.err = null;
  try { S.cat = await loadCatalog(); } catch (e) { /* names fall back to codes */ }
  try { S.data = await api.profile(); } catch (e) { S.err = e; S.data = null; }
  draw();
}
load();
