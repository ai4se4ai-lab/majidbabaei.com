'use strict';
// Project pages (overview / releases / gallery) and the projects index with the memories wall.
// Theme, menu and page transitions live in motion.js. Markdown is rendered and sanitized at build time.
(() => {
  const body = document.body;
  const ROOT = body.dataset.root || '';
  const M = window.Motion || { swap: (_, fn) => fn(), cover: () => '' };
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  // All dynamic values pass through esc(); *Html fields are sanitized by tools/build-projects.mjs.
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const render = (el, html) => el.replaceChildren(document.createRange().createContextualFragment(html));
  const url = u => /^(https?:|mailto:)/.test(u) ? u : ROOT + encodeURI(u.replace(/^\//, ''));

  /* ---------- Icons ---------- */
  const I = {
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
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
  };
  const icon = (n, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n] || I.link}</svg>`;
  const TYPE_LABEL = { paper: 'Paper', poster: 'Poster', code: 'Code', thesis: 'Thesis', talk: 'Talk', milestone: 'Milestone', report: 'Report', dataset: 'Dataset', slides: 'Slides', video: 'Video' };
  const N = 'var(--navy)', T = 'var(--teal)', O = 'var(--orange)';
  const THEME_COLOR = { Agents: O, Analysis: T, Infrastructure: N, 'Student projects': T };
  const THEME_HUE = { Agents: [O, N], Analysis: [T, N], Infrastructure: [N, T], 'Student projects': [T, O] };
  const THEME_LABEL = { Agents: 'Agentic systems', Analysis: 'Analysis & testing', Infrastructure: 'Infrastructure', 'Student projects': 'Student projects' };
  const RESEARCH_STAGES = ['Idea', 'Prototype', 'Submitted', 'Accepted', 'Published'];
  const STUDENT_STAGES = ['Proposal', 'Development', 'Poster', 'Completed'];
  const stagesOf = p => p.stages || (p.research ? RESEARCH_STAGES : STUDENT_STAGES);
  // Projects without a photograph get a generated statechart in their theme's colours.
  const emblem = (el, slug, theme) => { if (!el.firstElementChild) render(el, M.cover(slug, THEME_HUE[theme])); };

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
        </button>
        <figcaption>${g.caption ? `<p>${esc(g.caption)}</p>` : ''}<span class="pin-meta">${withProject ? `<a href="${ROOT}projects/${esc(g.project)}/#gallery">${esc(g.projectName)}</a>` : ''}${g.label ? `<span>${esc(g.label)}</span>` : ''}</span></figcaption>
      </figure>`).join('')}</div>` : '';
  const bindMasonry = (container, items) => {
    container.addEventListener('click', e => { const b = e.target.closest('[data-lb]'); if (b) { lbItems = items; showLb(Number(b.dataset.lb)); } });
  };

  /* ---------- Project page ---------- */
  function projectPage() {
    const P = JSON.parse($('#project-data').textContent);
    const fig = $('[data-emblem]'); if (fig) emblem(fig, P.slug, P.theme);
    const topics = [...new Set([THEME_LABEL[P.theme] || P.theme, ...String(P.tags || '').split('·').map(s => s.trim()).filter(Boolean)])];
    render($('#pj-side'), `
      <section><h2>About</h2>
        <div class="topics-gh">${topics.map(t => `<span>${esc(t)}</span>`).join('')}</div>
        ${P.url ? `<a class="side-row" href="${esc(P.url)}" target="_blank" rel="noopener">${icon('code')}${esc(P.url.replace('https://github.com/', ''))}</a>` : ''}
        ${P.links.map(l => `<a class="side-row" href="${esc(url(l.url))}" target="_blank" rel="noopener">${icon(l.type || 'link')}${esc(l.label)}</a>`).join('')}
        <p class="side-row">${icon('tag')}<b>${P.releases.length}</b> releases</p>
        ${P.publications.length ? `<p class="side-row">${icon('paper')}<b>${P.publications.length}</b> publication${P.publications.length > 1 ? 's' : ''}</p>` : ''}
        <p class="side-row">${icon('image')}<b>${P.gallery.length}</b> memories</p>
        ${P.updated ? `<p class="side-row">${icon('clock')}Updated ${esc(P.updated)}</p>` : ''}
      </section>
      ${P.releases[0] ? `<section><h2>Latest release</h2>
        <a class="side-rel" href="#releases">${icon(P.releases[0].type)}<span><b>${esc(P.releases[0].title)}</b><small>${esc(P.releases[0].label)}</small></span></a></section>` : ''}
      ${P.team.length ? `<section><h2>Contributors <span class="cnt">${P.team.length}</span></h2><ul class="people-gh">${P.team.map(n =>
        `<li><span class="av" aria-hidden="true">${esc(n.replace(/[^A-Za-zÀ-ž]/g, '').slice(0, 2).toUpperCase())}</span>${esc(n)}</li>`).join('')}</ul></section>` : ''}`);

    const pubCard = p => `<li class="gh-pub"><div class="gh-pub-top"><span class="venue">${esc(p.venue)}</span><span class="badge ${p.kind === 'submitted' ? 'status' : ''}">${esc(p.kind === 'submitted' ? p.status : p.year)}</span></div>
      <h3>${esc(p.title.replace(/\.$/, ''))}</h3><p class="authors">${esc(p.authors.replace(/\s*[\u{1F3C6}\u{1F4E6}✅♻️]+/gu, ''))}</p>
      <div class="gh-pub-act">${p.paper ? `<a href="${esc(p.paper)}" target="_blank" rel="noopener">Paper ↗</a>` : ''}${p.preprint ? `<a href="${esc(p.preprint)}" target="_blank" rel="noopener">Preprint ↗</a>` : ''}
        ${p.abstract ? `<details><summary>Abstract</summary><p>${esc(p.abstract.text)}</p></details>` : ''}<details><summary>Cite</summary><pre>${esc(p.bibtex)}</pre></details></div></li>`;
    const release = (r, i) => `<li class="rel" data-type="${esc(r.type)}">
        <div class="rel-side"><time datetime="${esc(r.iso)}">${esc(r.label)}</time><span class="rel-type t-${esc(r.type)}">${icon(r.type)}${esc(TYPE_LABEL[r.type] || r.type)}</span><span class="rel-tag">${esc(r.tag)}</span></div>
        <article class="rel-card"><h3>${esc(r.title)}${i === 0 ? '<span class="lt">Latest</span>' : ''}</h3>
          ${r.notesHtml ? `<div class="rel-notes prose md-body">${r.notesHtml}</div>` : ''}
          ${r.links?.length ? `<ul class="assets">${r.links.map(l => `<li><a href="${esc(url(l.url))}" target="_blank" rel="noopener">${icon(l.type || r.type)}<span>${esc(l.label)}</span><span class="m-arrow" aria-hidden="true">↗</span></a></li>`).join('')}</ul>` : ''}
        </article></li>`;

    const views = {
      overview: () => `
        ${P.readmeHtml ? `<section class="pj-sec"><h2 class="pj-h">${icon('book')}Overview</h2><div class="prose md-body">${P.readmeHtml}</div></section>` : ''}
        ${P.publications.length ? `<section class="pj-sec"><h2 class="pj-h">${icon('paper')}Publications &amp; manuscripts<span class="cnt">${P.publications.length}</span></h2><ul class="gh-pubs">${P.publications.map(pubCard).join('')}</ul></section>` : ''}
        ${P.releases.length ? `<section class="pj-sec"><h2 class="pj-h">${icon('tag')}Latest release<a class="gh-more" href="#releases">All ${P.releases.length} releases <span class="m-arrow" aria-hidden="true">→</span></a></h2><ol class="releases">${release(P.releases[0], 0)}</ol></section>` : ''}
        ${P.gallery.length ? `<section class="pj-sec"><h2 class="pj-h">${icon('image')}Recent memories<a class="gh-more" href="#gallery">View all ${P.gallery.length} <span class="m-arrow" aria-hidden="true">→</span></a></h2>${masonry(P.gallery.slice(0, 3))}</section>` : ''}`,
      releases: () => {
        const types = [...new Set(P.releases.map(r => r.type))];
        return `<div class="rel-head"><h2>Releases</h2><p>Every paper, poster, code drop, and milestone, newest first.</p>
          ${types.length > 1 ? `<div class="rel-filter" role="group" aria-label="Filter releases">${['all', ...types].map(t => `<button type="button" data-rtype="${t}" aria-pressed="${t === 'all'}">${t === 'all' ? 'All' : esc(TYPE_LABEL[t] || t)}<span>${t === 'all' ? P.releases.length : P.releases.filter(r => r.type === t).length}</span></button>`).join('')}</div>` : ''}</div>
          ${P.releases.length ? `<ol class="releases">${P.releases.map(release).join('')}</ol>` : `<div class="empty-box">${icon('tag')}<h3>No releases yet</h3><p>Papers, posters, and code drops will be recorded here.</p></div>`}`;
      },
      gallery: () => `<div class="rel-head"><h2>Gallery</h2><p>Memories from the people and moments behind ${esc(P.name)}.</p></div>
        ${P.gallery.length ? masonry(P.gallery) : `<div class="empty-box">${icon('image')}<h3>No memories yet</h3><p>Photos from presentations, team meetings, and milestones will appear here.</p></div>`}`
    };
    const content = $('#pj-content'), main = $('#pj-main');
    let current = null;
    function show(tab) {
      if (!views[tab]) tab = 'overview';
      const draw = () => {
        render(content, views[tab]());
        $$('#pj-tabs [data-tab]').forEach(a => { if (a.dataset.tab === tab) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
        $$('.masonry', content).forEach(m => bindMasonry(m, tab === 'overview' ? P.gallery.slice(0, 3) : P.gallery));
        $$('.rel-filter button', content).forEach(b => b.addEventListener('click', () => {
          $$('.rel-filter button', content).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
          $$('.rel', content).forEach(li => { li.hidden = b.dataset.rtype !== 'all' && li.dataset.type !== b.dataset.rtype; });
        }));
      };
      if (current === null) draw(); else if (current !== tab) M.swap(main, draw);
      current = tab;
    }
    const fromHash = () => show(location.hash.slice(1) || 'overview');
    addEventListener('hashchange', () => {
      const top = $('.pj-bar').offsetTop;
      if (scrollY > top) scrollTo({ top });
      fromHash();
    });
    fromHash();
  }

  /* ---------- Projects index + memories wall ---------- */
  function projectsIndex() {
    const PJ = window.PROJECTS || [], MEM = window.MEMORIES || [];
    const order = ['Agents', 'Analysis', 'Infrastructure', 'Student projects'];
    const themes = order.filter(t => PJ.some(p => p.theme === t));
    let theme = 'all';
    render($('#pj-theme'), ['all', ...themes].map(t => `<button type="button" role="tab" data-theme="${esc(t)}" aria-selected="${t === 'all'}">${esc(t === 'all' ? 'All' : THEME_LABEL[t] || t)}<sup>${t === 'all' ? PJ.length : PJ.filter(p => p.theme === t).length}</sup></button>`).join(''));
    $('#pj-count').textContent = PJ.length; $('#mem-count').textContent = MEM.length;
    $('#rel-count').textContent = PJ.reduce((n, p) => n + p.releaseCount, 0);
    $('#pub-count').textContent = PJ.filter(p => p.stage === 'Published' || p.stage === 'Accepted').length;
    const newest = PJ.filter(p => p.latest).sort((a, b) => b.latest.iso.localeCompare(a.latest.iso))[0];
    if (newest) $('#px-latest').textContent = `Latest release · ${newest.latest.label}`;
    const rank = { Published: 5, Completed: 5, Accepted: 4, Submitted: 3, Prototype: 2, Idea: 1 };
    const miniTrack = p => { const st = stagesOf(p), at = Math.max(0, st.indexOf(p.stage));
      return `<div class="pcard-stage"><ol class="track compact" style="--n:${st.length};--at:${at}" aria-label="Progress: ${esc(p.stage)}">${st.map((_, i) => `<li class="${i < at ? 'done' : i === at ? 'now' : ''}"><span class="st-dot"></span></li>`).join('')}</ol><span>${esc(p.stage)}</span></div>`; };
    const list = $('#pj-list'), main = $('#pj-main');
    function draw() {
      const q = $('#pj-q').value.trim().toLowerCase(), sort = $('#pj-sort').value;
      let items = PJ.filter(p => (theme === 'all' || p.theme === theme) && (!q || `${p.name} ${p.description} ${p.tags} ${p.status}`.toLowerCase().includes(q)));
      items = items.sort(sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : sort === 'stage' ? (a, b) => (rank[b.stage] || 0) - (rank[a.stage] || 0)
        : (a, b) => (b.latest?.iso || '').localeCompare(a.latest?.iso || ''));
      render(list, items.map(p => `<li class="pcard" data-key="${esc(p.slug)}" style="--c:${THEME_COLOR[p.theme] || N}"><a class="pcard-link" href="${esc(p.slug)}/">
          <figure class="pcard-emblem m-zoom" data-morph data-emblem="${esc(p.slug)}" data-theme="${esc(p.theme)}">${p.cover ? `<img src="${esc(url(p.cover))}" alt="" loading="lazy">` : ''}</figure>
          <div class="pcard-body">
            <p class="story-k"><span class="tg">${esc(THEME_LABEL[p.theme] || p.theme)}</span>${p.latest ? `<time datetime="${esc(p.latest.iso)}">${esc(p.latest.label)}</time>` : ''}</p>
            <h3 class="story-title"><span class="u">${esc(p.name)}</span></h3>
            <p class="story-sum">${esc(p.description)}</p>
            ${miniTrack(p)}
            <p class="pcard-foot"><span>${icon('tag')}${p.releaseCount} release${p.releaseCount === 1 ? '' : 's'}</span>${p.galleryCount ? `<span>${icon('image')}${p.galleryCount}</span>` : ''}<span class="pcard-status">${esc(p.status)}</span></p>
          </div></a></li>`).join('') || '<li class="empty-box"><h3>No projects match.</h3><p>Try another type or a shorter search.</p></li>');
      $$('[data-emblem]', list).forEach(el => emblem(el, el.dataset.emblem, el.dataset.theme));
      $$('#pj-theme button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.theme === theme)));
    }
    $('#pj-theme').addEventListener('click', e => { const b = e.target.closest('[data-theme]'); if (!b || b.dataset.theme === theme) return; theme = b.dataset.theme; M.swap(main, draw); });
    $('#pj-sort').addEventListener('input', () => M.swap(main, draw));
    $('#pj-q').addEventListener('input', draw);
    draw();
    render($('#mem-wall'), masonry(MEM, true) || '<div class="empty-box"><h3>No memories yet</h3></div>');
    bindMasonry($('#mem-wall'), MEM);
    let view = null;
    const tab = t => {
      const apply = () => {
        $$('.px-views [data-view]').forEach(a => { if (a.dataset.view === t) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
        $('#view-projects').hidden = t !== 'projects'; $('#view-memories').hidden = t !== 'memories'; $('#px-tools').hidden = t !== 'projects';
      };
      if (view === null || view === t) apply(); else M.swap(main, apply);
      view = t;
    };
    const fromHash = () => tab(location.hash === '#memories' ? 'memories' : 'projects');
    addEventListener('hashchange', fromHash); fromHash();
  }

  if (body.dataset.page === 'project') projectPage();
  if (body.dataset.page === 'projects') projectsIndex();
})();
