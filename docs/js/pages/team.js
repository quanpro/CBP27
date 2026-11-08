// team.html · Team overview: baseline averages by role group (specs/22: Part 1 %, Part 2 SJT % and
// manager mean, Part 3 core %; n ≥ min_n, managers excluded, only once results are published),
// checkpoint pass rates, and — for managers — passed / not yet / needs a chat for their own reports
// (no scores). A manager records the 15-minute chat here (unlock_retake), which reopens the checkpoint.
import { h, render, icon, chip, emptyState, errorState, errorMessage, modal, toast, mountShell } from '../ui.js';
import { guideBox } from '../guide.js';
import { t, pick, getLang, onLangChange } from '../i18n.js';
import { api } from '../api.js';
import { loadCatalog, journey, fmtShortDate, fmtDateTime, todayVN } from '../courses.js';

const GROUPS = ['all', 'demand', 'supply', 'materials', 'cs'];
const PCT_CUTS = [40, 55, 70, 85];
const MEAN_CUTS = [1.75, 2.25, 2.75, 3.25]; // manager mean, 1–4
const METRICS = [['p1_pct', 'pct'], ['p2_sjt_pct', 'pct'], ['p2_mgr_mean', 'mean'], ['p3_core_pct', 'pct']];

const S = {
  app: null, profile: null, catalog: null,
  summary: null, sumErr: null, sumLoading: true,
  status: null, statusErr: null, statusLoading: false,
  live: null, // courses with the Sheet's dates (for "next gate"), managers only
  unlocked: new Map(), // `${code}|${course}` → unlocked_at, recorded in this visit
  cpGroup: 'all', first: true,
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
  if (S.profile.is_manager) {
    loadStatus();
    api.me().then((me) => journey(me)).then((list) => { S.live = list; draw(); }).catch(() => { /* catalogue dates are the fallback */ });
  }
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
    guideBox({ id: 'team', page: t('guide.team.page'), now: t(S.profile.is_manager ? 'guide.team.now_mgr' : 'guide.team.now'), next: S.profile.is_manager ? t('guide.team.next_mgr') : '' }),
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

// ---------- baseline averages ----------
function heatSection() {
  const sum = S.summary;
  const head = h('div', { class: 'section-head' },
    h('div', { class: 'stack sm' }, h('h2', { id: 'heat-title', text: t('team.heat.title') }),
      h('p', { text: sum && sum.wave ? t('team.heat.sub', { wave: waveLabel(sum.wave) }) : t('team.heat.sub_plain') })));
  let body;
  if (S.sumLoading && !sum) body = h('div', { class: 'card pad' }, cardSkeleton(5));
  else if (S.sumErr && !sum) body = errorState(S.sumErr, () => loadSummary());
  else {
    const rows = ((sum && sum.baseline_published !== false && sum.baseline) || []).filter((r) => r && r.group).sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group));
    if (!rows.length) {
      body = h('div', { class: 'card' }, emptyState({ iconName: 'grid', title: t('team.heat.empty_title'), body: t('team.heat.empty_body', { n: (sum && sum.min_n) || 3 }) }));
    } else body = heatCard(sum, rows);
  }
  return h('section', { 'aria-labelledby': 'heat-title' }, head, body);
}

