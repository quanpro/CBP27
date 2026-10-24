// index.html · sign-in, onboarding gates (own PIN, privacy notice) and "My learning".
// All data from the Sheet is inserted as text (h() / textContent), never as HTML.
import { h, render, icon, chip, codeBadge, ring, progressBar, stepMeter, emptyState, errorState, errorMessage, changePinForm, mountShell, refreshShell, qs, logout } from '../ui.js';
import { t, pick, getLang, onLangChange } from '../i18n.js';
import { api, getSession, setSession, updateProfile, isDemo, serverNow } from '../api.js';
import { loadCatalog, journey, courseStatus, courseProgress, stepInfo, nextStep, fmtShortDate, fmtLongDate, fmtDateTime, daysUntil, todayVN } from '../courses.js';

// "A2 + A3" for a pair; more than three courses on one date reads "A2, A3 +3" so the line stays short.
const codeList = (set) => (set.length <= 3 ? set.map((c) => c.code).join(' + ') : `${set.slice(0, 2).map((c) => c.code).join(', ')} +${set.length - 2}`);

const NEXT_RE = /^[a-z]+\.html(\?[\w=&%.-]*)?(#[\w-]*)?$/;
const CODE_RE = /^[A-Z0-9_-]{3,20}$/;
const LAST_CODE = 'hub.lastCode';
const DEMO_PIN = '270127';
const DEMO_ACCOUNTS = [['DEMO-L', 'learner'], ['DEMO-M', 'manager'], ['DEMO-N', 'first']];
const TZ = 'Asia/Ho_Chi_Minh';
const LEVELS = ['practitioner', 'expert', 'coach'];
const WIDE = matchMedia('(min-width: 768px)');

const S = {
  app: null,
  view: 'boot', // login | pin | consent | dash
  login: { error: '', busy: false, showPin: false, invalid: '' },
  consent: { error: '', busy: false },
  onboardSteps: [],
  me: null, courses: null, catalog: null, loading: false, error: null, animate: false,
  team: null, teamErr: null, // manager: team_status for "Your team this week"
  open: new Set(), // <details> the learner opened (kept across a language switch)
};

// ---------- small helpers ----------
const loc = () => (getLang() === 'vi' ? 'vi-VN' : 'en-GB');
const fmtNum = (x, dp = 0) => new Intl.NumberFormat(loc(), { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(x);
const pct = (x) => `${Math.round(Number(x) || 0)}%`;
const toDate = (v) => (v ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00+07:00` : v) : null);
function part(v, o) { const d = toDate(v); return d ? new Intl.DateTimeFormat(loc(), { timeZone: TZ, ...o }).format(d) : ''; }
function monthLabel(v) { const d = toDate(v); if (!d) return ''; return getLang() === 'vi' ? `Th${part(v, { month: 'numeric' })}` : part(v, { month: 'short' }); }
function fmtRange(a, b) {
  if (!a || !b) return fmtShortDate(a || b);
  const vi = getLang() === 'vi';
  const sameMonth = a.slice(0, 7) === b.slice(0, 7);
  const dm = (v) => part(v, vi ? { day: 'numeric', month: 'numeric' } : { day: 'numeric', month: 'short' });
  return sameMonth ? `${part(a, { day: 'numeric' })}–${dm(b)}` : `${dm(a)} – ${dm(b)}`;
}
function relDay(date) {
  const n = daysUntil(date);
  if (n === null) return '';
  if (n < 0) return t('home.up.due_now');
  if (n === 0) return t('common.today');
  if (n === 1) return t('common.tomorrow');
  return t('common.in_days', { n });
}
const lastCode = () => { try { return localStorage.getItem(LAST_CODE) || ''; } catch (e) { return ''; } };
const saveCode = (c) => { try { localStorage.setItem(LAST_CODE, c); } catch (e) { /* storage blocked */ } };
const epTitle = (e) => (e.trailer ? t('home.trailer') : pick(e, 'title'));
const sup = (base, exp) => h('span', { class: 'pow' }, base, h('sup', null, String(exp)));

/** Keep typed values and focus when a view is re-rendered (language switch). */
function captureInputs(root) {
  const vals = {};
  root.querySelectorAll('input[id]').forEach((el) => { vals[el.id] = { value: el.value, checked: el.checked }; });
  const a = document.activeElement;
  return { vals, focus: a && root.contains(a) && a.id ? a.id : null };
}
function restoreInputs(root, kept) {
  Object.entries(kept.vals).forEach(([id, v]) => {
    const el = root.querySelector(`#${CSS.escape(id)}`);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = v.checked; else el.value = v.value;
  });
  if (kept.focus) { const el = root.querySelector(`#${CSS.escape(kept.focus)}`); if (el) el.focus({ preventScroll: true }); }
}

/** Rings and bars grow from zero on the first paint of real data (motion is skipped when reduced). */
function animateIn(root) {
  const bars = [...root.querySelectorAll('.ring .bar')];
  const fills = [...root.querySelectorAll('.progress > i, .rb-track > i')];
  bars.forEach((b) => { b.style.transition = 'none'; b.style.strokeDashoffset = b.getAttribute('stroke-dasharray'); });
  const widths = fills.map((f) => { const w = f.style.width; f.style.transition = 'none'; f.style.width = '0'; return w; });
  void root.offsetWidth;
  requestAnimationFrame(() => {
    bars.forEach((b) => { b.style.transition = ''; b.style.strokeDashoffset = b.getAttribute('stroke-dashoffset'); });
    fills.forEach((f, i) => { f.style.transition = ''; f.style.width = widths[i]; });
  });
}

// ---------- routing ----------
function route() {
  const s = getSession();
  if (!s) return show('login');
  const p = s.profile || {};
  if (p.must_change_pin || p.consent_needed) {
    if (!S.onboardSteps.length) S.onboardSteps = [p.must_change_pin ? 'pin' : null, p.consent_needed ? 'consent' : null].filter(Boolean);
    return show(p.must_change_pin ? 'pin' : 'consent');
  }
  const next = qs('next');
  if (next && NEXT_RE.test(next) && !/^index\.html/.test(next)) { location.replace(next); return null; }
  show('dash');
  if (!S.me) loadDash();
  return null;
}
function show(view) {
  S.view = view;
  draw();
  const h1 = S.app.querySelector('h1:not([hidden])');
  if (view !== 'dash' && view !== 'login' && h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
}
function draw() {
  S.app.querySelectorAll('details[data-k]').forEach((d) => {
    const k = d.dataset.k;
    if (d.open) { S.open.add(k); S.open.delete(`${k}:closed`); } else { S.open.delete(k); S.open.add(`${k}:closed`); }
  });
  const kept = captureInputs(S.app);
  const v = { login: viewLogin, pin: viewPin, consent: viewConsent, dash: viewDash }[S.view] || viewDash;
  // While the PIN / privacy gates are open, hide the navigation so nobody skips them by accident.
  document.body.classList.toggle('onboarding', S.view === 'pin' || S.view === 'consent');
  render(S.app, v());
  restoreInputs(S.app, kept);
  if (S.animate) { S.animate = false; animateIn(S.app); }
}

// ---------- sign in ----------
function compoundFigure(mini = false) {
  const weeks = Array.from({ length: 14 }, (_, i) => i * 4);
  const top = 1.01 ** 52 - 1;
  const bars = weeks.map((w, i) => {
    const el = h('i', { class: i === weeks.length - 1 ? 'hi' : null });
    el.style.height = `${16 + (84 * (1.01 ** w - 1)) / top}%`;
    return el;
  });
  if (mini) return h('div', { class: 'compound mini', 'aria-hidden': 'true' }, bars);
  return h('figure', { class: 'compound-fig' },
    h('div', { class: 'compound-wrap' },
      h('span', { class: 'compound-x', 'aria-hidden': 'true' }, `${fmtNum(1.68, 2)}×`),
      h('div', { class: 'compound', 'aria-hidden': 'true' }, bars),
      h('div', { class: 'compound-axis', 'aria-hidden': 'true' }, h('span', { text: t('login.week_1') }), h('span', { text: t('login.week_52') }))),
    h('figcaption', null, h('b', null, sup(fmtNum(1.01, 2), 52), ` ≈ ${fmtNum(1.68, 2)}×`), ' ', h('span', { text: t('login.compound_caption') })));
}

function viewLogin() {
  const L = S.login;
  const err = h('div', { class: 'login-error', 'aria-live': 'assertive' },
    L.error ? h('div', { class: 'callout bad', role: 'alert' }, icon('alert'), h('p', { text: L.error })) : null);

  const codeIn = h('input', { class: 'input code-input', id: 'login-code', name: 'username', type: 'text', autocomplete: 'username', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false', maxlength: 20, required: true, value: lastCode(), 'aria-invalid': L.invalid === 'code' ? 'true' : null, 'aria-describedby': 'login-code-hint' });
  codeIn.addEventListener('input', () => {
    const p = codeIn.selectionStart; const up = codeIn.value.toUpperCase();
    if (up !== codeIn.value) { codeIn.value = up; try { codeIn.setSelectionRange(p, p); } catch (e) { /* ignore */ } }
  });
  codeIn.addEventListener('blur', () => { codeIn.value = codeIn.value.trim().toUpperCase(); });

  const pinIn = h('input', { class: 'input pin', id: 'login-pin', name: 'password', type: L.showPin ? 'text' : 'password', inputmode: 'numeric', autocomplete: 'current-password', maxlength: 6, pattern: '[0-9]*', required: true, 'aria-invalid': L.invalid === 'pin' ? 'true' : null });
  pinIn.addEventListener('input', () => { const d = pinIn.value.replace(/\D/g, '').slice(0, 6); if (d !== pinIn.value) pinIn.value = d; });
  const eye = h('button', { class: 'icon-btn', type: 'button', 'aria-pressed': String(L.showPin), 'aria-label': t('login.show_pin'), 'aria-controls': 'login-pin', title: t('login.show_pin') }, icon(L.showPin ? 'eye-off' : 'eye'));
  eye.addEventListener('click', () => {
    L.showPin = !L.showPin;
    pinIn.type = L.showPin ? 'text' : 'password';
    eye.setAttribute('aria-pressed', String(L.showPin));
    eye.replaceChildren(icon(L.showPin ? 'eye-off' : 'eye'));
  });

  const remember = h('input', { type: 'checkbox', id: 'login-remember', name: 'remember' });
  const submit = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'submit', disabled: L.busy, 'aria-busy': L.busy ? 'true' : null },
    L.busy ? [h('span', { class: 'spinner', 'aria-hidden': 'true' }), t('login.signing_in')] : [t('login.submit'), icon('arrow-right')]);

  const form = h('form', { class: 'stack', novalidate: true, 'aria-labelledby': 'login-title' },
    h('div', { class: 'field' }, h('label', { for: 'login-code', text: t('login.code') }), codeIn, h('span', { class: 'hint', id: 'login-code-hint', text: t('login.code_hint') })),
    h('div', { class: 'field' }, h('label', { for: 'login-pin', text: t('login.pin') }), h('div', { class: 'input-wrap' }, pinIn, eye)),
    h('label', { class: 'check', for: 'login-remember' }, remember,
      h('span', null, h('span', { class: 'ink', text: t('login.remember') }), h('span', { class: 'hint-block', text: t('login.remember_hint') }))),
    err, submit,
    h('p', { class: 'help-line' }, icon('key', 'sm'), h('span', { text: t('login.forgot') })));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (L.busy) return;
    const code = codeIn.value.trim().toUpperCase(); codeIn.value = code;
    const pin = pinIn.value.trim();
    L.invalid = '';
    if (!CODE_RE.test(code)) { L.invalid = 'code'; L.error = t('login.err_code'); draw(); S.app.querySelector('#login-code').focus(); return; }
    if (!/^\d{6}$/.test(pin)) { L.invalid = 'pin'; L.error = t('login.err_pin'); draw(); S.app.querySelector('#login-pin').focus(); return; }
    L.error = ''; L.busy = true; draw();
    try {
      const res = await api.login(code, pin);
      setSession(res, { remember: remember.checked });
      saveCode(code);
      L.busy = false; L.error = ''; L.showPin = false;
      S.me = null;
      refreshShell();
      S.onboardSteps = [];
      route();
      window.scrollTo(0, 0);
    } catch (ex) {
      L.busy = false;
      L.error = errorMessage(ex);
      L.invalid = ex && ex.code === 'auth_failed' ? 'pin' : '';
      draw();
      const p = S.app.querySelector('#login-pin');
      if (p) { p.value = ''; p.focus(); }
    }
  });

  const demo = isDemo() ? h('div', { class: 'demo-accounts' },
    h('p', { class: 'demo-title' }, icon('zap', 'sm'), h('span', { text: t('login.demo_title') })),
    h('div', { class: 'demo-grid' }, DEMO_ACCOUNTS.map(([code, key]) => h('button', {
      class: 'demo-acct', type: 'button', 'aria-label': t('login.demo_fill', { code, who: t(`login.demo_${key}`) }),
      onclick: () => {
        const ci = S.app.querySelector('#login-code'); const pi = S.app.querySelector('#login-pin');
        ci.value = code; pi.value = DEMO_PIN; L.error = ''; L.invalid = '';
        const errBox = S.app.querySelector('.login-error'); if (errBox) errBox.replaceChildren();
        S.app.querySelector('form button[type="submit"]').focus();
      },
    }, h('b', { text: code }), h('span', { text: t(`login.demo_${key}`) })))),
    h('p', { class: 'xs muted', text: t('login.demo_pin', { pin: DEMO_PIN }) })) : null;

  const art = h('div', { class: 'auth-art' },
    h('p', { class: 'art-kicker' }, h('img', { src: 'assets/marico-logo.png', alt: '', width: 28, height: 28 }), h('span', { text: t('brand.program') })),
    h('h1', { text: t('brand.tagline') }),
    h('p', { text: t('login.art_lead') }),
    compoundFigure(),
    h('ul', { class: 'auth-points' },
      [['video', 'learn'], ['check-circle', 'prove'], ['users', 'apply']].map(([ic, k]) => h('li', null,
        h('span', { class: 'ap-icon' }, icon(ic)), h('span', null, h('b', { text: t(`login.point_${k}`) }), h('span', { text: t(`login.point_${k}_sub`) }))))));

  const mobileHero = h('div', { class: 'auth-mobile-hero' },
    h('div', { class: 'amh-text' },
      h('p', { class: 'art-kicker', text: t('brand.program') }),
      h('h1', { text: t('brand.tagline') }),
      h('p', null, t('login.mobile_lead'), ' ', h('b', null, sup(fmtNum(1.01, 2), 52), ` ≈ ${fmtNum(1.68, 2)}×`))),
    compoundFigure(true));

  return h('div', { class: 'auth-shell' }, art,
    h('div', { class: 'auth-main' }, h('div', { class: 'auth-card' }, mobileHero,
      h('div', { class: 'card pad stack' },
        h('div', { class: 'stack sm' }, h('h2', { id: 'login-title', text: t('login.title') }), h('p', { class: 'muted', text: t('login.lead') })),
        form),
      demo)));
}

