'use strict';
(() => {
  const R = window.RESEARCH || { projects: [], published: [], submitted: [] };
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  // Every dynamic value is passed through esc() before it reaches render(); the data is generated from the CV.
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const render = (el, html) => el.replaceChildren(document.createRange().createContextualFragment(html));
  const store = { set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } } };

  /* ---------- Counts & footer ---------- */
  const counts = { published: R.published.length, submitted: R.submitted.length, projects: R.projects.length };
  $$('[data-count]').forEach(el => { if (counts[el.dataset.count]) el.textContent = counts[el.dataset.count]; });
  $('#year').textContent = new Date().getFullYear();
  if (R.cvSha256) $('#sync-note').textContent = `CV-synced · ${R.cvSha256.slice(0, 10).toLowerCase()}`;

  /* ---------- Theme ---------- */
  const root = document.documentElement;
  $('#theme-btn').addEventListener('click', () => {
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    store.set('theme', root.dataset.theme);
  });

  /* ---------- Header, menu, scroll-spy ---------- */
  const header = $('.site-header'), nav = $('#nav'), menuBtn = $('#menu-btn');
  const setMenu = open => { nav.classList.toggle('open', open); menuBtn.setAttribute('aria-expanded', String(open)); };
  menuBtn.addEventListener('click', () => setMenu(!nav.classList.contains('open')));
  nav.addEventListener('click', e => { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });
  addEventListener('scroll', () => header.classList.toggle('scrolled', scrollY > 8), { passive: true });
  const links = new Map($$('a', nav).map(a => [a.hash.slice(1), a]));
  const spy = new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting) links.forEach((a, id) => a.classList.toggle('current', id === e.target.id));
  }), { rootMargin: '-45% 0px -50% 0px' });
  links.forEach((_, id) => { const s = document.getElementById(id); if (s) spy.observe(s); });

  /* ---------- Reveal on scroll ---------- */
  const reveal = new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); reveal.unobserve(e.target); }
  }), { rootMargin: '0px 0px -8% 0px' });
  $$('.reveal').forEach(el => reveal.observe(el));

  /* ---------- Newsroom panel (hero) ---------- */
  const NEWS = window.NEWS || [];
  const TAG_COLOR = { 'Research agenda': 'var(--orange)', 'Agentic AI': 'var(--orange)', Manuscripts: 'var(--teal)', Publications: 'var(--navy)',
    'Software evidence': 'var(--teal)', Teaching: 'var(--teal)', Students: 'var(--teal)', Partnerships: 'var(--orange)', Service: 'var(--navy)', Milestones: 'var(--orange)' };
  const heroGrid = $('#hero-grid');
  const isNew = p => (Date.now() - new Date(`${p.iso}T12:00:00`).getTime()) / 864e5 < 45;
  render($('#nr-list'), NEWS.slice(0, 6).map(p => `<li><a href="news/${esc(p.slug)}/" style="--c:${TAG_COLOR[p.tags[0]] || 'var(--orange)'}">
      <span class="nr-meta">${isNew(p) ? '<span class="nr-new">NEW</span>' : ''}<time datetime="${esc(p.iso)}">${esc(p.dateLabel)}</time><span aria-hidden="true">·</span><span class="tg">${esc(p.tags[0])}</span></span>
      <span class="nr-title">${esc(p.title)}</span><span class="nr-sum">${esc(p.summary)}</span></a></li>`).join('') || '<li><a href="news/">Browse all news &amp; notes</a></li>');
  $('#nr-count').textContent = NEWS.length;
  $('#nr-total').textContent = `${NEWS.length} stories`;
  if (NEWS[0]) $('#nr-latest').textContent = `Latest: ${NEWS[0].title}`;
  const setNews = (open, remember) => {
    heroGrid.classList.toggle('nr-closed', !open);
    $('#nr-open').setAttribute('aria-expanded', String(open));
    $('#nr-close').setAttribute('aria-expanded', String(open));
    if (remember) store.set('newsroom', open ? 'open' : 'closed');
  };
  let saved = null; try { saved = localStorage.getItem('newsroom'); } catch { /* storage unavailable */ }
  setNews(saved ? saved === 'open' : !matchMedia('(max-width: 1020px)').matches, false);
  $('#nr-open').addEventListener('click', () => { setNews(true, true); $('#nr-close').focus(); });
  $('#nr-close').addEventListener('click', () => { setNews(false, true); $('#nr-open').focus(); });

  /* ---------- Research loop <-> transition cards ---------- */
  const loop = $('#loop');
  const highlight = t => { loop.classList.toggle('hl-down', t === 'down'); loop.classList.toggle('hl-up', t === 'up');
    $$('.tr').forEach(c => c.classList.toggle('on', c.dataset.t === t)); };
  $$('.loop .tr-g').forEach(g => {
    g.addEventListener('mouseenter', () => highlight(g.dataset.t));
    g.addEventListener('mouseleave', () => highlight(null));
    g.addEventListener('click', () => $(`.tr[data-t="${g.dataset.t}"]`).scrollIntoView({ behavior: 'smooth', block: 'center' }));
  });
  $$('.tr').forEach(c => { c.addEventListener('mouseenter', () => highlight(c.dataset.t)); c.addEventListener('mouseleave', () => highlight(null)); });
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) $$('.loop svg').forEach(s => s.pauseAnimations?.());

  /* ---------- Artifacts ---------- */
  const themeLabel = { Agents: 'Agentic systems', Analysis: 'Analysis & testing', Infrastructure: 'Infrastructure' };
  const ongoingLast = (a, b) => Number(a.status === 'On-going') - Number(b.status === 'On-going');
  function renderArtifacts(theme) {
    const items = R.projects.filter(p => theme === 'All' || p.theme === theme).sort(ongoingLast);
    const slugOf = name => name.split(' / ')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    render($('#art-grid'), items.map(p => `<a class="art" data-theme="${esc(p.theme)}" href="projects/${esc(slugOf(p.name))}/">
      <span class="art-top"><span>${esc(themeLabel[p.theme] || p.theme)}</span><span aria-hidden="true">→</span></span>
      <h4>${esc(p.name)}</h4><p>${esc(p.description)}</p><span class="status">${esc(p.status)}</span></a>`).join(''));
    $('#art-count').textContent = `${items.length} of ${R.projects.length}`;
    $$('#art-filter button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.theme === theme)));
  }
  $('#art-filter').addEventListener('click', e => { const b = e.target.closest('button'); if (b) renderArtifacts(b.dataset.theme); });
  $('#art-more').addEventListener('click', () => { $('#art-grid').classList.remove('collapsed'); });
  renderArtifacts('All');

  /* ---------- Publications ---------- */
  R.published.sort((a, b) => Number(b.year) - Number(a.year)); // stable: keeps CV order within a year
  let kind = 'published', query = '';
  // Lab author strings carry trailing notes (pages, awards, emoji); keep the names and pages, show notes as badges.
  const cleanAuthors = a => a.replace(/\s*[\u{1F3C6}\u{1F4E6}✅♻️]+/gu, '')
    .replace(/\s*(ACM SIGSOFT Distinguished Paper Award|Artifacts Available and Evaluated–Reusable)\.?/g, '')
    .replace(/\s*(Research Track; )?[Tt]o appear\.?/g, '').trim();
  const boldMe = authors => esc(authors).replace(/M\. Babaei/g, '<b>M. Babaei</b>');
  const badgesFor = (p, reviewed) => {
    const b = [];
    if (reviewed) b.push(`<span class="badge ${p.status === 'On-going' ? 'ongoing' : 'status'}">${esc(p.status)}</span>`);
    if (/Distinguished Paper/.test(p.authors)) b.push('<span class="badge award">ACM SIGSOFT Distinguished Paper Award</span>');
    if (/Artifacts Available/.test(p.authors)) b.push('<span class="badge award">Artifacts Available &amp; Evaluated–Reusable</span>');
    if (/to appear/i.test(p.authors)) b.push('<span class="badge status">To appear</span>');
    return b.length ? `<div class="badges">${b.join('')}</div>` : '';
  };
  function renderPubs() {
    const reviewed = kind === 'submitted';
    const list = R[kind].map((p, i) => ({ p, i })).filter(({ p }) =>
      !query || `${p.title} ${p.authors} ${p.venue} ${p.year || p.status}`.toLowerCase().includes(query));
    const link = (href, label) => href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${label} ↗</a>` : '';
    render($('#pub-list'), list.length ? list.map(({ p, i }) => {
      const id = `${kind}-${i}`;
      const yr = reviewed ? (p.status === 'On-going' ? 'Now' : '—') : p.year;
      return `<li class="pub" id="pub-${esc(p.key)}">
        <div class="pub-meta"><span class="yr">${esc(yr)}</span><span class="venue">${esc(p.venue)}</span></div>
        <div><h3>${esc(p.title.replace(/\.$/, ''))}</h3><p class="authors">${boldMe(cleanAuthors(p.authors))}</p>${badgesFor(p, reviewed)}
          <div class="pub-actions">${link(p.paper, 'Paper')}${link(p.preprint, 'Preprint')}${link(p.code, 'Code')}
            ${p.abstract ? `<button type="button" aria-expanded="false" aria-controls="${id}-abs" data-panel="${id}-abs">Abstract</button>` : ''}
            <button type="button" aria-expanded="false" aria-controls="${id}-bib" data-panel="${id}-bib">Cite</button></div>
          ${p.abstract ? `<div class="pub-panel" id="${id}-abs" hidden><p class="k">${esc(p.abstract.kind)}</p><p>${esc(p.abstract.text)}</p>${p.abstract.source ? `<p style="margin-top:8px"><a href="${esc(p.abstract.source)}" target="_blank" rel="noopener">Original abstract ↗</a></p>` : ''}</div>` : ''}
          <div class="pub-panel" id="${id}-bib" hidden><p class="k">BibTeX</p><pre>${esc(p.bibtex)}</pre><button type="button" class="copy" data-copy>Copy BibTeX</button></div>
        </div></li>`;
    }).join('') : '<li class="empty">No matching entries. Try another search or switch tabs.</li>');
    $$('#pub-tabs [role=tab]').forEach(t => t.setAttribute('aria-selected', String(t.dataset.kind === kind)));
  }
  $('#pub-tabs').addEventListener('click', e => { const t = e.target.closest('[role=tab]'); if (t) { kind = t.dataset.kind; renderPubs(); } });
  $('#pub-tabs').addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const tabs = $$('#pub-tabs [role=tab]');
    const next = tabs[(tabs.indexOf(document.activeElement) + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    next.focus(); next.click();
  });
  $('#pub-search').addEventListener('input', e => { query = e.target.value.trim().toLowerCase(); renderPubs(); });
  $('#pub-list').addEventListener('click', async e => {
    const toggle = e.target.closest('[data-panel]');
    if (toggle) {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.closest('.pub').querySelectorAll('[data-panel]').forEach(b => { b.setAttribute('aria-expanded', 'false'); document.getElementById(b.dataset.panel).hidden = true; });
      toggle.setAttribute('aria-expanded', String(open));
      document.getElementById(toggle.dataset.panel).hidden = !open;
      return;
    }
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      try { await navigator.clipboard.writeText(copy.previousElementSibling.textContent); copy.textContent = 'Copied ✓'; }
      catch { copy.textContent = 'Select the text to copy'; }
      setTimeout(() => { copy.textContent = 'Copy BibTeX'; }, 1800);
    }
  });
  renderPubs();

  /* ---------- Research milestone chips -> publication entries ---------- */
  $$('.chip[data-find]').forEach(chip => {
    const needle = chip.dataset.find.toLowerCase();
    const match = p => p.title.toLowerCase().startsWith(needle);
    const k = R.published.some(match) ? 'published' : R.submitted.some(match) ? 'submitted' : null;
    if (!k) { chip.removeAttribute('href'); return; }
    const pub = R[k].find(match);
    chip.href = `#pub-${pub.key}`;
    chip.addEventListener('click', e => {
      e.preventDefault();
      kind = k; query = ''; $('#pub-search').value = ''; renderPubs();
      const el = document.getElementById(`pub-${pub.key}`);
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.animate([{ backgroundColor: 'rgba(184,79,18,.14)' }, { backgroundColor: 'rgba(184,79,18,0)' }], { duration: 1800, easing: 'ease-out' });
    });
  });
})();
