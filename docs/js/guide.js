// Guidance (specs/19 F30): the "What to do here" box at the top of a page and short guided tours.
// - guideBox(): This page / Now / Next, built by each page from the person's status. It folds away
//   (remembered per page in localStorage) and unfolds from its own header.
// - Tours: a few stops that point at parts of the page, the first time someone opens it (home, course,
//   baseline). "Show me around" in the user menu replays the tour of the page you are on.
// No third-party code. Text comes from i18n or from the person's own data (textContent only).
import { h, icon } from './ui.js';
import { t } from './i18n.js';

function store(op, key, val) {
  try {
    if (op === 'get') return localStorage.getItem(key);
    if (op === 'set') localStorage.setItem(key, val);
    if (op === 'del') localStorage.removeItem(key);
  } catch (e) { /* storage blocked: the box stays open, the tour may show again */ }
  return null;
}

// ---------------------------------------------------------------- "What to do here"
/**
 * @param {object} o  id: page key · page: what the page is for · now: what to do now · next: what comes
 *   after (optional) · tour: id of this page's tour (adds "Show me around")
 */
export function guideBox({ id, page, now, next, tour }) {
  const key = `hub.guide.${id}`;
  const bodyId = `guide-body-${id}`;
  let open = store('get', key) !== 'closed';
  const body = h('div', { class: 'guide-body', id: bodyId, hidden: !open },
    h('dl', { class: 'guide-dl' },
      h('div', null, h('dt', { text: t('guide.page') }), h('dd', { text: page })),
      now ? h('div', { class: 'guide-now' }, h('dt', { text: t('guide.now') }), h('dd', { text: now })) : null,
      next ? h('div', null, h('dt', { text: t('guide.next') }), h('dd', { text: next })) : null),
    tour && hasTour(tour) ? h('button', { class: 'link-btn guide-tour', type: 'button', onclick: () => startTour(tour, { force: true }) }, icon('compass', 'sm'), t('guide.tour')) : null);
  const toggle = h('button', { class: 'guide-toggle', type: 'button', 'aria-expanded': String(open), 'aria-controls': bodyId },
    h('span', { class: 'guide-q', 'aria-hidden': 'true' }, icon('help', 'sm')),
    h('span', { class: 'guide-title', text: t('guide.title') }),
    h('span', { class: 'guide-state', text: t(open ? 'guide.hide' : 'guide.show') }),
    icon('chevron-down', 'sm guide-chev'));
  const box = h('section', { class: `guide${open ? '' : ' folded'}`, 'aria-label': t('guide.title'), 'data-guide': id }, toggle, body);
  toggle.addEventListener('click', () => {
    open = !open;
    body.hidden = !open;
    box.classList.toggle('folded', !open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.querySelector('.guide-state').textContent = t(open ? 'guide.hide' : 'guide.show');
    store('set', key, open ? 'open' : 'closed');
  });
  return box;
}

// ---------------------------------------------------------------- tours
const TOURS = new Map(); // id → () => [{ el, title, body }]
let active = null;

/** A page registers its tour: getSteps returns stops whose element exists on the page now. */
export function registerTour(id, getSteps) { TOURS.set(id, getSteps); }
export function hasTour(id) { return TOURS.has(id); }
/** The tour of the page on screen, if any (for "Show me around" in the user menu). */
export function currentTour() { return TOURS.size ? [...TOURS.keys()].pop() : null; }
export const tourSeen = (id) => store('get', `hub.tour.${id}`) === 'done';

/** Starts the tour once, the first time (call after the page has drawn its content). */
export function maybeStartTour(id) {
  if (tourSeen(id) || active) return;
  setTimeout(() => { if (!tourSeen(id) && !active) startTour(id); }, 400);
}

const visible = (el) => !!el && el.isConnected && el.getClientRects().length > 0;

export function startTour(id, { force = false } = {}) {
  const get = TOURS.get(id);
  if (!get || (active && !force)) return;
  if (active) active.end(false);
  const steps = get().filter((s) => visible(s.el));
  if (!steps.length) return;
  let i = 0;
  const returnFocus = document.activeElement;
  const ring = h('div', { class: 'tour-ring', 'aria-hidden': 'true' });
  const titleId = `tour-title-${id}`;
  const count = h('p', { class: 'tour-count xs strong' });
  const title = h('h2', { class: 'tour-title', id: titleId });
  const text = h('p', { class: 'tour-text small' });
  const back = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, icon('chevron-left', 'sm'), t('tour.back'));
  const next = h('button', { class: 'btn btn-primary btn-sm', type: 'button' });
  const skip = h('button', { class: 'link-btn tour-skip', type: 'button', text: t('tour.skip') });
  const pop = h('div', { class: 'tour-pop', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' },
    count, title, text, h('div', { class: 'tour-actions' }, skip, h('span', { class: 'spacer' }), back, next));
  document.body.append(ring, pop);

  function place() {
    const s = steps[i];
    const r = s.el.getBoundingClientRect();
    const pad = 6;
    Object.assign(ring.style, { top: `${r.top - pad}px`, left: `${r.left - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    const vw = document.documentElement.clientWidth; const vh = window.innerHeight;
    if (vw < 600) { pop.classList.add('sheet'); pop.style.top = ''; pop.style.left = ''; return; }
    pop.classList.remove('sheet');
    const pw = pop.offsetWidth; const ph = pop.offsetHeight;
    if (r.height > vh * 0.55) { // a tall section: the card waits in the bottom-right corner
      pop.style.top = `${vh - ph - 16}px`; pop.style.left = `${vw - pw - 16}px`;
      return;
    }
    let top = r.bottom + 14;
    if (top + ph > vh - 12) top = Math.max(12, r.top - ph - 14);
    let left = Math.min(Math.max(12, r.left), vw - pw - 12);
    if (top < 12) { top = 12; left = Math.min(vw - pw - 12, r.right + 14); }
    pop.style.top = `${top}px`; pop.style.left = `${left}px`;
  }
  function show(n) {
    i = n;
    const s = steps[i];
    count.textContent = t('tour.count', { n: i + 1, total: steps.length });
    title.textContent = s.title;
    text.textContent = s.body;
    back.hidden = i === 0;
    next.textContent = '';
    next.append(t(i === steps.length - 1 ? 'tour.done' : 'tour.next'));
    if (i < steps.length - 1) next.append(icon('arrow-right', 'sm'));
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tall = s.el.getBoundingClientRect().height > window.innerHeight * 0.55;
    s.el.scrollIntoView({ block: tall ? 'start' : 'center', behavior: reduce ? 'auto' : 'smooth' });
    setTimeout(place, reduce ? 0 : 350);
    place();
    pop.focus({ preventScroll: true });
  }
  function end(remember = true) {
    if (remember) store('set', `hub.tour.${id}`, 'done');
    window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true);
    document.removeEventListener('keydown', onKey, true);
    ring.remove(); pop.remove();
    active = null;
    if (returnFocus && returnFocus.isConnected && typeof returnFocus.focus === 'function') returnFocus.focus({ preventScroll: true });
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); end(); return; }
    if (e.key === 'Tab') { // keep focus inside the tour card
      const f = [...pop.querySelectorAll('button:not([hidden])')];
      if (!f.length) return;
      const first = f[0]; const last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === pop)) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  back.addEventListener('click', () => show(Math.max(0, i - 1)));
  next.addEventListener('click', () => (i === steps.length - 1 ? end() : show(i + 1)));
  skip.addEventListener('click', () => end());
  window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
  document.addEventListener('keydown', onKey, true);
  active = { end };
  show(0);
}
