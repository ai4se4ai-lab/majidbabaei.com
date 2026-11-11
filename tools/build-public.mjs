// Build a fresh Pages artifact; private CVs, drafts and editing sources stay out.
import { readdir, readFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { resolve, dirname, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '_site');
if (!output.startsWith(root + sep) || output === root) throw new Error('Unsafe output directory');
await rm(output, { recursive: true, force: true });
await mkdir(output);
const hidden = /(?:agentm2m|skillspec|swe-multiskillsbench)/i;
const cv = /(?:02_Curriculum_Vitae|Majid_Babaei_CV)\.pdf$/i;
const extensions = new Set(['.html', '.css', '.js', '.json', '.xml', '.txt', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.pdf', '.woff', '.woff2', '.ttf', '.otf', '.eot']);
let count = 0;
async function copy(rel) {
  for (const item of await readdir(resolve(root, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${item.name}` : item.name;
    if (hidden.test(path) || cv.test(path) || item.name === 'project.json') continue;
    if (item.isDirectory()) { await copy(path); continue; }
    if (!item.isFile() || !extensions.has(extname(path)) && !/^news\/posts\/.*\.md$/.test(path)) continue;
    if (/\.(html|js|json|xml|txt|md|svg)$/i.test(path)) {
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
    if (['assets', 'news', 'projects', 'pages', 'data', 'images'].includes(item.name)) await copy(item.name);
  } else if (['index.html', '404.html', 'robots.txt', 'sitemap.xml', '.nojekyll'].includes(item.name)) {
    const text = await readFile(resolve(root, item.name), 'utf8');
    if (hidden.test(text) || /(?:02_Curriculum_Vitae|Majid_Babaei_CV)\.pdf/i.test(text)) throw new Error(`Private reference in ${item.name}`);
    await copyFile(resolve(root, item.name), resolve(output, item.name));
    count++;
  }
}
console.log(`Public artifact: ${count} files in ${output}; CVs and identifying review material excluded.`);
