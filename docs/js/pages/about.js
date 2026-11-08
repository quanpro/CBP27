// about.html · Privacy & help. Works signed in or out. Plain language, EN + VI.
import { h, render, icon, mountShell, openChangePinDialog } from '../ui.js';
import { t, pick, onLangChange } from '../i18n.js';
import { api, isDemo, getSession } from '../api.js';
import { loadCatalog, programSessions, fmtShortDate } from '../courses.js';

const SECTIONS = ['privacy', 'leaderboards', 'how', 'rules', 'certificates', 'pin', 'data', 'demo', 'faq'];
const SEC_ICON = { privacy: 'shield', leaderboards: 'users', how: 'book', rules: 'flag', certificates: 'award', pin: 'key', data: 'file', demo: 'zap', faq: 'help' };
const WHO = [['eye', 'you'], ['shield', 'director'], ['users', 'manager'], ['grid', 'team'], ['lock', 'nobody']];
import { STAGES, DOMAINS } from '../model.js';
const RULES = [['zap', 'predict'], ['flag', 'checkpoint'], ['refresh', 'retake'], ['users', 'third'], ['clock', 'late'], ['eye', 'answers'], ['refresh', 'recall'], ['target', 'baseline'], ['trophy', 'pitch']];
const FAQ = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9'];

const S = { app: null, catalog: null, me: null, open: new Set() };

(async function main() {
  const { app } = await mountShell({ page: 'about', auth: false });
  S.app = app;
  onLangChange(() => draw());
  draw();
  try { S.catalog = await loadCatalog(); draw(); } catch (e) { /* the session list stays generic */ }
  // Signed in: the sessions come from the Sheet's Sessions tab (the demo moves them with its calendar).
  if (getSession()) api.me().then((me) => { S.me = me; draw(); }).catch(() => { /* catalogue sessions stay */ });
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
  const sessions = S.catalog ? programSessions(S.me, S.catalog).map((x) => ({ date: x.date, codes: x.courses, title: pick(x, 'title') || t('about.how.warroom') })) : [];
  return sec('how',
    p('about.how.intro'),
    h('ol', { class: 'flow flow-5' }, STAGES.map((st, i) => h('li', { class: `flow-step ${st.online ? 'online' : 'offline'}` },
      h('span', { class: 'flow-n', 'aria-hidden': 'true' }, icon(st.icon)),
      h('div', null, h('p', { class: 'xs strong muted', text: `${t('about.how.step_n', { n: i + 1 })} · ${t(`model.stage.${st.key}.when`)}` }), h('h3', { text: t(`steps.${st.key}`) }),
        h('p', { class: 'small strong ink', text: t(`model.stage.${st.key}.where`) }), h('p', { class: 'small muted', text: t(`model.stage.${st.key}.what`) }))))),
    h('div', { class: 'grid cols-2 how-grid' },
      h('div', { class: 'card pad stack' },
        h('h3', { text: t('about.how.model_title') }),
        p('about.how.model_body', null, 'small'),
        h('ul', { class: 'how-domains' }, DOMAINS.map((d) => h('li', { class: `tone-${d.tone}` },
          h('b', { text: `${t(`model.d.${d.key}.name`)} · ${t(`model.d.${d.key}.area`)}` }),
          h('span', { class: 'small muted', text: d.skills.map((k) => t(`model.skill.${k}`)).join(' · ') })))),
        h('a', { class: 'btn btn-secondary', href: 'path.html' }, t('about.how.model_cta'), icon('arrow-right'))),
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

