// about.html · Privacy & help. Works signed in or out. Plain language, EN + VI.
import { h, render, icon, mountShell, openChangePinDialog } from '../ui.js';
import { t, pick, onLangChange } from '../i18n.js';
import { api, isDemo, getSession } from '../api.js';
import { loadCatalog, journey, fmtShortDate } from '../courses.js';

const SECTIONS = ['privacy', 'leaderboards', 'how', 'rules', 'certificates', 'pin', 'data', 'demo', 'faq'];
const SEC_ICON = { privacy: 'shield', leaderboards: 'users', how: 'book', rules: 'flag', certificates: 'award', pin: 'key', data: 'file', demo: 'zap', faq: 'help' };
const WHO = [['eye', 'you'], ['shield', 'director'], ['users', 'manager'], ['grid', 'team'], ['lock', 'nobody']];
const FLOW = [['video', 'blink'], ['check-circle', 'hub'], ['users', 'forum'], ['edit', 'field']];
const RHYTHM = ['w1', 'w2', 'forum', 'w4', 'recall'];
const RULES = [['zap', 'predict'], ['flag', 'checkpoint'], ['refresh', 'retake'], ['users', 'third'], ['clock', 'late'], ['eye', 'answers'], ['refresh', 'recall'], ['target', 'baseline'], ['trophy', 'pitch']];
const FAQ = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9'];

const S = { app: null, catalog: null, live: null, open: new Set() };

(async function main() {
  const { app } = await mountShell({ page: 'about', auth: false });
  S.app = app;
  onLangChange(() => draw());
  draw();
  try { S.catalog = await loadCatalog(); draw(); } catch (e) { /* the session list stays generic */ }
  // Demo: the mock moves the calendar, so show its forum dates (the live Hub uses the program dates).
  if (isDemo() && getSession()) api.me().then((me) => journey(me)).then((list) => { S.live = list; draw(); }).catch(() => { /* catalogue dates stay */ });
  if (location.hash) { const el = document.getElementById(location.hash.slice(1)); if (el) requestAnimationFrame(() => el.scrollIntoView()); }
}());

function draw() {
  // Remember which FAQ items are open so a language switch keeps them open.
  S.app.querySelectorAll('details[data-k]').forEach((d) => { if (d.open) S.open.add(d.dataset.k); else S.open.delete(d.dataset.k); });
  const focusId = document.activeElement && S.app.contains(document.activeElement) ? document.activeElement.id : null;
  render(S.app, h('div', { class: 'about-page stack xl' },
    h('header', { class: 'page-head stack sm' },
      h('p', { class: 'eyebrow', text: t('about.eyebrow') }),
      h('h1', { text: t('about.title') }),
      h('p', { class: 'lead muted', text: t('about.lead') })),
    h('div', { class: 'about-layout' },
      toc(),
      h('div', { class: 'about-body stack xl' },
        privacy(), leaderboards(), how(), rules(), certificates(), pin(), data(), demo(), faq(), contact()))));
  if (focusId) { const el = document.getElementById(focusId); if (el) el.focus({ preventScroll: true }); }
}

function toc() {
  return h('nav', { class: 'toc', 'aria-label': t('about.toc') },
    h('p', { class: 'toc-title xs strong muted', text: t('about.toc') }),
    h('ul', null, SECTIONS.map((k) => h('li', null, h('a', { href: `#${k}` }, icon(SEC_ICON[k], 'sm'), h('span', { text: t(`about.nav.${k}`) }))))));
}
function sec(id, ...children) {
  return h('section', { id, class: 'about-sec', 'aria-labelledby': `${id}-h` },
    h('h2', { id: `${id}-h` }, h('span', { class: 'sec-icon', 'aria-hidden': 'true' }, icon(SEC_ICON[id])), h('span', { text: t(`about.${id}.title`) })),
    children);
}
const p = (key, vars, cls) => h('p', { class: cls || null, text: t(key, vars) });

