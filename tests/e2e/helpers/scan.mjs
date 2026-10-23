// Answer-key leak scanner (CLAUDE.md hard rule, specs/20 "Served items never contain …").
// Every API payload a page receives is deep-scanned. Keys that must never appear:
//   answer, mockCorrect                       — anywhere, in any action
//   correct, why_en, why_vi                   — only inside review rows of a submitted attempt
//                                               (submit/review → missed[i] or review[i])
export const NEVER = ['answer', 'mockCorrect'];
export const REVIEW_ONLY = ['correct', 'why_en', 'why_vi'];
const REVIEW_ACTIONS = new Set(['submit', 'review']);
const REVIEW_ROW = /^(missed|review)\[\d+\]$/;

/** Returns [{path, key}] for every forbidden key in `data` for the given action. */
export function findLeaks(action, data) {
  const leaks = [];
  const walk = (v, path, parentPath) => {
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`, path)); return; }
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      const p = path ? `${path}.${k}` : k;
      if (NEVER.includes(k)) leaks.push({ path: p, key: k });
      else if (REVIEW_ONLY.includes(k) && !(REVIEW_ACTIONS.has(action) && REVIEW_ROW.test(path))) leaks.push({ path: p, key: k });
      walk(x, p, path);
    }
  };
  walk(data, '', '');
  return leaks;
}

const ITEM_KEYS = ['case_id', 'course', 'item_id', 'objective', 'options', 'stem_en', 'stem_vi'];
const OPTION_KEYS = ['en', 'id', 'vi'];

/** A served item has exactly the contract's whitelist of keys (specs/20 Item / Option). */
export function itemShapeProblems(items) {
  const out = [];
  (items || []).forEach((it, i) => {
    const keys = Object.keys(it).sort();
    if (keys.join() !== ITEM_KEYS.join()) out.push(`items[${i}] keys ${keys.join(',')}`);
    (it.options || []).forEach((o, j) => {
      const ok = Object.keys(o).sort();
      if (ok.join() !== OPTION_KEYS.join()) out.push(`items[${i}].options[${j}] keys ${ok.join(',')}`);
    });
    if (!Array.isArray(it.options) || it.options.length !== 4) out.push(`items[${i}] has ${it.options && it.options.length} options`);
  });
  return out;
}