// ---------- onboarding ----------
function onboardFrame(step, content) {
  const steps = S.onboardSteps.length ? S.onboardSteps : [step];
  const idx = Math.max(0, steps.indexOf(step));
  return h('div', { class: 'onboard' },
    h('div', { class: 'card onboard-card' },
      steps.length > 1 ? h('div', { class: 'onboard-progress' },
        h('p', { class: 'xs strong muted', text: t('onboard.step', { n: idx + 1, total: steps.length }) }),
        h('div', { class: 'onboard-segs', 'aria-hidden': 'true' }, steps.map((s, i) => h('i', { class: i <= idx ? 'on' : null })))) : null,
      h('div', { class: 'pad stack' }, content)),
    h('p', { class: 'center small muted onboard-out' }, h('button', { class: 'link-btn', type: 'button', onclick: logout, text: t('onboard.sign_out') })));
}
function viewPin() {
  const p = (getSession() || {}).profile || {};
  return onboardFrame('pin', [
    h('div', { class: 'onboard-icon' }, icon('key', 'lg')),
    h('h1', { text: t('onboard.pin_title', { name: p.first_name || '' }) }),
    changePinForm({ forced: true, onDone: () => { route(); window.scrollTo(0, 0); } }),
  ]);
}
const WHO = [['eye', 'you'], ['shield', 'director'], ['users', 'manager'], ['grid', 'team'], ['lock', 'nobody']];
function whoList() {
  return h('ul', { class: 'who-list' }, WHO.map(([ic, k]) => h('li', null,
    h('span', { class: 'who-icon' }, icon(ic)),
    h('div', null, h('b', { text: t(`onboard.who_${k}`) }), h('p', { text: t(`onboard.who_${k}_sees`) })))));
}
function viewConsent() {
  const C = S.consent;
  const btn = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button', disabled: C.busy, 'aria-busy': C.busy ? 'true' : null },
    C.busy ? [h('span', { class: 'spinner', 'aria-hidden': 'true' }), t('onboard.saving')] : [icon('check'), t('onboard.understand')]);
  btn.addEventListener('click', async () => {
    C.busy = true; C.error = ''; draw();
    try {
      await api.consent();
      updateProfile({ consent_needed: false });
      C.busy = false;
      S.onboardSteps = [];
      route();
      window.scrollTo(0, 0);
    } catch (ex) { C.busy = false; C.error = errorMessage(ex); draw(); }
  });
  return onboardFrame('consent', [
    h('div', { class: 'onboard-icon' }, icon('shield', 'lg')),
    h('h1', { text: t('onboard.privacy_title') }),
    h('p', { class: 'muted', text: t('onboard.privacy_lead') }),
    whoList(),
    h('p', { class: 'small muted' }, t('onboard.privacy_more'), ' ', h('a', { href: 'about.html#privacy', text: t('onboard.privacy_link') })),
    h('div', { 'aria-live': 'assertive' }, C.error ? h('div', { class: 'callout bad', role: 'alert' }, icon('alert'), h('p', { text: C.error })) : null),
    btn,
  ]);
}

