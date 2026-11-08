// Baseline v2 helpers shared by the dashboard (index.html) and baseline.html (specs/22).
// A part tile: "Part 1 · Problem solving with data · 65 min · 32 questions" with its state
// (opens when your admin starts it · not started · in progress, time left · done).
import { h, icon, chip } from './ui.js';
import { t, getLang } from './i18n.js';
import { serverNow } from './api.js';

export const PARTS = [1, 2, 3];
export const PART_ICON = { 1: 'target', 2: 'users', 3: 'book' };
export const partName = (n) => t(`baseline.part${n}.name`);
export const partOf = (b, n) => (b && b.parts && b.parts[`p${n}`]) || null;

/** Whole minutes left before deadline_at (0 when the time is up). */
export function minutesLeft(deadlineAt) {
  const ms = Date.parse(deadlineAt || '') - serverNow();
  return Number.isNaN(ms) ? null : Math.max(0, Math.ceil(ms / 60000));
}

/** 2525 s → "42 min" · 3900 s → "1 h 5 min" (never more precise than a minute). */
export function fmtDuration(seconds) {
  const m = Math.max(0, Math.round((Number(seconds) || 0) / 60));
  if (m < 60) return t('baseline.dur_min', { n: Math.max(m, seconds > 0 ? 1 : 0) });
  return t('baseline.dur_h', { h: Math.floor(m / 60), m: m % 60 });
}

/** Time used from a PartState (started_at → submitted_at, never more than the part's minutes). */
export function usedSeconds(ps) {
  if (!ps || !ps.started_at || !ps.submitted_at) return null;
  const s = (Date.parse(ps.submitted_at) - Date.parse(ps.started_at)) / 1000;
  const cap = ps.minutes ? ps.minutes * 60 : Infinity;
  return Number.isNaN(s) ? null : Math.max(0, Math.min(s, cap));
}

/** "Nov 2026" / "Tháng 11/2026" for a wave like "2026-11". */
export function waveLabel(w) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(w || ''));
  if (!m) return w || '';
  if (getLang() === 'vi') return t('baseline.wave_vi', { m: Number(m[2]), y: m[1] });
  return new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 15)));
}

/** closed · not_started · in_progress · done */
export function partState(ps) {
  if (!ps) return 'closed';
  if (ps.status === 'submitted') return 'done';
  if (ps.status === 'in_progress') return 'in_progress';
  return ps.open ? 'not_started' : 'closed';
}

/** "65 min · 32 questions" (the question count is shown for Part 1 only, as in specs/22 §5 tiles). */
export function partMeta(n, ps) {
  const bits = [];
  if (ps && ps.minutes) bits.push(t('baseline.dur_min', { n: ps.minutes }));
  if (n === 1 && ps && ps.n_items) bits.push(t('baseline.n_questions', { count: ps.n_items }));
  return bits.join(' · ');
}

export function partChip(ps) {
  const st = partState(ps);
  if (st === 'done') return chip(t('baseline.tile.done'), 'pass', 'check');
  if (st === 'in_progress') {
    const left = minutesLeft(ps.deadline_at);
    return chip(left ? t('baseline.tile.in_progress', { count: left }) : t('baseline.tile.time_up'), 'warn', 'clock');
  }
  if (st === 'not_started') return chip(t('baseline.tile.not_started'), 'info', 'circle');
  return chip(t('baseline.tile.closed'), 'locked', 'lock');
}

/**
 * One part as a tile. Actionable (open and not started, or in progress) tiles are links to
 * baseline.html?part=n; closed and done tiles are plain cards.
 */
export function partTile(n, ps, { heading = 'h3', current = false } = {}) {
  const st = partState(ps);
  const actionable = st === 'not_started' || st === 'in_progress';
  const tag = actionable && !current ? 'a' : 'div';
  const id = `bl2-tile-${n}`;
  const go = actionable ? h('span', { class: 'bl2-tile-go' }, h('span', { text: t(st === 'in_progress' ? 'baseline.tile.continue' : 'baseline.tile.start') }), icon('arrow-right', 'sm')) : null;
  return h(tag, { class: `card bl2-tile is-${st}${tag === 'a' ? ' hover card-link' : ''}`, href: tag === 'a' ? `baseline.html?part=${n}` : null, 'aria-labelledby': tag === 'a' ? null : id },
    h('span', { class: 'bl2-tile-n', 'aria-hidden': 'true' }, st === 'done' ? icon('check') : String(n)),
    h('div', { class: 'bl2-tile-main' },
      h('p', { class: 'bl2-tile-k', text: t('baseline.part_n', { n }) }),
      h(heading, { class: 'bl2-tile-name', id, text: partName(n) }),
      h('p', { class: 'bl2-tile-meta', text: partMeta(n, ps) }),
      h('p', { class: 'bl2-tile-measures small', text: t(`baseline.measures.p${n}`) }),
      h('p', { class: 'bl2-tile-state' }, partChip(ps))),
    go);
}
