#!/usr/bin/env node
// Privacy guard for this PUBLIC repository (specs/17 step 0, specs/18).
// Fails if a checked file:
//   - lives under content-private/ or is a .csv / .xlsx file
//   - contains a literal answer key ("answer": "a".."d")
//   - contains an item id from the private bank (e.g. A2-A-03, BL-xx-01; Baseline v2: P1B-A07,
//     P2-S03, P2-R11, P3-CORE04, P3-DP12; exhibit ids P1B_C1_T3, P3_DP05)
//   - (local only) contains a stem, option, explanation, statement or exhibit line from the private
//     bank, when it is available. $PRIVATE_BANK may name a JSON or CSV file, a folder (every .json
//     and .csv in it), or several of these separated by ':'. Default: content-private/item_bank.json,
//     content-private/Items.csv, content-private/Exhibits.csv and content-private/item_bank/ (when present).
// Usage: node tools/check_no_private.mjs            # staged content (pre-commit)
//        node tools/check_no_private.mjs --all      # every tracked file (CI)
//        node tools/check_no_private.mjs --history  # every blob ever committed (CI)
//        node tools/check_no_private.mjs <files...> # explicit files
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const args = process.argv.slice(2);
const git = (a, opts = {}) => execFileSync('git', a, { cwd: ROOT, maxBuffer: 256 * 1024 * 1024, ...opts });
// Each entry: { name, read() → Buffer|null }. Staged mode reads the index (what will be committed),
// history mode reads every blob reachable from any ref.
let entries;
if (args[0] === '--all') {
  entries = git(['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean).map((f) => ({ name: f, read: () => fromDisk(f) }));
} else if (args[0] === '--history') {
  const seen = new Set();
  entries = [];
  for (const line of git(['rev-list', '--objects', '--all'], { encoding: 'utf8' }).split('\n')) {
    const [sha, ...rest] = line.split(' ');
    const name = rest.join(' ');
    if (!sha || !name || seen.has(sha)) continue;
    seen.add(sha);
    if (git(['cat-file', '-t', sha], { encoding: 'utf8' }).trim() !== 'blob') continue;
    entries.push({ name: `${name} (${sha.slice(0, 8)})`, path: name, read: () => git(['cat-file', 'blob', sha]) });
  }
} else if (args.length) {
  entries = args.map((f) => ({ name: f, read: () => fromDisk(f) }));
} else {
  entries = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
    .map((f) => ({ name: f, read: () => { try { return git(['show', `:${f}`]); } catch (e) { return null; } } }));
}
function fromDisk(f) {
  const abs = join(ROOT, f);
  if (!existsSync(abs) || statSync(abs).isDirectory()) return null;
  return readFileSync(abs);
}
const files = entries;

const ANSWER_KEY = /"answer"\s*:\s*"[a-d]"/;
const ITEM_IDS = [
  /\b(A[123]|C1|P[1-6]|BL)-(A|B|PR|[A-Z0-9]{2,4})-[0-9]{2}\b/,  // v1 bank
  /\bP1[ABC]-[AB]\d{2}\b/,                                       // Baseline v2 Part 1
  /\bP2-[SR]\d{2}\b/,                                            // Part 2 SJT / rating
  /\bP3-(?:CORE|DP|SP|RPM|CS)\d{2}\b/,                           // Part 3
  /\bP1[ABC]_C[12]_(?:intro|[A-Z]\d+)\b/,                         // Part 1 exhibit ids
  /\bP3_(?:CORE|DP|SP|RPM|CS)\d{2}\b/                            // Part 3 exhibit ids
];
const SELF = 'tools/check_no_private.mjs';

// Optional local fingerprint of the private bank (never committed, never printed).
function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false;
  const t = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(field); field = ''; rows.push(row); row = []; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const fingerprints = new Set();
const add = (s) => {
  s = String(s || '').trim();
  if (s.length < 40) return;
  fingerprints.add(s.slice(0, 60));
  if (s.length > 160) {
    for (const part of s.split(/(?<=[.?!])\s+|\n+/)) { const p = part.trim(); if (p.length >= 40) fingerprints.add(p.slice(0, 60)); }
  }
};
function addJson(bank) {
  if (bank && Array.isArray(bank.items) && bank.items.some((it) => it && (it.stem_en || it.options))) {
    for (const it of bank.items) {
      add(it.stem_en); add(it.stem_vi); add(it.why_en); add(it.why_vi);
      for (const o of it.options || []) { add(o.en); add(o.vi); }
    }
    const c = (bank.meta && bank.meta.case) || {};
    for (const s of `${c.context_en || ''} ${c.context_vi || ''}`.split(/(?<=[.?!])\s+/)) add(s);
  }
  const walk = (v) => { if (typeof v === 'string') add(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(bank);
}
function addCsv(text) { for (const row of parseCsv(text).slice(1)) row.forEach(add); }
const bankPaths = [];
const expand = (p) => {
  if (!p || !existsSync(p)) return;
  if (statSync(p).isDirectory()) { for (const f of readdirSync(p)) if (/\.(json|csv)$/i.test(f)) bankPaths.push(join(p, f)); }
  else bankPaths.push(p);
};
if (process.env.PRIVATE_BANK) process.env.PRIVATE_BANK.split(delimiter).forEach(expand);
else ['item_bank.json', 'Items.csv', 'Exhibits.csv', 'BaselineItems.csv', 'item_bank'].forEach((f) => expand(join(ROOT, 'content-private', f)));
for (const p of bankPaths) {
  try {
    const text = readFileSync(p, 'utf8');
    if (/\.csv$/i.test(p)) addCsv(text); else addJson(JSON.parse(text));
  } catch (e) {
    console.error(`check_no_private: could not read a private bank file (${e.message}); it is skipped`);
  }
}

const problems = [];
for (const entry of files) {
  const rel = (entry.path || entry.name).replace(/\\/g, '/');
  const label = entry.name.replace(/\\/g, '/');
  if (/(^|\/)content-private(\/|$)/.test(rel)) { problems.push(`${label}: lives under content-private/`); continue; }
  if (/\.(csv|xlsx)$/i.test(rel)) { problems.push(`${label}: .csv/.xlsx files are never committed`); continue; }
  if (rel === SELF) continue;
  const buf = entry.read();
  if (!buf) continue;
  if (buf.includes(0)) continue; // binary (logo)
  const text = buf.toString('utf8');
  if (ANSWER_KEY.test(text)) problems.push(`${label}: contains a literal answer key ("answer": "x")`);
  for (const re of ITEM_IDS) {
    const id = text.match(re);
    if (id) { problems.push(`${label}: contains a private item id (${id[0]})`); break; }
  }
  for (const fp of fingerprints) {
    if (text.includes(fp)) { problems.push(`${label}: contains text from the private item bank`); break; }
  }
}

if (problems.length) {
  console.error('✖ Privacy check failed. This repository is public.\n  ' + problems.join('\n  '));
  console.error('Move private material to content-private/ (git-ignored) or the private Google Sheet.');
  process.exit(1);
}
console.log(`✔ Privacy check passed (${files.length} ${args[0] === '--history' ? 'blob' : 'file'}${files.length === 1 ? '' : 's'}${fingerprints.size ? `, bank fingerprint on (${bankPaths.length} file${bankPaths.length === 1 ? '' : 's'})` : ''}).`);
