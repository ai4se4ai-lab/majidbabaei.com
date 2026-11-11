import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firstImage, renderMarkdown } from './news-markdown.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('Markdown renders tables, captioned figures, links and unique heading anchors without browser scripts', () => {
  const html = renderMarkdown('## Results\n\n## Results\n\n![Workflow](/assets/figure.png)\n\n| Metric | Result |\n| --- | --- |\n| Hit@5 | 0.61 |\n\n[Code](https://example.org)');
  assert.match(html, /id="results"/);
  assert.match(html, /id="results-2"/);
  assert.match(html, /<figure><img[^>]+loading="lazy"[^>]* \/><figcaption>Workflow<\/figcaption><\/figure>/);
  assert.match(html, /class="table-wrap"><table>/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test('Markdown rejects executable HTML, unsafe links and image handlers', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n<img src="/ok.png" onerror="alert(1)">\n\n[bad](javascript:alert)\n\n<iframe src="https://example.org"></iframe>');
  assert.doesNotMatch(html, /<script|onerror|javascript:|<iframe/);
  assert.match(html, /src="\/ok.png"/);
});

test('first Markdown figure supplies the cover without repeating it in the article body', () => {
  const md = 'Introduction.\n\n![Top figure](/top.png)\n\n![Second figure](/second.png)';
  assert.deepEqual(firstImage(md), { src: '/top.png', alt: 'Top figure' });
  const html = renderMarkdown(md, { topImage: '/top.png' });
  assert.doesNotMatch(html, /src="\/top.png"/);
  assert.match(html, /src="\/second.png"/);
});

test('every Markdown post has a complete, crawlable article with canonical social metadata and valid local links', async () => {
  const files = (await readdir(resolve(root, 'news/posts'))).filter(f => f.endsWith('.md'));
  for (const file of files) {
    const slug = file.replace(/\.md$/, '').replace(/^\d{4}(-\d{2}){0,2}-/, '');
    const pagePath = resolve(root, 'news', slug, 'index.html');
    const html = await readFile(pagePath, 'utf8');
    const prose = html.match(/<article class="prose"[^>]*>([\s\S]*?)<\/article>/)?.[1];
    assert.ok(prose?.length > 200, `${slug}: missing static article body`);
    assert.doesNotMatch(html, /post-md|marked\.min\.js|purify\.min\.js|enable JavaScript/);
    assert.ok(html.includes(`property="og:url" content="https://majidbabaei.com/news/${slug}/"`));
    assert.match(html, /name="twitter:card" content="summary_large_image"/);
    for (const [, ref] of html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)) {
      if (/^(https?:|mailto:|data:)/.test(ref)) continue;
      const localPath = ref.split(/[?#]/)[0];
      const target = resolve(localPath.startsWith('/') ? root : dirname(pagePath), '.' + (localPath.startsWith('/') ? localPath : '/' + localPath));
      assert.ok(existsSync(decodeURIComponent(target)), `${slug}: missing ${ref}`);
    }
  }
});

test('RapidPay uses its full top figure as a LinkedIn-compatible raster preview and preserves to-appear status', async () => {
  const html = await readFile(resolve(root, 'news/rapidpay-emse/index.html'), 'utf8');
  const figure = '/assets/img/news/rapidpay-overview.png';
  assert.ok(html.includes(`property="og:image" content="https://majidbabaei.com${figure}"`));
  assert.ok(html.includes(`src="${figure}"`));
  assert.match(html, /<strong>to appear<\/strong>/);
  assert.match(html, /retrospective findings/);
  const image = await readFile(resolve(root, '.' + figure));
  assert.ok(image.readUInt32BE(16) >= 1200 && image.readUInt32BE(20) >= 627);
  assert.ok(image.length < 5 * 1024 * 1024);
});
