// Safe Markdown for text that comes from the Sheet (baseline exhibits, the rater guide).
// It builds DOM nodes only: every piece of Sheet text ends up in a text node, never in innerHTML.
// Supported: paragraphs, **bold**, *italic* / _italic_, "1. numbered lines", "- bullet" lines,
// "- label: value" lists, pipe tables (| a | b | with a |---| separator row), and "#" headings
// (shown as a bold line). Anything else (links, HTML, images) is shown as the literal text.
import { h } from './ui.js';

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,2})[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;
const LABEL_VALUE = /^([^:]{1,60}?):\s+(.+)$/;
const NUMERIC = /^[-+−]?[\d\s.,]*\d[\d\s.,]*(%|pp|x|×|k|m|bn)?$/i;

/** Inline **bold** and *italic* / _italic_ → an array of text nodes and <strong>/<em> elements. */
export function inline(text) {
  const out = [];
  const s = String(text == null ? '' : text);
  // No look-behind (older iPhones cannot parse it): the "not inside a word" check is done by hand.
  const re = /\*\*([^*]+?)\*\*|\*([^*\s](?:[^*]*[^*\s])?)\*|_([^_\s](?:[^_]*[^_\s])?)_/g;
  const word = (ch) => !!ch && /[\p{L}\p{N}]/u.test(ch);
  let last = 0; let m;
  while ((m = re.exec(s))) {
    const before = s.charAt(m.index - 1); const after = s.charAt(re.lastIndex);
    if (m[1] === undefined && (word(before) || word(after))) { re.lastIndex = m.index + 1; continue; } // snake_case, 2*3*4
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1] !== undefined) out.push(h('strong', null, inline(m[1])));
    else out.push(h('em', null, m[2] !== undefined ? m[2] : m[3]));
    last = re.lastIndex;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

const splitRow = (line) => {
  let x = line.trim();
  if (x.startsWith('|')) x = x.slice(1);
  if (x.endsWith('|')) x = x.slice(0, -1);
  return x.split('|').map((c) => c.trim());
};

function table(lines, { caption } = {}) {
  const rows = lines.filter((l) => !TABLE_SEP.test(l)).map(splitRow);
  const hasHead = lines.length > 1 && TABLE_SEP.test(lines[1]);
  const head = hasHead ? rows.shift() : null;
  const width = Math.max(head ? head.length : 0, ...rows.map((r) => r.length));
  const pad = (r) => r.concat(Array(Math.max(0, width - r.length)).fill(''));
  const numCol = Array.from({ length: width }, (_, i) => rows.length > 0 && rows.every((r) => !r[i] || NUMERIC.test(r[i].replace(/\*/g, ''))));
  const tbl = h('table', { class: 'md-table' },
    caption ? h('caption', { class: 'sr-only', text: caption }) : null,
    head ? h('thead', null, h('tr', null, pad(head).map((c, i) => h('th', { scope: 'col', class: numCol[i] ? 'num' : null }, inline(c))))) : null,
    h('tbody', null, rows.map((r) => h('tr', null, pad(r).map((c, i) => (i === 0 && head
      ? h('th', { scope: 'row' }, inline(c))
      : h('td', { class: numCol[i] ? 'num' : null }, inline(c))))))));
  // The table scrolls inside its own box on narrow phones; the page never scrolls sideways.
  return h('div', { class: 'md-table-wrap', role: 'region', tabindex: '0', 'aria-label': caption || null }, tbl);
}

function list(lines) {
  const items = lines.map((l) => BULLET.exec(l)[1]);
  const lv = items.map((x) => LABEL_VALUE.exec(x));
  if (lv.every(Boolean)) {
    return h('dl', { class: 'md-kv' }, lv.map((m) => h('div', { class: 'md-kv-row' }, h('dt', null, inline(m[1].trim())), h('dd', null, inline(m[2].trim())))));
  }
  return h('ul', { class: 'md-list' }, items.map((x) => h('li', null, inline(x))));
}

/**
 * Render Markdown-ish text as a DocumentFragment-like array of block elements.
 * @param {string} md
 * @param {object} [o] caption: accessible name for tables
 */
export function mdBlocks(md, o = {}) {
  const lines = String(md == null ? '' : md).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    if (TABLE_ROW.test(line)) {
      const group = [];
      while (i < lines.length && (TABLE_ROW.test(lines[i]) || TABLE_SEP.test(lines[i])) && lines[i].trim()) { group.push(lines[i]); i += 1; }
      blocks.push(table(group, o));
      continue;
    }
    if (BULLET.test(line)) {
      const group = [];
      while (i < lines.length && BULLET.test(lines[i])) { group.push(lines[i]); i += 1; }
      blocks.push(list(group));
      continue;
    }
    if (NUMBERED.test(line)) {
      const group = [];
      while (i < lines.length && NUMBERED.test(lines[i])) { group.push(NUMBERED.exec(lines[i])); i += 1; }
      blocks.push(h('ol', { class: 'md-ol', start: group[0][1] !== '1' ? group[0][1] : null }, group.map((m) => h('li', null, inline(m[2])))));
      continue;
    }
    const hd = HEADING.exec(line);
    if (hd) { blocks.push(h('p', { class: 'md-h' }, inline(hd[1]))); i += 1; continue; }
    // A paragraph: consecutive plain lines, kept as separate lines.
    const para = [];
    while (i < lines.length && lines[i].trim() && !TABLE_ROW.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i]) && !HEADING.test(lines[i])) { para.push(lines[i].trim()); i += 1; }
    const kids = [];
    para.forEach((p, k) => { if (k) kids.push(h('br')); kids.push(...inline(p)); });
    blocks.push(h('p', null, kids));
  }
  return blocks;
}

/** A wrapper element with the rendered blocks. */
export function mdView(md, { className = '', caption } = {}) {
  return h('div', { class: `md ${className}`.trim() }, mdBlocks(md, { caption }));
}
