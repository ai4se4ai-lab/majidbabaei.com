# Calendar & commitments: design

Date: 2026-11-16. Site: majidbabaei.com (personal site). Status: implemented in the same session; written for the record.

## Goal

A "Calendar" tab in the top navigation that shows the author's obligations (teaching, research blocks, events and talks, service, deadlines, travel, blocked time) in **week, month, and year** views, with blocked time drawn on the grid and details on click. Every entry can have its own detail page, written in Markdown, lighter than a news article but rendered with the same typography.

## Non-goals

- No editing in the browser. Entries are Markdown files committed to the repository, like news posts.
- No external calendar service. An iCalendar feed is generated so visitors (and the author) can subscribe from any calendar app.
- No time-zone conversion in the browser. Times are shown as written (Pacific time); the `.ics` files carry `TZID=America/Vancouver`.

## Approaches considered

1. **Markdown entries + build-time pages + client-side views** (chosen). Matches the newsroom and project pipelines: facts live in files, pages are static and crawlable, the interactive grid is progressive enhancement over a generated data file.
2. Embed a hosted calendar (Google Calendar iframe). Rejected: cannot match the site's design or motion, leaks the author's account structure, no Markdown detail pages.
3. A single JSON file for all events with no detail pages. Rejected: the user asked for a detail page per event with Markdown content.

## Data

`calendar/events/<YYYY-MM-DD>-<slug>.md` (files starting with `_` are ignored, so `_template.md` can live beside them):

```markdown
---
title: COMP 370 Software Engineering
type: teaching            # teaching | research | event | service | deadline | travel | block
start: 2026-09-08T10:00   # YYYY-MM-DD (all day) or YYYY-MM-DDTHH:MM, local time
end: 2026-09-08T11:20     # optional; same forms; an all-day range uses an inclusive end date
repeat: weekly            # optional; needs `until`; `days` defaults to the start weekday
days: [Mon, Wed]
interval: 1               # optional: every N weeks
until: 2026-12-04
except: [2026-10-12, 2026-11-11]
location: UFV Abbotsford, D221
link: https://…
project: rapidpay         # optional, links to projects/<slug>/
tags: [COMP 370, UFV]
summary: One sentence for the grid popover, the agenda and the page lede.
status: confirmed         # or tentative
---
Markdown body: headings, lists, links, images, tables.
```

The slug is the filename without the date prefix. `start` is authoritative; the filename prefix only orders the folder.

## Build (`tools/build-calendar.mjs`)

Reads the entries, validates them (required fields, date forms, `end` after `start`, `until` with `repeat`, known `type`, known `days`), renders the body with the shared sanitizing Markdown renderer, and writes:

- `assets/calendar-data.js`: `window.CALENDAR = { timezone, generated, events: [...] }` (rules, not expanded occurrences).
- `calendar/<slug>/index.html`: the detail page (static body, details rail, previous/next entries).
- `calendar/<slug>/event.ics` and `calendar/feed.ics`: iCalendar with `RRULE`/`EXDATE` for repeating entries.

`--check` fails when outputs are stale, like the other builders. `tools/build-news.mjs` adds the calendar pages to `sitemap.xml` by reading the generated data file, so the calendar builder runs first in the sync script and the workflow.

## Client (`assets/calendar-core.js`, `assets/calendar.js`, `assets/calendar.css`)

`calendar-core.js` is a dependency-free script usable in the browser and under Node (tests): date keys, week math, recurrence expansion into a date range, overlap layout for the week grid, and human descriptions of repeat rules.

`calendar.js` drives `calendar/index.html`:

- Sticky toolbar: previous / today / next, the period title, a segmented **Week / Month / Year** control (motion.js moves the spring thumb), type filter chips (legend doubles as filter), and a search box.
- **Week**: Monday-first time grid with an all-day row, hour rules from the earliest to the latest entry (at least 08:00 to 18:00), overlapping entries share the column, a red "now" line in the current week, today's column tinted.
- **Month**: six-row grid, up to three chips per day and a "+N more" that opens a day popover; other-month days dimmed; the day number opens that week.
- **Year**: twelve mini months, each day shows up to three type-coloured dots; a day opens its week, a month name opens that month; monthly counts in the headers.
- "Up next" rail: the next eight occurrences from today, with relative dates.
- Popover on any entry: type, when, where, status, summary, "Open details" and "Add to calendar (.ics)". Escape and outside click close it; focus returns to the opener.
- URL state: `?view=month&date=2026-11-16&types=teaching,research&q=…` (replaceState), so a view can be shared.
- Keyboard: ← → move, T today, W / M / Y switch views (ignored while typing).
- View and period changes go through `Motion.swap` so the grid glides like the other pages; masthead words rise on load; reduced motion is respected; print hides chrome.

The detail page uses `data-page="event"`: `calendar.js` fills the generated statechart cover (type hue), lists the next three occurrences of a repeating entry, and marks the page's entry as "today" or "past".

## Types and colours

teaching = teal, research = navy, event = orange (site accents); service = plum, deadline = rose, travel = muted, block = ink hatch. The two new tokens are defined in `calendar.css` for light and dark themes.

## Seeds

Only facts already on the site are seeded: Tech Panel 2026 (March 12, 2026), ICSE 2026 (April 2026; the exact days are marked tentative), the Fall 2026 teaching term (marked tentative; no class times are asserted). A `_template.md` documents every field. The author adds real class times and research blocks.

## Integration

- Navigation: `Calendar` after `Projects` in `tools/chrome.mjs` and the three hand-written pages; footer gains a Calendar link.
- Public build copies `calendar/` and `.ics` files; the artifact check requires `calendar/index.html`.
- Tests: `tools/calendar.test.mjs` (recurrence, overlap layout, build output, link validity, ICS escaping). `npm test` runs every test file in `tools/`.
- Lab repo: `scripts/sync-personal-site.mjs` runs and checks the calendar builder; `CHANGELOG.md` and `AGENTS.md` record the workflow.
