// Course catalogue (docs/data/courses.json, public) merged with the learner's live state from `me`.
// Shared status rules so every page shows the same chip, progress and next step.
import { t, pick } from './i18n.js';
import { serverNow } from './api.js';

let catalogPromise = null;

export function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetch(new URL('../data/courses.json', import.meta.url), { cache: 'no-cache' })
      .then((r) => { if (!r.ok) throw new Error(`courses.json HTTP ${r.status}`); return r.json(); });
  }
  return catalogPromise;
}

export const familyClass = (code) => `fam-${String(code || 'A').charAt(0)}`;

/** Today's date (YYYY-MM-DD) in Vietnam, from the server-corrected clock. */
export function todayVN(ms = serverNow()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

export function objectiveEpisodes(course, n) {
  const o = (course.objectives || []).find((x) => Number(x.n) === Number(n));
  return o && Array.isArray(o.episodes) ? o.episodes : [];
}

/** Merge static course data with the live course row from `me` (live wins for dates and flags). */
export function mergeCourse(staticCourse, live) {
  const liveEps = new Map(((live && live.episodes) || []).map((e) => [Number(e.ep), e]));
  const eps = [];
  if (staticCourse.has_trailer) eps.push({ ep: 0, title_en: 'Trailer', title_vi: 'Trailer', ideas_en: '', ideas_vi: '', trailer: true });
  (staticCourse.episodes || []).forEach((e) => eps.push({ ...e }));
  const episodes = eps.map((e) => {
    const l = liveEps.get(Number(e.ep)) || {};
    return { ...e, minutes: l.minutes || e.minutes || null, blink_url: l.blink_url || '', embed_url: l.embed_url || '', watched: !!l.watched };
  });
  return {
    ...staticCourse,
    ...(live || {}),
    name_en: staticCourse.name_en, name_vi: staticCourse.name_vi,
    episodes,
    predict: (live && live.predict) || { done: false, attempts: 0, last_pct: null },
    checkpoint: (live && live.checkpoint) || { status: 'not_started', attempts: 0 },
    recall: (live && live.recall) || [],
    open: live ? !!live.open : false,
  };
}

export async function journey(me) {
  const cat = await loadCatalog();
  const live = new Map(((me && me.courses) || []).map((c) => [c.code, c]));
  return cat.courses.slice().sort((a, b) => a.order - b.order).map((c) => mergeCourse(c, live.get(c.code)));
}

const lessonEps = (c) => c.episodes.filter((e) => !e.trailer);

/** 0–100: predict 10 · episodes 40 · checkpoint 40 · recall 10. */
export function courseProgress(c) {
  const eps = lessonEps(c);
  const watched = eps.filter((e) => e.watched).length;
  const recallDone = (c.recall || []).filter((r) => r.status === 'done').length;
  const passed = c.checkpoint && c.checkpoint.status === 'passed';
  let pct = (c.predict && c.predict.done ? 10 : 0) + (eps.length ? 40 * (watched / eps.length) : 0) + (passed ? 40 : 0) + 10 * (recallDone / 3);
  pct = Math.round(Math.min(100, pct));
  return { pct, watched, total: eps.length, recallDone, passed };
}

/** The six journey steps for the stepper: done | current | todo. */
export function courseSteps(c, today = todayVN()) {
  const p = courseProgress(c);
  const forumPassed = c.forum_date && today > c.forum_date;
  const fieldPassed = c.field_until && today > c.field_until;
  const steps = [
    { key: 'predict', done: !!(c.predict && c.predict.done) },
    { key: 'watch', done: p.total > 0 && p.watched === p.total },
    { key: 'checkpoint', done: p.passed },
    { key: 'forum', done: !!forumPassed },
    { key: 'field', done: !!fieldPassed },
    { key: 'recall', done: p.recallDone === 3 },
  ];
  const firstTodo = steps.findIndex((s) => !s.done);
  return steps.map((s, i) => ({ ...s, state: s.done ? 'done' : (i === firstTodo && c.open ? 'current' : 'todo') }));
}

/**
 * Status chip + call to action for one course.
 * Returns { key, variant: pass|warn|bad|info|locked, icon, label, cta?: {label, href} }.
 */
export function courseStatus(c, now = serverNow()) {
  const today = todayVN(now);
  const cp = c.checkpoint || {};
  const href = (type, extra = '') => `quiz.html?type=${type}&c=${encodeURIComponent(c.code)}${extra}`;
  if (!c.open) {
    const opens = c.online_from && c.online_from > today;
    return { key: 'locked', variant: 'locked', icon: 'lock', label: opens ? t('status.opens', { date: fmtShortDate(c.online_from) }) : t('status.locked') };
  }
  if (cp.status === 'passed') {
    const due = (c.recall || []).find((r) => r.status === 'due');
    if (due) return { key: 'recall', variant: 'info', icon: 'refresh', label: t('status.recall_due'), cta: { label: t('cta.recall'), href: href('recall', `&day=${due.day}`) } };
    return { key: 'passed', variant: 'pass', icon: 'check', label: t('status.passed') };
  }
  if (cp.gate_closed) return { key: 'closed', variant: 'bad', icon: 'alert', label: t('status.closed') };
  if (cp.needs_unlock) return { key: 'unlock', variant: 'warn', icon: 'users', label: t('status.needs_unlock') };
  if (cp.status === 'in_progress') return { key: 'cp_progress', variant: 'info', icon: 'edit', label: t('status.cp_in_progress'), cta: { label: t('cta.continue_checkpoint'), href: href('checkpoint') } };
  if (cp.status === 'not_yet') {
    if (cp.next_retake_at && Date.parse(cp.next_retake_at) > now) {
      return { key: 'retake_wait', variant: 'warn', icon: 'clock', label: t('status.retake_at', { time: fmtDateTime(cp.next_retake_at) }) };
    }
    return { key: 'retake', variant: 'warn', icon: 'refresh', label: t('status.retake_now'), cta: { label: t('cta.retake'), href: href('checkpoint') } };
  }
  if (!(c.predict && c.predict.done)) return { key: 'predict', variant: 'info', icon: 'zap', label: t('status.predict_first'), cta: { label: t('cta.predict'), href: href('predict') } };
  const p = courseProgress(c);
  if (p.watched < p.total) return { key: 'watch', variant: 'info', icon: 'play', label: t('status.watch', { n: p.watched, total: p.total }), cta: { label: t('cta.watch'), href: `course.html?c=${encodeURIComponent(c.code)}#episodes` } };
  return { key: 'checkpoint', variant: 'info', icon: 'flag', label: t('status.checkpoint_ready'), cta: { label: t('cta.checkpoint'), href: href('checkpoint') } };
}

/**
 * The single most useful next step for the dashboard hero.
 * { kind: baseline|checkpoint|recall|course|wait|done, course?, label, body, cta? }
 */
export function nextStep(me, courses, now = serverNow()) {
  const today = todayVN(now);
  const b = me && me.baseline;
  if (b && b.window === 'open' && b.status !== 'submitted') {
    return { kind: 'baseline', title: t(b.status === 'in_progress' ? 'next.baseline_continue' : 'next.baseline'), body: t('next.baseline_body', { date: fmtShortDate(b.open_to) }), cta: { label: t(b.status === 'in_progress' ? 'cta.continue' : 'cta.start_baseline'), href: 'baseline.html' } };
  }
  const inProg = courses.find((c) => c.open && c.checkpoint && c.checkpoint.status === 'in_progress');
  if (inProg) return { kind: 'checkpoint', course: inProg, ...fromStatus(inProg, now) };
  const recall = courses.find((c) => (c.recall || []).some((r) => r.status === 'due'));
  if (recall) return { kind: 'recall', course: recall, ...fromStatus(recall, now) };
  const active = courses.find((c) => c.open && !(c.checkpoint && c.checkpoint.status === 'passed'));
  if (active) return { kind: 'course', course: active, ...fromStatus(active, now) };
  const upcoming = courses.find((c) => !c.open && c.online_from && c.online_from >= today);
  if (upcoming) return { kind: 'wait', course: upcoming, title: t('next.wait', { code: upcoming.code, name: pick(upcoming, 'name') }), body: t('next.wait_body', { date: fmtLongDate(upcoming.online_from) }) };
  return { kind: 'done', title: t('next.done'), body: t('next.done_body') };
}

function fromStatus(c, now) {
  const s = courseStatus(c, now);
  return { title: `${c.code} · ${pick(c, 'name')}`, body: s.label, status: s, cta: s.cta || { label: t('cta.open_course'), href: `course.html?c=${encodeURIComponent(c.code)}` } };
}

// ---- Date formatting (Vietnam time, EN/VI) ----
const TZ = 'Asia/Ho_Chi_Minh';
const locale = () => (document.documentElement.lang === 'vi' ? 'vi-VN' : 'en-GB');
function toDate(v) {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T12:00:00+07:00`);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
/** "Tue 26 Jan" / "T3, 26/1"; the year is added when it is not the current year ("Tue 26 Jan 2027"). */
export function fmtShortDate(v) {
  const d = toDate(v); if (!d) return '';
  const year = (x) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric' }).format(x);
  const otherYear = year(d) !== year(new Date(serverNow()));
  if (locale() === 'vi-VN') {
    const wd = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, weekday: 'short' }).format(d);
    const dm = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, day: 'numeric', month: 'numeric', ...(otherYear ? { year: 'numeric' } : {}) }).format(d);
    return `${wd}, ${dm}`;
  }
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', ...(otherYear ? { year: 'numeric' } : {}) }).format(d).replace(',', '');
}
/** "Tuesday 26 January 2027" / "Thứ Ba, 26 tháng 1, 2027" */
export function fmtLongDate(v) {
  const d = toDate(v); if (!d) return '';
  return new Intl.DateTimeFormat(locale(), { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}
/** "Tue 26 Jan, 09:30" */
export function fmtDateTime(v) {
  const d = toDate(v); if (!d) return '';
  const time = new Intl.DateTimeFormat(locale(), { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${fmtShortDate(v)}, ${time}`;
}
/** Whole days from today (VN) to a date: 0 = today, 1 = tomorrow, −1 = yesterday. */
export function daysUntil(dateStr, now = serverNow()) {
  if (!dateStr) return null;
  const a = Date.parse(`${todayVN(now)}T00:00:00+07:00`);
  const b = Date.parse(`${String(dateStr).slice(0, 10)}T00:00:00+07:00`);
  return Math.round((b - a) / 86400000);
}