// ---------- dashboard ----------
async function loadDash() {
  S.loading = true; S.error = null;
  if (S.view === 'dash') draw();
  try {
    const [me, catalog] = await Promise.all([api.me(), loadCatalog()]);
    S.catalog = catalog;
    S.courses = await journey(me);
    S.me = me;
    if (me.profile) updateProfile(me.profile);
    S.loading = false; S.animate = true;
    if (me.profile && (me.profile.must_change_pin || me.profile.consent_needed)) { S.onboardSteps = []; route(); return; }
    if (me.profile && me.profile.is_manager) loadTeam();
  } catch (ex) {
    S.loading = false; S.error = ex;
  }
  if (S.view === 'dash') draw();
}

async function loadTeam() {
  S.teamErr = null;
  try { S.team = await api.teamStatus(); } catch (ex) { S.teamErr = ex; }
  if (S.view === 'dash' && S.me) draw();
}

function dashSkeleton() {
  const sk = (cls, hgt) => { const el = h('div', { class: `skeleton ${cls || ''}` }); el.style.height = hgt; return el; };
  return h('div', { class: 'stack lg dash', 'aria-busy': 'true' },
    h('span', { class: 'sr-only', role: 'status', text: t('common.loading') }),
    h('div', { class: 'stack sm', 'aria-hidden': 'true' }, sk('w-40', '14px'), sk('w-60', '34px')),
    sk('sk-hero', '200px'),
    h('div', { class: 'grid stat-grid', 'aria-hidden': 'true' }, [1, 2].map(() => sk('sk-tile', '120px'))),
    h('div', { class: 'grid cols-2', 'aria-hidden': 'true' }, [1, 2, 3, 4].map(() => sk('sk-tile', '190px'))));
}