function privacy() {
  return sec('privacy',
    p('about.privacy.intro'),
    h('ul', { class: 'who-grid' }, WHO.map(([ic, k]) => h('li', { class: `who-card who-${k}` },
      h('span', { class: 'who-icon' }, icon(ic)),
      h('div', { class: 'stack sm' }, h('h3', { text: t(`onboard.who_${k}`) }), h('p', { class: 'small', text: t(`about.privacy.${k}`) }))))),
    h('div', { class: 'callout info' }, icon('lock'), h('p', { class: 'small', text: t('about.privacy.where') })));
}
function leaderboards() {
  return sec('leaderboards',
    h('div', { class: 'card pad prose' }, p('about.leaderboards.p1'), p('about.leaderboards.p2'), p('about.leaderboards.p3')));
}
function how() {
  const cat = S.catalog;
  let sessions = [];
  if (cat) {
    const byDate = new Map();
    (S.live || cat.courses.slice().sort((a, b) => a.order - b.order)).forEach((c) => {
      if (!c.forum_date) return;
      const s = byDate.get(c.forum_date) || { date: c.forum_date, codes: [], title: pick(c.forum || {}, 'title') };
      s.codes.push(c.code); byDate.set(c.forum_date, s);
    });
    sessions = [...byDate.values()];
    if (cat.program && cat.program.capstone_day) sessions.push({ date: cat.program.capstone_day, codes: [], title: t('about.how.warroom') });
    sessions.sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  return sec('how',
    p('about.how.intro'),
    h('ol', { class: 'flow' }, FLOW.map(([ic, k], i) => h('li', { class: 'flow-step' },
      h('span', { class: 'flow-n', 'aria-hidden': 'true' }, icon(ic)),
      h('div', null, h('p', { class: 'xs strong muted', text: t('about.how.step_n', { n: i + 1 }) }), h('h3', { text: t(`about.how.${k}`) }), h('p', { class: 'small muted', text: t(`about.how.${k}_body`) }))))),
    h('div', { class: 'grid cols-2 how-grid' },
      h('div', { class: 'card pad stack' },
        h('h3', { text: t('about.how.rhythm_title') }),
        h('ol', { class: 'timeline rhythm' }, RHYTHM.map((k, i) => h('li', null,
          h('span', { class: 'tl-dot', 'aria-hidden': 'true' }, String(i + 1)),
          h('p', { class: 'strong ink small', text: t(`about.how.r_${k}`) }), h('p', { class: 'small muted', text: t(`about.how.r_${k}_body`) }))))),
      h('div', { class: 'card pad stack' },
        h('h3', { text: t('about.how.sessions_title', { n: sessions.length || 9 }) }),
        p('about.how.sessions_body', null, 'small muted'),
        sessions.length ? h('ol', { class: 'session-list' }, sessions.map((s) => h('li', null,
          h('span', { class: 'ses-date', text: fmtShortDate(s.date) }),
          h('span', { class: 'ses-text' }, h('span', { class: 'small ink strong', text: s.title }), s.codes.length ? h('span', { class: 'xs muted', text: ` · ${s.codes.join(' + ')}` }) : null)))) : null)));
}
function rules() {
  return sec('rules',
    p('about.rules.intro'),
    h('ul', { class: 'rule-grid' }, RULES.map(([ic, k]) => h('li', { class: 'rule-card' },
      h('span', { class: 'tile-icon' }, icon(ic)),
      h('div', { class: 'stack sm' }, h('h3', { text: t(`about.rules.${k}`) }), h('p', { class: 'small', text: t(`about.rules.${k}_body`) }))))));
}
function certificates() {
  const lv = [['award', 'practitioner'], ['award', 'expert'], ['star', 'coach']];
  return sec('certificates',
    p('about.certificates.intro'),
    h('ol', { class: 'cert-path' }, lv.map(([ic, k], i) => h('li', { class: 'cert' },
      h('div', { class: 'row' }, h('span', { class: 'medal' }, icon(ic)), h('div', null, h('p', { class: 'xs muted strong', text: t('cert.level_n', { n: i + 1 }) }), h('h3', { text: t(`cert.${k}`) }))),
      h('p', { class: 'small', text: t(`about.certificates.${k}`) })))),
    p('about.certificates.note', null, 'small muted'));
}
function pin() {
  const signedIn = !!getSession();
  return sec('pin',
    h('div', { class: 'card pad stack' },
      h('ul', { class: 'check-list' }, ['forgot', 'lock', 'change', 'session', 'remember', 'share'].map((k) => h('li', null, icon(k === 'lock' ? 'clock' : k === 'forgot' ? 'help' : k === 'share' ? 'alert' : 'check-circle', 'sm'), h('span', { text: t(`about.pin.${k}`) })))),
      signedIn ? h('div', null, h('button', { class: 'btn btn-secondary', type: 'button', id: 'about-change-pin', onclick: () => openChangePinDialog() }, icon('key'), t('about.pin.change_btn'))) : null));
}
function data() {
  return sec('data',
    h('div', { class: 'grid cols-2' },
      h('div', { class: 'card pad stack sm' }, h('h3', { text: t('about.data.kept_title') }), p('about.data.kept', null, 'small')),
      h('div', { class: 'card pad stack sm' }, h('h3', { text: t('about.data.not_title') }), p('about.data.not', null, 'small'))),
    h('div', { class: 'callout info' }, icon('clock'), h('p', { class: 'small', text: t('about.data.retention') })),
    p('about.data.rights', null, 'small muted'));
}
function demo() {
  return sec('demo',
    p('about.demo.body'),
    isDemo() ? h('div', { class: 'callout warn' }, icon('zap'), h('p', { class: 'small', text: t('about.demo.now') })) : null);
}
function faq() {
  return sec('faq',
    h('div', { class: 'faq-list' }, FAQ.map((k) => {
      const d = h('details', { class: 'faq', 'data-k': k, open: S.open.has(k) },
        h('summary', null, h('span', { text: t(`about.faq.${k}`) }), icon('chevron-down', 'faq-chev')),
        h('div', { class: 'faq-a' }, p(`about.faq.${k}_a`)));
      return d;
    })));
}
function contact() {
  return h('div', { class: 'card pad contact-card' },
    h('span', { class: 'tile-icon' }, icon('help')),
    h('div', { class: 'stack sm' }, h('h2', { class: 'title-sm', text: t('about.contact.title') }), p('about.contact.body', null, 'small muted')),
    getSession() ? h('a', { class: 'btn btn-primary', href: 'index.html' }, t('about.contact.home'), icon('arrow-right')) : h('a', { class: 'btn btn-primary', href: 'index.html' }, t('about.contact.signin'), icon('arrow-right')));
}