function heatCard(sum, rows) {
  const cell = (v, kind) => {
    if (!isNum(v)) return h('td', { class: 'na' }, h('span', { 'aria-hidden': 'true', text: '—' }), h('span', { class: 'sr-only', text: t('team.no_data') }));
    const b = bucket(v, kind === 'mean' ? MEAN_CUTS : PCT_CUTS);
    return h('td', { class: `h${b}` }, kind === 'mean' ? fmtNum(v, 1) : `${Math.round(v)}%`);
  };
  const table = h('table', { class: 'heat heat-bl2' },
    h('caption', { class: 'sr-only', text: t('team.heat.caption') }),
    h('thead', null, h('tr', null, h('th', { scope: 'col', class: 'heat-corner' }, h('span', { class: 'sr-only', text: t('team.heat.col_group') })),
      METRICS.map(([k]) => h('th', { scope: 'col' }, h('span', { class: 'heat-col', text: t(`team.heat.col.${k}`) }), h('span', { class: 'th-sub', text: t(`team.heat.unit.${k}`) }))))),
    h('tbody', null, rows.map((r) => h('tr', { class: r.group === 'all' ? 'is-all' : null },
      h('th', { scope: 'row' }, h('span', { class: 'g-name', text: groupLabel(r.group) }), h('span', { class: 'g-n', text: t('team.n', { n: r.n }) })),
      METRICS.map(([k, kind]) => cell(r[k], kind))))));
  const pctRanges = ['< 40', '40–54', '55–69', '70–84', '≥ 85'];
  const meanRanges = ['< 1.75', '1.75–2.24', '2.25–2.74', '2.75–3.24', '≥ 3.25'].map((x) => (getLang() === 'vi' ? x.replace(/\./g, ',') : x));
  const legend = (label, ranges) => h('div', { class: 'legend', role: 'list', 'aria-label': label },
    h('span', { class: 'strong', text: `${label}:` }),
    ranges.map((r, i) => h('span', { class: 'lg-item', role: 'listitem' }, h('i', { class: `h${i}` }), r)));
  return h('div', { class: 'card pad stack heat-card' },
    h('div', { class: 'heat-wrap', tabindex: '0', role: 'region', 'aria-labelledby': 'heat-title' }, table),
    legend(t('team.heat.legend_pct'), pctRanges),
    legend(t('team.heat.legend_mean'), meanRanges),
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
              const none = !isNum(x.first_try_pass) && !isNum(x.passed_by_forum);
              return h('tr', { class: none ? 'no-data' : null },
                h('th', { scope: 'row' }, h('span', { class: 'cp-course' }, h('span', { class: `code-badge sm fam-${c.code.charAt(0)}`, text: c.code }), c.name_en ? h('span', { class: 'cp-name', text: pick(c, 'name') }) : null)),
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
  needs_chat: ['warn', 'users', 'team.gs.needs_chat'],
  unlocked: ['info', 'key', 'team.gs.unlocked'],
  not_yet: ['warn', 'refresh', 'team.gs.not_yet'],
  not_started: ['locked', 'circle', 'team.gs.not_started'],
};
const cellState = (r, code) => {
  const v = (r.courses || {})[code] || 'not_started';
  return v === 'needs_chat' && S.unlocked.has(`${r.code}|${code}`) ? 'unlocked' : v;
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
// The 15-minute chat: list every checkpoint that needs one, each with "I've had the chat".
function chatPanel(reports, byCode) {
  const rows = reports.flatMap((r) => Object.keys(r.courses || {}).filter((code) => r.courses[code] === 'needs_chat').map((code) => ({ r, code })));
  if (!rows.length) return null;
  return h('div', { class: 'chat-panel', role: 'region', 'aria-labelledby': 'chat-title' },
    h('div', { class: 'row top' }, h('span', { class: 'tile-icon warn' }, icon('users')),
      h('div', { class: 'grow stack sm' }, h('h3', { id: 'chat-title', text: t('team.gs.chat_title') }), h('p', { class: 'small', text: t('team.gs.chat_body') }))),
    h('ul', { class: 'chat-list' }, rows.map(({ r, code }) => {
      const key = `${r.code}|${code}`;
      const done = S.unlocked.has(key);
      const name = r.first_name || r.code;
      const course = byCode.has(code) ? pick(byCode.get(code), 'name') : '';
      return h('li', { class: done ? 'is-done' : null },
        h('span', { class: 'chat-who' }, h('b', { text: name }), h('span', { class: `code-badge sm fam-${code.charAt(0)}`, text: code }), course ? h('span', { class: 'chat-course small muted', text: course }) : null),
        done ? chip(t('team.gs.unlocked'), 'info', 'key')
          : h('button', { class: 'btn btn-secondary chat-btn', type: 'button', id: `chat-${r.code}-${code}`, onclick: () => openChatDialog(r, code, course) }, icon('check'), t('team.gs.had_chat')));
    })));
}

function openChatDialog(r, code, course) {
  const name = r.first_name || r.code;
  const note = h('textarea', { class: 'textarea', id: 'chat-note', maxlength: 300, rows: 3, 'aria-describedby': 'chat-note-hint' });
  const err = h('p', { class: 'err', role: 'alert', hidden: true });
  const ok = h('button', { class: 'btn btn-primary', type: 'submit', form: 'chat-form' }, t('team.unlock.confirm'));
  const form = h('form', { id: 'chat-form', class: 'stack' },
    h('p', null, h('b', { text: `${name} · ${code}${course ? ` ${course}` : ''}` })),
    h('p', { class: 'small', text: t('team.unlock.body', { name }) }),
    h('div', { class: 'field' }, h('label', { for: 'chat-note', text: t('team.unlock.note') }), note, h('span', { class: 'hint', id: 'chat-note-hint', text: t('team.unlock.note_hint') })),
    err);
  const dlg = modal({ title: t('team.unlock.title'), body: form, actions: [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => dlg.close() }, t('common.cancel')), ok] });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true; ok.disabled = true;
    try {
      const res = await api.unlockRetake(r.code, code, note.value.trim());
      S.unlocked.set(`${r.code}|${code}`, res.unlocked_at || '');
      dlg.close();
      toast(t('team.unlock.done', { code, name }), 'ok');
      draw();
      const heading = document.getElementById('chat-title'); if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
    } catch (ex) {
      err.textContent = errorMessage(ex); err.hidden = false;
    } finally { ok.disabled = false; }
  });
  note.focus();
}

