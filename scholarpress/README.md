# ScholarPress

ScholarPress is a private preprint workspace that runs on your own computer at `http://127.0.0.1:8765`. You upload a `.tex` and `.bib` pair, build and check the PDF, review the article page and every affected part of the site, and publish. Each published version stays available at its own permanent URL. Public pages are generated into the existing majidbabaei.com build and deployed by its normal GitHub Pages workflow.

There are no accounts and no internet-facing endpoints. Access to the computer is the owner boundary. Deployment credentials stay with git and never reach the browser or the compiler.

## Set up

```sh
cd majidbabaei.com
npm ci                                   # site build dependencies (once)
cd scholarpress
uv sync                                  # Python 3.11+ dependencies
uv run scholarpress check                # shows the runner, toolchain, CV path and adapter
uv run scholarpress serve                # http://127.0.0.1:8765/
```

To use a configuration file, copy `config.example.toml` to a location outside the repository and set `SCHOLARPRESS_CONFIG` to its path. By default, the private workspace (database, original sources, PDFs, logs and staging releases) is `%LOCALAPPDATA%\ScholarPress`. It is always outside the site checkout.

## Workflow

1. **New article.** Upload the main `.tex` and the `.bib`. You can add PNG, JPEG or PDF figures and needed `.tex`, `.sty`, `.cls` or `.bst` files, each with its path relative to the main file. ZIP import is not supported.
2. **Metadata.** Confirm the title, author order, affiliations, abstract and slug. The slug becomes `/preprints/<slug>/` and is locked after the first publication.
3. **Build.** Choose a profile, then build. You can preview the PDF inline, open it in a new tab, or download it, and the build log can always be downloaded. Diagnostics give the file, line, and citation key or label where TeX reports them.
4. **Website links.** Link the preprint to an existing Publications entry, projects, related stories and homepage sections. Choose a new announcement, a paragraph added to an existing story, or a quiet release. You can also record a confirmed venue status and the CV section.
5. **Publish.** Review the proposed version, links, files and change summary. **Preview the full site** builds the real pages with the candidate. Publish is enabled only for a fresh, unblocked build with confirmed metadata. Approval is bound to a fingerprint of the PDF hash, metadata, links, announcement text and disclosure. Any change after review requires a new approval (HTTP 409).
6. **Revise.** Use **New revision from this version** (or from a draft). It copies the source snapshot, so you only upload the changed files and remove inherited assets explicitly. A failed revision build leaves the current public version untouched.
7. **Venue update.** On the article page, **Update public metadata** records a confirmed DOI, venue or links without creating a new PDF version.

## Build profiles

| Profile | What it compiles |
|---|---|
| **Preserve layout** (default) | The manuscript's own class and preamble, for example `article`, IEEEtran or acmart. |
| **House preprint** | Manuscripts using `\documentclass{scholarpress-preprint}`, or a `preprint.tex` entry point you upload. The class (`scholarpress/tex/scholarpress-preprint.cls`) is `article`-based, with an author/affiliation block, abstract, numbered sections, linked references and an optional notice (`[notice={Preprint. Under review.}]`). It carries no arXiv branding. Other classes are rejected before compiling, with a suggestion to use Preserve layout or upload a house-style adaptation. |

`starter/main.tex` and `starter/references.bib` form a working starter pair for the house profile.

Engines are pdfLaTeX (the default), XeLaTeX and LuaLaTeX. latexmk runs BibTeX or Biber according to the document and repeats passes until references settle. Every attempt runs in a fresh directory with `-norc` (uploaded latexmkrc files are ignored and are not accepted uploads), `-no-shell-escape` and fixed argument lists. Builds run in place, without `-outdir`, because with an output directory MiKTeX's BibTeX can pick up a same-named `.bib` from the TeX tree.

**Blockers:** missing bibliography files, undefined citations or references after convergence, missing figures, classes or packages, fatal TeX errors, timeouts, an output-size limit, and missing or structurally invalid PDFs. **Warnings for review:** overfull boxes, BibTeX warnings, and no bibliography declaration. A PDF with blockers is shown only as a marked partial preview.

### Runners

- **docker** is the isolated runner. It uses `--network none`, `--read-only`, a non-root user, `--cap-drop ALL`, `no-new-privileges`, and caps on memory, CPU and processes. Only the build directory is mounted. Set `compiler = "docker"` and pin `docker_image` by digest (`name@sha256:…`). An image without a digest is refused. Docker was not running on the development machine, so this runner has not been exercised there.
- **local** runs latexmk on this computer, with the same arguments, a timeout, and memory and process caps (a Windows Job Object that also kills the whole process tree on timeout, or rlimits on POSIX). It is **not a sandbox**: there is no network or filesystem isolation, so TeX can read your files. The workspace shows a banner while this runner is active. With MiKTeX, builds pass `--disable-installer`, so missing packages are reported instead of downloaded. Other MiKTeX tools, such as a plain `kpsewhich`, may still auto-install packages if MiKTeX's AutoInstall is on.

## Publishing adapters