function viewDash() {
  if (!S.me) {
    if (S.error) {
      return h('div', { class: 'stack lg dash' }, h('h1', { text: t('home.title') }), errorState(S.error, () => loadDash()));
    }
    return dashSkeleton();
  }
  const me = S.me; const courses = S.courses;
  const ns = nextStep(me, courses);
  const blocks = [
    greeting(me),
    heroNext(ns),
    statRow(me, courses),
    h('div', { class: 'dash-grid' },
      h('div', { class: 'dash-up stack' }, me.profile && me.profile.is_manager ? managerCard(courses) : null, comingUp(me, courses)),
      h('div', { class: 'dash-main stack xl' }, baselineCard(me.baseline), coursesSection(courses)),
      h('div', { class: 'dash-side stack' }, capstoneCard(me.capstone), privacyCard())),
    certPath(me),
  ];
  return h('div', { class: 'stack xl dash' }, blocks.map((b, i) => {
    if (b && S.animate) { b.classList.add('rise'); b.style.setProperty('--d', `${i * 60}ms`); }
    return b;
  }));
}

function greeting(me) {
  const hr = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date(serverNow())));
  const when = hr < 12 ? 'morning' : hr < 18 ? 'afternoon' : 'evening';
  const name = (me.profile && me.profile.first_name) || '';
  return h('header', { class: 'dash-head' },
    h('p', { class: 'dash-date' }, icon('calendar', 'sm'), h('span', { text: fmtLongDate(todayVN()) })),
    h('h1', { text: t(`home.greet_${when}`, { name }) }));
}

function heroBody(c, s) {
  const cp = c.checkpoint || {};
  switch (s.key) {
    case 'predict': return t('home.next.body_predict');
    case 'watch': {
      const p = courseProgress(c);
      const nx = c.episodes.find((e) => !e.trailer && !e.watched);
      return nx ? t('home.next.body_watch', { n: p.watched, total: p.total, title: epTitle(nx), ep: nx.ep }) : s.label;
    }
    case 'checkpoint': return t('home.next.body_checkpoint', { date: fmtShortDate(c.checkpoint_close) });
    case 'cp_progress': return t('home.next.body_cp_progress');
    case 'retake': return t('home.next.body_retake', { pct: pct(cp.best_pct) });
    case 'retake_wait': return t('home.next.body_retake_wait', { time: fmtDateTime(cp.next_retake_at) });
    case 'recall': { const r = (c.recall || []).find((x) => x.status === 'due'); return t('home.next.body_recall', { day: r ? r.day : '' }); }
    case 'unlock': return t('home.next.body_unlock');
    case 'closed': return t('home.next.body_closed');
    default: return s.label;
  }
}

function heroNext(ns) {
  const c = ns.course;
  const eyebrow = t(`home.next.eyebrow_${ns.kind}`);
  let title = ns.title; let body = ns.body; let aside = null; let lead = null; let meter = null;
  if (c && ns.status) {
    title = pick(c, 'name');
    body = heroBody(c, ns.status);
    lead = h('div', { class: 'row tight' }, h('span', { class: 'code-badge hero-code' }, c.code), chip(ns.status.label, ns.status.variant, ns.status.icon));
    meter = stepMeter(stepInfo(c), { onHero: true });
  } else if (ns.kind === 'baseline') {
    aside = h('div', { class: 'hero-aside' }, h('span', { class: 'hero-glyph' }, icon('target', 'lg')), h('span', { class: 'small', text: t('home.next.baseline_aside') }));
  } else if (ns.kind === 'done') {
    aside = h('div', { class: 'hero-aside' }, h('span', { class: 'hero-glyph' }, icon('check-circle', 'lg')));
  } else if (ns.kind === 'wait' && c) {
    lead = h('div', { class: 'row tight' }, h('span', { class: 'code-badge hero-code' }, c.code));
  }
  let cta = ns.cta;
  if (ns.kind === 'wait' && c) cta = { label: t('cta.open_course'), href: `course.html?c=${encodeURIComponent(c.code)}` };
  const courseHref = c ? `course.html?c=${encodeURIComponent(c.code)}` : null;
  const second = c && cta && !String(cta.href).startsWith('course.html') ? h('a', { class: 'btn btn-outline-light btn-lg', href: courseHref, text: t('cta.open_course') }) : null;
  return h('section', { class: 'hero next-hero', 'aria-labelledby': 'next-title' },
    h('div', { class: 'pad' },
      h('div', { class: 'next-grid' },
        h('div', { class: 'stack' },
          h('p', { class: 'eyebrow', text: eyebrow }),
          lead,
          h('h2', { id: 'next-title', class: 'next-title', text: title }),
          body ? h('p', { class: 'sub next-body', text: body }) : null,
          meter,
          cta || second ? h('div', { class: 'row next-ctas' },
            cta ? h('a', { class: 'btn btn-light btn-lg', href: cta.href }, cta.label, icon('arrow-right')) : null, second) : null),
        aside)));
}

