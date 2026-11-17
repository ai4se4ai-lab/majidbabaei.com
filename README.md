# majidbabaei.com

Personal academic website of Majid Babaei. It is a static site served by GitHub Pages.

## Keep in sync

Three things stay consistent:

1. **CV**: `docs/02_Curriculum_Vitae.tex` in [ai4se4ai-lab.github.io](https://github.com/ai4se4ai-lab/ai4se4ai-lab.github.io), the source of academic facts.
2. **Lab site**: [ai4se4ai-lab.github.io](https://ai4se4ai-lab.github.io/).
3. **This site**: [ai4se4ai-lab/majidbabaei.com](https://github.com/ai4se4ai-lab/majidbabaei.com).

This repository is cloned as `majidbabaei.com/` inside the lab-site working copy, which ignores it. Run these from the lab-site root:

```sh
node scripts/sync-personal-site.mjs           # regenerate CV data and PDF, then rebuild project pages, the calendar, and the newsroom
node scripts/sync-personal-site.mjs --check   # fail if anything here has drifted
node scripts/push-all.mjs                     # push both repositories after committing in each
```

## Post a news item (the Medium-style newsroom)

Install build dependencies once with `npm ci` from this repository. Articles are rendered from Markdown into complete HTML **at build time**, so they are readable without JavaScript and social crawlers can read the article and preview metadata. The deployed site needs no Node server or Markdown CDN. Do not edit generated article HTML.

1. Add `news/posts/YYYY-MM-DD-short-slug.md`. The date may also be `YYYY-MM` or `YYYY`; the slug becomes the URL `news/short-slug/`.

   ```markdown
   ---
   title: Our paper was accepted at Venue 2027
   subtitle: One sentence under the headline.
   date: 2027-02-14
   tags: [Publications, Agentic AI]
   summary: One or two sentences for the homepage panel, feed, RSS, and link previews.
   featured: false          # optional; true pins it as the newsroom's featured story
   cover: /assets/img/news/example.png
   coverAlt: A short accessible description of the top figure.
   coverCaption: Optional caption shown below the top figure.
   # socialImage: /assets/img/news/example-share.png
   ---

   Body in Markdown: headings, lists, links, images (`![caption](/assets/img/x.webp)`), tables, quotes.
   ```

2. Run `node tools/build-news.mjs` (or the lab sync). This updates the homepage newsroom panel, `news/` (the feed), `news/<slug>/` (the article page with share previews), `news/feed.xml` (RSS), and `sitemap.xml`.

To revise an existing article, edit its file in `news/posts/`, then run `npm run build:news`. Commit the Markdown, any images, and generated outputs together. `npm run check:news` detects stale pages; `npm test` checks rendering, safe markup, local article links, and RapidPay's share image.

The `cover` is the article's top figure and its default sharing thumbnail. When `cover` is omitted, the first Markdown image becomes the top figure (shown once); articles without an image retain the decorative cover and portrait preview. Set `socialImage` to a PNG/JPEG export when the top figure is SVG or needs a separate social-sized version. Use site-root paths such as `/assets/img/news/example.png`. LinkedIn needs an accessible PNG/JPEG/GIF of at least 1200 by 627 pixels, under 5 MB, ideally at a 1.91:1 ratio ([LinkedIn's requirements](https://www.linkedin.com/help/linkedin/answer/a521928)).

After deployment, use the article's **Share on LinkedIn** button or paste its canonical URL into a LinkedIn post. Open Graph tags are present in the initial HTML and use the top figure, title, and summary. For an old cached preview, inspect the deployed URL in [LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/). LinkedIn fetches the public deployed files; local edits cannot change its preview until deployed. This opens the share composer and leaves posting to you.

Only publish facts that are in the CV or that you have confirmed. Keep "submitted", "accepted", and "published" distinct.

## Record project progress (GitHub-style releases + Pinterest-style gallery)

Each project page `projects/<slug>/` is built from `projects/<slug>/project.json`:

```json
{
  "team": [],
  "links": [{ "label": "Project slides", "url": "https://…", "type": "talk" }],
  "releases": [
    { "tag": "v1.1-poster", "date": "2027-03-02", "type": "poster", "title": "Poster at Venue 2027",
      "notes": "Markdown release notes…",
      "links": [{ "label": "Poster (PDF)", "url": "data/posters/x.pdf", "type": "poster" }] }
  ],
  "gallery": [
    { "src": "assets/img/gallery/x.webp", "caption": "Presenting at Venue 2027", "date": "2027-03-02", "w": 1100, "h": 825 }
  ]
}
```

- **Release types:** `paper`, `poster`, `code`, `thesis`, `talk`, `report`, `dataset`, `milestone`. A release's `label` field (for example `"Fall 2023"`) overrides the displayed date, and releases sort newest first.
- **Gallery:** put photos in `assets/img/gallery/`; around 1100 px wide WebP files work well. `w` and `h` are optional but prevent layout shift. Every photo also appears on the **Memories** wall at `projects/#memories`.
- **README:** `projects/<slug>/README.md` is optional and adds a README panel to the Overview tab.
- **Generated, not edited:** name, description, status, repository, linked publications (with abstracts and BibTeX), contributors, and the progress stage (Idea → Prototype → Submitted → Accepted → Published) all come from the CV data.
- **New projects:** a new project in the CV data gets a scaffolded `project.json` automatically on the next build. A local-only project, such as a student capstone, is a folder whose `project.json` contains a `meta` block (see `projects/dapper/`).

Then run `node tools/build-projects.mjs` (or the lab sync).

## Keep the calendar (commitments by week, month, and year)

The **Calendar** tab shows teaching, research blocks, events and talks, service, deadlines, travel, and blocked time on a week grid, a month grid, and a year overview, with an "Up next" rail, type filters, search, keyboard shortcuts (arrows, T, W, M, Y), and an iCalendar feed (`calendar/feed.ics`) that any calendar app can subscribe to. Every entry has its own page at `calendar/<slug>/` with a Markdown body, a details rail, and an `event.ics` download. Nothing is edited in the browser: entries are files.

1. Copy `calendar/events/_template.md` to `calendar/events/YYYY-MM-DD-short-slug.md` (files starting with `_` are ignored; the slug becomes the URL).

   ```markdown
   ---
   title: COMP 370 Software Engineering
   type: teaching              # teaching | research | event | service | deadline | travel | block
   start: 2027-01-11T10:00     # YYYY-MM-DD (all day) or YYYY-MM-DDTHH:MM, Pacific time
   end: 2027-01-11T11:20       # optional; all-day ranges use an inclusive end date
   repeat: weekly              # optional; needs until; days defaults to the start weekday
   days: [Mon, Wed]
   until: 2027-04-16
   except: [2027-02-15]        # optional dates to skip
   location: UFV Abbotsford, Building D
   link: https://…
   project: rapidpay           # optional slug under projects/
   tags: [COMP 370, UFV]
   summary: One sentence for the popover, the rail, and the page lede.
   status: confirmed           # or tentative (hatched on the grid)
   ---

   Markdown body for the entry page. Leave it empty for a details-only page.
   ```

2. Run `node tools/build-calendar.mjs` (or the lab sync). This regenerates `assets/calendar-data.js`, `calendar/<slug>/index.html`, `calendar/<slug>/event.ics`, and `calendar/feed.ics`; `tools/build-news.mjs` then lists the entry pages in `sitemap.xml`. `npm run check:calendar` detects stale pages and `npm test` covers recurrence, overlap layout, generated pages, links, and the feed.

Times are written and shown as Pacific time (`America/Vancouver` in the `.ics` files); the browser does not convert them. Entries that are not yet settled should carry `status: tentative`. Do not invent class times or dates: record them when they are confirmed.

## Where content lives

The floating glass header groups navigation into four menus: Research (Agenda, Publications, Projects), Teaching (Teaching, Students), Updates (News, Calendar), and About (Background, Service, Contact). Theme and CV request controls sit beside them. Shared menu markup (labels, one-line descriptions, icons, group tones) lives in `tools/chrome.mjs`; run `node tools/sync-nav.mjs` to copy it into the four hand-maintained index pages (`--check` reports drift; `scripts/sync-personal-site.mjs` runs both), then rebuild generated pages. Menus use native disclosures that open on hover intent on desktop, animate in and out, close on outside clicks and Escape, and collapse behind the menu button on smaller screens. The header responds to scrolling through CSS variables set in `assets/motion.js`: `--hp` (compacts width, height, radius, blur, opacity and shadow), `--prog` (page-progress hairline), `--tilt` (a spring lean from scroll speed, off under reduced motion) and `--mx/--my` (pointer light).

| Content | File |
| --- | --- |
| Publications, manuscripts, artifacts, CV hash | `assets/research-data.js`, **generated** from the CV; do not edit |
| Project releases, gallery, team | `projects/<slug>/project.json`, edited by hand |
| News posts | `news/posts/*.md`, edited by hand |
| Calendar entries | `calendar/events/*.md`, edited by hand (see `_template.md`) |
| Project pages, newsroom pages, calendar pages, RSS, iCalendar feeds, sitemap, `assets/projects-data.js`, `assets/news-data.js`, `assets/calendar-data.js` | **generated** by `tools/` |
| Bio, research agenda, teaching, students, service, background, contact | `index.html`, edited by hand from the CV |
| Styles / behavior | `assets/style.css`, `news.css`, `projects.css`, `calendar.css` / `site.js`, `news.js`, `projects.js`, `calendar.js` (+ `calendar-core.js`, shared with the build and tests) |
| Page transitions, hero entrance, hover layer, theme toggle, phone menu | `assets/motion.css`, `assets/motion.js`, loaded by every page |
| Header and footer of generated pages | `tools/chrome.mjs`; the hand-written pages (`index.html`, `news/index.html`, `projects/index.html`, `calendar/index.html`) carry the same markup, so change them together |

Preview locally from this folder with `node ../scripts/serve.mjs`, then open http://localhost:8000.

## Public deployment and CV requests

CV links open an email-request modal with a blurred backdrop; the mailto fallback works without JavaScript. Run `node tools/build-public.mjs` to prepare `_site/`, which is what GitHub Pages publishes. It excludes CV PDFs, private drafts, project editing sources, and identifying pages for manuscripts under anonymous review, and refuses output containing their names. Keep the local PDF synchronized for private sharing, but do not publish the whole repository as a Pages artifact.
