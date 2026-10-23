#!/usr/bin/env node
// Integration step (run once after parallel page work): folds docs/i18n/parts/*.json into
// docs/i18n/en.json + vi.json and docs/css/parts/*.css into docs/css/hub.css, removes the
// part <link> tags from the pages and empties the PARTS list in docs/js/i18n.js.
import { readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const DOCS = new URL('../docs/', import.meta.url).pathname;
const deepMerge = (a, b) => { for (const [k, v] of Object.entries(b)) { if (v && typeof v === 'object' && !Array.isArray(v)) a[k] = deepMerge(a[k] && typeof a[k] === 'object' ? a[k] : {}, v); else a[k] = v; } return a; };
const partsDir = join(DOCS, 'i18n', 'parts');
if (existsSync(partsDir)) {
  for (const lang of ['en', 'vi']) {
    const base = JSON.parse(readFileSync(join(DOCS, 'i18n', `${lang}.json`), 'utf8'));
    for (const f of readdirSync(partsDir).filter((n) => n.endsWith(`.${lang}.json`)).sort()) {
      const part = JSON.parse(readFileSync(join(partsDir, f), 'utf8'));
      for (const k of Object.keys(part)) if (base[k] && typeof base[k] === 'object') console.warn(`note: ${f} extends existing namespace "${k}"`);
      deepMerge(base, part);
    }
    writeFileSync(join(DOCS, 'i18n', `${lang}.json`), `${JSON.stringify(base, null, 1)}\n`);
  }
  rmSync(partsDir, { recursive: true });
}
const cssDir = join(DOCS, 'css', 'parts');
if (existsSync(cssDir)) {
  let hub = readFileSync(join(DOCS, 'css', 'hub.css'), 'utf8').trimEnd();
  for (const f of readdirSync(cssDir).filter((n) => n.endsWith('.css')).sort()) {
    const css = readFileSync(join(cssDir, f), 'utf8').trim();
    if (css) hub += `\n\n/* ===== Pages (${f}) ===== */\n${css}`;
  }
  writeFileSync(join(DOCS, 'css', 'hub.css'), `${hub}\n`);
  rmSync(cssDir, { recursive: true });
}
for (const f of readdirSync(DOCS).filter((n) => n.endsWith('.html'))) {
  const p = join(DOCS, f);
  const s = readFileSync(p, 'utf8').replace(/<link rel="stylesheet" href="css\/parts\/[a-z]+\.css">(<!--[^>]*-->)?\n/g, '');
  writeFileSync(p, s);
}
const i18nJs = join(DOCS, 'js', 'i18n.js');
writeFileSync(i18nJs, readFileSync(i18nJs, 'utf8').replace(/const PARTS = \[[^\]]*\];/, 'const PARTS = [];'));
console.log('merged parts into en.json, vi.json and hub.css');
