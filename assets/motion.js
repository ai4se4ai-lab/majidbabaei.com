'use strict';
// Shared motion + chrome for every page. Loaded in <head> so the page-transition events are heard before first paint.
(() => {
  const html = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const crossDoc = 'CSSViewTransitionRule' in window;
  if (!crossDoc) html.classList.add('no-vt');
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const pathOf = u => new URL(u, location.href).pathname.replace(/index\.html$/, '');
  const depth = p => p.split('/').filter(Boolean).length;

  /* ---------- Page transitions: direction + the picture that travels ---------- */
  // The link that leads to `path` lends its [data-morph] picture the shared name for the length of the transition.
  function lend(path) {
    const link = $$('a[href]').find(a => pathOf(a.href) === path && $('[data-morph]', a));
    const el = link && $('[data-morph]', link);
    if (el) el.style.viewTransitionName = 'vt-cover';
    return el;
  }
  addEventListener('pageswap', e => {
    if (!e.viewTransition || !e.activation?.entry?.url) return;
    const own = $$('[data-morph-target]');
    const el = lend(pathOf(e.activation.entry.url));
    if (el) own.forEach(t => { t.style.viewTransitionName = 'none'; });
    e.viewTransition.finished.finally(() => { if (el) el.style.viewTransitionName = ''; own.forEach(t => { t.style.viewTransitionName = ''; }); });
  });
  addEventListener('pagereveal', e => {
    if (!e.viewTransition) return;
    const from = window.navigation?.activation?.from?.url;
    const was = from ? pathOf(from) : '';
    html.dataset.vt = was && depth(location.pathname.replace(/index\.html$/, '')) < depth(was) ? 'up' : 'down';
    const el = was && !$('[data-morph-target]') ? lend(was) : null;
    e.viewTransition.finished.finally(() => { delete html.dataset.vt; if (el) el.style.viewTransitionName = ''; });
  });
  addEventListener('pageshow', () => html.classList.remove('is-leaving'));

  /* ---------- In-page swaps: keyed items glide to their new place ---------- */
  const nameOf = el => { el.style.viewTransitionName = 'k-' + el.dataset.key.replace(/[^a-z0-9_-]/gi, '_'); };
  function swap(scope, update) {
    if (!document.startViewTransition || reduced || html.dataset.vt) { update(); return; }
    $$('[data-key]', scope).forEach(nameOf);
    html.dataset.vt = 'swap';
    const t = document.startViewTransition(() => { update(); $$('[data-key]', scope).forEach(nameOf); });
    t.finished.finally(() => { delete html.dataset.vt; $$('[data-key]', scope).forEach(el => { el.style.viewTransitionName = ''; }); });
  }

  /* ---------- Generative cover: a small statechart, seeded by slug, drawn in the page's own palette ---------- */
  const hash = s => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
  function rng(seed) { return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function cover(slug, [a, b] = ['var(--navy)', 'var(--orange)']) {
    const r = rng(hash(slug)); const W = 800, H = 500, id = 'c' + hash(slug);
    const n = 3 + Math.floor(r() * 3); const nodes = [];
    for (let i = 0; i < n; i++) nodes.push({ x: 150 + (i * (W - 300)) / (n - 1) + (r() - .5) * 50, y: 140 + r() * 220, w: 110 + r() * 70 });
    const edges = nodes.slice(1).map((m, i) => { const p = nodes[i]; const up = r() > .5 ? -1 : 1;
      return `<path d="M${p.x + p.w / 2} ${p.y} C ${p.x + p.w} ${p.y + up * 100}, ${m.x - m.w / 2} ${m.y + up * 100}, ${m.x - m.w / 2} ${m.y}"/>`; }).join('');
    const last = nodes[n - 1], first = nodes[0];
    const back = `<path d="M${last.x} ${last.y + 28} C ${last.x} ${H - 20}, ${first.x} ${H - 20}, ${first.x} ${first.y + 28}" style="stroke:${b}"/>`;
    const states = nodes.map((m, i) => `<rect x="${m.x - m.w / 2}" y="${m.y - 28}" width="${m.w}" height="56" rx="28" style="fill:${i === 0 ? a : 'var(--card)'};stroke:${i % 2 ? b : a}" stroke-width="2"/>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><pattern id="${id}" width="40" height="40" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.5" style="fill:${a}" fill-opacity=".22"/></pattern></defs>
      <rect width="${W}" height="${H}" style="fill:var(--paper-2)"/><rect width="${W}" height="${H}" fill="url(#${id})"/>
      <circle cx="${W - 90 - r() * 120}" cy="${70 + r() * 90}" r="${150 + r() * 90}" fill="none" style="stroke:${b}" stroke-opacity=".28"/>
      <g fill="none" style="stroke:${a}" stroke-width="2" stroke-dasharray="7 6" stroke-opacity=".75">${edges}${back}</g>
      <circle cx="${first.x - first.w / 2 - 34}" cy="${first.y}" r="8" style="fill:${a}"/>${states}</svg>`;
  }

  /* ---------- Segmented controls: a thumb on a bounded spring ---------- */
  // One thumb slides under the selected button. Each of its four dimensions follows a damped spring
  // (stiffness k, damping ratio zeta ≈ .78, about 2% overshoot). The x position is clamped to the
  // track, so the thumb never leaves the control, and a small velocity stretch is allowed only while
  // the stretched thumb still fits inside the bounds.
  function spring(x, to, v, dt, k = 380, zeta = .78) {
    const c = 2 * Math.sqrt(k) * zeta, n = Math.max(1, Math.ceil(dt / 4)), h = dt / n / 1000;
    for (let i = 0; i < n; i++) { v += (-k * (x - to) - c * v) * h; x += v * h; }
    return [x, v];
  }
  function seg(el) {
    if (el.querySelector(':scope > .seg-thumb')) return;
    const thumb = document.createElement('span'); thumb.className = 'seg-thumb'; thumb.setAttribute('aria-hidden', 'true');
    el.prepend(thumb);
    const selected = () => el.querySelector('button[aria-pressed="true"],button[aria-selected="true"]');
    const cur = { x: 0, y: 0, w: 0, h: 0 }, vel = { x: 0, y: 0, w: 0, h: 0 };
    let target = null, raf = 0, last = 0;
    const paint = still => {
      const pad = parseFloat(getComputedStyle(el).paddingLeft) || 0, inner = Math.max(el.clientWidth, el.scrollWidth) - pad;
      const x = Math.min(Math.max(cur.x, pad), Math.max(pad, inner - cur.w));
      let stretch = still ? 0 : Math.min(.09, Math.abs(vel.x) / 2600);
      if (x - cur.w * stretch / 2 < pad || x + cur.w * (1 + stretch / 2) > inner) stretch = 0;
      thumb.style.transform = `translate3d(${x.toFixed(2)}px,${cur.y.toFixed(2)}px,0) scaleX(${(1 + stretch).toFixed(3)})`;
      thumb.style.width = cur.w.toFixed(2) + 'px'; thumb.style.height = cur.h.toFixed(2) + 'px';
    };
    const rest = () => { Object.assign(cur, target); for (const k in vel) vel[k] = 0; };
    const tick = now => {
      const dt = Math.min(32, now - last || 16); last = now; let still = true;
      for (const k of ['x', 'y', 'w', 'h']) {
        [cur[k], vel[k]] = spring(cur[k], target[k], vel[k], dt);
        if (Math.abs(cur[k] - target[k]) > .08 || Math.abs(vel[k]) > 1) still = false;
      }
      if (still) rest();
      paint(still);
      raf = still ? 0 : requestAnimationFrame(tick);
    };
    const go = animate => {
      const b = selected(); if (!b) { el.classList.remove('seg-live'); return; }
      target = { x: b.offsetLeft, y: b.offsetTop, w: b.offsetWidth, h: b.offsetHeight };
      el.classList.add('seg-live');
      if (!animate || reduced || !cur.w) { rest(); paint(true); return; }
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
    };
    new MutationObserver(ms => go(ms.every(m => m.type === 'attributes'))).observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-selected'] });
    new ResizeObserver(() => go(false)).observe(el);
    document.fonts?.ready?.then(() => go(false));
    go(false);
  }

  window.Motion = { reduced, swap, cover, seg, spring };

  document.addEventListener('DOMContentLoaded', () => {
    $$('.seg, .feed-tabs').forEach(seg);

    /* Theme: the new palette opens in a circle from the button. */
    const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
    $('#theme-btn')?.addEventListener('click', e => {
      const dark = html.dataset.theme ? html.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      const apply = () => { html.dataset.theme = dark ? 'light' : 'dark'; store('theme', html.dataset.theme); };
      if (!document.startViewTransition || reduced || html.dataset.vt) { apply(); return; }
      const b = e.currentTarget.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2;
      const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      html.dataset.vt = 'theme';
      const t = document.startViewTransition(apply);
      t.ready.then(() => html.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 560, easing: 'cubic-bezier(.65,0,.35,1)', pseudoElement: '::view-transition-new(root)' })).catch(() => {});
      t.finished.finally(() => { delete html.dataset.vt; });
    });

    /* Header: phone menu, hairline once scrolled, and (articles) stepping aside while reading down. */
    const header = $('.site-header'), nav = $('#nav'), menuBtn = $('#menu-btn');
    if (nav && menuBtn) {
      const setMenu = open => { nav.classList.toggle('open', open); menuBtn.setAttribute('aria-expanded', String(open)); menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu'); };
      menuBtn.addEventListener('click', () => setMenu(!nav.classList.contains('open')));
      nav.addEventListener('click', e => { if (e.target.closest('a')) setMenu(false); });
      document.addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });
    }
    if (header) {
      const hides = document.body.dataset.page === 'post';
      let last = scrollY;
      const onScroll = () => {
        header.classList.toggle('scrolled', scrollY > 8);
        if (hides) header.classList.toggle('hide', scrollY > last && scrollY > 160 && !nav?.classList.contains('open'));
        last = scrollY;
      };
      addEventListener('scroll', onScroll, { passive: true }); onScroll();
    }

    /* The scroll-lit statement: split into words once; CSS does the rest. */
    $$('[data-lit]').forEach(el => {
      const words = [];
      const walk = node => [...node.childNodes].forEach(c => {
        if (c.nodeType === 3) {
          const frag = document.createDocumentFragment();
          c.textContent.split(/(\s+)/).forEach(part => {
            if (!part.trim()) { frag.append(part); return; }
            const s = document.createElement('span'); s.className = 'w'; s.textContent = part; words.push(s); frag.append(s);
          });
          c.replaceWith(frag);
        } else if (c.nodeType === 1) walk(c);
      });
      walk(el);
      words.forEach((s, i) => s.style.setProperty('--p', (i / Math.max(1, words.length - 1)).toFixed(3)));
      el.classList.add('is-split');
    });

    /* One count, on load, in the hero. The final figure is already in the HTML. */
    if (!reduced) $$('.ledger strong').forEach(el => {
      const end = Number(el.textContent); if (!end) return;
      const t0 = performance.now(), dur = 1000;
      const step = now => { const k = Math.min(1, (now - t0) / dur); el.textContent = Math.round(end * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
      el.style.fontVariantNumeric = 'tabular-nums'; requestAnimationFrame(step);
    });

    /* Fallback page transition where cross-document view transitions are missing. */
    if (!crossDoc && !reduced) document.addEventListener('click', e => {
      const a = e.target.closest('a[href]');
      if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target || a.hasAttribute('download')) return;
      const u = new URL(a.href, location.href);
      if (u.origin !== location.origin || /\.(pdf|xml|png|jpe?g|webp|svg)$/i.test(u.pathname) || (u.pathname === location.pathname && u.search === location.search)) return;
      e.preventDefault(); html.classList.add('is-leaving');
      setTimeout(() => { location.href = a.href; }, 150);
    });

    /* Prefetch the page a visitor is about to open, so the transition starts at once. */
    if (HTMLScriptElement.supports?.('speculationrules')) {
      const s = document.createElement('script'); s.type = 'speculationrules';
      s.textContent = JSON.stringify({ prefetch: [{ where: { and: [{ href_matches: '/*' }, { not: { href_matches: ['/*.pdf', '/*.xml', '/data/*', '/pages/*'] } }] }, eagerness: 'moderate' }] });
      document.head.append(s);
    }
  });
})();
