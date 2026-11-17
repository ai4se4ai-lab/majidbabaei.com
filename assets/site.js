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

  const M = window.Motion || { swap: (_, fn) => fn() };
  const main = $('#main');

  /* ---------- Scroll-spy (theme, menu and header behaviour live in motion.js) ---------- */
  const links = new Map($$('#nav a').filter(a => a.hash && a.pathname === location.pathname).map(a => [a.hash.slice(1), a]));
  const spy = new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting) links.forEach((a, id) => a.classList.toggle('current', id === e.target.id));
  }), { rootMargin: '-45% 0px -50% 0px' });
  links.forEach((_, id) => { const s = document.getElementById(id); if (s) spy.observe(s); });

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

  /* ---------- The statechart, in detail: the concepts that carry work across each transition ----------
     Each arc carries the abstractions that move work from one state to the other: ① turns human concerns
     into models, contracts, transformations, and verification that agents can be held to; ② turns agent
     traces into slices, provenance, and explanations that people can read. A hover names the projects
     behind each concept. One token is driven by script round the whole loop; concepts it has passed stay
     marked until the next pass, and a state's entry action stays lit while the token is inside. */
  const CONCEPTS = {
    down: [
      { c: 'concerns', d: 'safety, intent, correctness, and organizational constraints, as people state them' },
      { c: 'models', d: 'the same concerns at the level people reason about, precise enough to check · SSEVOH-DSL' },
      { c: 'contracts', d: 'checkable obligations between people, guardrails, and agents · TINT, SSEVOH-DSL' },
      { c: 'transformations', s: 'transforms', d: 'checked composition of agent teams and the state they share · AutoM2M, Safe Coordination' },
      { c: 'verification', d: 'does the composed team still meet its concerns? · TINT, Safe Coordination' },
    ],
    up: [
      { c: 'traces', d: 'transcripts, tool calls, and executions, abundant but unreadable at scale · TAAF' },
      { c: 'slices', d: 'the few components whose interaction explains a symptom · Agent Slicing' },
      { c: 'provenance', d: 'which version, approval, and context produced a behavior · Heartness' },
      { c: 'explanations', d: 'why an objective was or was not achieved, in terms people can check · TAAF' },
    ],
  };
  const SVG = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs = {}, text) => { const n = document.createElementNS(SVG, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (text != null) n.textContent = text; return n; };
  const diagrams = $$('.loop svg').map(svg => {
    const arcs = {}; $$('path[data-arc]', svg).forEach(p => { arcs[p.dataset.arc] = { path: p, len: 0, nodes: [] }; });
    $$('.nodes', svg).forEach(group => {
      const t = group.dataset.t, side = group.dataset.side, arc = arcs[t], steps = CONCEPTS[t], vertical = side === 'right' || side === 'left';
      steps.forEach((step, i) => {
        const node = mk('g', { class: 'node', tabindex: '0' });
        node.append(mk('title', {}, `${step.c} — ${step.d}`));
        node.append(mk('circle', { class: 'nd', r: 4.8 }));
        const label = mk('text', { class: 'nd-l', 'text-anchor': side === 'right' ? 'start' : side === 'left' ? 'end' : 'middle' }, vertical && step.s ? step.s : step.c);
        node.append(label);
        group.append(node); arc.nodes.push({ i, n: steps.length, at: 0, el: node, label, side });
      });
    });
    const tok = mk('g', { class: 'tok', opacity: 0 });
    const ghosts = [3, 2, 1].map(i => { const c = mk('circle', { class: 'tok-ghost', r: 2 + i, opacity: (.12 * i).toFixed(2) }); tok.append(c); return c; });
    tok.append(mk('circle', { class: 'tok-halo', r: 15 }), mk('circle', { class: 'token', r: 6 }));
    svg.append(tok);
    const d = { svg, arcs, tok, ghosts, ready: false, states: { human: $('.st[data-st="human"]', svg), ai: $('.st[data-st="ai"]', svg) } };
    // Path lengths read as 0 while the variant is display:none (one of the two always is), so nodes are
    // placed the first time the variant has a size.
    d.layout = () => {
      for (const arc of Object.values(arcs)) {
        arc.len = arc.path.getTotalLength(); if (!arc.len) return false;
        arc.nodes.forEach(n => {
          n.at = arc.len * (n.i + 1) / (n.n + 1);
          const p = arc.path.getPointAtLength(n.at), a = arc.path.getPointAtLength(Math.max(0, n.at - 4)), b = arc.path.getPointAtLength(Math.min(arc.len, n.at + 4));
          n.el.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
          // The label sits on the arc's normal, toward the inside of the loop, so it clears the line even
          // where the arc is steep. Alternate rows keep neighbouring labels apart.
          const tx = b.x - a.x, ty = b.y - a.y, m = Math.hypot(tx, ty) || 1;
          let nx = -ty / m, ny = tx / m;
          const inward = n.side === 'below' ? ny > 0 : n.side === 'above' ? ny < 0 : n.side === 'right' ? nx > 0 : nx < 0;
          if (!inward) { nx = -nx; ny = -ny; }
          const dist = (n.side === 'right' || n.side === 'left') ? 16 : 22 + (n.i % 2 ? 15 : 0);
          n.label.setAttribute('x', (nx * dist).toFixed(1)); n.label.setAttribute('y', (ny * dist + 4).toFixed(1));
          // On the horizontal arcs, labels near either end run toward the loop's interior, away from the steep line.
          if (n.side === 'below' || n.side === 'above') n.label.setAttribute('text-anchor', p.x < 440 ? 'start' : p.x > 560 ? 'end' : 'middle');
        });
      }
      return (d.ready = true);
    };
    new ResizeObserver(es => { if (!d.ready && es.some(e => e.contentRect.width > 0)) d.layout(); }).observe(svg);
    d.layout();
    return d;
  });
  $('#loop-sig').textContent = `2 states · 2 transitions · 1 loop · ${CONCEPTS.down.length + CONCEPTS.up.length} concepts`;

  if (!(window.Motion?.reduced)) {
    // Timeline, in ms: travel ①, dwell in AI, travel ②, dwell in Human.
    const phases = [{ arc: 'down', enters: 'ai', dur: 3600 }, { dwell: 'ai', dur: 1000 }, { arc: 'up', enters: 'human', dur: 3600 }, { dwell: 'human', dur: 1000 }];
    const total = phases.reduce((s, p) => s + p.dur, 0);
    const ease = k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; // slow out of a state, slow into the next
    let t0 = performance.now(), raf = 0, passes = 0, lastPhase = -1;
    const place = (d, arc, len) => {
      const p = arc.path.getPointAtLength(len);
      d.tok.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
      d.ghosts.forEach((g, i) => { const q = arc.path.getPointAtLength(Math.max(0, len - (3 - i) * 13)); g.setAttribute('cx', (q.x - p.x).toFixed(1)); g.setAttribute('cy', (q.y - p.y).toFixed(1)); });
    };
    // Steady marks, no flashes: the entry action stays lit while the token is in the state.
    const enter = (d, which, from) => { const st = d.states[which]; st.style.setProperty('--c', from === 'down' ? 'var(--orange)' : 'var(--teal)'); st.classList.add('state-active'); };
    const leave = d => Object.values(d.states).forEach(st => st.classList.remove('state-active'));
    const frame = now => {
      const elapsed = (now - t0) % total; let acc = 0, i = 0;
      while (elapsed >= acc + phases[i].dur) { acc += phases[i].dur; i++; }
      const ph = phases[i], k = (elapsed - acc) / ph.dur;
      if (i !== lastPhase) {
        if (ph.arc) diagrams.forEach(d => { leave(d); d.arcs[ph.arc].nodes.forEach(n => n.el.classList.remove('on')); d.tok.setAttribute('class', `tok tok-${ph.arc === 'down' ? 'o' : 't'}`); d.tok.setAttribute('opacity', 1); });
        else diagrams.forEach(d => { d.tok.setAttribute('opacity', 0); enter(d, ph.dwell, phases[(i + 3) % 4].arc); });
        if (i === 0 && lastPhase !== -1) { passes++; $('#loop-pass').textContent = `pass ${String(passes + 1).padStart(2, '0')}`; }
        lastPhase = i;
      }
      if (ph.arc) diagrams.forEach(d => {
        if (!d.ready) return;
        const arc = d.arcs[ph.arc], len = ease(k) * arc.len; place(d, arc, len);
        arc.nodes.forEach(n => { if (len >= n.at - 2) n.el.classList.add('on'); });
      });
      raf = requestAnimationFrame(frame);
    };
    // Off screen or in a hidden tab the loop stops; it restarts from the Human state when it is seen again.
    const run = on => { if (on && !raf && !document.hidden) { t0 = performance.now(); lastPhase = -1; raf = requestAnimationFrame(frame); } else if (!on && raf) { cancelAnimationFrame(raf); raf = 0; } };
    let seen = false;
    new IntersectionObserver(es => { seen = es.some(e => e.isIntersecting); run(seen); }, { threshold: .15 }).observe(loop);
    document.addEventListener('visibilitychange', () => run(seen && !document.hidden));
  }

  /* ---------- Artifacts ---------- */
  const themeLabel = { Agents: 'Agentic systems', Analysis: 'Analysis & testing', Infrastructure: 'Infrastructure' };
  const ongoingLast = (a, b) => Number(a.status === 'On-going') - Number(b.status === 'On-going');
  function renderArtifacts(theme) {
    const items = R.projects.filter(p => theme === 'All' || p.theme === theme).sort(ongoingLast);
    const slugOf = name => name.split(' / ')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    render($('#art-grid'), items.map(p => `<a class="art" data-key="art-${esc(slugOf(p.name))}" data-theme="${esc(p.theme)}" href="projects/${esc(slugOf(p.name))}/">
      <span class="art-top"><span>${esc(themeLabel[p.theme] || p.theme)}</span><span class="m-arrow" aria-hidden="true">→</span></span>
      <h4>${esc(p.name)}</h4><p>${esc(p.description)}</p><span class="status">${esc(p.status)}</span></a>`).join(''));
    $('#art-count').textContent = `${items.length} of ${R.projects.length}`;
    $$('#art-filter button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.theme === theme)));
  }
  $('#art-filter').addEventListener('click', e => { const b = e.target.closest('button'); if (b) M.swap(main, () => renderArtifacts(b.dataset.theme)); });
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
      if (p.anonymous) return `<li class="pub"><div class="pub-meta"><span class="yr">Under review</span></div><div><h3>[anonymous for review]</h3><p class="authors">Identifying details withheld during review.</p></div></li>`;
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
  $('#pub-tabs').addEventListener('click', e => { const t = e.target.closest('[role=tab]'); if (t && t.dataset.kind !== kind) { kind = t.dataset.kind; M.swap(main, renderPubs); } });
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
