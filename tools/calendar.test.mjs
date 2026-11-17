import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arr = a => Array.from(a);   // arrays made inside the sandbox belong to another realm; copy them before deepEqual
const load = async file => { const ctx = { window: {} }; vm.runInNewContext(await readFile(resolve(root, file), 'utf8'), ctx); return ctx; };
const C = (await load('assets/calendar-core.js')).window.CalendarCore;   // the core attaches to `window` when one exists
const D = (await load('assets/calendar-data.js')).window.CALENDAR;

test('weekly recurrence honours the start date, selected weekdays, interval, exceptions and the until date', () => {
  const ev = C.normalize({ slug: 'c', title: 'Class', start: '2026-09-08T10:00', end: '2026-09-08T11:20', repeat: 'weekly', days: ['Mon', 'Wed'], until: '2026-09-30', except: ['2026-09-14'] });
  const keys = arr(C.expand([ev], new Date(2026, 8, 1), new Date(2026, 9, 1)).map(o => o.key));
  assert.deepEqual(keys, ['2026-09-09', '2026-09-16', '2026-09-21', '2026-09-23', '2026-09-28', '2026-09-30']); // Sep 7 precedes the start, Sep 14 is skipped
  const bi = C.normalize({ slug: 'b', title: 'Biweekly', start: '2026-09-07T09:00', repeat: 'weekly', interval: 2, until: '2026-10-31' });
  assert.deepEqual(arr(C.expand([bi], new Date(2026, 8, 1), new Date(2026, 10, 1)).map(o => o.key)), ['2026-09-07', '2026-09-21', '2026-10-05', '2026-10-19']);
  assert.equal(C.describeRule(ev), 'Every Monday & Wednesday, 10am–11:20am · Sep 8 – 30, 2026 · 1 exception');
  // A window that starts mid-series still finds the occurrences inside it.
  assert.deepEqual(arr(C.expand([ev], new Date(2026, 8, 22), new Date(2026, 8, 29)).map(o => o.key)), ['2026-09-23', '2026-09-28']);
});

test('all-day spans use an inclusive end date and timed entries default to one hour', () => {
  const span = C.normalize({ slug: 's', title: 'Conference', start: '2026-04-12', end: '2026-04-18' });
  const [o] = C.expand([span], new Date(2026, 3, 1), new Date(2026, 4, 1));
  assert.equal(C.when(o), 'All day · Apr 12 – 18, 2026');
  assert.equal(o.multi, true);
  assert.equal(C.key(o.endExclusive), '2026-04-19');
  const [t] = C.expand([C.normalize({ slug: 't', title: 'Talk', start: '2026-11-16T14:30' })], new Date(2026, 10, 16), new Date(2026, 10, 17));
  assert.equal(C.when(t), 'Mon, Nov 16, 2026 · 2:30pm–3:30pm');
  assert.equal(C.parse('2026-02-30'), null);
  assert.equal(C.parse('2026-02-10T24:00'), null);
});

test('overlapping entries in a day share the column; separate clusters keep full width', () => {
  const day = new Date(2026, 10, 16);
  const mk = (slug, start, end) => C.normalize({ slug, title: slug, start, end });
  const items = C.expand([mk('a', '2026-11-16T09:00', '2026-11-16T10:30'), mk('b', '2026-11-16T10:00', '2026-11-16T11:00'), mk('c', '2026-11-16T13:00', '2026-11-16T14:00')], day, C.addDays(day, 1));
  const laid = Object.fromEntries(C.layoutDay(items, day).map(l => [l.occ.event.slug, l]));
  assert.deepEqual([laid.a.col, laid.a.cols, laid.b.col, laid.b.cols, laid.c.col, laid.c.cols], [0, 2, 1, 2, 0, 1]);
  assert.equal(laid.a.top, 540); assert.equal(laid.a.height, 90);
});

