// path.html · My path: the 1% Planner model on one page, filled in with the person's own progress.
// 1. The model: four domains · 13 skills, the 2027 courses that build each one (with status), the
//    baseline part that measures it, how it is built beyond the videos, and IDP gaps once results open.
// 2. Where it leads: 2027 Build → 2028 Deepen → 2029 Lead & scale (direction only).
// 3. How every course runs: Learn → Prove → Apply → Do → Teach, and why (recall after 3 months).
// 4. Your year: baseline, the offline sessions (Sheet's Sessions tab), re-test, with "you are here".
// 5. How you grow: the four IDP goals and your two gaps.
// Charter names come from the private Sheet (me.charters); the demo shows "Charter 1–5".
import { mountShell, h, icon, chip, codeBadge, render, loading, errorState } from '../ui.js';
import { t, pick, getLang, onLangChange } from '../i18n.js';
import { api, isDemo, cachedMe, sameMe } from '../api.js';
import { loadCatalog, journey, programSessions, courseStatus, stepInfo, nextStep, fmtShortDate, fmtLongDate, todayVN } from '../courses.js';
import { DOMAINS, STAGES, RECALL, gapDomain } from '../model.js';
import { guideBox } from '../guide.js';

const { app } = await mountShell({ page: 'path' });
const S = { me: null, cat: null, courses: null, gaps: null, err: null };

onLangChange(() => draw());

function partState(me, n) {
  const p = (me && me.baseline && me.baseline.parts && me.baseline.parts[`p${n}`]) || {};
  if (p.status === 'submitted' || p.status === 'done') return { key: 'done', variant: 'pass', icon: 'check' };
  if (p.status === 'in_progress') return { key: 'in_progress', variant: 'info', icon: 'edit' };
  if (p.open) return { key: 'open', variant: 'info', icon: 'play' };
  return { key: 'not_open', variant: 'locked', icon: 'lock' };
}

function courseChip(c) {
  const st = courseStatus(c);
  const passed = c.checkpoint && c.checkpoint.status === 'passed';
  const info = stepInfo(c);
  const label = passed ? t('path.c_passed') : !c.open ? (c.online_from ? t('path.c_opens', { date: fmtShortDate(c.online_from) }) : t('status.locked'))
    : ['warn', 'bad'].includes(st.variant) || st.key === 'recall' ? st.label
    : info.all ? t('steps.meter_done', { total: info.total }) : t('steps.meter', { n: info.n, total: info.total, label: t(`steps.${info.key}`) });
  return h('li', null, h('a', { class: `dm-course fam-${c.family}${passed ? ' passed' : ''}${c.open ? '' : ' locked'}`, href: `course.html?c=${encodeURIComponent(c.code)}` },
    codeBadge(c.code),
    h('span', { class: 'dm-c-text' }, h('span', { class: 'dm-c-name', text: pick(c, 'name') }), h('span', { class: `dm-c-state ${st.variant}` }, icon(passed ? 'check-circle' : st.icon, 'sm'), label))));
}

