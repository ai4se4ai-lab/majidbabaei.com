// Copies the shared header navigation (tools/chrome.mjs) into the hand-written pages,
// so every page carries identical menus. `--check` exits non-zero if any page is stale.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { navigation } from './chrome.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = [['index.html', '', ''], ['news/index.html', '../', 'news/'], ['projects/index.html', '../', 'projects/'], ['calendar/index.html', '../', 'calendar/']];
const NAV = /(<nav class="nav" id="nav" aria-label="Main">\s*)[\s\S]*?(\s*<\/nav>)/;
const check = process.argv.includes('--check');

const stale = [];
for (const [file, root, current] of PAGES) {
  const path = join(ROOT, file), html = readFileSync(path, 'utf8');
  if (!NAV.test(html)) throw new Error(`${file}: main navigation not found`);
  const next = html.replace(NAV, (_, open, close) => open + navigation(root, current) + close);
  if (next === html) continue;
  stale.push(file);
  if (!check) writeFileSync(path, next);
}
if (check && stale.length) { console.error(`Header navigation is stale in: ${stale.join(', ')} (run node tools/sync-nav.mjs)`); process.exit(1); }
console.log(stale.length ? `Updated navigation in ${stale.join(', ')}` : 'Navigation up to date');
