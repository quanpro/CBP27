// course.html?c=CODE · one course: hero, journey stepper, Blink player + episode list,
// objectives, forum, field assignment; side: checkpoint, predict, recall, key dates.
import { h, render, icon, chip, codeBadge, ring, emptyState, errorState, errorMessage, toast, mountShell, qs } from '../ui.js';
import { t, pick, getLang, onLangChange } from '../i18n.js';
import { api, serverNow } from '../api.js';
import { loadCatalog, journey, courseStatus, courseProgress, courseSteps, familyClass, fmtShortDate, fmtLongDate, fmtDateTime, daysUntil, todayVN } from '../courses.js';

const TZ = 'Asia/Ho_Chi_Minh';
const EMBED_TIMEOUT_MS = 8000;
const RUBRIC = ['applied', 'method', 'evidence', 'explained'];

const S = {
  app: null, code: '', course: null, catalog: null, me: null, error: null,
  sel: null, embedFailed: new Set(), pending: new Set(), els: null, rows: new Map(),
  player: { ep: null, iframe: false, timer: null },
};

// ---------- helpers ----------
const loc = () => (getLang() === 'vi' ? 'vi-VN' : 'en-GB');
const pct = (x) => `${Math.round(Number(x) || 0)}%`;
const toDate = (v) => (v ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00+07:00` : v) : null);
function part(v, o) { const d = toDate(v); return d ? new Intl.DateTimeFormat(loc(), { timeZone: TZ, ...o }).format(d) : ''; }
function fmtRange(a, b) {
  if (!a || !b) return fmtShortDate(a || b);
  const vi = getLang() === 'vi';
  const dm = (v) => part(v, vi ? { day: 'numeric', month: 'numeric' } : { day: 'numeric', month: 'short' });
  return a.slice(0, 7) === b.slice(0, 7) ? `${part(a, { day: 'numeric' })}–${dm(b)}` : `${dm(a)} – ${dm(b)}`;
}
function relDay(date) {
  const n = daysUntil(date);
  if (n === null) return '';
  if (n < 0) return t('common.days_ago', { n: -n });
  if (n === 0) return t('common.today');
  if (n === 1) return t('common.tomorrow');
  return t('common.in_days', { n });
}
const quizHref = (type, extra = '') => `quiz.html?type=${type}&c=${encodeURIComponent(S.code)}${extra}`;
const epLabel = (e) => (e.trailer ? t('course.trailer') : t('course.ep_n', { n: e.ep }));
const epTitle = (e) => (e.trailer ? t('course.trailer_title') : pick(e, 'title'));
const lessons = () => S.course.episodes.filter((e) => !e.trailer);
function announce(msg) { if (S.els) { S.els.live.textContent = ''; setTimeout(() => { S.els.live.textContent = msg; }, 30); } }
function tile(ic, cls = '') { return h('span', { class: `tile-icon ${cls}`.trim() }, icon(ic)); }

// ---------- boot ----------
(async function main() {
  const { app } = await mountShell({ page: 'home' });
  S.app = app;
  S.code = String(qs('c') || '').trim().toUpperCase();
  onLangChange(() => renderAll(true));
  try { S.catalog = await loadCatalog(); } catch (e) { S.error = e; }
  if (S.error) return renderError();
  const known = S.catalog.courses.some((c) => c.code === S.code);
  if (!known) return renderUnknown();
  render(app, skeletonView());
  load();
}());

async function load() {
  S.error = null;
  try {
    S.me = await api.me();
    const list = await journey(S.me);
    S.course = list.find((c) => c.code === S.code);
    if (!S.course) throw Object.assign(new Error('not_found'), { code: 'not_found' });
  } catch (ex) { S.error = ex; return renderError(); }
  const firstUnwatched = S.course.episodes.find((e) => !e.watched);
  S.sel = (firstUnwatched || S.course.episodes[0] || { ep: null }).ep;
  buildLayout();
  renderAll(false);
  document.title = `${S.code} · ${pick(S.course, 'name')} · ${t('brand.name')}`;
  if (location.hash === '#episodes') requestAnimationFrame(() => S.els.player.scrollIntoView({ block: 'start' }));
}

function renderUnknown() {
  render(S.app, h('div', { class: 'card course-missing' }, emptyState({
    iconName: 'book', title: t('course.unknown_title'), body: t('course.unknown_body', { code: S.code || '—' }),
    action: h('a', { class: 'btn btn-primary', href: 'index.html' }, icon('chevron-left'), t('course.back_home')),
  })));
}
function renderError() {
  render(S.app, h('div', { class: 'stack lg' }, backLink(), h('h1', { text: t('course.error_title') }), errorState(S.error, () => { render(S.app, skeletonView()); load(); })));
}
function skeletonView() {
  const sk = (hgt, cls = '') => { const el = h('div', { class: `skeleton ${cls}` }); el.style.height = hgt; return el; };
  return h('div', { class: 'stack lg', 'aria-busy': 'true' },
    h('span', { class: 'sr-only', role: 'status', text: t('common.loading') }),
    h('div', { class: 'stack lg', 'aria-hidden': 'true' }, sk('18px', 'w-20'), sk('230px', 'sk-hero'), sk('86px', 'sk-tile'),
      h('div', { class: 'layout-side' }, h('div', { class: 'stack' }, sk('320px', 'sk-hero'), sk('260px', 'sk-tile')), h('div', { class: 'stack' }, sk('240px', 'sk-tile'), sk('140px', 'sk-tile')))));
}
function backLink() {
  return h('a', { class: 'back-link', href: 'index.html' }, icon('chevron-left', 'sm'), t('course.back_home'));
}

function buildLayout() {
  const fam = familyClass(S.code);
  S.els = {
    back: backLink(),
    hero: h('section', { class: `hero fam-hero course-hero ${fam}`, 'aria-labelledby': 'course-title' }),
    steps: h('section', { class: 'card steps-card', 'aria-labelledby': 'steps-title' }),
    player: h('section', { id: 'episodes', class: `stack player-sec ${fam}`, 'aria-labelledby': 'player-title' }),
    eps: h('section', { class: 'card eps-card', 'aria-labelledby': 'eps-title' }),
    about: h('section', { class: `card pad stack about-card ${fam}`, 'aria-labelledby': 'about-title' }),
    forum: h('section', { class: 'card pad stack', 'aria-labelledby': 'forum-title' }),
    field: h('section', { class: 'card pad stack', 'aria-labelledby': 'field-title' }),
    cp: h('section', { class: 'card cp-card', 'aria-labelledby': 'cp-title' }),
    predict: h('section', { class: 'card pad stack', 'aria-labelledby': 'pr-title' }),
    recall: h('section', { class: 'card pad stack', 'aria-labelledby': 'rc-title' }),
    dates: h('section', { class: 'card pad stack', 'aria-labelledby': 'kd-title' }),
    live: h('p', { class: 'sr-only', 'aria-live': 'polite', role: 'status' }),
  };
  const E = S.els;
  render(S.app, h('div', { class: 'stack lg course-page' },
    E.back, E.hero, E.steps,
    h('div', { class: 'layout-side' },
      h('div', { class: 'stack lg course-main' }, E.player, E.eps, E.about, E.forum, E.field),
      h('aside', { class: 'side stack course-side', 'aria-label': t('course.side_aria') }, E.cp, E.predict, E.recall, E.dates)),
    E.live));
}

function renderAll(langChange) {
  if (!S.els) {
    if (S.error) renderError(); else if (S.code && S.catalog && !S.catalog.courses.some((c) => c.code === S.code)) renderUnknown();
    return;
  }
  const back = backLink();
  S.els.back.replaceWith(back);
  S.els.back = back;
  renderHero(); renderSteps(); renderPlayer(!langChange); renderEpisodes(); renderAbout(); renderForum(); renderField();
  renderCheckpoint(); renderPredict(); renderRecall(); renderDates();
  if (S.course) document.title = `${S.code} · ${pick(S.course, 'name')} · ${t('brand.name')}`;
}

// ---------- hero + stepper ----------
function renderHero() {
  const c = S.course; const st = courseStatus(c); const p = courseProgress(c);
  let cta = st.cta;
  if (cta && cta.href.startsWith('course.html')) cta = { label: cta.label, href: '#episodes' };
  if (!cta && c.open && st.key !== 'passed') cta = { label: t('cta.watch'), href: '#episodes' };
  if (!cta && st.key === 'passed' && c.checkpoint.last_attempt_id) cta = { label: t('course.cp.review'), href: quizHref('checkpoint', `&review=${encodeURIComponent(c.checkpoint.last_attempt_id)}`) };
  const blink = c.blink_url ? h('a', { class: 'btn btn-outline-light btn-lg', href: c.blink_url, target: '_blank', rel: 'noopener' }, icon('external'), t('course.playlist')) : null;
  render(S.els.hero, h('div', { class: 'pad' },
    h('div', { class: 'course-hero-grid' },
      h('div', { class: 'stack' },
        h('div', { class: 'row tight' }, codeBadge(c.code), h('span', { class: 'eyebrow', text: t(`family.${c.family}`) })),
        h('h1', { id: 'course-title', text: pick(c, 'name') }),
        h('p', { class: 'sub hero-promise', text: pick(c, 'promise') }),
        h('div', { class: 'row tight hero-chips' },
          chip(t('course.cycle', { n: c.cycle }), '', 'grid'),
          c.online_from ? chip(t('course.online', { range: fmtRange(c.online_from, c.online_to) }), '', 'video') : null,
          c.forum_date ? chip(t('course.forum_chip', { date: fmtShortDate(c.forum_date) }), '', 'users') : null,
          chip(st.label, `st ${st.variant}`, st.icon)),
        cta || blink ? h('div', { class: 'row hero-ctas' }, cta ? h('a', { class: 'btn btn-light btn-lg', href: cta.href }, cta.label, icon('arrow-right')) : null, blink) : null),
      h('div', { class: 'hero-aside' }, ring(p.pct, { size: 104, stroke: 9, ariaLabel: t('course.progress_aria', { pct: p.pct }) }), h('span', { class: 'small', text: t('course.progress_label') })))));
}

function renderSteps() {
  const c = S.course; const p = courseProgress(c); const cp = c.checkpoint || {};
  const sub = {
    predict: c.predict && c.predict.done ? t('course.steps.done') : t('course.steps.q3'),
    watch: t('common.of', { n: p.watched, total: p.total }),
    checkpoint: cp.status === 'passed' ? pct(cp.best_pct) : (c.checkpoint_close ? fmtShortDate(c.checkpoint_close) : ''),
    forum: fmtShortDate(c.forum_date),
    field: c.field_until ? t('course.steps.until', { date: fmtShortDate(c.field_until) }) : '',
    recall: t('common.of', { n: p.recallDone, total: 3 }),
  };
  render(S.els.steps,
    h('h2', { id: 'steps-title', class: 'sr-only', text: t('course.steps.title') }),
    h('ol', { class: 'steps' }, courseSteps(c).map((s, i) => h('li', { class: s.state, 'aria-current': s.state === 'current' ? 'step' : null },
      h('span', { class: 'dot', 'aria-hidden': 'true' }, s.done ? icon('check') : String(i + 1)),
      h('span', { class: 'lbl', text: t(`steps.${s.key}`) }),
      sub[s.key] ? h('span', { class: 'step-sub', text: sub[s.key] }) : null,
      h('span', { class: 'sr-only', text: ` · ${t(`course.steps.state_${s.state}`)}` })))));
}

// ---------- player ----------
function selected() { return S.course.episodes.find((e) => e.ep === S.sel) || S.course.episodes[0]; }
function selectEp(ep, scroll) {
  if (S.sel === ep) { if (scroll) S.els.player.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
  S.sel = ep;
  renderPlayer(true);
  S.rows.forEach((r, k) => { r.li.setAttribute('aria-current', String(k === ep)); r.open.setAttribute('aria-current', k === ep ? 'true' : 'false'); });
  if (scroll) S.els.player.scrollIntoView({ block: 'start', behavior: 'smooth' });
  const e = selected();
  announce(t('course.now_showing', { label: epLabel(e), title: epTitle(e) }));
}

function posterEl(e, failed) {
  const c = S.course;
  const url = e.blink_url || c.blink_url || '';
  const kicker = h('p', { class: 'poster-kicker' }, epLabel(e), e.minutes ? ` · ${t('common.minutes', { n: e.minutes })}` : '');
  let action;
  if (!c.open) {
    action = h('div', { class: 'poster-actions' }, h('span', { class: 'play-btn is-off', 'aria-hidden': 'true' }, icon('lock')),
      h('p', { class: 'poster-note', text: t('course.player.locked', { date: fmtLongDate(c.online_from) }) }));
  } else if (url) {
    action = h('div', { class: 'poster-actions' },
      h('a', { class: 'play-btn', href: url, target: '_blank', rel: 'noopener', 'aria-label': t('course.player.watch_aria', { label: epLabel(e), title: epTitle(e) }) }, icon('play')),
      h('a', { class: 'btn btn-light btn-sm', href: url, target: '_blank', rel: 'noopener', tabindex: '-1', 'aria-hidden': 'true' }, t('course.player.watch'), icon('external', 'sm')));
  } else {
    action = h('div', { class: 'poster-actions' },
      h('span', { class: 'play-btn is-off', 'aria-hidden': 'true' }, icon('play')),
      h('button', { class: 'btn btn-light btn-sm', type: 'button', disabled: true }, t('course.player.soon')),
      h('p', { class: 'poster-note', text: t('course.player.soon_note') }));
  }
  return h('div', { class: 'poster' },
    kicker,
    h('h3', { text: epTitle(e) }),
    failed ? h('p', { class: 'poster-note', text: t('course.player.embed_failed') }) : null,
    action);
}

function renderPlayer(force) {
  const e = selected();
  const E = S.els;
  if (!e) { render(E.player, emptyState({ iconName: 'video', title: t('course.player.none') })); return; }
  const canEmbed = S.course.open && e.embed_url && /^https:\/\//i.test(e.embed_url) && !S.embedFailed.has(e.ep);
  const keepFrame = !force && S.player.iframe && S.player.ep === e.ep && canEmbed && E.player.querySelector('iframe');
  let stage;
  if (keepFrame) stage = E.player.querySelector('.player');
  else {
    clearTimeout(S.player.timer);
    stage = h('div', { class: 'player' });
    if (canEmbed) {
      const fr = h('iframe', { src: e.embed_url, title: t('course.player.iframe_title', { label: epLabel(e), title: epTitle(e) }), allow: 'fullscreen; picture-in-picture', allowfullscreen: true, referrerpolicy: 'no-referrer' });
      let loaded = false;
      fr.addEventListener('load', () => { loaded = true; clearTimeout(S.player.timer); });
      S.player.timer = setTimeout(() => { if (!loaded && S.sel === e.ep) { S.embedFailed.add(e.ep); renderPlayer(true); } }, EMBED_TIMEOUT_MS);
      stage.append(fr);
    } else {
      stage.append(posterEl(e, S.embedFailed.has(e.ep)));
    }
    S.player = { ep: e.ep, iframe: !!canEmbed, timer: S.player.timer };
  }
  const lessonList = lessons();
  const idx = S.course.episodes.indexOf(e);
  const next = S.course.episodes[idx + 1];
  const watchBtn = h('button', { class: `btn btn-sm ${e.watched ? 'btn-success' : 'btn-secondary'} watch-toggle`, type: 'button', 'aria-pressed': String(!!e.watched), disabled: !S.course.open || S.pending.has(e.ep) },
    icon(e.watched ? 'check-circle' : 'circle'), t(e.watched ? 'course.player.watched' : 'course.player.mark'));
  watchBtn.addEventListener('click', () => toggleWatched(e.ep));
  const nextBtn = next ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => selectEp(next.ep, false) }, t('course.player.next'), icon('arrow-right')) : null;
  const meta = h('div', { class: 'player-meta' },
    h('div', { class: 'stack sm' },
      h('p', { class: 'eyebrow', text: `${epLabel(e)}${!e.trailer && lessonList.length ? ` / ${lessonList.length}` : ''}${e.minutes ? ` · ${t('common.minutes', { n: e.minutes })}` : ''}` }),
      h('h2', { id: 'player-title', text: epTitle(e) }),
      pick(e, 'ideas') ? h('p', { class: 'muted', text: pick(e, 'ideas') }) : null,
      pick(e, 'try') ? h('p', { class: 'try-line' }, icon('zap', 'sm'), h('span', null, h('b', { text: `${t('course.player.try')} ` }), pick(e, 'try'))) : null),
    h('div', { class: 'row player-actions' }, watchBtn, nextBtn));
  render(E.player, stage, meta);
}

// ---------- episode list ----------
function renderEpisodes() {
  const E = S.els; const c = S.course; const p = courseProgress(c);
  S.rows = new Map();
  const list = h('ul', { class: 'ep-list' }, c.episodes.map((e) => {
    const open = h('button', { class: 'ep-open', type: 'button', 'aria-current': e.ep === S.sel ? 'true' : 'false', onclick: () => selectEp(e.ep, true) },
      h('span', { class: 'ep-title' }, h('span', { class: 'sr-only', text: `${epLabel(e)}: ` }), epTitle(e)),
      h('span', { class: 'ep-sub' }, h('span', { class: 'ep-ideas', text: e.trailer ? t('course.trailer_sub') : pick(e, 'ideas') }), e.minutes ? h('span', { class: 'ep-min', text: t('common.minutes', { n: e.minutes }) }) : null));
    const tick = h('button', { class: 'tick', type: 'button', 'aria-pressed': String(!!e.watched), 'aria-label': t('course.eps.tick_aria', { label: epLabel(e), title: epTitle(e) }), title: t('course.eps.tick_title'), disabled: !c.open },
      icon(e.watched ? 'check-circle' : 'circle'));
    tick.addEventListener('click', () => toggleWatched(e.ep));
    const li = h('li', { class: `ep${e.watched ? ' watched' : ''}${e.trailer ? ' trailer' : ''}`, 'aria-current': String(e.ep === S.sel) },
      h('span', { class: 'ep-num', 'aria-hidden': 'true' }, e.watched ? icon('check', 'sm') : e.trailer ? icon('play', 'sm') : String(e.ep)), open, tick);
    S.rows.set(e.ep, { li, tick, open });
    return li;
  }));
  render(E.eps,
    h('div', { class: 'card-head eps-head' },
      h('div', { class: 'grow' }, h('h2', { id: 'eps-title', class: 'h3', text: t('course.eps.title') }),
        h('p', { class: 'small muted', text: t('course.eps.count', { n: p.watched, total: p.total }) })),
      ring(p.total ? (100 * p.watched) / p.total : 0, { size: 44, stroke: 5, label: `${p.watched}/${p.total}`, ariaLabel: t('course.eps.count', { n: p.watched, total: p.total }) })),
    h('div', { class: 'eps-body' }, list,
      h('p', { class: 'xs muted eps-note' }, icon('info', 'sm'), ' ', t('course.eps.note'))));
}

function updateWatchUI() {
  S.course.episodes.forEach((e) => {
    const r = S.rows.get(e.ep); if (!r) return;
    r.li.classList.toggle('watched', !!e.watched);
    r.tick.setAttribute('aria-pressed', String(!!e.watched));
    r.tick.replaceChildren(icon(e.watched ? 'check-circle' : 'circle'));
    r.tick.toggleAttribute('aria-busy', S.pending.has(e.ep));
    r.li.querySelector('.ep-num').replaceChildren(e.watched ? icon('check', 'sm') : e.trailer ? icon('play', 'sm') : String(e.ep));
  });
  const p = courseProgress(S.course);
  const head = S.els.eps.querySelector('.eps-head');
  if (head) {
    head.querySelector('p').textContent = t('course.eps.count', { n: p.watched, total: p.total });
    head.querySelector('.ring').replaceWith(ring(p.total ? (100 * p.watched) / p.total : 0, { size: 44, stroke: 5, label: `${p.watched}/${p.total}`, ariaLabel: t('course.eps.count', { n: p.watched, total: p.total }) }));
  }
  const focusedWatch = document.activeElement && document.activeElement.classList.contains('watch-toggle');
  renderPlayer(false);
  if (focusedWatch) { const b = S.els.player.querySelector('.watch-toggle'); if (b) b.focus({ preventScroll: true }); }
  renderHero(); renderSteps(); renderCheckpoint();
}

async function toggleWatched(ep) {
  const e = S.course.episodes.find((x) => x.ep === ep);
  if (!e || S.pending.has(ep) || !S.course.open) return;
  const want = !e.watched;
  e.watched = want; // optimistic
  S.pending.add(ep);
  updateWatchUI();
  try {
    const res = await api.watch(S.code, ep, want);
    if (res && Array.isArray(res.watched)) {
      const set = new Set(res.watched.map(Number));
      S.course.episodes.forEach((x) => { x.watched = set.has(Number(x.ep)); });
    }
    announce(t(want ? 'course.eps.marked' : 'course.eps.unmarked', { label: epLabel(e) }));
    const p = courseProgress(S.course);
    if (want && p.total && p.watched === p.total && !e.trailer) toast(t('course.eps.all_done'), 'ok');
  } catch (ex) {
    e.watched = !want; // revert
    toast(`${t('course.eps.save_failed')} ${errorMessage(ex)}`, 'bad');
  } finally {
    S.pending.delete(ep);
    updateWatchUI();
  }
}

// ---------- about, forum, field ----------
function renderAbout() {
  const c = S.course;
  const byEp = new Map(c.episodes.map((e) => [Number(e.ep), e]));
  render(S.els.about,
    h('h2', { id: 'about-title', text: t('course.about.title') }),
    h('div', { class: 'stack sm' }, h('h3', { text: t('course.about.problem') }), h('p', { text: pick(c, 'problem') })),
    h('div', { class: 'stack' }, h('h3', { text: t('course.about.can') }),
      h('ol', { class: 'obj-list' }, (c.objectives || []).map((o) => h('li', null,
        h('div', { class: 'stack sm' },
          h('span', { class: 'ink', text: getLang() === 'vi' ? (o.vi || o.en) : o.en }),
          (o.episodes || []).length ? h('div', { class: 'row tight obj-eps' },
            h('span', { class: 'xs muted', text: t('course.about.taught_in') }),
            o.episodes.map((n) => {
              const e = byEp.get(Number(n));
              return h('button', { class: 'chip ep-chip', type: 'button', 'aria-label': t('course.about.ep_chip_aria', { n, title: e ? epTitle(e) : '' }), onclick: () => selectEp(Number(n), true) }, icon('play'), t('course.ep_short', { n }));
            })) : null))))),
    h('div', { class: 'grid cols-2 about-meta' },
      h('div', { class: 'stack sm' }, h('h3', null, icon('target', 'sm'), ' ', t('course.about.used_at')), h('p', { class: 'small', text: pick(c, 'used_at') })),
      pick(c, 'kpi') ? h('div', { class: 'stack sm' }, h('h3', null, icon('trend-up', 'sm'), ' ', t('course.about.kpi')), h('p', { class: 'small', text: pick(c, 'kpi') })) : null));
}

function renderForum() {
  const c = S.course; const f = c.forum || {};
  const passed = c.checkpoint && c.checkpoint.status === 'passed';
  const today = todayVN();
  const upcoming = c.forum_date && c.forum_date >= today;
  render(S.els.forum,
    h('div', { class: 'row top' }, tile('users'), h('div', { class: 'grow stack sm' },
      h('p', { class: 'eyebrow', text: t('course.forum.eyebrow') }),
      h('h2', { id: 'forum-title', class: 'h3', text: pick(f, 'title') || t('course.forum.eyebrow') }),
      c.forum_date ? h('p', { class: 'strong ink' }, fmtLongDate(c.forum_date), h('span', { class: 'muted small', text: upcoming ? ` · ${relDay(c.forum_date)}` : '' })) : null)),
    h('p', { class: 'small muted', text: t(c.code === 'C1' ? 'course.forum.format_pitch' : 'course.forum.format') }),
    pick(f, 'summary') ? h('p', { text: pick(f, 'summary') }) : null,
    upcoming && !passed ? h('div', { class: 'callout info' }, icon('info'), h('p', { class: 'small', text: t('course.forum.gate', { date: fmtShortDate(c.checkpoint_close) }) })) : null);
}

function renderField() {
  const c = S.course; const f = c.field || {};
  render(S.els.field,
    h('div', { class: 'row top' }, tile('edit'), h('div', { class: 'grow stack sm' },
      h('p', { class: 'eyebrow', text: t('course.field.eyebrow') }),
      h('h2', { id: 'field-title', class: 'h3', text: t('course.field.title') }),
      c.field_until ? h('p', { class: 'small muted', text: t('course.field.until', { date: fmtLongDate(c.field_until) }) }) : null)),
    h('dl', { class: 'kv' },
      h('dt', { text: t('course.field.task') }), h('dd', { text: getLang() === 'vi' ? (f.vi || f.en || '') : (f.en || '') }),
      pick(f, 'evidence') ? [h('dt', { text: t('course.field.evidence') }), h('dd', { text: pick(f, 'evidence') })] : null,
      pick(c, 'kpi') ? [h('dt', { text: t('course.field.kpi') }), h('dd', { text: pick(c, 'kpi') })] : null),
    h('div', { class: 'panel stack sm' },
      h('p', { class: 'strong ink' }, icon('check-circle', 'sm'), ' ', t('course.field.signoff')),
      h('ul', { class: 'rubric-mini' }, RUBRIC.map((k) => h('li', null, h('b', { text: t(`course.rubric.${k}`) }), h('span', { text: t(`course.rubric.${k}_meets`) })))),
      h('p', { class: 'xs muted', text: t('course.field.signoff_note') })));
}

// ---------- side: checkpoint, predict, recall, key dates ----------
function gateMeter(best, passed) {
  const b = Math.max(0, Math.min(100, Number(best) || 0));
  const fill = h('i'); fill.style.width = `${b}%`;
  return h('div', { class: `gate${passed ? ' passed' : ''}` },
    h('div', { class: 'gate-track', role: 'img', 'aria-label': t('course.cp.meter_aria', { pct: b }) }, fill, h('b', { class: 'gate-mark' })),
    h('div', { class: 'gate-scale', 'aria-hidden': 'true' }, h('span', { text: t('course.cp.best', { pct: pct(b) }) }), h('span', { class: 'gate-pass', text: t('course.cp.pass_mark') })));
}
function rulesList(c) {
  return h('ul', { class: 'rules' },
    h('li', null, icon('list', 'sm'), h('span', { text: t('course.cp.rule_items') })),
    h('li', null, icon('refresh', 'sm'), h('span', { text: t('course.cp.rule_retake') })),
    h('li', null, icon('users', 'sm'), h('span', { text: t('course.cp.rule_third') })),
    c.checkpoint_close ? h('li', null, icon('calendar', 'sm'), h('span', { text: t('course.cp.rule_close', { date: fmtShortDate(c.checkpoint_close) }) })) : null);
}
function renderCheckpoint() {
  const c = S.course; const cp = c.checkpoint || {}; const p = courseProgress(c);
  const reviewHref = cp.last_attempt_id ? quizHref('checkpoint', `&review=${encodeURIComponent(cp.last_attempt_id)}`) : null;
  let stateChip; let body;
  const btn = (label, href, cls = 'btn-primary') => h('a', { class: `btn ${cls} btn-block`, href }, label, icon('arrow-right'));
  if (!c.open) {
    stateChip = chip(t('status.locked'), 'locked', 'lock');
    body = [h('p', { class: 'small muted', text: t('course.cp.locked', { date: fmtShortDate(c.online_from) }) }), rulesList(c)];
  } else if (cp.status === 'passed') {
    stateChip = chip(t('status.passed'), 'pass', 'check');
    body = [gateMeter(cp.best_pct, true),
      h('p', { class: 'small' }, t('course.cp.passed_on', { date: fmtShortDate(cp.passed_at) }), cp.attempts ? ` · ${t('course.cp.attempts', { count: cp.attempts })}` : ''),
      c.forum_date && c.forum_date >= todayVN() ? h('p', { class: 'small muted', text: t('course.cp.see_you', { date: fmtLongDate(c.forum_date) }) }) : null,
      reviewHref ? btn(t('course.cp.review'), reviewHref, 'btn-secondary') : null];
  } else if (cp.gate_closed) {
    stateChip = chip(t('status.closed'), 'bad', 'alert');
    body = [cp.best_pct !== null && cp.best_pct !== undefined ? gateMeter(cp.best_pct, false) : null,
      h('div', { class: 'callout bad' }, icon('alert'), h('p', { class: 'small', text: t('course.cp.gate_closed', { date: fmtShortDate(c.late_until) }) })),
      reviewHref ? btn(t('course.cp.revisit'), reviewHref, 'btn-secondary') : null];
  } else if (cp.needs_unlock) {
    stateChip = chip(t('status.needs_unlock'), 'warn', 'users');
    body = [cp.best_pct !== null && cp.best_pct !== undefined ? gateMeter(cp.best_pct, false) : null,
      h('div', { class: 'callout warn' }, icon('users'), h('p', { class: 'small', text: t('course.cp.unlock') })),
      reviewHref ? btn(t('course.cp.revisit'), reviewHref, 'btn-secondary') : null];
  } else if (cp.status === 'in_progress') {
    stateChip = chip(t('status.cp_in_progress'), 'info', 'edit');
    body = [h('p', { class: 'small', text: t('course.cp.in_progress') }), btn(t('cta.continue_checkpoint'), quizHref('checkpoint'))];
  } else if (cp.status === 'not_yet') {
    const wait = cp.next_retake_at && Date.parse(cp.next_retake_at) > serverNow();
    stateChip = chip(t('course.cp.not_yet'), 'warn', 'refresh');
    body = [gateMeter(cp.best_pct, false),
      h('p', { class: 'small' }, t('course.cp.attempts', { count: cp.attempts || 1 }), ' · ', t('course.cp.other_form')),
      wait ? h('div', { class: 'callout warn' }, icon('clock'), h('p', { class: 'small', text: t('course.cp.retake_from', { time: fmtDateTime(cp.next_retake_at) }) })) : btn(t('cta.retake'), quizHref('checkpoint')),
      reviewHref ? btn(t('course.cp.revisit'), reviewHref, 'btn-ghost') : null];
  } else {
    stateChip = chip(t('course.cp.not_started'), '', 'flag');
    const ready = p.total && p.watched === p.total;
    body = [rulesList(c),
      !ready ? h('p', { class: 'xs muted tip' }, icon('info', 'sm'), ' ', t('course.cp.tip_watch', { n: p.watched, total: p.total })) : null,
      btn(t('cta.checkpoint'), quizHref('checkpoint'))];
  }
  render(S.els.cp,
    h('div', { class: 'card-head' }, tile('flag'), h('h2', { id: 'cp-title', class: 'h3 grow', text: t('course.cp.title') }), stateChip),
    h('div', { class: 'pad stack' }, body));
}

function renderPredict() {
  const c = S.course; const pr = c.predict || {};
  render(S.els.predict,
    h('div', { class: 'row' }, tile('zap'), h('h2', { id: 'pr-title', class: 'h3 grow', text: t('course.pr.title') }),
      pr.done ? chip(t('course.pr.done'), 'pass', 'check') : null),
    h('p', { class: 'small muted', text: t('course.pr.body') }),
    !c.open ? null : pr.done
      ? h('div', { class: 'row between' },
        h('p', { class: 'small' }, t('course.pr.last', { pct: pct(pr.last_pct) }), pr.attempts > 1 ? ` · ${t('course.pr.tries', { count: pr.attempts })}` : ''),
        h('a', { class: 'btn btn-ghost btn-sm', href: quizHref('predict') }, icon('refresh', 'sm'), t('course.pr.again')))
      : h('a', { class: 'btn btn-primary btn-block', href: quizHref('predict') }, t('cta.predict'), icon('arrow-right')));
}

function renderRecall() {
  const c = S.course; const passed = c.checkpoint && c.checkpoint.status === 'passed';
  const rows = (c.recall || []).slice().sort((a, b) => a.day - b.day);
  let body;
  if (!passed && !rows.length) {
    body = [h('p', { class: 'small muted', text: t('course.rc.locked') }),
      h('ul', { class: 'recall-list ghost' }, [2, 7, 30].map((d) => h('li', null, h('span', { class: 'day-pill', text: t('course.rc.day', { n: d }) }), h('span', { class: 'small muted', text: t('course.rc.after_forum', { n: d }) }))))];
  } else if (!rows.length) {
    body = [h('p', { class: 'small muted', text: t('course.rc.pending') })];
  } else {
    body = [h('ul', { class: 'recall-list' }, rows.map((r) => {
      let state;
      if (r.status === 'done') state = chip(t('course.rc.done', { pct: r.score_pct !== null && r.score_pct !== undefined ? pct(r.score_pct) : '' }).trim(), 'pass', 'check');
      else if (r.status === 'due') state = h('a', { class: 'btn btn-primary btn-sm', href: quizHref('recall', `&day=${r.day}`), 'aria-label': t('course.rc.start_aria', { n: r.day }) }, t('course.rc.start'));
      else state = chip(relDay(r.due_date), 'locked', 'clock');
      return h('li', { class: r.status },
        h('span', { class: 'day-pill', text: t('course.rc.day', { n: r.day }) }),
        h('span', { class: 'grow' }, h('span', { class: 'small strong ink', text: fmtShortDate(r.due_date) }), h('span', { class: 'xs muted', text: r.status === 'due' ? ` · ${t('course.rc.due')}` : '' })),
        state);
    }))];
  }
  render(S.els.recall,
    h('div', { class: 'row' }, tile('refresh'), h('h2', { id: 'rc-title', class: 'h3 grow', text: t('course.rc.title') })),
    h('p', { class: 'small muted', text: t('course.rc.body') }),
    body);
}

function renderDates() {
  const c = S.course; const today = todayVN();
  const passed = c.checkpoint && c.checkpoint.status === 'passed';
  const rows = [
    c.prework_from ? { k: 'prework', d: c.prework_from } : null,
    { k: 'online', d: c.online_from, end: c.online_to, label: fmtRange(c.online_from, c.online_to) },
    { k: 'close', d: c.checkpoint_close },
    { k: 'forum', d: c.forum_date },
    !passed && c.late_until ? { k: 'late', d: c.late_until } : null,
    { k: 'field', d: c.field_until },
  ].filter((r) => r && r.d);
  const nextIdx = rows.findIndex((r) => (r.end || r.d) >= today);
  render(S.els.dates,
    h('div', { class: 'row' }, tile('calendar'), h('h2', { id: 'kd-title', class: 'h3 grow', text: t('course.kd.title') })),
    h('ul', { class: 'kd-list' }, rows.map((r, i) => {
      const past = (r.end || r.d) < today;
      return h('li', { class: past ? 'past' : i === nextIdx ? 'next' : null },
        h('span', { class: 'kd-dot', 'aria-hidden': 'true' }, past ? icon('check', 'sm') : null),
        h('span', { class: 'grow' }, h('span', { class: 'kd-k', text: t(`course.kd.${r.k}`) }), h('span', { class: 'kd-v', text: r.label || fmtShortDate(r.d) })),
        i === nextIdx ? chip(t('course.kd.next'), 'info') : past ? h('span', { class: 'sr-only', text: t('course.kd.past') }) : null);
    })));
}
