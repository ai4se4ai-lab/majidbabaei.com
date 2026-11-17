'use strict';
// Calendar core: dates, recurrence and week-grid layout. Dependency-free; loaded by the browser (window.CalendarCore)
// and by the build/tests under Node (globalThis.CalendarCore via vm). Times are "floating" local times, as written
// in calendar/events/*.md; nothing here converts time zones.
(function (root) {
  const pad = n => String(n).padStart(2, '0');
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];          // Monday-first week
  const DAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  /* ---------- Parsing and keys ---------- */
  // "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" -> local Date, or null when malformed.
  function parse(s) {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/);
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, 0, 0);
    if (d.getFullYear() !== +m[1] || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3]) return null;
    if (m[4] && (+m[4] > 23 || +m[5] > 59)) return null;
    return d;
  }
  const isAllDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const atMidnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
  const dow = d => (d.getDay() + 6) % 7;                                   // 0 = Monday
  const startOfWeek = d => addDays(atMidnight(d), -dow(d));
  const minutes = d => d.getHours() * 60 + d.getMinutes();
  const daysBetween = (a, b) => Math.round((atMidnight(b) - atMidnight(a)) / 864e5);

  /* ---------- Formatting ---------- */
  const time = d => { const h = d.getHours(), m = d.getMinutes(); return `${h % 12 || 12}${m ? ':' + pad(m) : ''}${h < 12 ? 'am' : 'pm'}`; };
  const time24 = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const dateLabel = (d, year = true) => `${MONTHS[d.getMonth()]} ${d.getDate()}${year ? `, ${d.getFullYear()}` : ''}`;
  const longDate = d => `${DAY_LONG[dow(d)]}, ${MONTH_LONG[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  // "Mar 12, 2026" / "Mar 12 – 14, 2026" / "Sep 28 – Oct 2, 2026" / "Dec 30, 2026 – Jan 2, 2027"
  function rangeLabel(a, b) {
    if (!b || key(a) === key(b)) return dateLabel(a);
    if (a.getFullYear() !== b.getFullYear()) return `${dateLabel(a)} – ${dateLabel(b)}`;
    if (a.getMonth() !== b.getMonth()) return `${dateLabel(a, false)} – ${dateLabel(b)}`;
    return `${MONTHS[a.getMonth()]} ${a.getDate()} – ${b.getDate()}, ${a.getFullYear()}`;
  }
  // When an occurrence happens, in words: "Thu, Mar 12, 2026 · 2:30–4pm" or "All day · Mar 12 – 14, 2026".
  function when(o) {
    if (o.allDay) return `All day · ${rangeLabel(o.start, o.end)}`;
    const same = key(o.start) === key(o.end);
    return `${DAYS[dow(o.start)]}, ${dateLabel(o.start)} · ${time(o.start)}–${same ? '' : DAYS[dow(o.end)] + ' '}${time(o.end)}`;
  }
  const relative = (d, now) => {
    const n = daysBetween(now, d);
    if (n === 0) return 'Today'; if (n === 1) return 'Tomorrow'; if (n === -1) return 'Yesterday';
    if (n > 1 && n < 7) return DAY_LONG[dow(d)];
    if (n >= 7 && n < 14) return 'Next week';
    return n < 0 ? `${-n} days ago` : `In ${n} days`;
  };
  // "Every Monday & Wednesday, 10–11:20am · Sep 8 – Dec 4, 2026" (null for one-off entries).
  function describeRule(ev) {
    if (!ev.repeat) return null;
    const days = (ev.days && ev.days.length ? ev.days : [DAYS[dow(parse(ev.start))]]).map(d => DAY_LONG[DAYS.indexOf(d)]);
    const list = days.length === 1 ? days[0] : days.length === 7 ? 'day' : days.slice(0, -1).join(', ') + ' & ' + days[days.length - 1];
    const every = ev.interval > 1 ? `Every ${ev.interval} weeks on ${list}` : `Every ${list}`;
    const s = parse(ev.start), e = ev.end ? parse(ev.end) : null, u = parse(ev.until);
    const t = isAllDay(ev.start) ? '' : `, ${time(s)}–${time(e || new Date(s.getTime() + 3600000))}`;
    return `${every}${t} · ${rangeLabel(s, u)}${ev.except && ev.except.length ? ` · ${ev.except.length} exception${ev.except.length > 1 ? 's' : ''}` : ''}`;
  }

  /* ---------- Normalising an entry ---------- */
  // Fill derived fields once (allDay, days, interval, duration) so the views can rely on them.
  function normalize(ev) {
    const allDay = isAllDay(ev.start);
    const start = parse(ev.start);
    let end = ev.end ? parse(ev.end) : null;
    if (!end) end = allDay ? start : new Date(start.getTime() + 60 * 60000);
    if (allDay) end = addDays(atMidnight(end), 1);                          // exclusive end for all-day spans
    const days = ev.repeat ? (ev.days && ev.days.length ? ev.days : [DAYS[dow(start)]]) : [];
    return { ...ev, allDay, days, interval: Math.max(1, Number(ev.interval) || 1), except: ev.except || [],
      _start: start, _end: end, _until: ev.until ? addDays(atMidnight(parse(ev.until)), 1) : null, _dur: end - start };
  }

  /* ---------- Recurrence: every occurrence of each entry that touches [from, to) ---------- */
  function expand(events, from, to) {
    const out = [];
    const push = (ev, start) => {
      const end = new Date(start.getTime() + ev._dur);
      if (end <= from || start >= to) return;
      const last = ev.allDay ? addDays(end, -1) : end;                     // inclusive end for display
      out.push({ event: ev, start, end: last, endExclusive: end, allDay: ev.allDay, key: key(start),
        id: `${ev.slug}@${key(start)}`, multi: ev.allDay ? daysBetween(start, last) > 0 : key(start) !== key(end) });
    };
    for (const raw of events) {
      const ev = '_dur' in raw ? raw : normalize(raw);
      if (!ev.repeat) { push(ev, ev._start); continue; }
      const limit = ev._until && ev._until < to ? ev._until : to;
      const week0 = startOfWeek(ev._start);
      const skip = new Set(ev.except);
      // Walk week by week from the first week, honouring the interval, and emit the selected weekdays.
      for (let w = week0, n = 0; w < limit; w = addDays(w, 7), n++) {
        if (n % ev.interval) continue;
        if (addDays(w, 7).getTime() + ev._dur <= from.getTime()) continue;   // the whole week ends before the window
        for (const d of ev.days) {
          const day = addDays(w, DAYS.indexOf(d));
          const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), ev._start.getHours(), ev._start.getMinutes());
          if (start < ev._start || start >= limit || skip.has(key(start))) continue;
          push(ev, start);
        }
      }
    }
    return out.sort((a, b) => a.start - b.start || b.endExclusive - a.endExclusive || a.event.title.localeCompare(b.event.title));
  }
  // The next `n` occurrences still running at or after `now`, across all entries (looks ahead `horizonDays`).
  function upcoming(events, now, n = 8, horizonDays = 400) {
    const from = atMidnight(now), to = addDays(from, horizonDays);
    return expand(events, from, to).filter(o => o.endExclusive > now).slice(0, n);
  }

  /* ---------- Week grid: timed occurrences of one day share the column when they overlap ---------- */
  // Returns [{occ, col, cols, top, height}] in minutes from midnight; a cluster of overlapping items gets equal columns.
  function layoutDay(items, dayStart) {
    const timed = items.filter(o => !o.allDay).map(o => {
      const top = Math.max(0, (o.start - dayStart) / 60000), bottom = Math.min(1440, (o.endExclusive - dayStart) / 60000);
      return { occ: o, top, height: Math.max(22, bottom - top), bottom: Math.max(bottom, top + 22), col: 0, cols: 1 };
    }).sort((a, b) => a.top - b.top || b.bottom - a.bottom);
    let cluster = [], clusterEnd = -1;
    const flush = () => {
      const ends = [];                                                     // greedy column assignment inside the cluster
      for (const it of cluster) {
        let c = ends.findIndex(e => e <= it.top);
        if (c < 0) { c = ends.length; ends.push(0); }
        ends[c] = it.bottom; it.col = c;
      }
      cluster.forEach(it => { it.cols = ends.length; });
      cluster = [];
    };
    for (const it of timed) {
      if (cluster.length && it.top >= clusterEnd) flush();
      cluster.push(it); clusterEnd = Math.max(clusterEnd, it.bottom);
    }
    if (cluster.length) flush();
    return timed;
  }

  root.CalendarCore = { DAYS, DAY_LONG, MONTHS, MONTH_LONG, parse, isAllDay, key, atMidnight, addDays, addMonths, dow, startOfWeek, minutes, daysBetween,
    time, time24, dateLabel, longDate, rangeLabel, when, relative, describeRule, normalize, expand, upcoming, layoutDay };
})(typeof window !== 'undefined' ? window : globalThis);
