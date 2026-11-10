# majidbabaei.com

Personal academic website of Majid Babaei. It is a dependency-free static site served by GitHub Pages, with the custom domain set in `CNAME`.

## Keep in sync

Three things stay consistent:

1. **CV**: `docs/02_Curriculum_Vitae.tex` in [ai4se4ai-lab.github.io](https://github.com/ai4se4ai-lab/ai4se4ai-lab.github.io), the source of academic facts.
2. **Lab site**: [ai4se4ai-lab.github.io](https://ai4se4ai-lab.github.io/).
3. **This site**: [ai4se4ai-lab/majidbabaei.com](https://github.com/ai4se4ai-lab/majidbabaei.com).

This repository is cloned as `majidbabaei.com/` inside the lab-site working copy, which ignores it. Run these from the lab-site root:

```sh
node scripts/sync-personal-site.mjs           # regenerate CV data and PDF, then rebuild project pages and the newsroom
node scripts/sync-personal-site.mjs --check   # fail if anything here has drifted
node scripts/push-all.mjs                     # push both repositories after committing in each
```

## Post a news item (the Medium-style newsroom)

1. Add `news/posts/YYYY-MM-DD-short-slug.md`. The date may also be `YYYY-MM` or `YYYY`; the slug becomes the URL `news/short-slug/`.

   ```markdown
   ---
   title: Our paper was accepted at Venue 2027
   subtitle: One sentence under the headline.
   date: 2027-02-14
   tags: [Publications, Agentic AI]
   summary: One or two sentences for the homepage panel, feed, RSS, and link previews.
   featured: false          # optional; true pins it as the newsroom's featured story
   cover: /assets/img/...   # optional image; otherwise a generated statechart-style cover is used
   ---

   Body in Markdown: headings, lists, links, images (`![caption](/assets/img/x.webp)`), tables, quotes.
   ```

2. Run `node tools/build-news.mjs` (or the lab sync). This updates the homepage newsroom panel, `news/` (the feed), `news/<slug>/` (the article page with share previews), `news/feed.xml` (RSS), and `sitemap.xml`.

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

## Where content lives

| Content | File |
| --- | --- |
| Publications, manuscripts, artifacts, CV hash | `assets/research-data.js`, **generated** from the CV; do not edit |
| Project releases, gallery, team | `projects/<slug>/project.json`, edited by hand |
| News posts | `news/posts/*.md`, edited by hand |
| Project pages, newsroom pages, RSS, sitemap, `assets/projects-data.js`, `assets/news-data.js` | **generated** by `tools/` |
| Bio, research agenda, teaching, students, service, background, contact | `index.html`, edited by hand from the CV |
| Styles / behavior | `assets/style.css`, `news.css`, `projects.css` / `site.js`, `news.js`, `projects.js` |

Preview locally from this folder with `node ../scripts/serve.mjs`, then open http://localhost:8000.
