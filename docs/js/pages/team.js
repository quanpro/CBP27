// team.html · Team picture: baseline heatmap (group averages, n ≥ min_n, managers excluded),
// checkpoint pass rates, and — for managers — passed / not yet for their own reports (no scores).
import { h, render, icon, chip, emptyState, errorState, mountShell } from '../ui.js';
import { t, pick, getLang, onLangChange } from '../i18n.js';
import { api } from '../api.js';
import { loadCatalog, fmtShortDate, fmtDateTime, todayVN } from '../courses.js';

const GROUPS = ['all', 'demand', 'supply', 'materials', 'cs'];
const PCT_CUTS = [40, 55, 70, 85];
const SELF_CUTS = [0.8, 1.6, 2.4, 3.2];

const S = {
  app: null, profile: null, catalog: null,
  summary: null, sumErr: null, sumLoading: true,
  status: null, statusErr: null, statusLoading: false,
  mode: 'pct', cpGroup: 'all', first: true,
};

const loc = () => (getLang() === 'vi' ? 'vi-VN' : 'en-GB');
const fmtNum = (x, dp = 0) => new Intl.NumberFormat(loc(), { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(x);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const groupLabel = (g) => (g === 'all' ? t('team.group_all') : t(`role.${g}`));
const courses = () => ((S.catalog && S.catalog.courses) || []).slice().sort((a, b) => a.order - b.order);
const bucket = (v, cuts) => cuts.filter((c) => v >= c).length;

(async function main() {
  const { app, session } = await mountShell({ page: 'team' });
  S.app = app; S.profile = (session && session.profile) || {};
  onLangChange(() => draw());
  draw();
  try { S.catalog = await loadCatalog(); } catch (e) { /* names fall back to codes */ }
  loadSummary();
  if (S.profile.is_manager) loadStatus();
}());

async function loadSummary() {
  S.sumLoading = true; S.sumErr = null; draw();
  try { S.summary = await api.teamSummary(); } catch (ex) { S.sumErr = ex; }
  S.sumLoading = false; draw();
}
async function loadStatus() {
  S.statusLoading = true; S.statusErr = null; draw();
  try { S.status = await api.teamStatus(); } catch (ex) { S.statusErr = ex; }
  S.statusLoading = false; draw();
}

function draw() {
  const focusId = document.activeElement && S.app && S.app.contains(document.activeElement) ? document.activeElement.id : null;
  render(S.app, h('div', { class: 'stack xl team-page' },
    h('header', { class: 'page-head stack sm' },
      h('p', { class: 'eyebrow', text: t('team.eyebrow') }),
      h('h1', { text: t('team.title') }),
      h('p', { class: 'lead muted', text: t('team.lead') }),
      h('p', { class: 'privacy-chip' }, icon('shield', 'sm'), h('span', { text: t('team.privacy') }))),
    heatSection(),
    checkpointSection(),
    S.profile.is_manager ? gateSection() : null));
  if (focusId) { const el = document.getElementById(focusId); if (el) el.focus({ preventScroll: true }); }
  if (S.first && S.summary) { S.first = false; if (location.hash === '#gates') { const g = document.getElementById('gates'); if (g) g.scrollIntoView(); } }
}

function cardSkeleton(lines = 4) {
  const box = h('div', { class: 'stack', 'aria-hidden': 'true' });
  for (let i = 0; i < lines; i += 1) { const s = h('div', { class: 'skeleton' }); s.style.height = i === 0 ? '28px' : '40px'; s.style.width = `${[60, 100, 100, 100, 92][i % 5]}%`; box.append(s); }
  return h('div', null, h('span', { class: 'sr-only', role: 'status', text: t('common.loading') }), box);
}

function segToggle(id, value, options, onPick, label) {
  return h('div', { class: 'seg seg-lg', role: 'group', 'aria-label': label },
    options.map(([v, text]) => h('button', { type: 'button', id: `${id}-${v}`, 'aria-pressed': String(value === v), onclick: () => onPick(v) }, text)));
}

// ---------- heatmap ----------
function heatSection() {
  const sum = S.summary;
  const head = h('div', { class: 'section-head' },
    h('div', { class: 'stack sm' }, h('h2', { id: 'heat-title', text: t('team.heat.title') }),
      h('p', { text: sum && sum.wave ? t('team.heat.sub', { wave: waveLabel(sum.wave) }) : t('team.heat.sub_plain') })),
    segToggle('mode', S.mode, [['pct', t('team.heat.mode_pct')], ['self', t('team.heat.mode_self')]], (v) => { S.mode = v; draw(); }, t('team.heat.mode_aria')));
  let body;
  if (S.sumLoading && !sum) body = h('div', { class: 'card pad' }, cardSkeleton(5));
  else if (S.sumErr && !sum) body = errorState(S.sumErr, () => loadSummary());
  else {
    const rows = ((sum && sum.baseline) || []).filter((r) => r && r.courses).sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group));
    if (!rows.length) {
      body = h('div', { class: 'card' }, emptyState({ iconName: 'grid', title: t('team.heat.empty_title'), body: t('team.heat.empty_body', { n: (sum && sum.min_n) || 3 }) }));
    } else body = heatCard(sum, rows);
  }
  return h('section', { 'aria-labelledby': 'heat-title' }, head, body);
}