// Baseline v2: done / in progress / not done for each of the three parts (never a score).
const BL_ST = { done: ['pass', 'check', 'team.gs.bl_done'], in_progress: ['warn', 'edit', 'team.gs.bl_progress'], not_done: ['locked', 'circle', 'team.gs.bl_not'] };
function blParts(r) {
  const b = r.baseline;
  if (b && typeof b === 'object') return ['p1', 'p2', 'p3'].map((k) => (BL_ST[b[k]] ? b[k] : 'not_done'));
  const one = b === 'done' ? 'done' : 'not_done'; // an older backend sends one value for the whole baseline
  return [one, one, one];
}
const blAll = (r) => blParts(r).every((x) => x === 'done');
function blChips(r, withLabel) {
  return h('span', { class: 'gs-bl row tight' }, withLabel ? h('span', { class: 'small muted', text: `${t('team.gs.col_baseline')}:` }) : null,
    blParts(r).map((st, i) => { const d = BL_ST[st]; const c = chip(t('team.gs.bl_part', { n: i + 1 }), d[0], d[1]); c.setAttribute('title', t(d[2])); c.append(h('span', { class: 'sr-only', text: ` · ${t(d[2])}` })); return c; }));
}

function gateTable(reports) {
  const list = courses();
  const codes = list.length ? list.map((c) => c.code) : Object.keys(reports[0].courses || {});
  const byCode = new Map(list.map((c) => [c.code, c]));
  const cellChip = (s) => { const d = ST[s] || ST.not_started; return chip(t(d[2]), d[0], d[1]); };
  const today = todayVN();
  const dated = S.live || list; // the Sheet's dates when we have them
  const next = dated.filter((c) => c.checkpoint_close && c.checkpoint_close >= today).sort((a, b) => (a.checkpoint_close < b.checkpoint_close ? -1 : 1))[0];
  let nextLine = null;
  if (next) {
    const set = dated.filter((c) => c.checkpoint_close === next.checkpoint_close);
    const done = set.map((c) => reports.filter((r) => (r.courses || {})[c.code] === 'passed').length);
    nextLine = h('div', { class: 'callout info' }, icon('flag'),
      h('p', { class: 'small' }, h('b', { text: t('team.gs.next_gate', { codes: set.map((c) => c.code).join(' + '), date: fmtShortDate(next.checkpoint_close) }) }), ' ',
        set.map((c, i) => t('team.gs.next_count', { code: c.code, n: done[i], total: reports.length })).join(' · ')));
  }
  const blDone = reports.filter((r) => blAll(r)).length;
  // Phones: one card per report, statuses grouped (passed / not yet / not started) with course codes.
  const cards = h('ul', { class: 'gs-cards' }, reports.map((r) => h('li', { class: 'gs-card' },
    h('div', { class: 'stack sm' }, h('h3', { text: r.first_name || r.code }), blChips(r, true)),
    ['needs_chat', 'unlocked', 'not_yet', 'passed', 'not_started'].map((st) => {
      const list = codes.filter((code) => cellState(r, code) === st);
      if (!list.length) return null;
      return h('p', { class: 'gs-line' }, cellChip(st), list.map((code) => h('span', { class: `code-badge sm fam-${code.charAt(0)}`, title: byCode.has(code) ? pick(byCode.get(code), 'name') : code, text: code })));
    }))));
  return h('div', { class: 'card pad stack' },
    chatPanel(reports, byCode),
    nextLine,
    cards,
    h('div', { class: 'table-wrap status-wrap gs-table', role: 'region', tabindex: '0', 'aria-labelledby': 'gates-title' },
      h('table', { class: 'data status-table' },
        h('caption', { class: 'sr-only', text: t('team.gs.caption') }),
        h('thead', null, h('tr', null,
          h('th', { scope: 'col', class: 'sticky-col', text: t('team.gs.col_person') }),
          h('th', { scope: 'col', text: t('team.gs.col_baseline') }),
          codes.map((code) => h('th', { scope: 'col' }, h('abbr', { title: byCode.has(code) ? pick(byCode.get(code), 'name') : code, text: code }))))),
        h('tbody', null, reports.map((r) => h('tr', null,
          h('th', { scope: 'row', class: 'sticky-col', text: r.first_name || r.code }),
          h('td', null, blChips(r)),
          codes.map((code) => h('td', null, cellChip(cellState(r, code))))))),
        h('tfoot', null, h('tr', null,
          h('th', { scope: 'row', class: 'sticky-col', text: t('team.gs.total') }),
          h('td', { class: 'num', text: `${blDone}/${reports.length}` }),
          codes.map((code) => h('td', { class: 'num', text: `${reports.filter((r) => (r.courses || {})[code] === 'passed').length}/${reports.length}` })))))),
    h('p', { class: 'xs muted note-line' }, icon('lock', 'sm'), ' ', t('team.gs.note')));
}