function statTile({ k, kIcon, v, d, extra, below, cls }) {
  return h('div', { class: `stat ${cls || ''}`.trim() },
    h('p', { class: 'k' }, kIcon ? icon(kIcon, 'sm') : null, h('span', { text: k })),
    h('div', { class: 'stat-main' }, h('p', { class: 'v' }, v), extra || null),
    below || null,
    d ? h('p', { class: 'd' }, d) : null);
}

function statRow(me, courses) {
  const cert = me.certificates || {};
  const passed = cert.checkpoints_passed !== undefined ? cert.checkpoints_passed : courses.filter((c) => c.checkpoint && c.checkpoint.status === 'passed').length;
  const total = cert.checkpoints_total || 10;

  const tCp = statTile({
    k: t('home.stat.checkpoints'), kIcon: 'flag',
    v: [String(passed), h('small', null, ` / ${total}`)],
    d: t('home.stat.checkpoints_d'),
    extra: ring((100 * passed) / total, { size: 52, stroke: 6, label: '', ariaLabel: t('home.stat.checkpoints_aria', { n: passed, total }) }),
  });

  // One tile for the weekly habit: active weeks this program year, the last 12 weeks as dots
  // (this week outlined) and whether this week already counts. No multiplier here: the 1.01^52
  // story lives on the sign-in page and the About page.
  const st = me.streak || {};
  const n = st.active_weeks_total || 0;
  const of = st.weeks_total_program || 52;
  const recent = Array.isArray(st.recent) && st.recent.length ? st.recent.slice(-12) : recentFromStreak(st);
  const dots = h('div', { class: 'week-dots', role: 'img', 'aria-label': t('home.weeks.strip_aria', { n: recent.filter(Boolean).length, total: recent.length, row: st.current_weeks || 0 }) },
    recent.map((on, i) => h('i', { class: [on ? 'on' : '', i === recent.length - 1 ? 'now' : ''].filter(Boolean).join(' ') || null })));
  const tWeeks = statTile({
    k: t('home.weeks.title'), kIcon: 'calendar', cls: 'stat-weeks',
    v: [String(n), h('small', null, ` ${t('home.weeks.of', { total: of })}`)],
    below: dots,
    d: st.active_this_week ? h('span', { class: 'ok-line', text: t('streak.active') }) : t('streak.inactive'),
  });

  return h('section', { 'aria-label': t('home.stat.aria') }, h('div', { class: 'grid stat-grid' }, tCp, tWeeks));
}
// Older backends send no `recent`: rebuild the last 12 weeks from the current run of weeks.
function recentFromStreak(st) {
  const out = Array(12).fill(false);
  const end = st.active_this_week ? 11 : 10;
  for (let i = 0; i < (st.current_weeks || 0) && end - i >= 0; i += 1) out[end - i] = true;
  return out;
}

// Baseline card: CTA while open; readiness and the two largest gaps after submit.
function baselineCard(b) {
  if (!b) return null;
  const head = (chipEl) => h('div', { class: 'section-head' },
    h('div', { class: 'stack sm' }, h('h2', { id: 'bl-title', text: t('home.bl.title') }), h('p', { text: t('home.bl.sub', { wave: waveLabel(b.wave) }) })), chipEl);
  if (b.status === 'submitted' && b.result) return baselineRow(b);
  let body;
  if (b.window === 'open' || b.status === 'in_progress') {
    const inProg = b.status === 'in_progress';
    body = h('div', { class: 'card pad stack bl-open' },
      h('div', { class: 'bl-facts' },
        fact('calendar', t('home.bl.window'), fmtRange(b.open_from, b.open_to)),
        fact('clock', t('home.bl.time'), t('home.bl.time_v')),
        fact('list', t('home.bl.parts'), t('home.bl.parts_v')),
        fact('lock', t('home.bl.who'), t('home.bl.who_v'))),
      h('p', { class: 'muted', text: t(inProg ? 'home.bl.body_continue' : 'home.bl.body_open') }),
      inProg && b.deadline_at ? h('p', { class: 'small strong ink' }, icon('clock', 'sm'), ' ', t('home.bl.deadline', { time: fmtDateTime(b.deadline_at) })) : null,
      h('div', null, h('a', { class: 'btn btn-primary btn-lg', href: 'baseline.html' }, t(inProg ? 'cta.continue' : 'cta.start_baseline'), icon('arrow-right'))));
    return h('section', { 'aria-labelledby': 'bl-title' }, head(chip(t(inProg ? 'home.bl.chip_progress' : 'home.bl.chip_open'), 'info', inProg ? 'edit' : 'clock')), body);
  }
  if (b.window === 'before') {
    body = h('div', { class: 'card pad' }, h('p', { class: 'muted', text: t('home.bl.body_before', { from: fmtLongDate(b.open_from), to: fmtLongDate(b.open_to) }) }));
    return h('section', { 'aria-labelledby': 'bl-title' }, head(chip(t('home.bl.chip_soon'), 'locked', 'lock')), body);
  }
  body = h('div', { class: 'card pad' }, h('p', { class: 'muted', text: t('home.bl.body_missed', { date: fmtLongDate(b.open_to) }) }));
  return h('section', { 'aria-labelledby': 'bl-title' }, head(chip(t('home.bl.chip_closed'), 'locked', 'lock')), body);
}
function fact(ic, k, v) { return h('div', { class: 'bl-fact' }, icon(ic), h('div', null, h('span', { class: 'xs muted', text: k }), h('b', { text: v }))); }
function waveLabel(w) {
  if (!w) return '';
  const [y, m] = String(w).split('-');
  return getLang() === 'vi' ? `${t('home.bl.month')} ${Number(m)}/${y}` : new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(Number(y), Number(m) - 1, 15)));
}
// After the baseline: one row. The full result (by course, self-rating, gaps) is on baseline.html.
function baselineRow(b) {
  return h('section', { class: 'bl-row-sec', 'aria-labelledby': 'bl-title' },
    h('a', { class: 'card hover bl-row', href: 'baseline.html' },
      h('span', { class: 'tile-icon' }, icon('target')),
      h('span', { class: 'bl-row-text' },
        h('h2', { id: 'bl-title', class: 'title-sm', text: t('home.bl.title') }),
        h('span', { class: 'bl-row-pct', text: t('home.bl.row_overall', { pct: pct(b.result.score_pct) }) })),
      h('span', { class: 'bl-row-go' }, h('span', { text: t('home.bl.row_link') }), icon('arrow-right', 'sm'))));
}