function heatCard(sum, rows) {
  const list = courses();
  const codes = list.length ? list.map((c) => c.code) : Object.keys(rows[0].courses);
  const byCode = new Map(list.map((c) => [c.code, c]));
  const self = S.mode === 'self';
  const cell = (v) => {
    if (!isNum(v)) return h('td', { class: 'na' }, h('span', { 'aria-hidden': 'true', text: '—' }), h('span', { class: 'sr-only', text: t('team.no_data') }));
    const b = bucket(v, self ? SELF_CUTS : PCT_CUTS);
    return h('td', { class: `h${b}` }, self ? fmtNum(v, 1) : `${Math.round(v)}`);
  };
  const table = h('table', { class: 'heat' },
    h('caption', { class: 'sr-only', text: t(self ? 'team.heat.caption_self' : 'team.heat.caption_pct') }),
    h('thead', null, h('tr', null, h('th', { scope: 'col', class: 'heat-corner' }, h('span', { class: 'sr-only', text: t('team.heat.col_group') })),
      codes.map((code) => h('th', { scope: 'col' }, h('abbr', { title: byCode.has(code) ? pick(byCode.get(code), 'name') : code, text: code }))))),
    h('tbody', null, rows.map((r) => h('tr', { class: r.group === 'all' ? 'is-all' : null },
      h('th', { scope: 'row' }, h('span', { class: 'g-name', text: groupLabel(r.group) }), h('span', { class: 'g-n', text: t('team.n', { n: r.n }) })),
      codes.map((code) => { const x = r.courses[code] || {}; return cell(self ? x.self : x.pct); })))));

  const all = rows.find((r) => r.group === 'all') || rows[0];
  const ranked = codes.map((code) => ({ code, v: (all.courses[code] || {})[self ? 'self' : 'pct'] })).filter((x) => isNum(x.v)).sort((a, b) => a.v - b.v);
  const low = ranked.slice(0, 2); const high = ranked.slice(-2).reverse();
  const val = (x) => (self ? fmtNum(x.v, 1) : `${Math.round(x.v)}%`);
  const insight = ranked.length >= 4 ? h('div', { class: 'insights' },
    h('div', { class: 'insight' }, h('span', { class: 'ins-k' }, icon('target', 'sm'), t('team.heat.room')),
      h('span', { class: 'row tight' }, low.map((x) => chip(`${x.code} · ${val(x)}`, 'warn')))),
    h('div', { class: 'insight' }, h('span', { class: 'ins-k' }, icon('trend-up', 'sm'), t('team.heat.strong')),
      h('span', { class: 'row tight' }, high.map((x) => chip(`${x.code} · ${val(x)}`, 'pass'))))) : null;

  const ranges = self ? ['0–0.7', '0.8–1.5', '1.6–2.3', '2.4–3.1', '3.2–4'] : ['< 40', '40–54', '55–69', '70–84', '≥ 85'];
  const legend = h('div', { class: 'legend', role: 'list', 'aria-label': t('team.heat.legend') },
    h('span', { class: 'strong', text: `${t(self ? 'team.heat.legend_self' : 'team.heat.legend_pct')}:` }),
    ranges.map((r, i) => h('span', { class: 'lg-item', role: 'listitem' }, h('i', { class: `h${i}` }), self ? r.replace(/\./g, getLang() === 'vi' ? ',' : '.') : r)),
    h('span', { class: 'lg-item', role: 'listitem' }, h('i', { class: 'lg-na' }), `— ${t('team.no_data')}`));

  return h('div', { class: 'card pad stack heat-card' },
    insight,
    h('div', { class: 'heat-wrap', tabindex: '0', role: 'region', 'aria-labelledby': 'heat-title' }, table),
    legend,
    list.length ? h('details', { class: 'key-details' }, h('summary', { text: t('team.heat.key') }),
      h('dl', { class: 'course-key' }, list.map((c) => [h('dt', { text: c.code }), h('dd', { text: pick(c, 'name') })]))) : null,
    h('p', { class: 'xs muted note-line' }, icon('info', 'sm'), ' ',
      t('team.heat.note', { n: (sum && sum.min_n) || 3 }), sum && sum.updated_at ? ` ${t('team.updated', { time: fmtDateTime(sum.updated_at) })}` : ''));
}

