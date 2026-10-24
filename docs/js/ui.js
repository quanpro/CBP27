// Shared UI: element builder, icons, page shell (header, tab bar, footer, demo banner),
// theme, dialogs, toasts, loading/empty/error states, rings and bars, change-PIN form.
// Text from the Sheet is always inserted as text nodes (never innerHTML).
import { initI18n, t, getLang, setLang, onLangChange, applyI18n } from './i18n.js';
import { api, getSession, setSession, clearSession, isDemo, onSessionExpired, resetDemo, ApiError } from './api.js';
import { fmtDateTime } from './courses.js';

// ---------- Element builder ----------
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}
export function append(el, children) {
  for (const c of [children].flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function render(el, ...children) { clear(el); return append(el, children); }
export const qs = (name) => new URLSearchParams(location.search).get(name);
export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Icons (24×24 stroke icons; static markup only) ----------
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  book: '<path d="M4 19.5V5a2 2 0 0 1 2-2h14v16H6.5A2.5 2.5 0 0 0 4 21.5"/><path d="M8 7h8"/><path d="M8 11h6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4"/><path d="M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4"/><path d="M8 21h8"/><path d="M9.5 17h5l.5 4h-6z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.5h.01"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.9.7c0 1.6-2.4 2.3-2.4 3.8"/><path d="M12 17h.01"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  check: '<path d="M5 12.5 10 17.5 19 7"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17"/><path d="M8 3v4"/><path d="M16 3v4"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  'chevron-right': '<path d="m9 6 6 6-6 6"/>',
  'chevron-left': '<path d="m15 6-6 6 6 6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'arrow-right': '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="m10 17-5-5 5-5"/><path d="M5 12h11"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>',
  alert: '<path d="M10.3 4.2 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  flame: '<path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 .3 2 1.5 3 2.5 3 0-3-1-5.5 0-8z"/>',
  award: '<circle cx="12" cy="9" r="6"/><path d="m8.5 14-1.5 7 5-2.5 5 2.5-1.5-7"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3z"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="m3 3 18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1"/><path d="M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  'wifi-off': '<path d="m2 2 20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M5 12.5a10 10 0 0 1 5-2.7"/><path d="M14 9.8a10 10 0 0 1 5 2.7"/><path d="M12 20h.01"/>',
  cloud: '<path d="M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1 0 8z"/><path d="m9.5 13.5 2 2 3.5-4"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9"/><path d="m17 6 3 3"/>',
  'trend-up': '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
};
export function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `icon ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = ICONS[name] || ICONS.circle; // static, trusted markup
  return svg;
}

// ---------- Theme ----------
const THEME_KEY = 'hub.theme';
const THEMES = ['system', 'light', 'dark'];
function readTheme() { try { const v = localStorage.getItem(THEME_KEY); return THEMES.includes(v) ? v : 'system'; } catch (e) { return 'system'; } }
export function applyTheme(mode = readTheme()) {
  if (mode === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', mode);
}
function cycleTheme() {
  const next = THEMES[(THEMES.indexOf(readTheme()) + 1) % THEMES.length];
  try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
  applyTheme(next);
  return next;
}
applyTheme();

// ---------- Small components ----------
export function chip(label, variant = '', iconName = null) {
  return h('span', { class: `chip ${variant}`.trim() }, iconName ? icon(iconName) : null, label);
}
export function codeBadge(code) { return h('span', { class: `code-badge fam-${String(code).charAt(0)}` }, code); }

export function ring(pct, { size = 56, stroke = 6, label, blue = false, ariaLabel } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', size); svg.setAttribute('height', size); svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('aria-hidden', 'true');
  for (const cls of ['track', 'bar']) {
    const circle = document.createElementNS(NS, 'circle');
    circle.setAttribute('class', cls);
    circle.setAttribute('cx', size / 2); circle.setAttribute('cy', size / 2); circle.setAttribute('r', r);
    circle.setAttribute('fill', 'none'); circle.setAttribute('stroke-width', stroke);
    if (cls === 'bar') { circle.setAttribute('stroke-linecap', 'round'); circle.setAttribute('stroke-dasharray', c); circle.setAttribute('stroke-dashoffset', c * (1 - p / 100)); }
    svg.append(circle);
  }
  return h('span', { class: `ring${blue ? ' blue' : ''}`, role: 'img', 'aria-label': ariaLabel || t('a11y.percent', { pct: Math.round(p) }) },
    svg, h('span', { class: 'label', style: { fontSize: size < 50 ? '11px' : '13px' } }, label !== undefined ? label : `${Math.round(p)}%`));
}

export function progressBar(pct, { blue = false, thin = false, label } = {}) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const i = h('i'); i.style.width = `${p}%`;
  return h('div', { class: `progress${blue ? ' blue' : ''}${thin ? ' thin' : ''}`, role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(p), 'aria-label': label || t('a11y.progress') }, i);
}

/**
 * Six-segment mini stepper for a course: "Step 3 of 6 · Checkpoint" (never a percentage).
 * info = courses.stepInfo(course). onHero: white-on-blue variant.
 */
export function stepMeter(info, { onHero = false, compact = false } = {}) {
  const label = info.all ? t('steps.meter_done', { total: info.total }) : t('steps.meter', { n: info.n, total: info.total, label: t(`steps.${info.key}`) });
  const aria = info.all ? label : t('steps.meter_aria', { n: info.n, total: info.total, label: t(`steps.${info.key}`), done: info.done });
  return h('div', { class: `step-meter${onHero ? ' on-hero' : ''}${compact ? ' compact' : ''}`, role: 'img', 'aria-label': aria },
    h('span', { class: 'sm-segs', 'aria-hidden': 'true' }, info.steps.map((s) => h('i', { class: s.state }))),
    h('span', { class: 'sm-label', 'aria-hidden': 'true', text: label }));
}

export function skeleton(lines = 3) {
  return h('div', { class: 'stack sm', 'aria-hidden': 'true' },
    Array.from({ length: lines }, (_, i) => { const s = h('div', { class: 'skeleton' }); s.style.width = `${[92, 76, 84, 60, 70][i % 5]}%`; s.style.height = i === 0 ? '22px' : '14px'; return s; }));
}
export function loading(text) {
  return h('div', { class: 'loading-screen', role: 'status', 'aria-live': 'polite' }, h('span', { class: 'spinner' }), h('span', { text: text || t('common.loading') }));
}
export function emptyState({ iconName = 'info', title, body, action } = {}) {
  return h('div', { class: 'empty' }, h('div', { class: 'em-icon' }, icon(iconName, 'lg')), title ? h('h3', { text: title }) : null, body ? h('p', { text: body }) : null, action || null);
}
export function errorMessage(err) {
  const code = (err && err.code) || 'generic';
  // A third lock in 7 days has no end time (until: null): only an admin can clear it (F22).
  const key = code === 'locked' && err && !err.until ? 'errors.locked_admin' : `errors.${code}`;
  const vars = { ...(err || {}) };
  ['until', 'next_retake_at', 'opens_at'].forEach((k) => { if (vars[k]) vars[k] = fmtDateTime(vars[k]); });
  const msg = t(key, vars);
  return msg === key ? t('errors.generic') : msg;
}
export function errorState(err, retry) {
  return h('div', { class: 'callout bad', role: 'alert' }, icon('alert'),
    h('div', { class: 'stack sm' }, h('b', { text: errorMessage(err) }),
      retry ? h('div', null, h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: retry }, icon('refresh'), t('common.retry'))) : null));
}

// ---------- Toasts ----------
let toastBox = null;
export function toast(message, variant = '') {
  if (!toastBox) { toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(toastBox); }
  const el = h('div', { class: `toast ${variant}` }, icon(variant === 'bad' ? 'alert' : 'check-circle'), h('span', { text: message }));
  toastBox.append(el);
  setTimeout(() => el.remove(), 4200);
}

// ---------- Dialogs ----------
export function modal({ title, body, actions = [], dismissable = true, labelledBy } = {}) {
  const id = labelledBy || `dlg-${Math.random().toString(36).slice(2, 8)}`;
  const dlg = h('dialog', { class: 'modal', 'aria-labelledby': id });
  const content = h('div', { class: 'pad stack' }, title ? h('h2', { id, text: title }) : null, body);
  dlg.append(content);
  if (actions.length) dlg.append(h('div', { class: 'actions' }, actions));
  if (!dismissable) dlg.addEventListener('cancel', (e) => e.preventDefault());
  dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 0));
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}
export function confirmDialog({ title, body, confirm, cancel, danger = false } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const ok = h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', onclick: () => { result = true; dlg.close(); } }, confirm || t('common.confirm'));
    const no = h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => dlg.close() }, cancel || t('common.cancel'));
    const dlg = modal({ title, body: typeof body === 'string' ? h('p', { text: body }) : body, actions: [no, ok] });
    dlg.addEventListener('close', () => resolve(result));
    ok.focus();
  });
}

// ---------- Change-PIN form (used by onboarding and the user menu) ----------
export function changePinForm({ forced = false, onDone } = {}) {
  const err = h('p', { class: 'err', role: 'alert', hidden: true });
  const mk = (id, key) => {
    const input = h('input', { class: 'input pin', id, type: 'password', inputmode: 'numeric', autocomplete: id === 'pin-old' ? 'current-password' : 'new-password', maxlength: 6, pattern: '[0-9]{6}', required: true });
    return { input, field: h('div', { class: 'field' }, h('label', { for: id, text: t(key) }), input) };
  };
  const oldF = mk('pin-old', forced ? 'pin.current_issued' : 'pin.current');
  const newF = mk('pin-new', 'pin.new');
  const repF = mk('pin-rep', 'pin.repeat');
  const btn = h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'submit' }, t('pin.save'));
  const form = h('form', { class: 'stack', novalidate: true },
    h('p', { class: 'muted', text: t(forced ? 'pin.forced_intro' : 'pin.intro') }),
    oldF.field, newF.field, h('p', { class: 'hint small muted', text: t('pin.rules') }), repF.field, err, btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const o = oldF.input.value.trim(); const n = newF.input.value.trim(); const r = repF.input.value.trim();
    const show = (msg) => { err.textContent = msg; err.hidden = false; };
    if (!/^\d{6}$/.test(o) || !/^\d{6}$/.test(n)) return show(t('pin.six_digits'));
    if (n !== r) return show(t('pin.mismatch'));
    btn.disabled = true;
    try {
      const res = await api.changePin(o, n);
      setSession(res);
      toast(t('pin.changed'), 'ok');
      if (onDone) onDone(res);
    } catch (ex) {
      show(errorMessage(ex));
    } finally { btn.disabled = false; }
  });
  return form;
}
export function openChangePinDialog() {
  let dlg;
  const form = changePinForm({ onDone: () => dlg.close() });
  dlg = modal({ title: t('pin.title'), body: form, actions: [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => dlg.close() }, t('common.cancel'))] });
}

// ---------- Session expiry: sign in again without losing answers ----------
function reloginDialog() {
  return new Promise((resolve) => {
    const prevCode = (() => { try { return localStorage.getItem('hub.lastCode') || ''; } catch (e) { return ''; } })();
    const code = h('input', { class: 'input', id: 'rl-code', autocomplete: 'username', value: prevCode, required: true });
    const pin = h('input', { class: 'input pin', id: 'rl-pin', type: 'password', inputmode: 'numeric', maxlength: 6, autocomplete: 'current-password', required: true });
    const err = h('p', { class: 'err', role: 'alert', hidden: true });
    let done = false;
    const submit = h('button', { class: 'btn btn-primary', type: 'submit', form: 'rl-form' }, t('login.submit'));
    const form = h('form', { id: 'rl-form', class: 'stack' },
      h('p', { class: 'muted', text: t('login.expired_body') }),
      h('div', { class: 'field' }, h('label', { for: 'rl-code', text: t('login.code') }), code),
      h('div', { class: 'field' }, h('label', { for: 'rl-pin', text: t('login.pin') }), pin), err);
    const dlg = modal({ title: t('login.expired_title'), body: form, dismissable: false, actions: [
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { dlg.close(); } }, t('common.cancel')), submit] });
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); err.hidden = true; submit.disabled = true;
      try {
        const res = await api.login(code.value.trim(), pin.value.trim());
        setSession(res); done = true; dlg.close();
      } catch (ex) { err.textContent = errorMessage(ex); err.hidden = false; }
      finally { submit.disabled = false; }
    });
    dlg.addEventListener('close', () => { if (!done) location.href = 'index.html'; resolve(done); });
    (prevCode ? pin : code).focus();
  });
}
// One dialog for every request that hits session_expired at the same time (a page often loads two or three at once).
let reloginPending = null;
onSessionExpired(() => reloginPending || (reloginPending = reloginDialog().finally(() => { reloginPending = null; })));

// ---------- Page shell ----------
const NAV = [
  { key: 'home', href: 'index.html', icon: 'home', label: 'nav.home' },
  { key: 'team', href: 'team.html', icon: 'grid', label: 'nav.team' },
  { key: 'capstone', href: 'capstone.html', icon: 'trophy', label: 'nav.capstone' },
  { key: 'panel', href: 'panel.html', icon: 'star', label: 'nav.panel', roles: ['panel', 'admin'] },
  { key: 'about', href: 'about.html', icon: 'shield', label: 'nav.about' },
];

function navItems(profile) {
  const roles = (profile && profile.roles) || [];
  return NAV.filter((n) => !n.roles || n.roles.some((r) => roles.includes(r)));
}

export async function logout() {
  const s = getSession();
  // Server-side sign-out (bumps session_ver so the token stops working everywhere); best effort, 4 s max.
  if (s) await Promise.race([api.logout().catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
  // On a shared PC, forget the employee code too unless the person chose "Keep me signed in".
  if (!(s && s.remember)) { try { localStorage.removeItem('hub.lastCode'); } catch (e) { /* ignore */ } }
  clearSession();
  location.href = 'index.html';
}

// The user menu of the current header. Document listeners are registered once (the header is rebuilt
// on every language or theme change) and always act on the latest menu.
let openMenu = null;
document.addEventListener('click', (e) => { if (openMenu && !openMenu.menu.hidden && !openMenu.menu.contains(e.target)) openMenu.close(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openMenu && !openMenu.menu.hidden) { openMenu.close(); openMenu.btn.focus(); } });

function headerEl({ page, focus, session, exitHref }) {
  openMenu = null;
  const profile = session && session.profile;
  const brand = h('a', { class: 'brand', href: 'index.html', 'aria-label': t('brand.home_aria') },
    h('img', { src: 'assets/marico-logo.png', alt: '', width: 38, height: 38 }),
    h('span', { class: 'brand-text' }, h('b', { text: t('brand.name') }), h('span', { text: t('brand.tagline') })));
  const items = !focus && session ? navItems(profile) : [];
  const nav = items.length ? h('nav', { class: `nav-primary${items.length > 4 ? ' many' : ''}`, 'aria-label': t('nav.aria') },
    items.map((n) => h('a', { href: n.href, 'aria-current': n.key === page ? 'page' : null }, icon(n.icon), t(n.label)))) : null;

  const lang = getLang();
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': t('lang.aria') },
    ['en', 'vi'].map((code) => h('button', { type: 'button', 'aria-pressed': String(lang === code), lang: code, onclick: () => setLang(code) }, code.toUpperCase())));
  const themeNow = readTheme();
  const themeIcon = themeNow === 'dark' ? 'moon' : themeNow === 'light' ? 'sun' : 'monitor';
  const themeBtn = h('button', { class: 'icon-btn theme-btn', type: 'button', 'aria-label': t('theme.aria', { mode: t(`theme.${themeNow}`) }), title: t(`theme.${themeNow}`),
    onclick: () => { cycleTheme(); rebuildShell(); } }, icon(themeIcon));

  // Phones under 400 px: the theme button moves into the user menu so "The 1% Planner" fits.
  const actions = h('div', { class: `header-actions${session && !focus ? ' has-menu' : ''}` }, seg, themeBtn);
  if (focus && exitHref) {
    actions.append(h('a', { class: 'btn btn-ghost btn-sm', href: exitHref }, icon('x'), h('span', { class: 'hide-sm', text: t('common.exit') })));
  } else if (session) {
    const initial = (profile.first_name || profile.code || '?').trim().charAt(0).toUpperCase();
    const menuId = 'user-menu';
    const btn = h('button', { class: 'user-btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': menuId },
      h('span', { class: 'avatar', 'aria-hidden': 'true', text: initial }), h('span', { class: 'name', text: profile.first_name || profile.code }), icon('chevron-down', 'sm chev'));
    const menu = h('div', { class: 'menu', id: menuId, role: 'menu', hidden: true },
      h('div', { class: 'menu-head' }, h('b', { class: 'ink', text: profile.first_name || profile.code }), h('div', { class: 'small muted', text: profile.role_area ? `${profile.code} · ${t(`role.${profile.role_area}`)}` : profile.code })),
      h('button', { type: 'button', role: 'menuitem', onclick: () => { closeMenu(); openChangePinDialog(); } }, icon('key'), t('menu.change_pin')),
      h('button', { type: 'button', role: 'menuitem', class: 'menu-theme', 'aria-label': t('theme.aria', { mode: t(`theme.${themeNow}`) }),
        onclick: () => { cycleTheme(); rebuildShell(); const b = document.querySelector('.user-btn'); if (b) b.focus(); } },
      icon(themeIcon), h('span', { class: 'grow', text: t('theme.menu') }), h('span', { class: 'menu-val', text: t(`theme.short_${themeNow}`) })),
      h('a', { href: 'about.html', role: 'menuitem' }, icon('shield'), t('menu.privacy')),
      h('button', { type: 'button', role: 'menuitem', onclick: logout }, icon('logout'), t('menu.logout')));
    const closeMenu = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', (e) => { e.stopPropagation(); const open = menu.hidden; menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); if (open) menu.querySelector('[role="menuitem"]').focus(); });
    openMenu = { menu, btn, close: closeMenu };
    actions.append(btn, menu);
  }
  const header = h('header', { class: `app-header${focus ? ' is-focus' : ''}` }, h('div', { class: 'container' }, brand, nav, actions));
  const frag = document.createDocumentFragment();
  if (isDemo()) {
    frag.append(h('div', { class: 'demo-banner', role: 'note' }, h('div', { class: 'container' },
      icon('info'), h('b', { text: t('demo.label') }), h('span', { class: 'demo-long', text: t('demo.body') }), h('span', { class: 'demo-short', text: t('demo.short') }))));
  }
  frag.append(header);
  return frag;
}

function footerEl({ focus, session, page }) {
  const frag = document.createDocumentFragment();
  const links = h('div', { class: 'row' },
    h('span', { class: 'lock' }, icon('lock', 'sm'), t('footer.privacy')),
    h('a', { href: 'about.html', text: t('footer.about') }));
  if (isDemo()) links.append(h('button', { class: 'link-btn', type: 'button', onclick: async () => { await resetDemo(); location.href = 'index.html?mock=1'; } }, t('demo.reset')));
  frag.append(h('footer', { class: 'app-footer' }, h('div', { class: 'container' }, links, h('span', { class: 'spacer' }), h('span', { class: 'xs', text: t('footer.program') }))));
  if (!focus && session) {
    frag.append(h('nav', { class: 'tabbar', 'aria-label': t('nav.aria_mobile') },
      navItems(session.profile).map((n) => h('a', { href: n.href, 'aria-current': n.key === page ? 'page' : null }, icon(n.icon), h('span', { text: t(`${n.label}_short`) })))));
    document.body.classList.add('has-tabbar');
  } else document.body.classList.remove('has-tabbar');
  return frag;
}

let shellOpts = null;
function rebuildShell() {
  if (!shellOpts) return;
  const session = getSession();
  render(document.getElementById('shell-top'), headerEl({ ...shellOpts, session }));
  render(document.getElementById('shell-bottom'), footerEl({ ...shellOpts, session }));
  applyI18n(document);
}

/**
 * Start a page: loads strings, draws header/footer, enforces sign-in.
 * @param {object} o  page: nav key · auth: require sign-in (default true) · focus: minimal header (quiz, baseline) · exitHref
 * @returns {Promise<{session, app: HTMLElement}>}
 */
export async function mountShell(o = {}) {
  shellOpts = { page: o.page, focus: !!o.focus, exitHref: o.exitHref || 'index.html' };
  await initI18n();
  let session = getSession();
  if (o.auth !== false && !session) {
    const next = encodeURIComponent(location.pathname.split('/').pop() + location.search + location.hash);
    location.replace(`index.html?next=${next}`);
    return new Promise(() => {}); // never resolves; the page is leaving
  }
  if (o.auth !== false && session && session.profile && (session.profile.must_change_pin || session.profile.consent_needed) && o.page !== 'home') {
    location.replace('index.html');
    return new Promise(() => {});
  }
  rebuildShell();
  onLangChange(() => {
    rebuildShell();
    if (session) api.setLang(getLang()).catch(() => {}); // remember on the server too (best effort)
  });
  session = getSession();
  return { session, app: document.getElementById('app') };
}

/** Re-draw header/footer (e.g. after sign-in or sign-out on the same page). */
export function refreshShell() { rebuildShell(); }

export { t, getLang, ApiError };