// Courses grouped by cycle, calendar order, as a learning path.
function cycleMonths(list) {
  const from = list.map((c) => c.online_from).filter(Boolean).sort()[0];
  const to = list.map((c) => c.forum_date).filter(Boolean).sort().pop();
  if (!from) return '';
  const a = monthLabel(from); const b = to ? monthLabel(to) : a;
  return a === b ? a : `${a}–${b}`;
}
function coursesSection(courses) {
  const cycles = [];
  courses.forEach((c) => { let g = cycles.find((x) => x.n === c.cycle); if (!g) { g = { n: c.cycle, list: [] }; cycles.push(g); } g.list.push(c); });
  const today = todayVN();
  const passedN = courses.filter((c) => c.checkpoint && c.checkpoint.status === 'passed').length;
  // The current cycle is the latest one that has opened (before the year starts: the first).
  const opened = cycles.filter((g) => g.list.some((c) => c.online_from && c.online_from <= today));
  const cur = opened.length ? opened[opened.length - 1].n : (cycles[0] && cycles[0].n);
  const finished = (g) => g.list.every((c) => c.checkpoint && c.checkpoint.status === 'passed');
  const done = cycles.filter((g) => g.n < cur && finished(g));
  const shown = cycles.filter((g) => g.n === cur || (g.n < cur && !finished(g))); // earlier cycles with work left stay open
  const later = cycles.filter((g) => g.n > cur);
  const doneCourses = done.flatMap((g) => g.list);
  const laterCourses = later.flatMap((g) => g.list);
  const fold = (k, label, body) => h('details', { class: 'fold', 'data-k': k, open: S.open.has(k) },
    h('summary', null, h('span', { class: 'fold-title', text: label }), icon('chevron-down', 'fold-chev')), body);
  return h('section', { 'aria-labelledby': 'courses-title' },
    h('div', { class: 'section-head' },
      h('div', { class: 'stack sm' }, h('h2', { id: 'courses-title', text: t('home.courses.title') }), h('p', { text: t('home.courses.sub', { n: passedN, total: courses.length }) }))),
    h('div', { class: 'stack' },
      doneCourses.length ? fold('done', t('home.courses.done', { n: doneCourses.length }), h('ol', { class: 'timeline cycles' }, done.map((g) => cycleItem(g, 'done')))) : null,
      h('ol', { class: 'timeline cycles' }, shown.map((g) => cycleItem(g, g.n === cur ? 'now' : null))),
      laterCourses.length ? fold('later', t('home.courses.later', { n: laterCourses.length }),
        h('ul', { class: 'later-list' }, laterCourses.map((c) => h('li', null,
          h('a', { class: 'later-row', href: `course.html?c=${encodeURIComponent(c.code)}` },
            h('span', { class: `code-badge sm fam-${c.code.charAt(0)}`, text: c.code }),
            h('span', { class: 'later-name', text: pick(c, 'name') }),
            h('span', { class: 'later-date' }, icon(c.open ? 'video' : 'lock', 'sm'), h('span', { text: c.online_from ? fmtShortDate(c.online_from) : '' }),
              h('span', { class: 'sr-only', text: c.open ? '' : ` · ${t('status.locked')}` }))))))) : null));
}
function cycleItem(g, state) {
  const forum = g.list.map((c) => c.forum_date).filter(Boolean).sort()[0];
  return h('li', { class: state },
    h('span', { class: 'tl-dot', 'aria-hidden': 'true' }, state === 'done' ? icon('check', 'sm') : String(g.n)),
    h('div', { class: 'cycle-head' },
      h('h3', { class: 'cycle-label' }, t('home.courses.cycle', { n: g.n }), h('span', { class: 'cycle-months', text: ` · ${cycleMonths(g.list)}` })),
      forum ? h('span', { class: 'xs muted' }, icon('calendar', 'sm'), ' ', t('home.courses.forum_on', { date: fmtShortDate(forum) })) : null),
    h('div', { class: 'cycle-grid' }, g.list.map(courseCard)));
}
function courseCard(c) {
  const s = courseStatus(c);
  const locked = s.key === 'locked';
  const href = `course.html?c=${encodeURIComponent(c.code)}`;
  const st = chip(s.label, s.variant, s.icon); st.title = s.label;
  return h('a', { class: `card hover card-link course-card fam-${c.code.charAt(0)}${locked ? ' locked' : ''}`, href },
    h('div', { class: 'band' }),
    h('div', { class: 'body' },
      h('div', { class: 'top' }, codeBadge(c.code), h('span', { class: 'cc-family', text: t(`family.${c.family || c.code.charAt(0)}`) })),
      h('h4', { class: 'cc-name', text: pick(c, 'name') }),
      h('p', { class: 'promise', text: pick(c, 'promise') }),
      h('p', { class: 'meta' },
        c.online_from ? h('span', null, icon('video', 'sm'), t('home.courses.online', { date: fmtShortDate(c.online_from) })) : null,
        c.forum_date ? h('span', null, icon('users', 'sm'), t('home.courses.forum', { date: fmtShortDate(c.forum_date) })) : null)),
    h('div', { class: 'foot' },
      h('div', { class: 'foot-row' }, st, h('span', { class: 'spacer' }), locked ? h('span', { class: 'cc-lock' }, icon('lock')) : null, h('span', { class: 'cc-go' }, icon('chevron-right'))),
      locked ? null : stepMeter(stepInfo(c), { compact: true })));
}