function waveLabel(w) {
  const [y, m] = String(w).split('-');
  if (!y || !m) return w;
  return getLang() === 'vi' ? `${t('team.month')} ${Number(m)}/${y}` : new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(Number(y), Number(m) - 1, 15)));
}

// ---------- checkpoints ----------
function checkpointSection() {
  const sum = S.summary;
  const groups = ((sum && sum.checkpoints) || []).filter((g) => g && g.courses).sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group));
  if (groups.length && !groups.some((g) => g.group === S.cpGroup)) S.cpGroup = groups[0].group;
  const head = h('div', { class: 'section-head' },
    h('div', { class: 'stack sm' }, h('h2', { id: 'cp-title', text: t('team.cp.title') }), h('p', { text: t('team.cp.sub') })),
    groups.length > 1 ? segToggle('cpg', S.cpGroup, groups.map((g) => [g.group, g.group === 'all' ? t('team.group_all_short') : t(`team.short.${g.group}`)]), (v) => { S.cpGroup = v; draw(); }, t('team.cp.group_aria')) : null);
  let body;
  if (S.sumLoading && !sum) body = h('div', { class: 'card pad' }, cardSkeleton(4));
  else if (S.sumErr && !sum) body = h('div', { class: 'card pad muted small', text: t('team.cp.unavailable') });
  else {
    const g = groups.find((x) => x.group === S.cpGroup);
    const list = courses();
    const anyData = g && Object.values(g.courses).some((x) => x && (isNum(x.first_try_pass) || isNum(x.passed_by_forum)));
    if (!g || !anyData) body = h('div', { class: 'card' }, emptyState({ iconName: 'flag', title: t('team.cp.empty_title'), body: t('team.cp.empty_body') }));
    else {
      const bar = (v, target) => {
        if (!isNum(v)) return h('td', { class: 'num na-cell' }, h('span', { 'aria-hidden': 'true', text: '—' }), h('span', { class: 'sr-only', text: t('team.no_data') }));
        const fill = h('i'); fill.style.width = `${Math.max(0, Math.min(100, v))}%`;
        const met = v >= target;
        return h('td', { class: 'num' }, h('span', { class: 'cell-bar' },
          h('b', { text: `${Math.round(v)}%` }),
          h('span', { class: `mini-track${met ? ' met' : ''}`, 'aria-hidden': 'true' }, fill),
          met ? h('span', { class: 'met-tag' }, icon('check', 'sm'), h('span', { class: 'sr-only', text: t('team.cp.target_met') })) : null));
      };
      body = h('div', { class: 'card' },
        h('div', { class: 'table-wrap', role: 'region', tabindex: '0', 'aria-labelledby': 'cp-title' },
          h('table', { class: 'data cp-table' },
            h('caption', { class: 'sr-only', text: t('team.cp.caption', { group: groupLabel(g.group) }) }),
            h('thead', null, h('tr', null,
              h('th', { scope: 'col', text: t('team.cp.col_course') }),
              h('th', { scope: 'col' }, t('team.cp.col_first'), h('span', { class: 'th-sub', text: t('team.cp.target_first') })),
              h('th', { scope: 'col' }, t('team.cp.col_forum'), h('span', { class: 'th-sub', text: t('team.cp.target_forum') })))),
            h('tbody', null, (list.length ? list : Object.keys(g.courses).map((code) => ({ code }))).map((c) => {
              const x = g.courses[c.code] || {};
              return h('tr', null,
                h('th', { scope: 'row' }, h('span', { class: `code-badge sm fam-${c.code.charAt(0)}`, text: c.code }), c.name_en ? h('span', { class: 'cp-name', text: pick(c, 'name') }) : null),
                bar(x.first_try_pass, 70), bar(x.passed_by_forum, 100));
            })))),
        h('p', { class: 'xs muted pad-x note-line' }, icon('info', 'sm'), ' ', t('team.cp.note', { n: g.n })));
    }
  }
  return h('section', { 'aria-labelledby': 'cp-title' }, head, body);
}