function domainCard(d) {
  const me = S.me;
  const courses = (S.courses || []).filter((c) => d.courses.includes(c.code));
  const passedN = courses.filter((c) => c.checkpoint && c.checkpoint.status === 'passed').length;
  const ps = partState(me, d.part);
  const gaps = (S.gaps || []).filter((g) => gapDomain(g.area) === d.key);
  const charters = d.key === 'mind' ? charterNames() : [];
  return h('article', { class: `card dm-card tone-${d.tone}`, 'aria-labelledby': `dm-${d.key}`, 'data-domain': d.key },
    h('header', { class: 'dm-head' },
      h('span', { class: 'dm-icon', 'aria-hidden': 'true' }, icon(d.icon)),
      h('div', { class: 'stack sm grow' },
        h('p', { class: 'dm-domain', text: t(`model.d.${d.key}.name`) }),
        h('h3', { id: `dm-${d.key}`, text: t(`model.d.${d.key}.area`) })),
      courses.length ? h('span', { class: 'dm-count', title: t('path.passed_of', { n: passedN, total: courses.length }) },
        h('b', { text: String(passedN) }), h('span', { text: `/${courses.length}` }), h('span', { class: 'sr-only', text: ` ${t('path.passed_of', { n: passedN, total: courses.length })}` })) : null),
    h('ul', { class: 'skill-list', 'aria-label': t('path.skills_aria') }, d.skills.map((k) => h('li', { text: t(`model.skill.${k}`) }))),
    h('div', { class: 'dm-row' },
      h('p', { class: 'dm-label', text: t('path.built_by') }),
      courses.length ? h('ul', { class: 'dm-courses' }, courses.map(courseChip)) : h('p', { class: 'small', text: t('model.d.mind.no_course') })),
    charters.length ? h('div', { class: 'dm-row' },
      h('p', { class: 'dm-label', text: t('path.charters') }),
      h('ol', { class: 'charter-list' }, charters.map((c) => h('li', null, h('span', { class: 'ch-n', 'aria-hidden': 'true', text: String(c.n) }), h('span', { text: c.name }))))) : null,
    h('div', { class: 'dm-row' },
      h('p', { class: 'dm-label', text: t('path.beyond') }),
      h('p', { class: 'small', text: t(`model.d.${d.key}.built`) })),
    h('div', { class: 'dm-foot' },
      h('span', { class: 'small strong ink' }, icon('target', 'sm'), ' ', t('path.measured', { n: d.part })),
      chip(t(`path.part.${ps.key}`), ps.variant, ps.icon)),
    gaps.length ? h('a', { class: 'dm-gap', href: 'profile.html' }, icon('trend-up', 'sm'),
      h('span', null, h('b', { text: t('path.gap') }), ' ', gaps.map((g) => `${pick(g, 'name') || g.area}${typeof g.pct === 'number' ? ` (${Math.round(g.pct)}%)` : ''}`).join(' · ')),
      icon('chevron-right', 'sm')) : null);
}

function charterNames() {
  const live = (S.me && Array.isArray(S.me.charters)) ? S.me.charters : [];
  if (live.length) return live.map((c) => ({ n: c.n, name: (getLang() === 'vi' ? c.vi : c.en) || c.en || c.vi })).filter((c) => c.name);
  return [1, 2, 3, 4, 5].map((n) => ({ n, name: t('profile.charter_n', { n }) }));
}

function modelSection() {
  return h('section', { class: 'stack lg', 'aria-labelledby': 'model-h', id: 'model' },
    h('div', { class: 'section-head' }, h('div', { class: 'stack sm' }, h('h2', { id: 'model-h', text: t('path.model_title') }), h('p', { class: 'muted', text: t('path.model_sub') }))),
    h('div', { class: 'dm-grid' }, DOMAINS.map(domainCard)),
    h('ol', { class: 'years', 'aria-label': t('path.years_title') },
      ['y2027', 'y2028', 'y2029'].map((k, i) => h('li', { class: i === 0 ? 'now' : null },
        h('p', { class: 'yr-k', text: t(`path.${k}`) }), h('p', { class: 'small', text: t(`path.${k}_body`) })))),
    h('p', { class: 'xs muted', text: t('path.years_note') }));
}

function stagesSection() {
  return h('section', { class: 'stack lg', 'aria-labelledby': 'stages-h', id: 'stages' },
    h('div', { class: 'section-head' }, h('div', { class: 'stack sm' }, h('h2', { id: 'stages-h', text: t('path.stages_title') }), h('p', { class: 'muted', text: t('path.stages_sub') }))),
    h('ol', { class: 'stage-cards' }, STAGES.map((s, i) => h('li', { class: `stage-card ${s.online ? 'online' : 'offline'}` },
      h('p', { class: 'sc-when', text: t(`model.stage.${s.key}.when`) }),
      h('h3', null, h('span', { class: 'sc-n', 'aria-hidden': 'true', text: String(i + 1) }), t(`steps.${s.key}`)),
      h('p', { class: 'sc-where', text: t(`model.stage.${s.key}.where`) }),
      h('p', { class: 'small', text: t(`model.stage.${s.key}.what`) }),
      h('p', { class: 'sc-hub small' }, icon(s.online ? 'check-circle' : 'info', 'sm'), h('span', { text: t(`model.stage.${s.key}.hub`) })),
      h('p', { class: 'sc-time' }, icon('clock', 'sm'), h('span', { text: t(`model.stage.${s.key}.time`) }))))),
    h('div', { class: 'card pad stack recall-card' },
      h('h3', { class: 'title-sm', text: t('path.recall_title') }),
      h('ol', { class: 'recall-bars' }, RECALL.map((r) => h('li', { class: `lv${r.level}` },
        h('span', { class: 'rb-v', text: r.value || t('path.recall.test_v') }),
        h('span', { class: 'rb-k small', text: t(`path.recall.${r.key}`) })))),
      h('p', { class: 'xs muted', text: t('path.recall_src') })),
    h('div', { class: 'grid cols-2 load-grid' },
      h('p', { class: 'load-line' }, icon('clock', 'sm'), h('span', { text: t('path.load') })),
      h('p', { class: 'load-line' }, icon('refresh', 'sm'), h('span', { text: t('path.between') }))),
    h('p', { class: 'xs muted', text: t('path.legend') }));
}