// Coming up: next forum, checkpoint closing, recall due (and the baseline window / Pitch Day when relevant).
function comingUp(me, courses) {
  const today = todayVN();
  const items = [];
  const b = me.baseline || {};
  if (b.window === 'open' && b.status !== 'submitted' && b.open_to) items.push({ date: b.open_to, icon: 'target', title: t('home.up.baseline_closes'), sub: t('home.up.baseline_sub'), href: 'baseline.html', prio: 0 });
  if (b.window === 'before' && b.open_from) items.push({ date: b.open_from, icon: 'target', title: t('home.up.baseline_opens'), sub: t('home.up.baseline_sub'), prio: 3 });
  courses.forEach((c) => (c.recall || []).forEach((r) => {
    if (r.status === 'due') items.push({ date: r.due_date < today ? today : r.due_date, icon: 'refresh', title: t('home.up.recall_due', { code: c.code, day: r.day }), sub: pick(c, 'name'), href: `quiz.html?type=recall&c=${encodeURIComponent(c.code)}&day=${r.day}`, prio: 0, due: true });
  }));
  const nextRecall = courses.flatMap((c) => (c.recall || []).filter((r) => r.status === 'upcoming').map((r) => ({ c, r }))).sort((x, y) => (x.r.due_date < y.r.due_date ? -1 : 1))[0];
  if (nextRecall) items.push({ date: nextRecall.r.due_date, icon: 'refresh', title: t('home.up.recall_next', { code: nextRecall.c.code, day: nextRecall.r.day }), sub: pick(nextRecall.c, 'name'), href: `course.html?c=${encodeURIComponent(nextRecall.c.code)}`, prio: 2 });
  const closing = courses.filter((c) => c.checkpoint_close && c.checkpoint_close >= today && !(c.checkpoint && c.checkpoint.status === 'passed')).sort((x, y) => (x.checkpoint_close < y.checkpoint_close ? -1 : 1));
  if (closing.length) {
    const d = closing[0].checkpoint_close; const set = closing.filter((c) => c.checkpoint_close === d);
    items.push({ date: d, icon: 'flag', title: t('home.up.checkpoint_closes', { codes: codeList(set) }), sub: set.length === 1 ? pick(set[0], 'name') : t('home.up.checkpoint_sub'), href: `course.html?c=${encodeURIComponent(set[0].code)}`, prio: 1 });
  }
  const forums = courses.filter((c) => c.forum_date && c.forum_date >= today).sort((x, y) => (x.forum_date < y.forum_date ? -1 : 1));
  if (forums.length) {
    const d = forums[0].forum_date; const set = forums.filter((c) => c.forum_date === d);
    items.push({ date: d, icon: 'users', title: t('home.up.forum', { codes: codeList(set) }), sub: pick(set[0].forum || {}, 'title'), href: `course.html?c=${encodeURIComponent(set[0].code)}`, prio: 1 });
  }
  const pitch = pitchDay();
  if (pitch && pitch >= today) items.push({ date: pitch, icon: 'trophy', title: t('home.up.pitch'), sub: t('home.up.pitch_sub'), href: 'capstone.html', prio: 4 });
  items.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.prio - y.prio));
  const list = items.slice(0, 5);

  return h('section', { class: 'card up-card', 'aria-labelledby': 'up-title' },
    h('div', { class: 'card-head' }, icon('calendar'), h('h2', { id: 'up-title', class: 'title-sm', text: t('home.up.title') })),
    list.length ? h('ul', { class: 'up-list' }, list.map((it) => {
      const inner = [
        h('span', { class: `date-tile${it.due ? ' due' : ''}`, 'aria-hidden': 'true' },
          h('span', { class: 'dt-wd', text: part(it.date, { weekday: 'short' }) }), h('b', { text: part(it.date, { day: 'numeric' }) }), h('span', { class: 'dt-m', text: monthLabel(it.date) })),
        h('span', { class: 'up-text' }, h('span', { class: 'up-title', text: it.title }), h('span', { class: 'up-sub', text: it.sub }),
          h('span', { class: `up-when${it.due ? ' due' : ''}` }, icon(it.icon, 'sm'), h('span', { class: 'sr-only', text: `${fmtLongDate(it.date)} · ` }), relDay(it.date))),
        it.href ? h('span', { class: 'up-go', 'aria-hidden': 'true' }, icon('chevron-right')) : null,
      ];
      return h('li', null, it.href ? h('a', { class: 'up-item', href: it.href }, inner) : h('div', { class: 'up-item' }, inner));
    })) : h('div', { class: 'pad' }, emptyState({ iconName: 'calendar', title: t('home.up.empty_title'), body: t('home.up.empty_body') })));
}

// Pitch Day is the C1 forum (live dates from the Sheet win over courses.json).
function pitchDay() {
  const c1 = (S.courses || []).find((c) => c.code === 'C1');
  return (c1 && c1.forum_date) || (S.catalog && S.catalog.program && S.catalog.program.pitch_day) || '';
}
function capstoneCard(cap) {
  const c = cap || {};
  const submitted = !!c.pitch_submitted_at;
  return h('section', { class: 'card pad stack cap-card', 'aria-labelledby': 'cap-title' },
    h('div', { class: 'row' }, h('span', { class: 'tile-icon' }, icon('trophy')), h('div', { class: 'grow' }, h('p', { class: 'eyebrow', text: t('home.cap.eyebrow') }), h('h2', { id: 'cap-title', class: 'title-sm', text: c.project_title || t('home.cap.no_team') }))),
    h('p', { class: 'small muted', text: c.team_id ? t('home.cap.body', { date: fmtLongDate(pitchDay() || '2027-06-22') }) : t('home.cap.no_team_body') }),
    c.team_id ? h('div', { class: 'row tight' },
      submitted ? chip(t('home.cap.pitch_done'), 'pass', 'check') : chip(t('home.cap.pitch_due', { date: fmtShortDate(c.pitch_deadline || pitchDay()) }), 'info', 'clock')) : null,
    h('div', null, h('a', { class: 'btn btn-secondary', href: 'capstone.html' }, t('home.cap.open'), icon('arrow-right'))));
}
// Manager: "Your team this week" from team_status (passed / not started for the next gate, and who
// needs the 15-minute chat before a third or late try). Never scores.
function managerCard(courses) {
  const head = h('div', { class: 'row' }, h('span', { class: 'tile-icon' }, icon('users')),
    h('div', { class: 'grow' }, h('h2', { id: 'mgr-title', class: 'title-sm', text: t('home.mgr.title') })));
  const link = h('div', null, h('a', { class: 'btn btn-secondary', href: 'team.html#gates' }, t('home.mgr.open'), icon('arrow-right')));
  let body;
  if (!S.team && !S.teamErr) {
    body = h('div', { class: 'stack sm', 'aria-hidden': 'true' }, [70, 100].map((w) => { const el = h('div', { class: 'skeleton' }); el.style.width = `${w}%`; el.style.height = '44px'; return el; }));
  } else if (S.teamErr || !S.team) {
    body = h('p', { class: 'small muted', text: t('home.mgr.body') });
  } else {
    const reports = S.team.reports || [];
    if (!reports.length) body = h('p', { class: 'small muted', text: t('team.gs.empty_body') });
    else {
      const today = todayVN();
      const next = courses.filter((c) => c.checkpoint_close && c.checkpoint_close >= today).sort((a, b) => (a.checkpoint_close < b.checkpoint_close ? -1 : 1))[0];
      const set = next ? courses.filter((c) => c.checkpoint_close === next.checkpoint_close) : [];
      const codes = set.map((c) => c.code).join(' + ');
      const cell = (r, code) => (r.courses || {})[code] || 'not_started';
      const chats = reports.flatMap((r) => Object.entries(r.courses || {}).filter(([, v]) => v === 'needs_chat').map(([code]) => ({ r, code })));
      const chatPeople = new Set(chats.map((x) => x.r.code)).size;
      const passed = set.length ? reports.filter((r) => set.every((c) => cell(r, c.code) === 'passed')).length : 0;
      const notStarted = set.length ? reports.filter((r) => set.some((c) => cell(r, c.code) === 'not_started')).length : 0;
      const count = (n, label, sub, variant, ic) => h('li', { class: `mgr-count${variant ? ` ${variant}` : ''}${n ? '' : ' zero'}` },
        h('b', { class: 'num', text: String(n) }), h('span', { class: 'mgr-k' }, icon(ic, 'sm'), h('span', { text: label })), sub ? h('span', { class: 'mgr-sub', text: sub }) : null);
      body = h('div', { class: 'stack' },
        h('p', { class: 'small muted', text: t('home.mgr.people', { count: reports.length }) }),
        h('ul', { class: 'mgr-counts' },
          count(chatPeople, t('home.mgr.chat', { count: chatPeople }), '', 'warn', 'users'),
          set.length ? count(notStarted, t('home.mgr.not_started'), codes, '', 'circle') : null,
          set.length ? count(passed, t('home.mgr.passed'), codes, 'pass', 'check') : null),
        chats.length ? h('p', { class: 'small mgr-chats' }, icon('users', 'sm'), h('span', { text: chats.map((x) => `${x.r.first_name || x.r.code} · ${x.code}`).join(', ') })) : null);
    }
  }
  return h('section', { class: 'card pad stack mgr-card', 'aria-labelledby': 'mgr-title' }, head, body, link);
}
function privacyCard() {
  return h('aside', { class: 'panel privacy-note' }, icon('lock', 'sm'),
    h('p', { class: 'small' }, t('home.privacy_note'), ' ', h('a', { href: 'about.html#privacy', text: t('home.privacy_link') })));
}

