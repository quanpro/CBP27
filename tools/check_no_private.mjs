#!/usr/bin/env node
// Privacy guard for this PUBLIC repository (specs/17 step 0, specs/18).
// Fails if a checked file:
//   - lives under content-private/ or is a .csv / .xlsx file
//   - contains a literal answer key ("answer": "a".."d")
//   - contains an item id from the private bank (e.g. A2-A-03, BL-xx-01)
//   - (local only) contains an item stem, option or case sentence from the private bank,
//     when the bank is available at $PRIVATE_BANK or ./content-private/item_bank.json
// Usage: node tools/check_no_private.mjs            # staged content (pre-commit)
//        node tools/check_no_private.mjs --all      # every tracked file (CI)
//        node tools/check_no_private.mjs --history  # every blob ever committed (CI)
//        node tools/check_no_private.mjs <files...> # explicit files
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

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
const ITEM_ID = /\b(A[123]|C1|P[1-6]|BL)-(A|B|PR|[A-Z0-9]{2,4})-[0-9]{2}\b/;
const SELF = 'tools/check_no_private.mjs';

// Optional local fingerprint of the private bank (never committed, never printed).
const bankPath = process.env.PRIVATE_BANK || join(ROOT, 'content-private', 'item_bank.json');
const fingerprints = [];
if (existsSync(bankPath)) {
  try {
    const bank = JSON.parse(readFileSync(bankPath, 'utf8'));
    const add = (s) => { s = (s || '').trim(); if (s.length >= 40) fingerprints.push(s.slice(0, 60)); };
    for (const it of bank.items || []) {
      add(it.stem_en); add(it.stem_vi); add(it.why_en); add(it.why_vi);
      for (const o of it.options || []) { add(o.en); add(o.vi); }
    }
    const c = (bank.meta && bank.meta.case) || {};
    for (const s of `${c.context_en || ''} ${c.context_vi || ''}`.split(/(?<=[.?!])\s+/)) add(s);
  } catch (e) {
    console.error(`check_no_private: could not read the private bank (${e.message}); stem check skipped`);
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
  const id = text.match(ITEM_ID);
  if (id) problems.push(`${label}: contains a private item id (${id[0]})`);
  for (const fp of fingerprints) {
    if (text.includes(fp)) { problems.push(`${label}: contains text from the private item bank`); break; }
  }
}

if (problems.length) {
  console.error('✖ Privacy check failed. This repository is public.\n  ' + problems.join('\n  '));
  console.error('Move private material to content-private/ (git-ignored) or the private Google Sheet.');
  process.exit(1);
}
console.log(`✔ Privacy check passed (${files.length} ${args[0] === '--history' ? 'blob' : 'file'}${files.length === 1 ? '' : 's'}${fingerprints.length ? ', bank fingerprint on' : ''}).`);