- **staging** (the default) copies the site checkout, writes the full public catalog (every published version plus the candidate), runs the site builders, `build-public` and `check-public`, and activates the release atomically by switching a pointer file. It then verifies the result over HTTP at `http://127.0.0.1:8766/`. The real checkout is not modified.
- **production** builds the same release in a temporary git worktree at the checkout's HEAD. HEAD must equal `origin/main`, so a release never pushes unrelated local commits. It runs the site tests, commits only the generated preprint, news, project, asset and sitemap files, and pushes with a fast-forward. GitHub Actions then deploys `_site/` as one artifact. Verification polls `https://majidbabaei.com` for the landing page, the PDF type and hash, the latest alias, earlier versions, and links from every changed page. To enable it, set `adapter = "production"`. Git authentication uses your existing setup.

Failures before activation leave the old release live and free the reserved version number. A failed verification after activation restores the previous staging release; with production, it reports how to proceed. The exposed version number is kept and never reused for different bytes. Retrying with the same idempotency key reuses the reservation. After a crash, unfinished builds are marked interrupted, and unfinished publications are reconciled against the staging pointer or the remote branch.

Hosting notes: GitHub Pages serves PDFs as `application/pdf` and supports byte ranges, but it does not support custom cache headers or redirects. The latest-PDF link (`/preprints/<slug>/paper.pdf`) is therefore a copy of the newest numbered PDF, revalidated under Pages' default 10-minute cache. Numbered paths never change bytes; `tools/build-preprints.mjs --check` fails if they do.

## Website integration

| Surface | Behaviour |
|---|---|
| `/preprints/`, `/preprints/<slug>/`, `/v<N>/`, `paper.pdf`, `citation.bib` | Generated by `tools/build-preprints.mjs` from `preprints/<slug>/preprint.json`. The JSON records are export files, not hand-edited, and are excluded from `_site/`. |
| Homepage publications | A **Read preprint** link appears on the entry whose CV key is selected. Preprints without a public entry appear under a separate Preprints tab and are never counted as published. A **Browse preprints** link sits under the list. `/#pub-<key>` opens and scrolls to the entry. |
| Projects | Each project–article pair adds one release, `preprint-<slug>`, linking the article and every version. Publishing again never duplicates it. |
| Newsroom, homepage panel, RSS | A new story is written to `news/posts/` with `preprint: <slug>` front matter. An update appends a marked block to an existing story without changing its URL or RSS GUID. Revisions are quiet unless you choose a story. |
| Sitemap | Lists the index, each article and each version. |
| CV | ScholarPress produces the exact `\cvpublication{…}` entry and intended subsection, but never edits the CV. Its status reads **applied** only after the maintained `docs/02_Curriculum_Vitae.tex` contains the stable URL (and the DOI, after a venue update). Withheld work produces no CV export. |

Publication groups and counts come from the CV through the lab-site sync. A confirmed venue transition updates the article page and CV handoff immediately; the work moves to the published group after the CV is updated and synced, keeping the same row and its **Read preprint** link.

**Anonymous review:** a draft marked *withheld* can be built and previewed, but nothing about it is exported: no page, PDF, data, feed item, sitemap entry, project or story link, or CV entry. Anonymous Publications entries cannot be selected. Changing a work from withheld to public needs explicit approval. Released versions cannot be withdrawn here.

## Local API

| Handler | Contract |
|---|---|
| `POST /api/articles` | Multipart `tex`, `bib`, `support[]` + `support_paths[]`, optional `slug`. 201 with draft URL; 422 with field errors. |
| `POST /api/articles/{id}/drafts` | Revised files plus `basis_release_id` or `basis_draft_id` and `remove[]`. |
| `PATCH /api/drafts/{id}` | `{rev, metadata?, profile?, links?, announcement?, disclosure?, venue?, cv?, revision_note?}`. 409 on a stale `rev`. |
| `POST /api/drafts/{id}/builds` | 202 `{build_id}`; builds the saved snapshot. |
| `GET /api/builds/{id}` | Status, readiness, diagnostics, PDF/log links. |
| `GET /api/drafts/{id}/candidate` | Fingerprint, readiness reasons, change summary, CV handoff. |
| `POST /api/drafts/{id}/publish` | `{build_id, fingerprint, idempotency_key}`. 202; 409 for stale approval or a concurrent publication. |
| `GET /api/publications/{id}` | Progress and verified URLs. |
| `POST /api/articles/{id}/updates/preview`, `POST /api/articles/{id}/updates` | Metadata-only update (venue, DOI, links). |

Writes require a same-origin `Origin`, a loopback `Host` and the session-bound `X-CSRF-Token`. No CORS headers are sent. Private files use opaque IDs and `Cache-Control: no-store`.

## Back up and restore

```sh
uv run scholarpress backup --to D:/Backups/ScholarPress     # online SQLite backup + blobs (sources, PDFs) + build logs
uv run scholarpress restore D:/Backups/ScholarPress/scholarpress-<stamp>   # into an EMPTY data_dir; verifies every referenced blob
```

Restore refuses to overwrite an existing database. After restoring, start the workspace: the staging site is rebuilt on the next publication. With the production adapter, the public site lives in git and needs no restore.

## Tests

```sh
uv run pytest                       # everything (real TeX builds are marked `tex`)
uv run pytest -m "not tex"          # fast suite without latexmk
node --test ../tools/preprints.test.mjs
```
