'use strict';
// Newsroom: feed page (news/) and Markdown article pages (news/<slug>/).
(() => {
  const NEWS = window.NEWS || [];
  const body = document.body;
  const ROOT = body.dataset.root || '';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  // Values are escaped with esc(); article Markdown is rendered and sanitized at build time.
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const render = (el, html) => el.replaceChildren(document.createRange().createContextualFragment(html));
  const postURL = slug => `${ROOT}news/${slug}/`;
  const store = { set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* unavailable */ } } };

  /* ---------- Theme ---------- */
  const rootEl = document.documentElement;
  $('#theme-btn')?.addEventListener('click', () => {
    const dark = rootEl.dataset.theme ? rootEl.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    rootEl.dataset.theme = dark ? 'light' : 'dark';
    store.set('theme', rootEl.dataset.theme);
  });

  /* ---------- Generative covers (statechart motif, seeded by slug) ---------- */
  const TAG_HUE = { 'Research agenda': ['#19375f', '#b84f12'], 'Agentic AI': ['#b84f12', '#19375f'], Publications: ['#19375f', '#00737d'],
    Manuscripts: ['#00737d', '#b84f12'], 'Software evidence': ['#00737d', '#19375f'], Teaching: ['#00737d', '#b84f12'],
    Students: ['#00737d', '#19375f'], Partnerships: ['#b84f12', '#00737d'], Service: ['#19375f', '#00737d'], Milestones: ['#b84f12', '#19375f'] };
  const hash = s => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
  function rng(seed) { return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function cover(slug, tag) {
    const [a, b] = TAG_HUE[tag] || ['#19375f', '#b84f12'];
    const r = rng(hash(slug)); const W = 800, H = 400;
    const n = 3 + Math.floor(r() * 3); const nodes = [];
    for (let i = 0; i < n; i++) nodes.push({ x: 150 + (i * (W - 300)) / (n - 1) + (r() - .5) * 50, y: 110 + r() * 180, w: 110 + r() * 70 });
    const dots = Array.from({ length: 140 }, (_, i) => `<circle cx="${(i % 20) * 42 + 10}" cy="${Math.floor(i / 20) * 60 + 20}" r="1.4"/>`).join('');
    const edges = nodes.slice(1).map((m, i) => { const p = nodes[i]; const up = r() > .5 ? -1 : 1;
      return `<path d="M${p.x + p.w / 2} ${p.y} C ${p.x + p.w} ${p.y + up * 90}, ${m.x - m.w / 2} ${m.y + up * 90}, ${m.x - m.w / 2} ${m.y}" />`; }).join('');
    const back = `<path d="M${nodes[n - 1].x} ${nodes[n - 1].y + 28} C ${nodes[n - 1].x} ${H - 10}, ${nodes[0].x} ${H - 10}, ${nodes[0].x} ${nodes[0].y + 28}" stroke="${b}" />`;
    const states = nodes.map((m, i) => `<rect x="${m.x - m.w / 2}" y="${m.y - 28}" width="${m.w}" height="56" rx="28" fill="${i % 2 ? b : a}" fill-opacity="${i === 0 ? .9 : .14}" stroke="${i % 2 ? b : a}" stroke-width="2"/>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="g${hash(slug)}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}" stop-opacity=".16"/><stop offset="1" stop-color="${b}" stop-opacity=".12"/></linearGradient></defs>
      <rect width="${W}" height="${H}" fill="#f3eee3"/><rect width="${W}" height="${H}" fill="url(#g${hash(slug)})"/>
      <g fill="${a}" fill-opacity=".18">${dots}</g>
      <g fill="none" stroke="${a}" stroke-width="2" stroke-dasharray="7 6" stroke-opacity=".7">${edges}${back}</g>
      <circle cx="${nodes[0].x - nodes[0].w / 2 - 34}" cy="${nodes[0].y}" r="8" fill="${a}"/>${states}</svg>`;
  }
  function paintCover(el, slug, tag, src) {
    if (src) render(el, `<img src="${esc(src)}" alt="" loading="lazy">`); else render(el, cover(slug, tag));
  }

  /* ---------- Feed ---------- */
  const byline = p => `<span class="fl-by"><img src="${ROOT}assets/img/portrait.webp" alt="" width="20" height="20">Majid Babaei</span>`;
  function feed() {
    const params = new URLSearchParams(location.search);
    const tags = [...new Set(NEWS.flatMap(p => p.tags))];
    const counts = Object.fromEntries(tags.map(t => [t, NEWS.filter(p => p.tags.includes(t)).length]));
    let tag = tags.includes(params.get('tag')) ? params.get('tag') : 'All';

    render($('#feed-tabs'), ['All', ...tags].map(t => `<button type="button" role="tab" data-tag="${esc(t)}">${esc(t === 'All' ? 'All stories' : t)}</button>`).join(''));
    render($('#topics'), tags.map(t => `<button type="button" data-tag="${esc(t)}">${esc(t)} <span>${counts[t]}</span></button>`).join(''));

    function draw() {
      const list = NEWS.filter(p => tag === 'All' || p.tags.includes(tag));
      const featured = tag === 'All' ? (NEWS.find(p => p.featured) || NEWS[0]) : null;
      const rest = list.filter(p => p !== featured);
      const fe = $('#featured');
      fe.hidden = !featured;
      if (featured) {
        render(fe, `<a class="feat" href="${postURL(featured.slug)}"><figure class="feat-cover" data-c></figure>
          <div class="feat-body"><span class="feat-k">Featured · ${esc(featured.tags[0])}</span><h2>${esc(featured.title)}</h2>
          <p>${esc(featured.subtitle || featured.summary)}</p><p class="fl-meta">${byline()}<span>${esc(featured.dateLabel)}</span><span>${featured.minutes} min read</span></p></div></a>`);
        paintCover($('[data-c]', fe), featured.slug, featured.tags[0], featured.cover && ROOT + featured.cover.replace(/^\//, ''));
      }
      render($('#feed-list'), rest.map(p => `<article class="fl"><a class="fl-link" href="${postURL(p.slug)}">
          <div class="fl-text">${byline()}<h3>${esc(p.title)}</h3><p class="fl-sum">${esc(p.summary)}</p>
            <p class="fl-meta"><span>${esc(p.dateLabel)}</span><span>${p.minutes} min read</span><span class="pill">${esc(p.tags[0])}</span></p></div>
          <figure class="fl-thumb" data-c="${esc(p.slug)}"></figure></a></article>`).join('') || '<p class="empty">No stories with this topic yet.</p>');
      $$('#feed-list [data-c]').forEach(el => { const p = NEWS.find(x => x.slug === el.dataset.c); paintCover(el, p.slug, p.tags[0], p.cover && ROOT + p.cover.replace(/^\//, '')); });
      $$('#feed-tabs [role=tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tag === tag)));
      $$('#topics button').forEach(b => b.classList.toggle('on', b.dataset.tag === tag));
      $('#feed-count').textContent = `${list.length} ${list.length === 1 ? 'story' : 'stories'}`;
    }
    const pick = t => { tag = t; const u = new URL(location.href); if (t === 'All') u.searchParams.delete('tag'); else u.searchParams.set('tag', t); history.replaceState(null, '', u); draw(); };
    $('#feed-tabs').addEventListener('click', e => { const b = e.target.closest('[data-tag]'); if (b) pick(b.dataset.tag); });
    $('#topics').addEventListener('click', e => { const b = e.target.closest('[data-tag]'); if (b) { pick(b.dataset.tag); scrollTo({ top: 0, behavior: 'smooth' }); } });
    draw();
  }

  /* ---------- Article ---------- */
  function article() {
    const slug = body.dataset.slug;
    const post = NEWS.find(p => p.slug === slug) || { title: document.title, tags: [], summary: '' };
    const prose = $('#prose');
    // The full article and its figure are already in the HTML, including without JS.
    const fig = $('[data-cover]');
    if (fig) paintCover(fig, slug, post.tags[0]);

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

    // More from the author: same-topic posts first, then most recent.
    const others = NEWS.filter(p => p.slug !== slug);
    const more = [...others.filter(p => p.tags.some(t => post.tags.includes(t))), ...others].filter((p, i, a) => a.indexOf(p) === i).slice(0, 4);
    render($('#more-grid'), more.map(p => `<a class="mc" href="${postURL(p.slug)}"><figure data-c="${esc(p.slug)}"></figure>
      <span class="mc-k">${esc(p.tags[0])}</span><h3>${esc(p.title)}</h3><p>${esc(p.summary)}</p><span class="mc-meta">${esc(p.dateLabel)} · ${p.minutes} min read</span></a>`).join(''));
    $$('#more-grid [data-c]').forEach(el => { const p = NEWS.find(x => x.slug === el.dataset.c); paintCover(el, p.slug, p.tags[0], p.cover && ROOT + p.cover.replace(/^\//, '')); });

    // Reading progress and a top bar that hides while reading down.
    const bar = $('#r-bar'), progress = $('#read-progress');
    let last = scrollY;
    addEventListener('scroll', () => {
      const end = prose.offsetTop + prose.offsetHeight - innerHeight;
      progress.style.transform = `scaleX(${Math.min(1, Math.max(0, scrollY / Math.max(1, end)))})`;
      bar.classList.toggle('hide', scrollY > last && scrollY > 120);
      last = scrollY;
    }, { passive: true });
  }

  if (body.dataset.page === 'feed') feed();
  if (body.dataset.page === 'post') article();
})();