// ---------- manager: my team's gate status ----------
const ST = {
  passed: ['pass', 'check', 'team.gs.passed'],
  not_yet: ['warn', 'refresh', 'team.gs.not_yet'],
  not_started: ['locked', 'circle', 'team.gs.not_started'],
};
function gateSection() {
  const head = h('div', { class: 'section-head' },
    h('div', { class: 'stack sm' }, h('h2', { id: 'gates-title', text: t('team.gs.title') }), h('p', { text: t('team.gs.sub') })));
  let body;
  if (S.statusLoading && !S.status) body = h('div', { class: 'card pad' }, cardSkeleton(4));
  else if (S.statusErr && !S.status) {
    body = S.statusErr.code === 'forbidden'
      ? h('div', { class: 'callout info' }, icon('lock'), h('p', { text: t('team.gs.forbidden') }))
      : errorState(S.statusErr, () => loadStatus());
  } else {
    const reports = (S.status && S.status.reports) || [];
    if (!reports.length) body = h('div', { class: 'card' }, emptyState({ iconName: 'users', title: t('team.gs.empty_title'), body: t('team.gs.empty_body') }));
    else body = gateTable(reports);
  }
  return h('section', { id: 'gates', 'aria-labelledby': 'gates-title' }, head, body);
}
function gateTable(reports) {
  const list = courses();
  const codes = list.length ? list.map((c) => c.code) : Object.keys(reports[0].courses || {});
  const byCode = new Map(list.map((c) => [c.code, c]));
  const cellChip = (s) => { const d = ST[s] || ST.not_started; return chip(t(d[2]), d[0], d[1]); };
  const today = todayVN();
  const next = list.filter((c) => c.checkpoint_close && c.checkpoint_close >= today).sort((a, b) => (a.checkpoint_close < b.checkpoint_close ? -1 : 1))[0];
  let nextLine = null;
  if (next) {
    const set = list.filter((c) => c.checkpoint_close === next.checkpoint_close);
    const done = set.map((c) => reports.filter((r) => (r.courses || {})[c.code] === 'passed').length);
    nextLine = h('div', { class: 'callout info' }, icon('flag'),
      h('p', { class: 'small' }, h('b', { text: t('team.gs.next_gate', { codes: set.map((c) => c.code).join(' + '), date: fmtShortDate(next.checkpoint_close) }) }), ' ',
        set.map((c, i) => t('team.gs.next_count', { code: c.code, n: done[i], total: reports.length })).join(' · ')));
  }
  const blDone = reports.filter((r) => r.baseline === 'done').length;
  return h('div', { class: 'card pad stack' },
    nextLine,
    h('div', { class: 'table-wrap status-wrap', role: 'region', tabindex: '0', 'aria-labelledby': 'gates-title' },
      h('table', { class: 'data status-table' },
        h('caption', { class: 'sr-only', text: t('team.gs.caption') }),
        h('thead', null, h('tr', null,
          h('th', { scope: 'col', class: 'sticky-col', text: t('team.gs.col_person') }),
          h('th', { scope: 'col', text: t('team.gs.col_baseline') }),
          codes.map((code) => h('th', { scope: 'col' }, h('abbr', { title: byCode.has(code) ? pick(byCode.get(code), 'name') : code, text: code }))))),
        h('tbody', null, reports.map((r) => h('tr', null,
          h('th', { scope: 'row', class: 'sticky-col', text: r.first_name || r.code }),
          h('td', null, r.baseline === 'done' ? chip(t('team.gs.bl_done'), 'pass', 'check') : chip(t('team.gs.bl_not'), 'locked', 'circle')),
          codes.map((code) => h('td', null, cellChip((r.courses || {})[code])))))),
        h('tfoot', null, h('tr', null,
          h('th', { scope: 'row', class: 'sticky-col', text: t('team.gs.total') }),
          h('td', { class: 'num', text: `${blDone}/${reports.length}` }),
          codes.map((code) => h('td', { class: 'num', text: `${reports.filter((r) => (r.courses || {})[code] === 'passed').length}/${reports.length}` })))))),
    h('p', { class: 'xs muted note-line' }, icon('lock', 'sm'), ' ', t('team.gs.note')));
}
