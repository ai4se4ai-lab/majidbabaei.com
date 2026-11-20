// Build a fresh Pages artifact; private CVs, drafts and editing sources stay out.
import { readdir, readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '_site');
if (!output.startsWith(root + sep) || output === root) throw new Error('Unsafe output directory');
await rm(output, { recursive: true, force: true });
await mkdir(output);
const hidden = /(?:agentm2m|skillspec|swe-multiskillsbench)/i;
const cv = /(?:02_Curriculum_Vitae|Majid_Babaei_CV)\.pdf$/i;
const extensions = new Set(['.html', '.css', '.js', '.json', '.xml', '.txt', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.pdf', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.ics', '.scxml']);
let count = 0;
async function copy(rel) {
  for (const item of await readdir(resolve(root, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${item.name}` : item.name;
    if (hidden.test(path) || cv.test(path) || item.name === 'project.json' || item.name === 'preprint.json') continue;
    if (item.isDirectory()) { await copy(path); continue; }
    // Generated preprint citations (preprints/<slug>/v<N>/citation.bib) are the only public .bib files.
    const preprintBib = /^preprints\/[a-z0-9-]+\/v\d+\/citation\.bib$/.test(path);
    if (!item.isFile() || !extensions.has(extname(path)) && !preprintBib && !/^(?:news\/posts|calendar\/events)\/[^_][^/]*\.md$/.test(path)) continue;
    if (/\.(html|js|json|xml|txt|md|svg|bib|scxml)$/i.test(path)) {
      const text = await readFile(resolve(root, path), 'utf8');
      if (hidden.test(text)) throw new Error(`Identifying review details in public output: ${path}`);
      if (/(?:02_Curriculum_Vitae|Majid_Babaei_CV)\.pdf/i.test(text)) throw new Error(`Direct CV reference in public output: ${path}`);
    }
    const target = resolve(output, path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(resolve(root, path), target);
    count++;
  }
}
for (const item of await readdir(root, { withFileTypes: true })) {
  if (item.isDirectory()) {
    if (['assets', 'news', 'projects', 'calendar', 'preprints', 'pages', 'data', 'images'].includes(item.name)) await copy(item.name);
  } else if (['index.html', '404.html', 'favicon.ico', 'robots.txt', 'sitemap.xml', '.nojekyll'].includes(item.name)) {
    const text = await readFile(resolve(root, item.name), 'utf8');
    if (hidden.test(text) || /(?:02_Curriculum_Vitae|Majid_Babaei_CV)\.pdf/i.test(text)) throw new Error(`Private reference in ${item.name}`);
    await copyFile(resolve(root, item.name), resolve(output, item.name));
    count++;
  }
}
// Cache-bust local stylesheets and scripts: browsers otherwise pair fresh HTML with a stale cached
// style.css/site.js (Pages sends max-age=600), and new markup renders without its rules.
const hashes = new Map();
async function version(file) {
  if (!hashes.has(file)) hashes.set(file, createHash('sha256').update(await readFile(file)).digest('hex').slice(0, 10));
  return hashes.get(file);
}
let busted = 0;
async function bust(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, item.name);
    if (item.isDirectory()) { await bust(path); continue; }
    if (!item.name.endsWith('.html')) continue;
    const html = await readFile(path, 'utf8');
    const refs = new Map([...html.matchAll(/\b(href|src)="([^"?#:]+\.(?:css|js))"/g)].map(m => [m[0], m]));
    if (!refs.size) continue;
    let out = html;
    for (const [whole, attr, ref] of refs.values()) {
      const file = ref.startsWith('/') ? resolve(output, '.' + ref) : resolve(dirname(path), ref);
      if (!file.startsWith(output + sep) || !existsSync(file)) continue;
      out = out.replaceAll(whole, `${attr}="${ref}?v=${await version(file)}"`);
      busted++;
    }
    if (out !== html) await writeFile(path, out);
  }
}
await bust(output);
console.log(`Public artifact: ${count} files in ${output}; CVs and identifying review material excluded; ${busted} asset references versioned.`);
