// The 1% Planner model (program deck, "Our approaching model" and "How each course runs"):
// 13 skills in four domains, the courses that build each domain in 2027 and the baseline part that
// measures it; the five stages every course runs through. Generic program design only: the five
// charter names come from the private Sheet (`me.charters`), never from this file.
import { h, icon } from './ui.js';
import { t } from './i18n.js';

/** Four domains · 13 skills. part = the baseline part that measures the domain. */
export const DOMAINS = [
  { key: 'think', icon: 'bulb', tone: 'think', courses: ['A1', 'A2', 'A3'], part: 1, skills: ['problem', 'data', 'genai'], gap: /^p1_/ },
  { key: 'plan', icon: 'list', tone: 'plan', courses: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'], part: 3, skills: ['process', 'theory', 'e2e'], gap: /^p3_/ },
  { key: 'work', icon: 'users', tone: 'work', courses: ['C1'], part: 2, skills: ['acumen', 'comms', 'team'], gap: null },
  { key: 'mind', icon: 'compass', tone: 'mind', courses: [], part: 2, skills: ['mastery', 'customer', 'agility', 'leadership'], gap: /^p2_/ },
];

/** The five stages of every course, with the deck's timing. online = Blink and the Hub; else offline/on the job. */
export const STAGES = [
  { key: 'learn', icon: 'video', online: true },
  { key: 'prove', icon: 'flag', online: true },
  { key: 'apply', icon: 'users', online: false },
  { key: 'do', icon: 'edit', online: false },
  { key: 'teach', icon: 'star', online: false },
];

/** Recall after three months, by how we learn (Whitmore, Coaching for Performance, 2002). */
export const RECALL = [
  { key: 'hear', value: '10–32%', level: 1 },
  { key: 'test', value: '', level: 2 },
  { key: 'case', value: '65%', level: 3 },
  { key: 'live', value: '65%', level: 3 },
  { key: 'teach', value: '100%', level: 4 },
];

/** The domain a baseline IDP gap belongs to (p1_* Think, p2_* Lead · mindset, p3_* Plan). */
export function gapDomain(area) {
  const d = DOMAINS.find((x) => x.gap && x.gap.test(String(area || '')));
  return d ? d.key : null;
}

/** "Learn → Prove → Apply → Do → Teach" as a compact strip (help page, course pages). */
export function stageStrip({ current = null, compact = false } = {}) {
  return h('ol', { class: `stage-strip${compact ? ' compact' : ''}`, 'aria-label': t('model.stages_aria') },
    STAGES.map((s, i) => h('li', { class: `${s.online ? 'online' : 'offline'}${current === s.key ? ' current' : ''}`, 'aria-current': current === s.key ? 'step' : null },
      h('span', { class: 'ss-n', 'aria-hidden': 'true' }, icon(s.icon, 'sm')),
      h('span', { class: 'ss-text' }, h('b', { text: t(`steps.${s.key}`) }), compact ? null : h('span', { class: 'xs', text: t(`model.stage.${s.key}.when`) })),
      i < STAGES.length - 1 ? h('span', { class: 'ss-arrow', 'aria-hidden': 'true' }, icon('chevron-right', 'sm')) : null)));
}
