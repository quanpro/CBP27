#!/usr/bin/env node
// Writes the <link rel="modulepreload"> lines of every page in docs/: all the modules its script
// imports (directly or through another module), so the browser asks for them together instead of
// discovering them one import level at a time. Run after adding an import; `--check` fails when a
// page is out of date (CI).
//   node tools/gen_preloads.mjs [--check]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const CHECK = process.argv.includes('--check');
const IMPORT_RE = /^\s*import\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm; // static imports only

const cache = new Map();
function importsOf(file) {
  if (!cache.has(file)) {
    const src = readFileSync(file, 'utf8');
    cache.set(file, [...src.matchAll(IMPORT_RE)].map((m) => m[1]).filter((s) => s.startsWith('.')).map((s) => resolve(dirname(file), s)));
  }
  return cache.get(file);
}
function graph(entry) {
  const seen = []; const todo = [...importsOf(entry)];
  while (todo.length) {
    const f = todo.shift();
    if (f === entry || seen.includes(f)) continue;
    seen.push(f);
    todo.push(...importsOf(f));
  }
  return seen;
}

let stale = 0;
for (const name of readdirSync(DOCS).filter((f) => f.endsWith('.html')).sort()) {
  const path = join(DOCS, name);
  const html = readFileSync(path, 'utf8');
  const entry = /<script type="module" src="([^"]+)"><\/script>/.exec(html);
  if (!entry) continue;
  const links = graph(resolve(DOCS, entry[1])).map((f) => `<link rel="modulepreload" href="${relative(DOCS, f).split('\\').join('/')}">`);
  const without = html.replace(/<link rel="modulepreload" href="[^"]+">\n/g, '');
  const next = without.replace(entry[0], `${links.join('\n')}\n${entry[0]}`);
  if (next !== html) {
    stale += 1;
    if (CHECK) console.error(`✖ ${name}: modulepreload links are out of date (run node tools/gen_preloads.mjs)`);
    else { writeFileSync(path, next); console.log(`✔ ${name}: ${links.length} modules`); }
  }
}
if (CHECK && stale) process.exit(1);
if (!stale) console.log('✔ modulepreload links are up to date');