test('the generated data file carries every entry with a page, a type, and a valid start', async () => {
  const files = (await readdir(resolve(root, 'calendar/events'))).filter(f => f.endsWith('.md') && !f.startsWith('_'));
  assert.equal(D.events.length, files.length);
  for (const e of D.events) {
    assert.ok(D.types[e.type], `${e.slug}: unknown type ${e.type}`);
    assert.ok(C.parse(e.start), `${e.slug}: bad start`);
    assert.ok(existsSync(resolve(root, 'calendar', e.slug, 'index.html')), `${e.slug}: missing page`);
    assert.ok(existsSync(resolve(root, 'calendar', e.slug, 'event.ics')), `${e.slug}: missing .ics`);
  }
  assert.equal(D.timezone, 'America/Vancouver');
});

test('every entry page is static, links to its .ics, and references only files that exist', async () => {
  for (const e of D.events) {
    const pagePath = resolve(root, 'calendar', e.slug, 'index.html');
    const html = await readFile(pagePath, 'utf8');
    assert.match(html, /<article class="prose ev-prose"/);
    assert.ok(html.includes(`<link rel="canonical" href="https://majidbabaei.com/calendar/${e.slug}/">`));
    assert.ok(html.includes('href="event.ics"'));
    assert.doesNotMatch(html, /undefined|NaN/, `${e.slug}: a date failed to render`);
    assert.ok(html.includes('aria-current="page">Calendar</a>'), `${e.slug}: Calendar is not the current nav item`);
    assert.doesNotMatch(html, /<script src="https:\/\/cdn/);
    for (const [, ref] of html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)) {
      if (/^(https?:|mailto:|data:)/.test(ref)) continue;
      const localPath = ref.split(/[?#]/)[0];
      const target = resolve(localPath.startsWith('/') ? root : dirname(pagePath), '.' + (localPath.startsWith('/') ? localPath : '/' + localPath));
      assert.ok(existsSync(decodeURIComponent(target)), `${e.slug}: missing ${ref}`);
    }
  }
});

test('the iCalendar feed is well formed: CRLF, escaped text, date values, and a repeat rule per repeating entry', async () => {
  const ics = await readFile(resolve(root, 'calendar/feed.ics'), 'utf8');
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, D.events.length);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, `line too long: ${line}`);
  for (const e of D.events) {
    assert.ok(ics.includes(`UID:${e.slug}@majidbabaei.com`));
    if (e.allDay) assert.ok(ics.includes(`DTSTART;VALUE=DATE:${e.start.replace(/-/g, '')}`));
    else assert.ok(ics.includes(`DTSTART;TZID=America/Vancouver:${e.start.replace(/[-:]/g, '')}00`));
    if (e.repeat) assert.match(ics, new RegExp(`UID:${e.slug}@[\\s\\S]*?RRULE:FREQ=WEEKLY;INTERVAL=\\d+;BYDAY=`));
  }
  // Commas and semicolons inside text values must be escaped (folded continuation lines start with a space).
  const unfolded = ics.replace(/\r\n /g, '');
  for (const line of unfolded.split('\r\n').filter(l => /^(SUMMARY|LOCATION|DESCRIPTION):/.test(l))) assert.doesNotMatch(line.slice(line.indexOf(':') + 1), /(^|[^\\])[,;]/, `unescaped text in ${line}`);
});

test('the calendar page and the shared chrome link to each other', async () => {
  const page = await readFile(resolve(root, 'calendar/index.html'), 'utf8');
  assert.ok(page.includes('aria-current="page">Calendar</a>'));
  assert.ok(page.includes('href="feed.ics"'));
  for (const file of ['index.html', 'news/index.html', 'projects/index.html']) {
    const html = await readFile(resolve(root, file), 'utf8');
    assert.ok(/href="(?:\.\.\/)?calendar\/">Calendar<\/a>/.test(html), `${file}: no Calendar link in the navigation`);
  }
  const sitemap = await readFile(resolve(root, 'sitemap.xml'), 'utf8');
  assert.ok(sitemap.includes('https://majidbabaei.com/calendar/</loc>'));
  for (const e of D.events) assert.ok(sitemap.includes(`https://majidbabaei.com/calendar/${e.slug}/</loc>`));
});
