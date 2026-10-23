// index.html · sign-in, onboarding gates (own PIN, privacy notice) and "My learning".
// All data from the Sheet is inserted as text (h() / textContent), never as HTML.
import { h, render, icon, chip, codeBadge, ring, progressBar, emptyState, errorState, errorMessage, changePinForm, mountShell, refreshShell, qs, logout } from '../ui.js';
import { t, pick, getLang, onLangChange } from '../i18n.js';
import { api, getSession, setSession, updateProfile, isDemo, serverNow } from '../api.js';
import { loadCatalog, journey, courseStatus, courseProgress, nextStep, fmtShortDate, fmtLongDate, fmtDateTime, daysUntil, todayVN } from '../courses.js';

const NEXT_RE = /^[a-z]+\.html(\?[\w=&%.-]*)?(#[\w-]*)?$/;
const CODE_RE = /^[A-Z0-9_-]{3,20}$/;
const LAST_CODE = 'hub.lastCode';
const DEMO_PIN = '270127';
const DEMO_ACCOUNTS = [['DEMO-L', 'learner'], ['DEMO-M', 'manager'], ['DEMO-N', 'first']];
const TZ = 'Asia/Ho_Chi_Minh';
const LEVELS = ['practitioner', 'expert', 'coach'];

const S = {
  app: null,
  view: 'boot', // login | pin | consent | dash
  login: { error: '', busy: false, showPin: false, invalid: '' },
  consent: { error: '', busy: false },
  onboardSteps: [],
  me: null, courses: null, catalog: null, loading: false, error: null, animate: false,
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
  } catch (ex) {
    S.loading = false; S.error = ex;
  }
  if (S.view === 'dash') draw();
}

