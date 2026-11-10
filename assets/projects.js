'use strict';
// Project pages (GitHub-style overview / releases / gallery) and the projects index with the memories wall.
(() => {
  const body = document.body;
  const ROOT = body.dataset.root || '';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  // All dynamic values pass through esc(); Markdown is sanitized with DOMPurify before insertion.
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const render = (el, html) => el.replaceChildren(document.createRange().createContextualFragment(html));
  const url = u => /^(https?:|mailto:)/.test(u) ? u : ROOT + encodeURI(u.replace(/^\//, ''));
  const md = text => {
    const holder = document.createElement('div');
    if (window.marked && window.DOMPurify) holder.append(DOMPurify.sanitize(marked.parse(text || '', { gfm: true }), { RETURN_DOM_FRAGMENT: true }));
    else holder.textContent = text || '';
    $$('a[href^="http"]', holder).forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
    return holder.innerHTML; // sanitized above
  };
  const store = { set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* unavailable */ } } };

  /* ---------- Theme ---------- */
  const rootEl = document.documentElement;
  $('#theme-btn')?.addEventListener('click', () => {
    const dark = rootEl.dataset.theme ? rootEl.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    rootEl.dataset.theme = dark ? 'light' : 'dark'; store.set('theme', rootEl.dataset.theme);
  });

  /* ---------- Icons ---------- */
  const I = {
    repo: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v16H6.5A2.5 2.5 0 0 0 4 20.5v-16Z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>',
    tag: '<path d="M3 3h8l10 10-8 8L3 11V3Z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    book: '<path d="M2 4h7a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H2V4Zm20 0h-7a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h8V4Z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
    paper: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
    code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
    poster: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/>',
    thesis: '<path d="m22 10-10-5L2 10l10 5 10-5Z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/>',
    talk: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/>',
    milestone: '<path d="M5 22V4M5 4h11l-2 4 2 4H5"/>',
    report: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"/><path d="M14 2v6h6M9 15l2 2 4-4"/>',
    dataset: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
    people: '<circle cx="9" cy="8" r="3.5"/><path d="M2 21a7 7 0 0 1 14 0M16 4.5a3.5 3.5 0 0 1 0 7M22 21a7 7 0 0 0-4-6.3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
  };
  const icon = (n, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n] || I.link}</svg>`;
  const TYPE_LABEL = { paper: 'Paper', poster: 'Poster', code: 'Code', thesis: 'Thesis', talk: 'Talk', milestone: 'Milestone', report: 'Report', dataset: 'Dataset', slides: 'Slides', video: 'Video' };
  const THEME_COLOR = { Agents: 'var(--orange)', Analysis: 'var(--teal)', Infrastructure: 'var(--navy)', 'Student projects': '#8a6d3b' };
  const THEME_LABEL = { Agents: 'Agentic systems', Analysis: 'Analysis & testing', Infrastructure: 'Infrastructure', 'Student projects': 'Student projects' };
  const RESEARCH_STAGES = ['Idea', 'Prototype', 'Submitted', 'Accepted', 'Published'];

  const stageBar = (stage, stages = RESEARCH_STAGES, compact = false) => {
    const at = stages.indexOf(stage);
    return `<ol class="stages${compact ? ' compact' : ''}" aria-label="Progress: ${esc(stage)}">${stages.map((s, i) =>
      `<li class="${i < at ? 'done' : i === at ? 'now' : ''}"><span class="st-dot"></span>${compact ? '' : `<span class="st-l">${esc(s)}</span>`}</li>`).join('')}</ol>`;
  };

  /* ---------- Lightbox (shared) ---------- */
  let lbItems = [], lbIndex = 0;
  function lightbox() {
    let d = $('#lightbox');
    if (d) return d;
    d = document.createElement('dialog'); d.id = 'lightbox'; d.className = 'lightbox';
    render(d, `<button class="lb-close" type="button" aria-label="Close">×</button>
      <button class="lb-nav lb-prev" type="button" aria-label="Previous photo">‹</button>
      <figure class="lb-fig"><img alt=""><figcaption><span class="lb-cap"></span><span class="lb-meta"></span></figcaption></figure>
      <button class="lb-nav lb-next" type="button" aria-label="Next photo">›</button>`);
    document.body.append(d);
    $('.lb-close', d).addEventListener('click', () => d.close());
    $('.lb-prev', d).addEventListener('click', () => showLb(lbIndex - 1));
    $('.lb-next', d).addEventListener('click', () => showLb(lbIndex + 1));
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
    d.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') showLb(lbIndex - 1); if (e.key === 'ArrowRight') showLb(lbIndex + 1); });
    return d;
  }
  function showLb(i) {
    const d = lightbox(); lbIndex = (i + lbItems.length) % lbItems.length; const g = lbItems[lbIndex];
    const img = $('img', d); img.src = url(g.src); img.alt = g.alt || g.caption || '';
    $('.lb-cap', d).textContent = g.caption || '';
    $('.lb-meta', d).textContent = [g.projectName, g.label, `${lbIndex + 1} / ${lbItems.length}`].filter(Boolean).join(' · ');
    $$('.lb-nav', d).forEach(b => { b.hidden = lbItems.length < 2; });
    if (!d.open) d.showModal();
  }
  const masonry = (items, withProject) => items.length ? `<div class="masonry">${items.map((g, i) => `
      <figure class="pin">
        <button type="button" class="pin-open" data-lb="${i}" aria-label="Open photo: ${esc(g.caption || 'memory')}">
          <img src="${esc(url(g.src))}" alt="${esc(g.alt || g.caption || '')}" loading="lazy" ${g.w && g.h ? `width="${g.w}" height="${g.h}"` : ''}>
          <span class="pin-veil"><span>View</span></span>
        </button>
        <figcaption>${g.caption ? `<p>${esc(g.caption)}</p>` : ''}<span class="pin-meta">${withProject ? `<a href="${ROOT}projects/${esc(g.project)}/#gallery">${esc(g.projectName)}</a>` : ''}${g.label ? `<span>${esc(g.label)}</span>` : ''}</span></figcaption>
      </figure>`).join('')}</div>` : '';
  const bindMasonry = (container, items) => {
    container.addEventListener('click', e => { const b = e.target.closest('[data-lb]'); if (b) { lbItems = items; showLb(Number(b.dataset.lb)); } });
  };

  /* ---------- Project page ---------- */
  function projectPage() {
    const P = JSON.parse($('#project-data').textContent);
    const stages = P.stages || (P.research ? RESEARCH_STAGES : ['Proposal', 'Development', 'Poster', 'Completed']);
    const tabs = [['overview', 'Overview', 'book', ''], ['releases', 'Releases', 'tag', P.releases.length], ['gallery', 'Gallery', 'image', P.gallery.length]];
    render($('#pj-tabs'), tabs.map(([id, label, ic, n]) => `<a role="tab" href="#${id}" data-tab="${id}">${icon(ic)}${label}${n !== '' ? `<span class="cnt">${n}</span>` : ''}</a>`).join(''));

    const repoLink = P.url ? `<a class="pj-btn" href="${esc(P.url)}" target="_blank" rel="noopener">${icon('code')}Code ↗</a>` : '';
    const topics = [...new Set([THEME_LABEL[P.theme] || P.theme, ...String(P.tags || '').split('·').map(s => s.trim()).filter(Boolean)])];
    render($('#pj-side'), `
      <section><h2>About</h2><p class="pj-desc">${esc(P.description)}</p>
        ${P.url ? `<a class="side-row" href="${esc(P.url)}" target="_blank" rel="noopener">${icon('code')}${esc(P.url.replace('https://github.com/', ''))}</a>` : ''}
        ${P.links.map(l => `<a class="side-row" href="${esc(url(l.url))}" target="_blank" rel="noopener">${icon(l.type || 'link')}${esc(l.label)}</a>`).join('')}
        <div class="topics-gh">${topics.map(t => `<span>${esc(t)}</span>`).join('')}</div>
        <p class="side-row">${icon('tag')}<b>${P.releases.length}</b> releases</p>
        ${P.publications.length ? `<p class="side-row">${icon('paper')}<b>${P.publications.length}</b> publication${P.publications.length > 1 ? 's' : ''}</p>` : ''}
        <p class="side-row">${icon('image')}<b>${P.gallery.length}</b> memories</p>
        ${P.updated ? `<p class="side-row">${icon('clock')}Updated ${esc(P.updated)}</p>` : ''}
      </section>
      ${P.releases[0] ? `<section><h2>Releases <span class="cnt">${P.releases.length}</span></h2>
        <a class="side-rel" href="#releases" data-tab-link="releases">${icon('tag')}<span><b>${esc(P.releases[0].title)}</b><span class="lt">Latest</span><small>${esc(P.releases[0].label)}</small></span></a></section>` : ''}
      ${P.team.length ? `<section><h2>Contributors <span class="cnt">${P.team.length}</span></h2><ul class="people-gh">${P.team.map(n =>
        `<li><span class="av" aria-hidden="true">${esc(n.replace(/[^A-Za-zÀ-ž]/g, '').slice(0, 2).toUpperCase())}</span>${esc(n)}</li>`).join('')}</ul></section>` : ''}`);

    const pubCard = p => `<li class="gh-pub"><div class="gh-pub-top"><span class="venue">${esc(p.venue)}</span><span class="badge ${p.kind === 'submitted' ? 'status' : ''}">${esc(p.kind === 'submitted' ? p.status : p.year)}</span></div>
      <h3>${esc(p.title.replace(/\.$/, ''))}</h3><p class="authors">${esc(p.authors.replace(/\s*[\u{1F3C6}\u{1F4E6}✅♻️]+/gu, ''))}</p>
      <div class="gh-pub-act">${p.paper ? `<a href="${esc(p.paper)}" target="_blank" rel="noopener">Paper ↗</a>` : ''}${p.preprint ? `<a href="${esc(p.preprint)}" target="_blank" rel="noopener">Preprint ↗</a>` : ''}
        ${p.abstract ? `<details><summary>Abstract</summary><p>${esc(p.abstract.text)}</p></details>` : ''}<details><summary>Cite</summary><pre>${esc(p.bibtex)}</pre></details></div></li>`;

    const views = {
      overview: () => `
        <header class="pj-head"><p class="pj-kicker" style="--c:${THEME_COLOR[P.theme] || 'var(--navy)'}">${esc(THEME_LABEL[P.theme] || P.theme)}</p>
          <h1>${esc(P.name)}</h1><p class="pj-lede">${esc(P.description)}</p>
          <div class="pj-actions">${repoLink}<a class="pj-btn ghost" href="#releases" data-tab-link="releases">${icon('tag')}Release history</a>${P.gallery.length ? `<a class="pj-btn ghost" href="#gallery" data-tab-link="gallery">${icon('image')}Gallery</a>` : ''}</div></header>
        <section class="gh-box"><div class="gh-box-h">${icon('milestone')}Progress<span class="pj-status">${esc(P.status)}</span></div><div class="gh-box-b">${stageBar(P.stage, stages)}</div></section>
        ${P.readme ? `<section class="gh-box"><div class="gh-box-h">${icon('book')}README.md</div><div class="gh-box-b prose md-body">${md(P.readme)}</div></section>` : ''}
        ${P.publications.length ? `<section class="gh-box"><div class="gh-box-h">${icon('paper')}Publications &amp; manuscripts<span class="cnt">${P.publications.length}</span></div><ul class="gh-pubs">${P.publications.map(pubCard).join('')}</ul></section>` : ''}
        ${P.gallery.length ? `<section class="gh-box"><div class="gh-box-h">${icon('image')}Recent memories<a class="gh-more" href="#gallery" data-tab-link="gallery">View all ${P.gallery.length} →</a></div><div class="gh-box-b">${masonry(P.gallery.slice(0, 3))}</div></section>` : ''}`,
      releases: () => {
        const types = [...new Set(P.releases.map(r => r.type))];
        return `<div class="rel-head"><h2>Releases</h2><p>Every paper, poster, code drop, and milestone, newest first.</p>
          <div class="rel-filter" role="group" aria-label="Filter releases">${['all', ...types].map(t => `<button type="button" data-rtype="${t}" aria-pressed="${t === 'all'}">${t === 'all' ? 'All' : esc(TYPE_LABEL[t] || t)}<span>${t === 'all' ? P.releases.length : P.releases.filter(r => r.type === t).length}</span></button>`).join('')}</div></div>
          <ol class="releases">${P.releases.map((r, i) => `<li class="rel" data-type="${esc(r.type)}">
            <div class="rel-side"><time datetime="${esc(r.iso)}">${esc(r.label)}</time><span class="rel-tag">${icon('tag')}${esc(r.tag)}</span><span class="rel-type t-${esc(r.type)}">${icon(r.type)}${esc(TYPE_LABEL[r.type] || r.type)}</span></div>
            <article class="rel-card"><h3>${esc(r.title)}${i === 0 ? '<span class="lt">Latest</span>' : ''}</h3>
              ${r.notes ? `<div class="rel-notes prose md-body">${md(r.notes)}</div>` : ''}
              ${r.links?.length ? `<details class="assets" open><summary>Assets <span class="cnt">${r.links.length}</span></summary><ul>${r.links.map(l => `<li><a href="${esc(url(l.url))}" target="_blank" rel="noopener">${icon(l.type || r.type)}${esc(l.label)}</a></li>`).join('')}</ul></details>` : ''}
            </article></li>`).join('')}</ol>`;
      },
      gallery: () => `<div class="rel-head"><h2>Gallery</h2><p>Memories from the people and moments behind ${esc(P.name)}.</p></div>
        ${P.gallery.length ? masonry(P.gallery) : `<div class="empty-box">${icon('image')}<h3>No memories yet</h3><p>Photos from presentations, team meetings, and milestones will appear here.</p></div>`}`
    };
    const content = $('#pj-content');
    function show(tab) {
      if (!views[tab]) tab = 'overview';
      render(content, views[tab]());
      $$('#pj-tabs [data-tab]').forEach(a => a.setAttribute('aria-selected', String(a.dataset.tab === tab)));
      $$('.masonry', content).forEach(m => bindMasonry(m, tab === 'overview' ? P.gallery.slice(0, 3) : P.gallery));
      $$('.rel-filter button', content).forEach(b => b.addEventListener('click', () => {
        $$('.rel-filter button', content).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        $$('.rel', content).forEach(li => { li.hidden = b.dataset.rtype !== 'all' && li.dataset.type !== b.dataset.rtype; });
      }));
    }
    const fromHash = () => show(location.hash.slice(1) || 'overview');
    addEventListener('hashchange', () => { fromHash(); scrollTo({ top: 0 }); });
    document.addEventListener('click', e => { const a = e.target.closest('[data-tab-link]'); if (a) { e.preventDefault(); location.hash = a.dataset.tabLink; } });
    fromHash();
  }

  /* ---------- Projects index + memories wall ---------- */
  function projectsIndex() {
    const PJ = window.PROJECTS || [], MEM = window.MEMORIES || [];
    const order = ['Agents', 'Analysis', 'Infrastructure', 'Student projects'];
    const themes = order.filter(t => PJ.some(p => p.theme === t));
    render($('#pj-theme'), `<option value="all">All types</option>${themes.map(t => `<option value="${esc(t)}">${esc(THEME_LABEL[t] || t)}</option>`).join('')}`);
    $('#pj-count').textContent = PJ.length; $('#mem-count').textContent = MEM.length;
    const rank = { Published: 5, Completed: 5, Accepted: 4, Submitted: 3, Prototype: 2, Idea: 1 };
    function list() {
      const q = $('#pj-q').value.trim().toLowerCase(), th = $('#pj-theme').value, sort = $('#pj-sort').value;
      let items = PJ.filter(p => (th === 'all' || p.theme === th) && (!q || `${p.name} ${p.description} ${p.tags} ${p.status}`.toLowerCase().includes(q)));
      items = items.sort(sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : sort === 'stage' ? (a, b) => (rank[b.stage] || 0) - (rank[a.stage] || 0)
        : (a, b) => (b.latest?.iso || '').localeCompare(a.latest?.iso || ''));
      render($('#pj-list'), items.map(p => `<li class="repo-row">
        <div class="rr-main"><h3><a href="${p.slug}/">${esc(p.name)}</a><span class="pj-stage-pill">${esc(p.stage)}</span></h3>
          <p>${esc(p.description)}</p>
          <p class="rr-meta"><span><i style="background:${THEME_COLOR[p.theme] || 'var(--navy)'}"></i>${esc(THEME_LABEL[p.theme] || p.theme)}</span>
            ${p.latest ? `<a href="${p.slug}/#releases">${icon('tag')}${esc(p.latest.tag)}</a>` : ''}<span>${icon('tag')}${p.releaseCount} releases</span>
            ${p.galleryCount ? `<a href="${p.slug}/#gallery">${icon('image')}${p.galleryCount}</a>` : ''}${p.latest ? `<span>Updated ${esc(p.latest.label)}</span>` : ''}</p></div>
        <div class="rr-side">${p.cover ? `<img src="${esc(url(p.cover))}" alt="" loading="lazy">` : ''}${stageBar(p.stage, p.stages || (p.research ? RESEARCH_STAGES : ['Proposal', 'Development', 'Poster', 'Completed']), true)}<span class="rr-status">${esc(p.status)}</span></div></li>`).join('') || '<li class="empty-box"><h3>No projects match.</h3></li>');
    }
    ['#pj-q', '#pj-theme', '#pj-sort'].forEach(s => $(s).addEventListener('input', list));
    list();
    render($('#mem-wall'), masonry(MEM, true) || '<div class="empty-box"><h3>No memories yet</h3></div>');
    bindMasonry($('#mem-wall'), MEM);
    const tab = t => { $$('.pj-tabs [data-view]').forEach(a => a.setAttribute('aria-selected', String(a.dataset.view === t)));
      $('#view-projects').hidden = t !== 'projects'; $('#view-memories').hidden = t !== 'memories'; };
    const fromHash = () => tab(location.hash === '#memories' ? 'memories' : 'projects');
    addEventListener('hashchange', fromHash); fromHash();
  }

  if (body.dataset.page === 'project') projectPage();
  if (body.dataset.page === 'projects') projectsIndex();
})();