// Certificate path: Practitioner → Expert → Coach. Marks what the Hub knows and what is recorded elsewhere.
function certPath(me) {
  const cert = me.certificates || {};
  const level = cert.level || (me.profile && me.profile.certificate) || '';
  const earnedIdx = LEVELS.indexOf(level);
  const passed = cert.checkpoints_passed || 0; const total = cert.checkpoints_total || 10;
  const crit = (state, text, note) => h('li', { class: state },
    icon(state === 'ok' ? 'check-circle' : state === 'ext' ? 'file' : 'circle'),
    h('span', null, h('span', { text }), note ? h('span', { class: 'crit-note', text: note }) : null,
      h('span', { class: 'sr-only', text: ` (${t(`cert.state_${state}`)})` })));
  const defs = {
    practitioner: [
      crit(passed >= total ? 'ok' : 'no', t('cert.cp_all', { n: passed, total })),
      crit('ext', t('cert.field_all'), t('cert.field_note')),
    ],
    expert: [
      crit(earnedIdx >= 0 ? 'ok' : 'no', t('cert.prev_practitioner')),
      crit(cert.capstone_submitted ? 'ok' : 'no', t('cert.capstone_submitted')),
      crit('ext', t('cert.capstone_score'), t('cert.capstone_score_note')),
      crit('ext', t('cert.fo'), t('cert.fo_note')),
    ],
    coach: [
      crit(earnedIdx >= 1 ? 'ok' : 'no', t('cert.prev_expert')),
      crit('ext', t('cert.coteach')),
      crit('ext', t('cert.coach_peer')),
      crit('ext', t('cert.le'), t('cert.le_note')),
    ],
  };
  return h('section', { 'aria-labelledby': 'cert-title' },
    h('div', { class: 'section-head' }, h('div', { class: 'stack sm' }, h('h2', { id: 'cert-title', text: t('cert.title') }), h('p', { text: t('cert.sub') }))),
    h('ol', { class: 'cert-path' }, LEVELS.map((lv, i) => {
      const earned = i <= earnedIdx; const active = i === earnedIdx + 1;
      const bar = lv === 'practitioner' ? progressBar((100 * passed) / total, { thin: true, label: t('cert.cp_all', { n: passed, total }) }) : null;
      // Levels further ahead fold their criteria on phones (one tap away), so the page stays short.
      const later = !earned && !active;
      const k = `cert-${lv}`;
      const list = h('ul', null, defs[lv]);
      return h('li', { class: `cert${earned ? ' earned' : ''}${active ? ' active' : ''}` },
        h('div', { class: 'row' }, h('span', { class: 'medal' }, icon(earned ? 'award' : i === 2 ? 'star' : 'award')),
          h('div', { class: 'grow' }, h('p', { class: 'xs muted strong', text: t('cert.level_n', { n: i + 1 }) }), h('h3', { text: t(`cert.${lv}`) })),
          earned ? chip(t('cert.earned'), 'pass', 'check') : active ? chip(t('cert.working'), 'info') : null),
        h('p', { class: 'small muted', text: t(`cert.${lv}_promise`) }),
        bar,
        later ? h('details', { class: 'cert-more', 'data-k': k, open: S.open.has(k) || (!S.open.has(`${k}:closed`) && WIDE.matches) },
          h('summary', null, h('span', { text: t('cert.what_it_takes') }), icon('chevron-down', 'fold-chev')), list) : list);
    })),
    h('p', { class: 'xs muted cert-legend' },
      h('span', null, icon('check-circle', 'sm'), t('cert.legend_ok')),
      h('span', null, icon('circle', 'sm'), t('cert.legend_no')),
      h('span', null, icon('file', 'sm'), t('cert.legend_ext'))));
}

// ---------- start ----------
(async function main() {
  const { app } = await mountShell({ page: 'home', auth: false });
  S.app = app;
  onLangChange(() => draw());
  route();
}());