function dashSkeleton() {
  const sk = (cls, hgt) => { const el = h('div', { class: `skeleton ${cls || ''}` }); el.style.height = hgt; return el; };
  return h('div', { class: 'stack lg dash', 'aria-busy': 'true' },
    h('span', { class: 'sr-only', role: 'status', text: t('common.loading') }),
    h('div', { class: 'stack sm', 'aria-hidden': 'true' }, sk('w-40', '14px'), sk('w-60', '34px')),
    sk('sk-hero', '200px'),
    h('div', { class: 'grid cols-4', 'aria-hidden': 'true' }, [1, 2, 3, 4].map(() => sk('sk-tile', '108px'))),
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
      h('div', { class: 'dash-up' }, comingUp(me, courses)),
      h('div', { class: 'dash-main stack xl' }, baselineCard(me.baseline), coursesSection(courses, ns)),
      h('div', { class: 'dash-side stack' }, capstoneCard(me.capstone), me.profile && me.profile.is_manager ? managerCard() : null, privacyCard())),
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
  let title = ns.title; let body = ns.body; let aside = null; let lead = null;
  if (c && ns.status) {
    title = pick(c, 'name');
    body = heroBody(c, ns.status);
    lead = h('div', { class: 'row tight' }, h('span', { class: 'code-badge hero-code' }, c.code), chip(ns.status.label, ns.status.variant, ns.status.icon));
    const p = courseProgress(c);
    aside = h('div', { class: 'hero-aside' }, ring(p.pct, { size: 92, stroke: 8, ariaLabel: t('home.next.ring_aria', { pct: p.pct }) }), h('span', { class: 'small', text: t('home.next.ring_label') }));
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
  const st = me.streak || { current_weeks: 0, active_this_week: false, active_weeks_total: 0, multiplier: 1 };
  const b = me.baseline || {};

  const tCp = statTile({
    k: t('home.stat.checkpoints'), kIcon: 'flag',
    v: [String(passed), h('small', null, ` / ${total}`)],
    d: t('home.stat.checkpoints_d'),
    extra: ring((100 * passed) / total, { size: 52, stroke: 6, label: '', ariaLabel: t('home.stat.checkpoints_aria', { n: passed, total }) }),
  });

  const squares = Math.min(st.current_weeks || 0, 8);
  const weeks = h('div', { class: 'weeks', 'aria-hidden': 'true' },
    Array.from({ length: squares }, () => h('i', { class: 'on' })), st.active_this_week ? null : h('i', { class: 'todo' }));
  const tStreak = statTile({
    k: t('home.stat.streak'), kIcon: 'flame', cls: 'stat-streak',
    v: t('streak.weeks', { count: st.current_weeks || 0 }),
    d: st.active_this_week ? h('span', { class: 'ok-line' }, icon('check', 'sm'), t('streak.active')) : t('streak.inactive'),
    extra: h('span', { class: `flame${st.active_this_week ? ' on' : ''}` }, icon('flame')),
    below: weeks,
  });

  const n = st.active_weeks_total || 0;
  const meter = h('div', { class: 'meter' },
    h('div', { class: 'progress meter-track', role: 'img', 'aria-label': t('streak.meter_aria', { n, x: fmtNum(st.multiplier || 1, 2) }) }, (() => { const i = h('i'); i.style.width = `${Math.min(100, (100 * n) / 52)}%`; return i; })()),
    h('div', { class: 'meter-scale', 'aria-hidden': 'true' }, h('span', { text: `${fmtNum(1, 2)}×` }), h('span', { text: `${fmtNum(1.68, 2)}×` })));
  const tMeter = statTile({
    k: t('streak.meter'), kIcon: 'trend-up', cls: 'stat-meter',
    v: `${fmtNum(st.multiplier || 1, 2)}×`,
    d: h('span', null, sup(fmtNum(1.01, 2), n), ' · ', t('streak.active_weeks', { count: n })),
    below: meter,
  });

  let bv; let bd;
  if (b.status === 'submitted' && b.result) { bv = pct(b.result.score_pct); bd = t('home.stat.baseline_done'); }
  else if (b.status === 'in_progress') { bv = t('home.stat.baseline_in_progress'); bd = b.deadline_at ? t('home.stat.baseline_until', { time: fmtDateTime(b.deadline_at) }) : ''; }
  else if (b.window === 'open') { bv = t('home.stat.baseline_open'); bd = t('home.stat.baseline_open_until', { date: fmtShortDate(b.open_to) }); }
  else if (b.window === 'before') { bv = t('home.stat.baseline_soon'); bd = t('home.stat.baseline_opens', { date: fmtShortDate(b.open_from) }); }
  else { bv = '—'; bd = t('home.stat.baseline_missed'); }
  const tBase = statTile({ k: t('home.stat.baseline'), kIcon: 'target', v: bv, d: bd, cls: 'stat-base' });

  return h('section', { 'aria-label': t('home.stat.aria') }, h('div', { class: 'grid cols-4 stat-grid' }, tCp, tStreak, tMeter, tBase));
}

// Baseline card: CTA while open; readiness and the two largest gaps after submit.
function baselineCard(b) {
  if (!b) return null;
  const head = (chipEl) => h('div', { class: 'section-head' },
    h('div', { class: 'stack sm' }, h('h2', { id: 'bl-title', text: t('home.bl.title') }), h('p', { text: t('home.bl.sub', { wave: waveLabel(b.wave) }) })), chipEl);
  if (b.status === 'submitted' && b.result) return baselineResult(b, head);
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
function scaleLabel(level) {
  const sc = ((S.catalog && S.catalog.scale) || []).find((x) => Number(x.level) === Number(level));
  if (!sc) return { short: String(level), long: '' };
  return { short: sc.abbr ? `${level} · ${sc.abbr}` : String(level), long: getLang() === 'vi' ? sc.vi : sc.en };
}
function baselineResult(b, head) {
  const r = b.result; const gaps = r.gaps || [];
  const byCode = new Map((S.courses || []).map((c) => [c.code, c]));
  const name = (code) => (byCode.get(code) ? pick(byCode.get(code), 'name') : code);
  const prev = b.previous;
  const rows = (S.courses || []).map((c) => {
    const sc = r.by_course ? r.by_course[c.code] : null;
    const self = r.self ? r.self[c.code] : null;
    const isGap = gaps.includes(c.code);
    const fill = h('i'); fill.style.width = `${Math.max(0, Math.min(100, Number(sc) || 0))}%`;
    const sl = self !== null && self !== undefined ? scaleLabel(self) : null;
    return h('li', { class: `rb-row${isGap ? ' gap' : ''}` },
      h('span', { class: `rb-code fam-${c.code.charAt(0)}`, title: pick(c, 'name') }, c.code),
      h('span', { class: 'rb-track', role: 'img', 'aria-label': t('home.bl.row_aria', { code: c.code, name: pick(c, 'name'), pct: sc === null || sc === undefined ? '—' : pct(sc), self: sl ? `${sl.short} ${sl.long}` : '—' }) }, fill),
      h('span', { class: 'rb-pct num', text: sc === null || sc === undefined ? '—' : pct(sc) }),
      h('span', { class: 'rb-self', title: sl ? sl.long : '' }, sl ? sl.short : '—'),
      isGap ? h('span', { class: 'rb-gap' }, icon('target', 'sm'), h('span', { class: 'sr-only', text: t('home.bl.gap_sr') })) : h('span', { class: 'rb-gap' }));
  });
  return h('section', { 'aria-labelledby': 'bl-title' },
    head(chip(t('home.bl.chip_done'), 'pass', 'check')),
    h('div', { class: 'card bl-result' },
      h('div', { class: 'pad bl-top' },
        h('div', { class: 'bl-score' }, ring(r.score_pct, { size: 84, stroke: 8, blue: true, ariaLabel: t('home.bl.overall_aria', { pct: r.score_pct }) }),
          h('div', null, h('p', { class: 'strong ink', text: t('home.bl.overall') }),
            h('p', { class: 'small muted', text: b.submitted_at ? t('home.bl.taken', { date: fmtShortDate(b.submitted_at) }) : '' }),
            prev && prev.score_pct !== undefined ? h('p', { class: 'small muted', text: t('home.bl.previous', { pct: pct(prev.score_pct), wave: waveLabel(prev.wave) }) }) : null)),
        gaps.length ? h('div', { class: 'callout warn bl-gaps' }, icon('target'),
          h('div', { class: 'stack sm' },
            h('p', { class: 'strong', text: t('home.bl.gaps_title') }),
            h('ul', { class: 'gap-list' }, gaps.map((g) => h('li', null, h('b', { text: g }), ' ', name(g), ' · ', pct(r.by_course ? r.by_course[g] : 0)))),
            h('p', { class: 'small', text: t('home.bl.gaps_idp') }))) : null),
      h('div', { class: 'pad bl-rows' },
        h('div', { class: 'rb-head xs muted', 'aria-hidden': 'true' }, [0, 1].map(() => h('div', { class: 'rb-hrow' },
          h('span', { text: t('home.bl.col_course') }), h('span', { text: t('home.bl.col_score') }), h('span'), h('span', { text: t('home.bl.col_self') }), h('span')))),
        h('ul', { class: 'rb-list' }, rows),
        h('p', { class: 'xs muted rb-note', text: t('home.bl.note') }))));
}

// Courses grouped by cycle, calendar order, as a learning path.
function cycleMonths(list) {
  const from = list.map((c) => c.online_from).filter(Boolean).sort()[0];
  const to = list.map((c) => c.forum_date).filter(Boolean).sort().pop();
  if (!from) return '';
  const a = monthLabel(from); const b = to ? monthLabel(to) : a;
  return a === b ? a : `${a}–${b}`;
}
function coursesSection(courses, ns) {
  const cycles = [];
  courses.forEach((c) => { let g = cycles.find((x) => x.n === c.cycle); if (!g) { g = { n: c.cycle, list: [] }; cycles.push(g); } g.list.push(c); });
  const focus = ns && ns.course ? ns.course.code : null;
  const passedN = courses.filter((c) => c.checkpoint && c.checkpoint.status === 'passed').length;
  return h('section', { 'aria-labelledby': 'courses-title' },
    h('div', { class: 'section-head' },
      h('div', { class: 'stack sm' }, h('h2', { id: 'courses-title', text: t('home.courses.title') }), h('p', { text: t('home.courses.sub', { n: passedN, total: courses.length }) }))),
    h('ol', { class: 'timeline cycles' }, cycles.map((g) => {
      const done = g.list.every((c) => c.checkpoint && c.checkpoint.status === 'passed');
      const now = !done && g.list.some((c) => c.code === focus);
      const forum = g.list.map((c) => c.forum_date).filter(Boolean).sort()[0];
      return h('li', { class: done ? 'done' : now ? 'now' : null },
        h('span', { class: 'tl-dot', 'aria-hidden': 'true' }, done ? icon('check', 'sm') : String(g.n)),
        h('div', { class: 'cycle-head' },
          h('h3', { class: 'cycle-label' }, t('home.courses.cycle', { n: g.n }), h('span', { class: 'cycle-months', text: ` · ${cycleMonths(g.list)}` })),
          forum ? h('span', { class: 'xs muted' }, icon('calendar', 'sm'), ' ', t('home.courses.forum_on', { date: fmtShortDate(forum) })) : null),
        h('div', { class: 'cycle-grid' }, g.list.map(courseCard)));
    })));
}
function courseCard(c) {
  const s = courseStatus(c);
  const p = courseProgress(c);
  const locked = s.key === 'locked';
  const href = `course.html?c=${encodeURIComponent(c.code)}`;
  return h('a', { class: `card hover card-link course-card fam-${c.code.charAt(0)}${locked ? ' locked' : ''}`, href },
    h('div', { class: 'band' }),
    h('div', { class: 'body' },
      h('div', { class: 'top' }, codeBadge(c.code), h('span', { class: 'cc-family', text: t(`family.${c.family || c.code.charAt(0)}`) })),
      h('h4', { class: 'cc-name', text: pick(c, 'name') }),
      h('p', { class: 'promise', text: pick(c, 'promise') }),
      h('p', { class: 'meta' },
        c.online_from ? h('span', null, icon('video', 'sm'), t('home.courses.online', { date: fmtShortDate(c.online_from) })) : null,
        c.forum_date ? h('span', null, icon('users', 'sm'), t('home.courses.forum', { date: fmtShortDate(c.forum_date) })) : null)),
    h('div', { class: 'foot' }, (() => { const el = chip(s.label, s.variant, s.icon); el.title = s.label; return el; })(), h('span', { class: 'spacer' }),
      locked ? h('span', { class: 'cc-lock' }, icon('lock')) : ring(p.pct, { size: 44, stroke: 5, ariaLabel: t('home.courses.progress_aria', { pct: p.pct }) }),
      h('span', { class: 'cc-go' }, icon('chevron-right'))));
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
    items.push({ date: d, icon: 'flag', title: t('home.up.checkpoint_closes', { codes: set.map((c) => c.code).join(' + ') }), sub: set.length === 1 ? pick(set[0], 'name') : t('home.up.checkpoint_sub'), href: `course.html?c=${encodeURIComponent(set[0].code)}`, prio: 1 });
  }
  const forums = courses.filter((c) => c.forum_date && c.forum_date >= today).sort((x, y) => (x.forum_date < y.forum_date ? -1 : 1));
  if (forums.length) {
    const d = forums[0].forum_date; const set = forums.filter((c) => c.forum_date === d);
    items.push({ date: d, icon: 'users', title: t('home.up.forum', { codes: set.map((c) => c.code).join(' + ') }), sub: pick(set[0].forum || {}, 'title'), href: `course.html?c=${encodeURIComponent(set[0].code)}`, prio: 1 });
  }
  const pitch = S.catalog && S.catalog.program && S.catalog.program.pitch_day;
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

function capstoneCard(cap) {
  const prog = (S.catalog && S.catalog.program) || {};
  const c = cap || {};
  const submitted = !!c.pitch_submitted_at;
  return h('section', { class: 'card pad stack cap-card', 'aria-labelledby': 'cap-title' },
    h('div', { class: 'row' }, h('span', { class: 'tile-icon' }, icon('trophy')), h('div', { class: 'grow' }, h('p', { class: 'eyebrow', text: t('home.cap.eyebrow') }), h('h2', { id: 'cap-title', class: 'title-sm', text: c.project_title || t('home.cap.no_team') }))),
    h('p', { class: 'small muted', text: c.team_id ? t('home.cap.body', { date: fmtLongDate(prog.pitch_day || '2027-06-22') }) : t('home.cap.no_team_body') }),
    c.team_id ? h('div', { class: 'row tight' },
      submitted ? chip(t('home.cap.pitch_done'), 'pass', 'check') : chip(t('home.cap.pitch_due', { date: fmtShortDate(c.pitch_deadline || prog.pitch_day) }), 'info', 'clock')) : null,
    h('div', null, h('a', { class: 'btn btn-secondary', href: 'capstone.html' }, t('home.cap.open'), icon('arrow-right'))));
}
function managerCard() {
  return h('section', { class: 'card pad stack mgr-card', 'aria-labelledby': 'mgr-title' },
    h('div', { class: 'row' }, h('span', { class: 'tile-icon' }, icon('users')), h('h2', { id: 'mgr-title', class: 'title-sm grow', text: t('home.mgr.title') })),
    h('p', { class: 'small muted', text: t('home.mgr.body') }),
    h('div', null, h('a', { class: 'btn btn-secondary', href: 'team.html#gates' }, t('home.mgr.open'), icon('arrow-right'))));
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
      return h('li', { class: `cert${earned ? ' earned' : ''}${active ? ' active' : ''}` },
        h('div', { class: 'row' }, h('span', { class: 'medal' }, icon(earned ? 'award' : i === 2 ? 'star' : 'award')),
          h('div', { class: 'grow' }, h('p', { class: 'xs muted strong', text: t('cert.level_n', { n: i + 1 }) }), h('h3', { text: t(`cert.${lv}`) })),
          earned ? chip(t('cert.earned'), 'pass', 'check') : active ? chip(t('cert.working'), 'info') : null),
        h('p', { class: 'small muted', text: t(`cert.${lv}_promise`) }),
        bar,
        h('ul', null, defs[lv]));
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
