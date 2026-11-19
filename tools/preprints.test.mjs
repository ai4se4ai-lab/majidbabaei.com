// Tests for tools/build-preprints.mjs on a disposable copy of the site's inputs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = b => createHash('sha256').update(b).digest('hex');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

async function sandbox() {
  const dir = await mkdtemp(join(tmpdir(), 'preprints-'));
  await cp(join(root, 'tools'), join(dir, 'tools'), { recursive: true });
  await mkdir(join(dir, 'assets'), { recursive: true });
  await cp(join(root, 'assets', 'research-data.js'), join(dir, 'assets', 'research-data.js'));
  await cp(join(root, 'news', 'posts'), join(dir, 'news', 'posts'), { recursive: true });
  await mkdir(join(dir, 'projects', 'demo'), { recursive: true });
  await writeFile(join(dir, 'projects', 'demo', 'project.json'), JSON.stringify({ meta: { name: 'Demo Project' } }));
  return dir;
}
const run = (dir, ...args) => spawnSync(process.execPath, [join(dir, 'tools', 'build-preprints.mjs'), ...args], { encoding: 'utf8' });
const record = over => ({
  articleId: 'art_test', slug: 'demo-paper', disclosure: 'public',
  links: { publicationId: null, projectIds: ['demo'], newsPostIds: [], agendaIds: ['research'] }, venue: null,
  versions: [{ version: 1, date: '2026-11-19', note: '', sha256: sha(PDF), title: 'A <Demo> Paper', authors: [{ name: 'Majid Babaei', affiliation: 'UFV' }], abstract: 'Abstract text.' }],
  ...over
});
async function writeRecord(dir, rec, pdf = PDF) {
  await mkdir(join(dir, 'preprints', rec.slug, 'v1'), { recursive: true });
  await writeFile(join(dir, 'preprints', rec.slug, 'preprint.json'), JSON.stringify(rec));
  await writeFile(join(dir, 'preprints', rec.slug, 'v1', 'paper.pdf'), pdf);
}

test('an empty catalog still produces the index page and data file', async () => {
  const dir = await sandbox();
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(await readFile(join(dir, 'preprints', 'index.html'), 'utf8'), /No preprints have been released yet/);
  assert.match(await readFile(join(dir, 'assets', 'preprints-data.js'), 'utf8'), /window\.PREPRINTS = \[\]/);
  await rm(dir, { recursive: true, force: true });
});

test('a release record generates stable, numbered, citation and alias outputs with escaped metadata', async () => {
  const dir = await sandbox();
  await writeRecord(dir, record());
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  const landing = await readFile(join(dir, 'preprints', 'demo-paper', 'index.html'), 'utf8');
  assert.match(landing, /citation_pdf_url" content="https:\/\/majidbabaei\.com\/preprints\/demo-paper\/v1\/paper\.pdf"/);
  assert.match(landing, /A &lt;Demo&gt; Paper/);
  assert.doesNotMatch(landing, /<Demo>/);
  assert.match(landing, /projects\/demo\//);
  assert.ok(existsSync(join(dir, 'preprints', 'demo-paper', 'v1', 'index.html')));
  assert.match(await readFile(join(dir, 'preprints', 'demo-paper', 'v1', 'citation.bib'), 'utf8'), /^@misc\{babaei2026demopaperv1,/);
  assert.deepEqual(await readFile(join(dir, 'preprints', 'demo-paper', 'paper.pdf')), PDF);
  assert.match(await readFile(join(dir, 'assets', 'preprints-data.js'), 'utf8'), /"slug": "demo-paper"/);
  assert.equal(run(dir, '--check').status, 0);
  await rm(dir, { recursive: true, force: true });
});

test('a changed numbered PDF fails the check: published versions are immutable', async () => {
  const dir = await sandbox();
  await writeRecord(dir, record());
  assert.equal(run(dir).status, 0);
  await writeFile(join(dir, 'preprints', 'demo-paper', 'v1', 'paper.pdf'), Buffer.concat([PDF, Buffer.from('tampered')]));
  const r = run(dir, '--check');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /immutable/);
  await rm(dir, { recursive: true, force: true });
});

test('withheld records, anonymous publications, and unknown targets are refused', async () => {
  for (const [over, pattern] of [
    [{ disclosure: 'withheld' }, /disclosure "public"/],
    [{ links: { publicationId: 'anonymous-review-1', projectIds: [], newsPostIds: [], agendaIds: [] } }, /anonymous for review/],
    [{ links: { publicationId: null, projectIds: ['nope'], newsPostIds: ['missing-story'], agendaIds: [] } }, /unknown project "nope"[\s\S]*unknown news story "missing-story"/]
  ]) {
    const dir = await sandbox();
    await writeRecord(dir, record(over));
    const r = run(dir);
    assert.notEqual(r.status, 0, JSON.stringify(over));
    assert.match(r.stderr, pattern);
    await rm(dir, { recursive: true, force: true });
  }
});
