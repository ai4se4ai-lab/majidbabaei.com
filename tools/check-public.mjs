// Verifies the built Pages artifact (_site/) before it is uploaded: every page loads its shared assets,
// every local link and file reference resolves, and nothing private or stale slipped in.
// Usage: node tools/check-public.mjs   (run after node tools/build-public.mjs)
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..', '_site');
if (!existsSync(site)) { console.error('_site/ is missing. Run: node tools/build-public.mjs'); process.exit(1); }

const walk = async dir => (await Promise.all((await readdir(dir, { withFileTypes: true }))
  .map(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))).flat();
const files = await walk(site);
const pages = files.filter(f => f.endsWith('.html') && !f.includes(`${sep}pages${sep}`));
const problems = [];
const rel = f => f.slice(site.length + 1).split(sep).join('/');

// Pages written before the redesign (archived course pages) are left as they were; every other page is checked.
for (const file of pages) {
  const html = await readFile(file, 'utf8');
  const name = rel(file);
  if (!/assets\/motion\.css/.test(html) || !/assets\/motion\.js/.test(html)) problems.push(`${name}: does not load the shared motion layer`);
  if (/cdn\.jsdelivr\.net/.test(html)) problems.push(`${name}: still loads a CDN script (Markdown is rendered at build time)`);
  if (/rel="expect"/.test(html) && !/id="page-ready"/.test(html)) problems.push(`${name}: render-blocking link has no #page-ready target, so the page would never paint early`);
  for (const [, ref] of html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)) {
    if (/^(https?:|mailto:|data:|tel:|javascript:)/.test(ref)) continue;
    const path = decodeURIComponent(ref.split(/[?#]/)[0]);
    let target = resolve(path.startsWith('/') ? site : dirname(file), '.' + (path.startsWith('/') ? path : '/' + path));
    if (!target.startsWith(site)) { problems.push(`${name}: link leaves the site: ${ref}`); continue; }
    if (!existsSync(target)) problems.push(`${name}: missing ${ref}`);
    else if (path.endsWith('/') && !existsSync(join(target, 'index.html'))) problems.push(`${name}: ${ref} is a folder without an index page`);
  }
}
for (const need of ['index.html', '404.html', 'news/index.html', 'projects/index.html', 'news/feed.xml', 'sitemap.xml', 'assets/motion.css', 'assets/motion.js'])
  if (!files.includes(join(site, ...need.split('/')))) problems.push(`missing required file: ${need}`);
if (files.some(f => /(?:Curriculum_Vitae|Majid_Babaei_CV)\.pdf$/i.test(f))) problems.push('a CV PDF is in the public artifact');
if (files.some(f => f.endsWith('project.json'))) problems.push('a project.json editing source is in the public artifact');

if (problems.length) { console.error(`Public artifact check failed:\n- ${problems.join('\n- ')}`); process.exit(1); }
console.log(`Public artifact OK: ${pages.length} pages, ${files.length} files.`);
