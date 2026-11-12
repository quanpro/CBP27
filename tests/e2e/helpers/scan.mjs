// Answer-key leak scanner (CLAUDE.md hard rule, specs/20 "Served items never contain …", specs/22 §3
// "Privacy"). Every API payload a page receives is deep-scanned:
//   answer, answer_most, answer_least, mockCorrect   — never, anywhere, in any action
//   step, move, gate, level, charter                 — never (the baseline's scoring keys), except the
//                                                       known non-item places in LEVEL_OK below
//   correct, why_en, why_vi                          — only inside review rows of a submitted course
//                                                       quiz (submit/review → missed[i] / review[i]);
//                                                       by_objective.<n>.correct is a count (a number)
// and every served item must carry exactly its contract's whitelist of fields.
export const NEVER = ['answer', 'answer_most', 'answer_least', 'mockCorrect'];
export const BASELINE_META = ['step', 'move', 'gate', 'level', 'charter'];
export const REVIEW_ONLY = ['correct', 'why_en', 'why_vi'];
const REVIEW_ACTIONS = new Set(['submit', 'review']);
const REVIEW_ROW = /^(missed|review)\[\d+\]$/;
const OBJECTIVE_COUNT = /^by_objective\.[^.[\]]+$/;
// Known places where a key called "level" is not an item's level:
//   scale[i].level        the 0–4 course self-rating scale (Part 3 opener)
//   certificates.level    the certificate path (me, and the me that comes with login)
//   p3.level              the indicative level in the learner's own profile (after results open)
const LEVEL_OK = [
  { key: 'level', parent: /^scale\[\d+\]$/ },
  { key: 'level', parent: /^certificates$/, actions: ['me'] },
  { key: 'level', parent: /^me\.certificates$/, actions: ['login'] },
  { key: 'level', parent: /^p3$/, actions: ['profile'] },
];

/** Returns [{path, key}] for every forbidden key in `data` for the given action. */
export function findLeaks(action, data) {
  const leaks = [];
  const walk = (v, path) => {
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      const p = path ? `${path}.${k}` : k;
      if (NEVER.includes(k)) leaks.push({ path: p, key: k });
      else if (BASELINE_META.includes(k)) {
        const ok = LEVEL_OK.some((e) => e.key === k && e.parent.test(path) && (!e.actions || e.actions.includes(action)));
        if (!ok) leaks.push({ path: p, key: k });
      } else if (REVIEW_ONLY.includes(k) && !(REVIEW_ACTIONS.has(action) && REVIEW_ROW.test(path))
        && !(k === 'correct' && typeof x === 'number' && OBJECTIVE_COUNT.test(path))) leaks.push({ path: p, key: k });
      walk(x, p);
    }
  };
  walk(data, '');
  return leaks;
}

// ---------------------------------------------------------------- served item whitelists
const OPTION_KEYS = ['en', 'id', 'vi'];
const SHAPES = {
  // course quizzes (predict, checkpoint, recall): specs/20 Item
  item: ['case_id', 'course', 'item_id', 'objective', 'options', 'stem_en', 'stem_vi'],
  // baseline v2 (specs/22 §4)
  mcq: ['case_id', 'exhibit_ids', 'item_id', 'options', 'section', 'stem_en', 'stem_vi', 'type'],
  sjt: ['item_id', 'options', 'stem_en', 'stem_vi', 'type'],
  rating: ['allow_nr', 'anchor1_en', 'anchor1_vi', 'anchor4_en', 'anchor4_vi', 'item_id', 'text_en', 'text_vi', 'type'],
  // manager form (rate_get): manager wording, no type
  rateItem: ['anchor1_en', 'anchor1_vi', 'anchor4_en', 'anchor4_vi', 'item_id', 'text_en', 'text_vi'],
};

function shapeProblems(items, shapeOf, where) {
  const out = [];
  (items || []).forEach((it, i) => {
    const shape = shapeOf(it);
    const want = SHAPES[shape];
    const keys = Object.keys(it).sort();
    if (!want) { out.push(`${where}[${i}] unknown item type ${JSON.stringify(it.type)}`); return; }
    if (keys.join() !== want.join()) out.push(`${where}[${i}] (${shape}) keys ${keys.join(',')}`);
    if (shape !== 'rating' && shape !== 'rateItem') {
      if (!Array.isArray(it.options) || it.options.length !== 4) out.push(`${where}[${i}] has ${it.options && it.options.length} options`);
      (it.options || []).forEach((o, j) => {
        const ok = Object.keys(o).sort();
        if (ok.join() !== OPTION_KEYS.join()) out.push(`${where}[${i}].options[${j}] keys ${ok.join(',')}`);
      });
    }
  });
  return out;
}

/** Course-quiz items (start of predict / checkpoint / recall): exactly the specs/20 Item fields. */
export function itemShapeProblems(items) {
  return shapeProblems(items, () => 'item', 'items');
}

/** Whitelist check for every item a payload serves, by action and shape (v1 quizzes, v2 baseline, rating). */
export function servedShapeProblems(action, data) {
  if (!data || !data.ok) return [];
  const byType = (it) => it.type;
  if (action === 'start' && Array.isArray(data.sections)) {
    return data.sections.flatMap((s) => shapeProblems(s.items, byType, `sections.${s.id}.items`));
  }
  if (action === 'start') return itemShapeProblems(data.items);
  if (action === 'baseline_next' && data.section) return shapeProblems(data.section.items, byType, 'section.items');
  if (action === 'rate_get') return shapeProblems(data.items, () => 'rateItem', 'items');
  return [];
}
