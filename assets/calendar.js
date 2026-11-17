'use strict';
// Calendar of commitments: the week / month / year grids on calendar/ and the small enhancements on calendar/<slug>/.
// Entries come from assets/calendar-data.js (generated from calendar/events/*.md); dates and recurrence from calendar-core.js.
// Theme, menu, segmented-control springs and page transitions live in motion.js.
(() => {
  const C = window.CalendarCore, D = window.CALENDAR || { events: [], types: {} };
  const M = window.Motion || { swap: (_, fn) => fn(), cover: () => '', reduced: false };
  const body = document.body, ROOT = body.dataset.root || '';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  // Every value from the data file passes through esc(); entry bodies are rendered and sanitized at build time.
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const render = (el, html) => el.replaceChildren(document.createRange().createContextualFragment(html));
  const N = 'var(--navy)', T = 'var(--teal)', O = 'var(--orange)';
  const HUE = { teaching: [T, N], research: [N, T], event: [O, N], service: ['var(--cal-plum)', O], deadline: ['var(--cal-rose)', N], travel: ['var(--muted)', O], block: ['var(--ink)', 'var(--muted)'] };
  const TYPE_ORDER = ['teaching', 'research', 'event', 'service', 'deadline', 'travel', 'block'];
  const label = t => D.types[t] || t;
  const EVENTS = D.events.map(C.normalize);
  const pageOf = e => ROOT + e.url, icsOf = e => `${ROOT}calendar/${e.slug}/event.ics`;
  const I = {
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    pin: '<path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="10" r="2.5"/>',
    repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>'
  };
  const icon = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}</svg>`;
  const isoWeek = d => { const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1)); return Math.ceil(((x - y0) / 864e5 + 1) / 7); };
  const timeSpan = o => `${C.time(o.start)}–${C.time(o.end)}`;
  // "Today", "Tomorrow", "In 12 days"; an entry already under way says so.
  const relative = (o, now) => o.start <= now && o.endExclusive > now ? (o.allDay && o.multi ? `Ongoing · until ${C.dateLabel(o.end, false)}` : 'Now') : C.relative(o.start, now);

  /* ---------- One entry on the grid ---------- */
  // mode: 'week' (timed block), 'allday' (week lane), 'month' (cell chip). `cls` adds classes, `attrs` inline attributes.
  const chip = (o, mode, cls = '', attrs = '') => {
    const e = o.event, past = o.endExclusive < new Date();
    const meta = mode === 'month' ? (o.allDay ? '' : `<span class="cal-ev-m">${esc(C.time(o.start))}</span>`)
      : mode === 'allday' ? (o.multi ? `<span class="cal-ev-m">${esc(C.rangeLabel(o.start, o.end))}</span>` : '')
      : `<span class="cal-ev-m">${esc(timeSpan(o))}${e.location ? ` · ${esc(e.location)}` : ''}</span>`;
    const classes = ['cal-ev', o.allDay ? 'is-allday' : '', past ? 'is-past' : '', e.status === 'tentative' ? 'is-tentative' : '', cls].filter(Boolean).join(' ');
    const title = `<span class="cal-ev-t">${esc(e.title)}</span>`;
    return `<button type="button" class="${classes}" data-type="${esc(e.type)}" data-occ="${esc(o.id)}" aria-label="${esc(e.title)}, ${esc(C.when(o))}" ${attrs}>
      <span class="cal-ev-in">${mode === 'month' ? meta + title : title + meta}</span></button>`;
  };
  // All-day lane (week) and month cells: spans that run past the visible range get an open end.
  const spanAttrs = (o, from, to) => ({ s: Math.max(0, C.daysBetween(from, o.start)), n: Math.min(C.daysBetween(from, o.end), C.daysBetween(from, to) - 1) - Math.max(0, C.daysBetween(from, o.start)) + 1,
    contL: o.start < from, contR: o.end >= to });

  /* ================= Calendar page ================= */
  function calendarPage() {
    const main = $('#cal-main'), grid = $('#cal-grid');
    const params = new URLSearchParams(location.search);
    const state = {
      view: ['week', 'month', 'year'].includes(params.get('view')) ? params.get('view') : 'month',
      date: C.parse(params.get('date')) || C.atMidnight(new Date()),
      types: new Set(params.get('types') ? params.get('types').split(',').filter(t => HUE[t]) : TYPE_ORDER),
      q: params.get('q') || '',
      full: params.get('full') === '1'
    };
    if (!state.types.size) TYPE_ORDER.forEach(t => state.types.add(t));
    $('#cal-q').value = state.q;
    const counts = Object.fromEntries(TYPE_ORDER.map(t => [t, EVENTS.filter(e => e.type === t).length]));
    const present = TYPE_ORDER.filter(t => counts[t]);
    render($('#cal-legend'), present.map(t => `<button type="button" data-type="${t}" aria-pressed="${state.types.has(t)}"><span class="sw" aria-hidden="true"></span>${esc(label(t))}<sup>${counts[t]}</sup></button>`).join('')
      + (present.length > 1 ? '<button type="button" class="cal-legend-all" data-all>Show all</button>' : ''));
    const visible = () => {
      const q = state.q.trim().toLowerCase();
      return EVENTS.filter(e => state.types.has(e.type) && (!q || `${e.title} ${e.summary} ${e.location} ${e.tags.join(' ')} ${label(e.type)}`.toLowerCase().includes(q)));
    };
    let occ = new Map();                                                  // id -> occurrence, for the popover
    const keep = list => { occ = new Map(list.map(o => [o.id, o])); return list; };

    /* ---------- Views ---------- */
    function week() {
      const from = C.startOfWeek(state.date), to = C.addDays(from, 7), now = new Date(), today = C.key(now);
      const items = keep(C.expand(visible(), from, to));
      const days = [...Array(7)].map((_, i) => C.addDays(from, i));
      const timed = items.filter(o => !o.allDay), allDay = items.filter(o => o.allDay);
      // Hour rules run from the earliest entry to the latest, and always at least 8am to 6pm.
      let h0 = 8, h1 = 18;
      for (const o of timed) {
        h0 = Math.min(h0, o.start < from ? 0 : o.start.getHours());
        const endMin = C.minutes(o.endExclusive), sameDay = C.key(o.start) === C.key(o.endExclusive);
        h1 = Math.max(h1, o.endExclusive >= to || !sameDay ? 24 : Math.ceil(endMin / 60));
      }
      // All-day lane: greedy rows over 7 columns.
      const rows = [];
      const lane = allDay.sort((a, b) => a.start - b.start || b.end - a.end).map(o => {
        const { s, n, contL, contR } = spanAttrs(o, from, to);
        let r = rows.findIndex(row => row.slice(s, s + n).every(x => !x)); if (r < 0) { r = rows.length; rows.push(Array(7).fill(false)); }
        for (let i = s; i < s + n; i++) rows[r][i] = true;
        return chip(o, 'allday', `${contL ? 'cont-l' : ''} ${contR ? 'cont-r' : ''}`, `style="--s:${s + 1};--n:${n};--r:${r + 1}"`);
      }).join('');
      const hours = [...Array(h1 - h0 + 1)].map((_, i) => `<span style="top:calc(${i} * var(--cal-hour))">${i + h0 === 24 ? '' : C.time(new Date(2000, 0, 1, i + h0))}</span>`).join('');
      const cols = days.map(d => {
        const start = C.atMidnight(d), end = C.addDays(start, 1);
        const laid = C.layoutDay(timed.filter(o => o.start < end && o.endExclusive > start), start);
        const evs = laid.map(l => chip(l.occ, 'week', l.height < 40 ? 'is-short' : '', `style="--top:${(l.top - h0 * 60).toFixed(1)};--h:${l.height.toFixed(1)};--col:${l.col};--cols:${l.cols}"`)).join('');
        const isToday = C.key(d) === today;
        const nowLine = isToday ? `<div class="cal-now" style="top:calc(${(C.minutes(now) - h0 * 60)} * var(--cal-hour) / 60)"></div><span class="cal-now-lbl" style="top:calc(${(C.minutes(now) - h0 * 60)} * var(--cal-hour) / 60)">${esc(C.time(now))}</span>` : '';
        return `<div class="cal-day${isToday ? ' is-today' : ''}${C.dow(d) > 4 ? ' is-weekend' : ''}" style="height:calc(${h1 - h0} * var(--cal-hour))" data-day="${C.key(d)}">${evs}${nowLine}</div>`;
      }).join('');
      return `<div class="cal-week" data-key="cal-week"><div class="cal-week-scroll"><div class="cal-week-inner">
        <div class="cal-wh"><div></div>${days.map(d => `<div class="${C.key(d) === today ? 'is-today' : ''}${C.dow(d) > 4 ? ' is-weekend' : ''}"><span class="dn">${C.DAYS[C.dow(d)]}</span><span class="dd">${d.getDate()}</span></div>`).join('')}</div>
        <div class="cal-allday"><div class="lbl">All day</div>${lane ? `<div class="cal-allday-lane">${lane}</div>` : '<div class="cal-allday-empty"></div>'}</div>
        <div class="cal-wb"><div class="cal-hours" style="height:calc(${h1 - h0} * var(--cal-hour))">${hours}</div>${cols}</div>
      </div></div></div>${items.length ? '' : empty('Nothing this week')}`;
    }
    function month() {
      const first = new Date(state.date.getFullYear(), state.date.getMonth(), 1), from = C.startOfWeek(first), to = C.addDays(from, 42), today = C.key(new Date());
      const items = keep(C.expand(visible(), from, to));
      const byDay = new Map();
      for (const o of items) {
        const a = o.start < from ? from : C.atMidnight(o.start), b = o.allDay ? o.end : (C.key(o.start) === C.key(o.end) ? o.start : o.end);
        for (let d = a; d <= b && d < to; d = C.addDays(d, 1)) { const k = C.key(d); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(o); }
      }
      const cells = [...Array(42)].map((_, i) => {
        const d = C.addDays(from, i), k = C.key(d), list = byDay.get(k) || [];
        const other = d.getMonth() !== first.getMonth(), max = 3, shown = list.slice(0, list.length > max ? max - 1 : max);
        const chips = shown.map(o => chip(o, 'month', `${o.allDay && o.multi && C.key(o.start) !== k ? 'cont-l' : ''} ${o.allDay && o.multi && C.key(o.end) !== k ? 'cont-r' : ''}`)).join('');
        const more = list.length > shown.length ? `<button type="button" class="cal-more" data-more="${k}">+${list.length - shown.length} more</button>` : '';
        return `<div class="cal-mc${other ? ' is-other' : ''}${k === today ? ' is-today' : ''}${C.dow(d) > 4 ? ' is-weekend' : ''}" data-day="${k}">
          <button type="button" class="cal-mc-d" data-goto="${k}" aria-label="Open the week of ${esc(C.longDate(d))}">${d.getDate()}${d.getDate() === 1 ? `<b>${C.MONTHS[d.getMonth()]}</b>` : ''}</button>${chips}${more}</div>`;
      }).join('');
      return `<div class="cal-month" data-key="cal-month"><div class="cal-mh">${C.DAYS.map(d => `<div>${d}</div>`).join('')}</div><div class="cal-mb">${cells}</div></div>${items.length ? '' : empty('Nothing this month')}`;
    }
    function year() {
      const y = state.date.getFullYear(), from = new Date(y, 0, 1), to = new Date(y + 1, 0, 1), today = C.key(new Date());
      const items = keep(C.expand(visible(), from, to));
      const byDay = new Map();
      for (const o of items) {
        for (let d = C.atMidnight(o.start < from ? from : o.start); d <= o.end && d < to; d = C.addDays(d, 1)) { const k = C.key(d); if (!byDay.has(k)) byDay.set(k, new Set()); byDay.get(k).add(o.event.type); }
      }
      const months = [...Array(12)].map((_, m) => {
        const first = new Date(y, m, 1), n = new Date(y, m + 1, 0).getDate(), lead = C.dow(first);
        const count = items.filter(o => o.start.getMonth() === m || (o.start < first && o.end >= first)).length;
        const cells = [...Array(lead)].map(() => '<span class="cal-yd is-empty" aria-hidden="true"></span>').join('') + [...Array(n)].map((_, i) => {
          const d = new Date(y, m, i + 1), k = C.key(d), types = byDay.get(k);
          const dots = types ? `<span class="dots">${[...types].slice(0, 3).map(t => `<i data-type="${t}"></i>`).join('')}</span>` : '<span class="dots"></span>';
          return `<button type="button" class="cal-yd${k === today ? ' is-today' : ''}${C.dow(d) > 4 ? ' is-weekend' : ''}${types ? ' has-busy' : ''}" data-goto="${k}" aria-label="${esc(C.longDate(d))}${types ? `, ${[...types].map(label).join(', ')}` : ''}">${i + 1}${dots}</button>`;
        }).join('');
        return `<section class="cal-ym${new Date().getFullYear() === y && new Date().getMonth() === m ? ' is-now' : ''}" data-key="ym-${m}" aria-label="${C.MONTH_LONG[m]} ${y}"><div class="cal-ym-h"><button type="button" data-month="${m}">${C.MONTH_LONG[m]}</button><span>${count ? `${count} ${count === 1 ? 'entry' : 'entries'}` : ''}</span></div>
          <div class="cal-ym-g">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => `<span class="wd" aria-hidden="true">${d}</span>`).join('')}${cells}</div></section>`;
      }).join('');
      return `<div class="cal-year" data-key="cal-year">${months}</div>${items.length ? '' : empty(`Nothing in ${y}`)}`;
    }
    const empty = t => `<div class="cal-empty"><b>${esc(t)}</b><span>${state.q || state.types.size < present.length ? 'Try clearing the search or the type filters.' : 'Entries will appear here as they are added.'}</span></div>`;

    /* ---------- Title, URL, rail, stats ---------- */
    const title = () => {
      const d = state.date;
      if (state.view === 'week') { const a = C.startOfWeek(d), b = C.addDays(a, 6); return `${esc(C.rangeLabel(a, b))}<small>Week ${isoWeek(a)}</small>`; }
      if (state.view === 'month') return `${C.MONTH_LONG[d.getMonth()]} ${d.getFullYear()}`;
      return String(d.getFullYear());
    };
    const sync = () => {
      const u = new URL(location.href), p = u.searchParams;
      p.set('view', state.view); p.set('date', C.key(state.date));
      if (state.types.size < present.length) p.set('types', TYPE_ORDER.filter(t => state.types.has(t)).join(',')); else p.delete('types');
      if (state.q.trim()) p.set('q', state.q.trim()); else p.delete('q');
      if (state.full) p.set('full', '1'); else p.delete('full');
      history.replaceState(null, '', u);
    };
    function rail() {
      const now = new Date(), up = C.upcoming(visible(), now, 8);
      render($('#cal-up'), up.map(o => `<li><a href="${esc(pageOf(o.event))}" data-type="${esc(o.event.type)}"><b>${esc(o.event.title)}</b><small><em>${esc(relative(o, now))}</em> · ${esc(o.allDay ? C.rangeLabel(o.start, o.end) : `${C.dateLabel(o.start, false)}, ${timeSpan(o)}`)}</small></a></li>`).join('')
        || '<li><span class="cal-up-empty">Nothing scheduled in the next year.</span></li>');
    }
    function stats() {
      const now = new Date(), w0 = C.startOfWeek(now), m0 = new Date(now.getFullYear(), now.getMonth(), 1);
      $('#st-week').textContent = C.expand(EVENTS, w0, C.addDays(w0, 7)).length;
      $('#st-month').textContent = C.expand(EVENTS, m0, C.addMonths(m0, 1)).length;
      $('#st-total').textContent = EVENTS.length;
      const next = C.upcoming(EVENTS, now, 1)[0];
      render($('#st-next'), next ? `<a href="${esc(pageOf(next.event))}">${esc(next.event.title)}</a><small>${esc(relative(next, now))} · ${esc(label(next.event.type))}</small>` : 'Nothing scheduled');
      $('#cal-today-label').textContent = `Today · ${C.dateLabel(now)}`;
    }
    function draw() {
      render(grid, state.view === 'week' ? week() : state.view === 'month' ? month() : year());
      render($('#cal-title'), title());
      $$('#cal-views [data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
      $$('#cal-legend [data-type]').forEach(b => b.setAttribute('aria-pressed', String(state.types.has(b.dataset.type))));
      rail(); sync();
    }
    const go = (fn, animate = true) => { closePop(); fn(); if (animate) M.swap(main, draw); else draw(); };
    const step = n => {
      if (state.view === 'week') state.date = C.addDays(state.date, 7 * n);
      else if (state.view === 'month') state.date = C.addMonths(state.date, n);
      else state.date = new Date(state.date.getFullYear() + n, 0, 1);
    };

    /* ---------- Popover ---------- */
    const pop = document.createElement('div'); pop.className = 'cal-pop'; pop.hidden = true; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-modal', 'false'); pop.tabIndex = -1;
    body.append(pop);
    let opener = null;
    function place(anchor) {
      const r = anchor.getBoundingClientRect(), m = 12, W = pop.offsetWidth, H = pop.offsetHeight;
      let x = r.left, y = r.bottom + 8;
      if (y + H > innerHeight - m) y = r.top - H - 8;
      if (y < m) y = Math.max(m, Math.min(innerHeight - H - m, r.top));
      if (x + W > innerWidth - m) x = innerWidth - W - m;
      if (x < m) x = m;
      pop.style.left = `${Math.round(x)}px`; pop.style.top = `${Math.round(y)}px`;
    }
    function openPop(html, anchor, type) {
      opener = anchor; render(pop, `<button type="button" class="cal-pop-x" aria-label="Close">×</button>${html}`);
      pop.dataset.type = type || ''; pop.hidden = false; place(anchor); pop.focus({ preventScroll: true });
    }
    function closePop() { if (pop.hidden) return; pop.hidden = true; if (opener && document.contains(opener)) opener.focus({ preventScroll: true }); opener = null; }
    function showOcc(id, anchor) {
      const o = occ.get(id); if (!o) return;
      const e = o.event, rule = C.describeRule(e);
      openPop(`<p class="cal-pop-k"><span class="sw" aria-hidden="true"></span>${esc(label(e.type))}${e.status === 'tentative' ? '<span class="tent">Tentative</span>' : ''}</p>
        <h3>${esc(e.title)}</h3>
        <p class="row">${icon('clock')}<span>${esc(C.when(o))}</span></p>
        ${rule ? `<p class="row">${icon('repeat')}<span>${esc(rule)}</span></p>` : ''}
        ${e.location ? `<p class="row">${icon('pin')}<span>${esc(e.location)}</span></p>` : ''}
        ${e.summary ? `<p class="sum">${esc(e.summary)}</p>` : ''}
        <div class="cal-pop-act"><a class="primary" href="${esc(pageOf(e))}">Open details <span class="m-arrow" aria-hidden="true">→</span></a><a href="${esc(icsOf(e))}" download="${esc(e.slug)}.ics">${icon('download')}.ics</a></div>`, anchor, e.type);
    }
    function showDay(k, anchor) {
      const d = C.parse(k), list = [...occ.values()].filter(o => o.start < C.addDays(d, 1) && (o.allDay ? o.end >= d : o.end > d)).sort((a, b) => a.allDay === b.allDay ? a.start - b.start : a.allDay ? -1 : 1);
      openPop(`<p class="cal-pop-k">${esc(C.longDate(d))}</p><h3>${list.length} ${list.length === 1 ? 'entry' : 'entries'}</h3><ul class="cal-pop-list">${list.map(o => `<li>${chip(o, 'month')}</li>`).join('')}</ul>`, anchor, '');
    }
    pop.addEventListener('click', e => { if (e.target.closest('.cal-pop-x')) closePop(); const c = e.target.closest('[data-occ]'); if (c) showOcc(c.dataset.occ, c); });
    document.addEventListener('click', e => { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('[data-occ],[data-more]')) closePop(); });
    addEventListener('resize', closePop);
    /* ---------- Full screen ---------- */
    // Focus mode (html.cal-focus) hides the site chrome and lets the grid fill the window; it survives reloads via ?full=1.
    // Browser full screen needs a click or key press, so it is requested only from one; arriving at ?full=1 gets focus mode,
    // and the next F (or the button) widens it to the whole screen.
    const fullBtn = $('#cal-full'), canNative = !!document.fullscreenEnabled;
    let native = false, tried = false;                                    // holding browser full screen; asked for it this session
    const chrome = () => document.documentElement.style.setProperty('--cal-chrome', `${Math.ceil($('#cal-bar').offsetHeight + 40)}px`);
    function setFull(on, gesture = false) {
      state.full = on;
      document.documentElement.classList.toggle('cal-focus', on);
      fullBtn.setAttribute('aria-pressed', String(on));
      fullBtn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
      fullBtn.title = on ? 'Exit full screen (F or Esc)' : 'Full screen (F)';
      $('.fs-label', fullBtn).textContent = on ? 'Exit' : 'Full screen';
      if (on && gesture && canNative && !document.fullscreenElement) { tried = true; document.documentElement.requestFullscreen().then(() => { native = true; }, () => {}); }
      if (!on) { tried = false; if (document.fullscreenElement) { native = false; document.exitFullscreen().catch(() => {}); } }
      closePop(); chrome(); sync();
      if (on) scrollTo({ top: 0 });
    }
    // F: enter; in focus mode without browser full screen, go whole-screen; otherwise leave.
    const toggleFull = () => {
      if (!state.full) setFull(true, true);
      else if (canNative && !document.fullscreenElement && !tried) setFull(true, true);
      else setFull(false);
    };
    document.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement) { chrome(); return; }
      if (native) { native = false; setFull(false); }                       // Esc out of browser full screen leaves focus mode too
    });
    fullBtn.addEventListener('click', () => (state.full ? setFull(false) : setFull(true, true)));
    addEventListener('resize', () => { if (state.full) chrome(); });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !pop.hidden) { closePop(); return; }
      if (e.key === 'Escape' && state.full && !document.fullscreenElement && !e.target.closest('input,textarea,select')) { setFull(false); return; }
      if (e.target.closest('input,textarea,select,[contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'f') { if (!e.repeat) toggleFull(); e.preventDefault(); return; }
      if (e.key === 'ArrowLeft') go(() => step(-1)); else if (e.key === 'ArrowRight') go(() => step(1));
      else if (k === 't') go(() => { state.date = C.atMidnight(new Date()); });
      else if (k === 'w' || k === 'm' || k === 'y') go(() => { state.view = { w: 'week', m: 'month', y: 'year' }[k]; });
      else return;
      e.preventDefault();
    });

    /* ---------- Controls ---------- */
    grid.addEventListener('click', e => {
      const c = e.target.closest('[data-occ]'); if (c) { showOcc(c.dataset.occ, c); return; }
      const more = e.target.closest('[data-more]'); if (more) { showDay(more.dataset.more, more); return; }
      const d = e.target.closest('[data-goto]'); if (d) { go(() => { state.date = C.parse(d.dataset.goto); state.view = 'week'; }); return; }
      const mo = e.target.closest('[data-month]'); if (mo) go(() => { state.date = new Date(state.date.getFullYear(), Number(mo.dataset.month), 1); state.view = 'month'; });
    });
    $('#cal-prev').addEventListener('click', () => go(() => step(-1)));
    $('#cal-next').addEventListener('click', () => go(() => step(1)));
    $('#cal-today').addEventListener('click', () => go(() => { state.date = C.atMidnight(new Date()); }));
    $('#cal-views').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b && b.dataset.view !== state.view) go(() => { state.view = b.dataset.view; }); });
    $('#cal-legend').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      go(() => {
        if (b.dataset.all !== undefined) { present.forEach(t => state.types.add(t)); return; }
        const t = b.dataset.type;
        if (state.types.has(t)) { if (state.types.size > 1) state.types.delete(t); } else state.types.add(t);
      });
    });
    $('#cal-q').addEventListener('input', e => { state.q = e.target.value; go(() => {}, false); });
    const bar = $('#cal-bar');
    const keepTop = () => { const top = bar.offsetTop; if (scrollY > top + 40) scrollTo({ top }); };
    [$('#cal-prev'), $('#cal-next'), $('#cal-today'), $('#cal-views')].forEach(el => el.addEventListener('click', keepTop));
    stats(); draw();
    if (state.full) setFull(true);
    // In the week view, scroll the first entry (or the working day) into view inside the grid.
    const firstChip = $('.cal-day .cal-ev', grid);
    if (firstChip && state.view === 'week') firstChip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /* ================= Entry page ================= */
  function eventPage() {
    const slug = body.dataset.slug, e = EVENTS.find(x => x.slug === slug);
    const fig = $('[data-cover]'); if (fig) render(fig, M.cover(slug, HUE[fig.dataset.type]));
    if (!e) return;
    const now = new Date();
    if (e.repeat) {
      const next = C.upcoming([e], now, 3);
      const box = $('#ev-next');
      if (next.length && box) { render($('ol', box), next.map(o => `<li><span>${esc(C.DAYS[C.dow(o.start)])}, ${esc(C.dateLabel(o.start, false))}${o.allDay ? '' : ` · ${esc(timeSpan(o))}`}</span><span>${esc(C.relative(o.start, now))}</span></li>`).join('')); box.hidden = false; }
      else if (box) { render($('ol', box), '<li><span>No further occurrences</span></li>'); box.hidden = false; }
    } else {
      const o = C.expand([e], new Date(1970, 0, 1), new Date(2100, 0, 1))[0], k = $('#ev-status');
      if (o && k) k.textContent = o.endExclusive < now ? 'When · past' : o.start <= now ? 'Happening now' : `When · ${C.relative(o.start, now)}`;
    }
  }

  if (body.dataset.page === 'calendar') calendarPage();
  if (body.dataset.page === 'event') eventPage();
})();
