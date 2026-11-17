---
title: COMP 370 Software Engineering
type: teaching
start: 2027-01-11T10:00
end: 2027-01-11T11:20
repeat: weekly
days: [Mon, Wed]
interval: 1
until: 2027-04-16
except: [2027-02-15]
location: UFV Abbotsford, Building D
link: https://www.ufv.ca/computing/
project: rapidpay
tags: [COMP 370, UFV]
summary: One sentence shown in the calendar popover, the "Up next" rail, and under the page title.
status: confirmed
---

Files that start with `_` are ignored by the build, so this template is never published. Copy it to
`calendar/events/YYYY-MM-DD-short-slug.md`; the slug becomes the URL `calendar/short-slug/`.

## Fields

| Field | Meaning |
| --- | --- |
| `title` | Required. |
| `type` | Required. One of `teaching`, `research`, `event`, `service`, `deadline`, `travel`, `block`. |
| `start` | Required. `YYYY-MM-DD` for an all-day entry, or `YYYY-MM-DDTHH:MM` (24-hour, Pacific time). |
| `end` | Optional. Same form as `start`. All-day ranges use an inclusive end date. A timed entry without `end` lasts one hour. |
| `repeat` | Optional. `weekly`, with `until` (required), `days` (defaults to the start weekday), `interval` (every N weeks), and `except` (dates to skip). |
| `location`, `link`, `project`, `tags`, `summary` | Optional. `project` is a slug under `projects/`. |
| `status` | `confirmed` (default) or `tentative`. Tentative entries are hatched on the grid. |

The body is Markdown and becomes the detail page. Leave it empty for a page that shows only the details rail.
After editing, run `node tools/build-calendar.mjs` (or the lab sync).