function yearSection() {
  const cat = S.cat || {}; const prog = cat.program || {};
  const today = todayVN();
  const items = [];
  // Demo: the mock moves the calendar; move the baseline and re-test with it so the year reads in order.
  let shift = 0;
  const live = programSessions(S.me, cat); const base = programSessions(null, cat);
  if (isDemo() && live.length && base.length) shift = Math.round((Date.parse(`${live[0].date}T12:00:00Z`) - Date.parse(`${base[0].date}T12:00:00Z`)) / 86400000);
  const mv = (d) => (shift && d ? new Date(Date.parse(`${d}T12:00:00Z`) + shift * 86400000).toISOString().slice(0, 10) : d);
  if (prog.baseline) items.push({ date: mv(prog.baseline.open_from), end: mv(prog.baseline.open_to), kind: 'baseline', title: t('path.yr_baseline') });
  live.forEach((x) => items.push({ date: x.date, kind: x.kind, title: pick(x, 'title'), codes: x.courses, when: [x.start && x.end ? `${x.start}–${x.end}` : x.start, x.place].filter(Boolean).join(' · ') }));
  if (prog.retest) items.push({ date: mv(prog.retest.open_from), end: mv(prog.retest.open_to), kind: 'retest', title: t('path.yr_retest') });
  items.sort((a, b) => (a.date < b.date ? -1 : 1));
  const hereIdx = items.findIndex((x) => (x.end || x.date) >= today);
  const list = [];
  items.forEach((x, i) => {
    if (i === hereIdx) list.push(h('li', { class: 'yr-here', 'aria-label': t('path.here_aria', { date: fmtLongDate(today) }) }, h('span', { class: 'yr-dot', 'aria-hidden': 'true' }), h('span', { class: 'xs strong', text: t('path.here') })));
    const past = (x.end || x.date) < today;
    list.push(h('li', { class: `yr-item k-${x.kind}${past ? ' past' : ''}` },
      h('span', { class: 'yr-dot', 'aria-hidden': 'true' }, past ? icon('check', 'sm') : null),
      h('span', { class: 'yr-date', text: x.end ? `${fmtShortDate(x.date)} – ${fmtShortDate(x.end)}` : fmtShortDate(x.date) }),
      h('span', { class: 'yr-body' },
        h('span', { class: 'yr-kind xs', text: t(`path.kind.${x.kind}`) }),
        h('span', { class: 'yr-title strong ink', text: x.title || t(`path.kind.${x.kind}`) }),
        x.codes && x.codes.length ? h('span', { class: 'xs muted', text: x.codes.join(' + ') }) : null,
        x.when ? h('span', { class: 'xs muted' }, icon('clock', 'sm'), ' ', x.when) : null),
      past ? h('span', { class: 'sr-only', text: t('course.kd.past') }) : null));
  });
  if (hereIdx < 0) list.push(h('li', { class: 'yr-here' }, h('span', { class: 'yr-dot', 'aria-hidden': 'true' }), h('span', { class: 'xs strong', text: t('path.here') })));
  return h('section', { class: 'stack lg', 'aria-labelledby': 'year-h', id: 'year' },
    h('div', { class: 'section-head' }, h('div', { class: 'stack sm' }, h('h2', { id: 'year-h', text: t('path.year_title') }), h('p', { class: 'muted', text: t('path.year_sub') }))),
    h('div', { class: 'card pad' }, h('ol', { class: 'yr-list' }, list)));
}

