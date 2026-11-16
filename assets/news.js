'use strict';
// Newsroom: front page (news/) and article pages (news/<slug>/). Theme, menu and page transitions live in motion.js.
(() => {
  const NEWS = window.NEWS || [];
  const M = window.Motion || { swap: (_, fn) => fn(), cover: () => '' };
  const body = document.body;
  const ROOT = body.dataset.root || '';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  // Values are escaped with esc(); article Markdown is rendered and sanitized at build time.
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const render = (el, html) => el.replaceChildren(document.createRange().createContextualFragment(html));
  const postURL = slug => `${ROOT}news/${slug}/`;

  /* ---------- Covers: the post's own figure, or a generated statechart in the topic's colours ---------- */
  const N = 'var(--navy)', T = 'var(--teal)', O = 'var(--orange)';
  const TAG_HUE = { 'Research agenda': [N, O], 'Agentic AI': [O, N], Publications: [N, T], Manuscripts: [T, O], 'Software evidence': [T, N],
    Teaching: [T, O], Students: [T, N], Partnerships: [O, T], Service: [N, T], Milestones: [O, N] };
  function paintCover(el, p) {
    if (p.cover) { el.classList.add('is-figure'); render(el, `<img src="${esc(ROOT + p.cover.replace(/^\//, ''))}" alt="" loading="lazy">`); }
    else render(el, M.cover(p.slug, TAG_HUE[p.tags[0]]));
  }
  const paintAll = scope => $$('[data-c]', scope).forEach(el => { const p = NEWS.find(x => x.slug === el.dataset.c); if (p) paintCover(el, p); });
  const isNew = p => (Date.now() - new Date(`${p.iso}T12:00:00`).getTime()) / 864e5 < 45;
  const kicker = p => `<p class="story-k">${isNew(p) ? '<span class="new">New</span>' : ''}<span class="tg">${esc(p.tags[0])}</span><time datetime="${esc(p.iso)}">${esc(p.dateLabel)}</time></p>`;
  const card = (p, big) => `<article class="story${big === true ? ' big' : ''}" data-key="${esc(p.slug)}"><a class="story-link" href="${postURL(p.slug)}">
      <figure class="story-cover m-zoom" data-morph data-c="${esc(p.slug)}"></figure>
      ${kicker(p)}<h3 class="story-title"><span class="u">${esc(p.title)}</span></h3><p class="story-sum">${esc(p.summary)}</p>
      <p class="story-meta">${p.minutes} min read <span class="m-arrow" aria-hidden="true">→</span></p></a></article>`;

  /* ---------- Front page ---------- */
  function feed() {
    const params = new URLSearchParams(location.search);
    const tags = [...new Set(NEWS.flatMap(p => p.tags))];
    const count = t => NEWS.filter(p => p.tags.includes(t)).length;
    let tag = tags.includes(params.get('tag')) ? params.get('tag') : 'All';
    const main = $('main');

    render($('#feed-tabs'), ['All', ...tags].map(t => `<button type="button" role="tab" data-tag="${esc(t)}">${esc(t === 'All' ? 'All stories' : t)}<sup>${t === 'All' ? NEWS.length : count(t)}</sup></button>`).join(''));
    if (NEWS[0]) $('#feed-latest').textContent = `Latest · ${NEWS[0].dateLabel}`;

    function draw() {
      const list = NEWS.filter(p => tag === 'All' || p.tags.includes(tag));
      const featured = tag === 'All' ? (NEWS.find(p => p.featured) || NEWS[0]) : null;
      const rest = list.filter(p => p !== featured);
      const fe = $('#featured');
      fe.hidden = !featured;
      render(fe, featured ? `<a class="lead" href="${postURL(featured.slug)}" data-key="${esc(featured.slug)}">
          <figure class="story-cover m-zoom" data-morph data-c="${esc(featured.slug)}"></figure>
          <div class="lead-body">${kicker(featured)}<h2 class="story-title"><span class="u">${esc(featured.title)}</span></h2>
            <p class="story-sum">${esc(featured.subtitle || featured.summary)}</p>
            <p class="story-meta">Read the story · ${featured.minutes} min <span class="m-arrow" aria-hidden="true">→</span></p></div></a>` : '');
      const big = rest.length % 3 === 1 ? 4 : rest.length % 3 === 2 ? 2 : 0; // wide cards first, so the last row is always full
      render($('#feed-list'), rest.map((p, i) => card(p, i < big)).join('') || (featured ? '' : '<p class="empty">No stories with this topic yet.</p>'));
      paintAll(main);
      $$('#feed-tabs [role=tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tag === tag)));
      $('#feed-count').textContent = `${list.length} ${list.length === 1 ? 'story' : 'stories'}`;
    }
    $('#feed-tabs').addEventListener('click', e => {
      const b = e.target.closest('[data-tag]'); if (!b || b.dataset.tag === tag) return;
      tag = b.dataset.tag;
      const u = new URL(location.href); if (tag === 'All') u.searchParams.delete('tag'); else u.searchParams.set('tag', tag);
      history.replaceState(null, '', u);
      const top = $('#feed-bar').offsetTop;
      if (scrollY > top) scrollTo({ top });
      M.swap(main, draw);
    });
    draw();
  }

  /* ---------- Article ---------- */
  function article() {
    const slug = body.dataset.slug;
    const post = NEWS.find(p => p.slug === slug) || { slug, title: document.title, tags: [], summary: '' };
    const prose = $('#prose');
    // The full article and its figure are already in the HTML, including without JS.
    const fig = $('[data-cover]');
    if (fig) render(fig, M.cover(slug, TAG_HUE[post.tags[0]]));

    // Share actions (top and bottom)
    const url = $('link[rel="canonical"]')?.href || location.href.split(/[?#]/)[0];
    const share = `<span class="share-k">Share</span>
      <button type="button" class="share" data-copy title="Copy link" aria-label="Copy link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/></svg></button>
      <a class="share" href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}" target="_blank" rel="noopener" title="Share on LinkedIn" aria-label="Share on LinkedIn"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9.75h4v11H3v-11Zm6.5 0h3.8v1.5h.06c.53-1 1.83-2.06 3.77-2.06 4.03 0 4.77 2.65 4.77 6.1v5.46h-4v-4.84c0-1.16-.02-2.64-1.61-2.64-1.61 0-1.86 1.26-1.86 2.56v4.92h-4v-11Z"/></svg></a>
      <a class="share" href="https://x.com/intent/post?url=${encodeURIComponent(url)}&text=${encodeURIComponent(post.title)}" target="_blank" rel="noopener" title="Share on X" aria-label="Share on X"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.78L17.75 3Zm-1.08 16.2h1.7L7.4 4.72H5.57L16.67 19.2Z"/></svg></a>
      <a class="share" href="mailto:?subject=${encodeURIComponent(post.title)}&body=${encodeURIComponent(url)}" title="Share by email" aria-label="Share by email"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg></a>
      <span class="copied" role="status" aria-live="polite"></span>`;
    $$('[data-share]').forEach(el => render(el, share));
    document.addEventListener('click', async e => {
      const b = e.target.closest('[data-copy]'); if (!b) return;
      const s = b.parentElement.querySelector('.copied');
      try { await navigator.clipboard.writeText(url); s.textContent = 'Link copied'; } catch { s.textContent = url; }
      setTimeout(() => { s.textContent = ''; }, 2200);
    });

    // Keep reading: same-topic posts first, then most recent.
    const others = NEWS.filter(p => p.slug !== slug);
    const more = [...others.filter(p => p.tags.some(t => post.tags.includes(t))), ...others].filter((p, i, a) => a.indexOf(p) === i).slice(0, 3);
    render($('#more-grid'), more.map(p => card(p)).join(''));
    paintAll($('#more-grid'));

    // Reading progress, and the contents rail following the section in view.
    const progress = $('#read-progress');
    addEventListener('scroll', () => {
      const end = prose.offsetTop + prose.offsetHeight - innerHeight;
      progress.style.transform = `scaleX(${Math.min(1, Math.max(0, scrollY / Math.max(1, end)))})`;
    }, { passive: true });
    const links = new Map($$('#toc a').map(a => [a.hash.slice(1), a]));
    if (links.size) {
      const spy = new IntersectionObserver(entries => entries.forEach(e => {
        if (e.isIntersecting) links.forEach((a, id) => a.classList.toggle('on', id === e.target.id));
      }), { rootMargin: '-96px 0px -70% 0px' });
      links.forEach((_, id) => { const h = document.getElementById(id); if (h) spy.observe(h); });
    }
  }

  if (body.dataset.page === 'feed') feed();
  if (body.dataset.page === 'post') article();
})();
