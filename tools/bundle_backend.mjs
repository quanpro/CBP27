#!/usr/bin/env node
// Concatenates backend/*.gs into backend/dist/Hub.gs (one file to paste into the Apps Script
// editor) and copies backend/appsscript.json to backend/dist/.
// Usage: node tools/bundle_backend.mjs           # write backend/dist/
//        node tools/bundle_backend.mjs --check   # exit 1 if backend/dist/ is out of date
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'backend');
const DIST = join(SRC, 'dist');
const ORDER = ['Seed.gs', 'Logic.gs', 'Data.gs', 'Code.gs', 'Auth.gs', 'Assess.gs', 'Admin.gs', 'Setup.gs'];

export function buildBundle() {
  const all = readdirSync(SRC).filter((f) => f.endsWith('.gs'));
  const files = ORDER.filter((f) => all.includes(f)).concat(all.filter((f) => !ORDER.includes(f)).sort());
  const parts = [
    '/**',
    ' * Hub.gs · The 1% Planner Hub backend, bundled by tools/bundle_backend.mjs. Do not edit this',
    ' * file: edit backend/*.gs and run `node tools/bundle_backend.mjs`.',
    ' * Paste the whole file into the Apps Script editor (see backend/DEPLOY.md).',
    ' * Sources: ' + files.join(', '),
    ' */',
    ''
  ];
  for (const f of files) {
    parts.push('// ' + '='.repeat(76), '// ' + f, '// ' + '='.repeat(76), readFileSync(join(SRC, f), 'utf8').replace(/\s+$/, ''), '');
  }
  return { hub: parts.join('\n'), manifest: readFileSync(join(SRC, 'appsscript.json'), 'utf8'), files };
}

function main() {
  const b = buildBundle();
  const hubPath = join(DIST, 'Hub.gs'), manPath = join(DIST, 'appsscript.json');
  if (process.argv.includes('--check')) {
    const same = existsSync(hubPath) && existsSync(manPath) && readFileSync(hubPath, 'utf8') === b.hub && readFileSync(manPath, 'utf8') === b.manifest;
    if (!same) { console.error('✖ backend/dist is out of date: run node tools/bundle_backend.mjs'); process.exit(1); }
    console.log('✔ backend/dist is up to date');
    return;
  }
  mkdirSync(DIST, { recursive: true });
  writeFileSync(hubPath, b.hub);
  writeFileSync(manPath, b.manifest);
  console.log(`✔ wrote backend/dist/Hub.gs (${b.files.length} files, ${Math.round(b.hub.length / 1024)} KB) and backend/dist/appsscript.json`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