function growSection() {
  const b = (S.me && S.me.baseline) || {};
  const gaps = S.gaps || [];
  return h('section', { class: 'stack lg', 'aria-labelledby': 'grow-h', id: 'grow' },
    h('div', { class: 'section-head' }, h('div', { class: 'stack sm' }, h('h2', { id: 'grow-h', text: t('path.grow_title') }), h('p', { class: 'muted', text: t('path.grow_sub') }))),
    h('ol', { class: 'goal-cards' }, ['business', 'capability', 'application'].map((k) => h('li', { class: 'card pad stack sm' },
      h('p', { class: 'goal-n' }, h('b', { text: t(`path.goal.${k}_n`) }), ' ', t(`path.goal.${k}_k`)),
      h('p', { class: 'small', text: t(`path.goal.${k}`) }),
      k === 'capability' ? (gaps.length
        ? h('ul', { class: 'goal-gaps' }, gaps.slice(0, 2).map((g) => h('li', null, icon('target', 'sm'), h('span', { text: `${pick(g, 'name') || g.area}${typeof g.pct === 'number' ? ` · ${Math.round(g.pct)}%` : ''}` }))))
        : S.gaps === null && b.results_open && b.profile_ready ? null // the profile is on its way
          : h('p', { class: 'xs muted', text: t(b.results_open ? 'path.gaps_wait_profile' : 'path.gaps_wait') })) : null))),
    gaps.length ? h('a', { class: 'btn btn-secondary', href: 'profile.html' }, t('path.see_profile'), icon('arrow-right')) : null);
}

function guide() {
  const ns = S.me && S.courses ? nextStep(S.me, S.courses) : null;
  const today = todayVN();
  const nx = programSessions(S.me, S.cat).find((x) => x.date >= today);
  return guideBox({
    id: 'path', tour: null,
    page: t('guide.path.page'),
    now: ns ? `${ns.title}${ns.body ? ` · ${ns.body}` : ''}` : '',
    next: nx ? t('guide.next_session', { title: pick(nx, 'title') || t(`path.kind.${nx.kind}`), date: fmtLongDate(nx.date) }) : '',
  });
}

function draw() {
  if (S.err && !S.me) { render(app, h('div', { class: 'stack lg' }, h('h1', { text: t('path.title') }), errorState(S.err, () => load()))); return; }
  if (!S.me) { render(app, loading()); return; }
  render(app, h('div', { class: 'path-page stack xl' },
    h('header', { class: 'page-head stack sm' },
      h('p', { class: 'eyebrow', text: t('path.eyebrow') }),
      h('h1', { text: t('path.title') }),
      h('p', { class: 'lead muted', text: t('path.lead') })),
    guide(),
    modelSection(),
    stagesSection(),
    yearSection(),
    growSection()));
}

let gapsAsked = false;
/** IDP gaps (optional here): asked once, as soon as a `me` says the profile is ready. */
function loadGaps() {
  const b = S.me && S.me.baseline;
  if (gapsAsked || !(b && b.results_open && b.profile_ready)) return;
  gapsAsked = true;
  api.profile().then((p) => { S.gaps = (p && p.gaps) || []; }).catch(() => { S.gaps = []; }).then(() => draw());
}

async function load() {
  S.err = null;
  // The last `me` of this tab draws the page at once; the fresh one replaces it when it differs.
  const cached = cachedMe();
  let shown = null;
  if (cached) {
    try { S.cat = await loadCatalog(); S.courses = await journey(cached); S.me = cached; shown = cached; } catch (e) { S.me = null; }
  }
  if (shown) { draw(); loadGaps(); } else render(app, loading());
  try {
    const [me, cat] = await Promise.all([api.me(), loadCatalog()]);
    if (shown && sameMe(me, shown)) return;
    S.cat = cat; S.courses = await journey(me); S.me = me;
  } catch (e) { if (shown) return; S.err = e; }
  draw();
  loadGaps();
}

load();
