#!/usr/bin/env node
// Privacy guard for this PUBLIC repository (specs/17 step 0, specs/18).
// Fails if a checked file:
//   - lives under content-private/ or is a .csv / .xlsx file
//   - contains a literal answer key ("answer": "a".."d")
//   - contains an item id from the private bank (e.g. A2-A-03, BL-xx-01)
//   - (local only) contains an item stem, option or case sentence from the private bank,
//     when the bank is available at $PRIVATE_BANK or ./content-private/item_bank.json
// Usage: node tools/check_no_private.mjs            # staged files (pre-commit)
//        node tools/check_no_private.mjs --all      # every tracked file (CI)
//        node tools/check_no_private.mjs <files...> # explicit files
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const args = process.argv.slice(2);
let files;
if (args[0] === '--all') {
  files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
} else if (args.length) {
  files = args;
} else {
  files = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
}

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
for (const f of files) {
  const rel = f.replace(/\\/g, '/');
  if (/(^|\/)content-private(\/|$)/.test(rel)) { problems.push(`${rel}: lives under content-private/`); continue; }
  if (/\.(csv|xlsx)$/i.test(rel)) { problems.push(`${rel}: .csv/.xlsx files are never committed`); continue; }
  if (rel === SELF) continue;
  const abs = join(ROOT, rel);
  if (!existsSync(abs) || statSync(abs).isDirectory()) continue;
  const buf = readFileSync(abs);
  if (buf.includes(0)) continue; // binary (logo)
  const text = buf.toString('utf8');
  if (ANSWER_KEY.test(text)) problems.push(`${rel}: contains a literal answer key ("answer": "x")`);
  const id = text.match(ITEM_ID);
  if (id) problems.push(`${rel}: contains a private item id (${id[0]})`);
  for (const fp of fingerprints) {
    if (text.includes(fp)) { problems.push(`${rel}: contains text from the private item bank`); break; }
  }
}

if (problems.length) {
  console.error('✖ Privacy check failed. This repository is public.\n  ' + problems.join('\n  '));
  console.error('Move private material to content-private/ (git-ignored) or the private Google Sheet.');
  process.exit(1);
}
console.log(`✔ Privacy check passed (${files.length} file${files.length === 1 ? '' : 's'}${fingerprints.length ? ', bank fingerprint on' : ''}).`);
