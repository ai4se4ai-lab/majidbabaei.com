"""Workspace service: articles, drafts, builds, candidates. HTTP handlers call into this module only."""
from __future__ import annotations

import hashlib
import queue
import re
import shutil
import threading
import traceback
from datetime import date
from pathlib import Path

from . import cv as cvmod
from .compiler import Compiler, normalize_profile, profile_fingerprint
from .config import Config
from .db import Database, dumps, loads, new_id, now
from .export import Candidate
from .site import SLUG, load_catalog, slugify
from .store import Incoming, Store, UploadError, inspect_manuscript

VENUE_STATUSES = ["preprint", "under-review", "revision-requested", "accepted", "published"]


class Conflict(Exception):
    """HTTP 409: stale revision, stale approval, or concurrent publication."""


class Invalid(Exception):
    """HTTP 422 with field-level errors."""

    def __init__(self, errors: list[dict]):
        super().__init__("; ".join(e["message"] for e in errors))
        self.errors = errors


class NotFound(Exception):
    pass


def fingerprint(obj) -> str:
    return hashlib.sha256(dumps(obj).encode()).hexdigest()


class Workspace:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        cfg.ensure_dirs()
        self.db = Database(cfg.db_path)
        self.store = Store(self.db, cfg.data_dir, max_files=cfg.max_files, max_file_mb=cfg.max_file_mb, max_total_mb=cfg.max_total_mb)
        self.compiler = Compiler(cfg)
        self._queue: queue.Queue[str] = queue.Queue()
        self._worker: threading.Thread | None = None
        from .publish import Publisher  # circular import guard
        self.publisher = Publisher(self)

    # Lifecycle ----------------------------------------------------------------------------
    def start(self) -> None:
        self.recover()
        if not self._worker:
            self._worker = threading.Thread(target=self._work, name="scholarpress-builds", daemon=True)
            self._worker.start()

    def recover(self) -> None:
        """After a crash: unfinished builds become interrupted; unfinished publications are reconciled."""
        self.db.run("UPDATE builds SET status = 'interrupted', finished = ?, diagnostics_json = ? WHERE status IN ('queued','running')",
                    now(), dumps([{"severity": "error", "code": "interrupted", "message": "The workspace stopped during this build",
                                   "action": "Start a new build."}]))
        self.publisher.reconcile_all()

    def catalog(self):
        """Site collections from the checkout plus stories ScholarPress already published (with the staging adapter,
        those exist only in the staged release, but every export rewrites them, so they are valid link targets)."""
        cat = load_catalog(self.cfg.site_dir)
        for e in self.db.all("SELECT n.*, a.slug AS article_slug FROM news_edits n JOIN articles a ON a.id = n.article_id "
                             "WHERE n.state = 'public' AND n.mode = 'new' AND a.disclosure = 'public'"):
            cat.news.setdefault(e["news_slug"], {"title": e["title"], "date": e["date"], "file": f"{e['date']}-{e['news_slug']}.md", "preprint": e["article_slug"]})
        return cat

    # Articles and drafts ----------------------------------------------------------------------
    def _default_metadata(self, tex: bytes) -> dict:
        info = inspect_manuscript(tex.decode("utf-8", "replace"))
        clean = lambda s: re.sub(r"\\[A-Za-z]+\*?(\[[^\]]*\])?\{([^{}]*)\}", r"\2", s).replace("~", " ").replace("\\\\", " ").strip()
        title = clean(info["title"])
        return {"title": title, "authors": [], "abstract": clean(info["abstract"]), "confirmed": False}

    def _unique_slug(self, base: str) -> str:
        slug, n = base, 2
        while self.db.one("SELECT 1 FROM articles WHERE slug = ?", slug):
            slug = f"{base}-{n}"
            n += 1
        return slug

    def create_article(self, files: list[Incoming], *, slug: str | None = None) -> dict:
        tex = next((f for f in files if f.role == "entry"), None)
        if not tex:
            raise UploadError([{"field": "tex", "message": "Upload the main .tex file."}])
        meta = self._default_metadata(tex.data)
        if slug and not SLUG.match(slug):
            raise Invalid([{"field": "slug", "message": "Use lowercase letters, digits and single hyphens."}])
        aid = new_id("art")
        with self.db.tx() as c:
            final_slug = slug or self._unique_slug(slugify(meta["title"] or Path(tex.path).stem))
            if c.execute("SELECT 1 FROM articles WHERE slug = ?", (final_slug,)).fetchone():
                raise Invalid([{"field": "slug", "message": f"The slug “{final_slug}” is already used."}])
            c.execute("INSERT INTO articles(id, slug, title, created) VALUES(?,?,?,?)", (aid, final_slug, meta["title"] or final_slug, now()))
        try:
            sid = self.store.create_snapshot(aid, files)
        except UploadError:
            self.db.run("DELETE FROM articles WHERE id = ?", aid)
            raise
        did = self._new_draft(aid, sid, None, meta, {"kind": "preserve", "engine": "pdflatex"}, first=True)
        return {"article_id": aid, "draft_id": did, "snapshot_id": sid}

    def _new_draft(self, aid, sid, basis_release_id, meta, profile, *, first=False, inherit_from: dict | None = None) -> str:
        did = new_id("drf")
        art = self.db.one("SELECT * FROM articles WHERE id = ?", aid)
        links = inherit_from.get("links_json") if inherit_from else art["links_json"]
        venue = inherit_from.get("venue_json") if inherit_from else art["venue_json"]
        cvj = inherit_from.get("cv_json") if inherit_from else art["cv_json"]
        announcement = {"mode": "none"}
        with self.db.tx() as c:
            c.execute("UPDATE drafts SET status = 'superseded', updated = ? WHERE article_id = ? AND status = 'open'", (now(), aid))
            c.execute("""INSERT INTO drafts(id, article_id, snapshot_id, basis_release_id, metadata_json, profile_json, links_json, announcement_json,
                         venue_json, disclosure, cv_json, created, updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                      (did, aid, sid, basis_release_id, dumps(meta), dumps(normalize_profile(profile)), links, dumps(announcement), venue,
                       art["disclosure"], cvj, now(), now()))
        return did

    def create_revision(self, article_id: str, files: list[Incoming], *, basis_release_id: str | None = None,
                        basis_draft_id: str | None = None, remove: set[str] | None = None) -> dict:
        art = self.article(article_id)
        if basis_release_id:
            basis = self.db.one("SELECT * FROM releases WHERE id = ? AND article_id = ? AND state IN ('public','exposed')", basis_release_id, article_id)
            if not basis:
                raise NotFound("release")
            parent_snapshot, meta = basis["snapshot_id"], loads(basis["metadata_json"])
            build = self.db.one("SELECT profile_json FROM builds WHERE id = ?", basis["build_id"])
            profile = loads(build["profile_json"])
            inherit = None
        else:
            d = self.db.one("SELECT * FROM drafts WHERE id = ? AND article_id = ?", basis_draft_id, article_id) if basis_draft_id else \
                self.db.one("SELECT * FROM drafts WHERE article_id = ? ORDER BY created DESC, rowid DESC LIMIT 1", article_id)
            if not d:
                raise NotFound("draft")
            parent_snapshot, meta, profile, inherit = d["snapshot_id"], loads(d["metadata_json"]), loads(d["profile_json"]), dict(d)
        sid = self.store.create_snapshot(article_id, files, parent_id=parent_snapshot, remove=remove)
        meta = {**meta, "confirmed": False}
        did = self._new_draft(article_id, sid, basis_release_id, meta, profile, inherit_from=inherit)
        return {"article_id": article_id, "draft_id": did, "snapshot_id": sid}

    def article(self, article_id: str):
        a = self.db.one("SELECT * FROM articles WHERE id = ?", article_id)
        if not a:
            raise NotFound("article")
        return a

    def draft(self, draft_id: str):
        d = self.db.one("SELECT * FROM drafts WHERE id = ?", draft_id)
        if not d:
            raise NotFound("draft")
        return d

    def update_draft(self, draft_id: str, rev: int, changes: dict) -> dict:
        d = self.draft(draft_id)
        if d["status"] != "open":
            raise Conflict("This draft is no longer open; start a new revision.")
        art = self.article(d["article_id"])
        errors: list[dict] = []
        sets: dict[str, str] = {}
        new_slug = None
        if "metadata" in changes:
            m = changes["metadata"] or {}
            title = re.sub(r"\s+", " ", str(m.get("title", ""))).strip()
            abstract = str(m.get("abstract", "")).strip()
            authors = [{"name": re.sub(r"\s+", " ", str(a.get("name", ""))).strip(), "affiliation": re.sub(r"\s+", " ", str(a.get("affiliation", ""))).strip()}
                       for a in (m.get("authors") or []) if str(a.get("name", "")).strip()]
            if not title:
                errors.append({"field": "title", "message": "Enter the title."})
            if len(title) > 300:
                errors.append({"field": "title", "message": "The title is longer than 300 characters."})
            if not authors:
                errors.append({"field": "authors", "message": "Add at least one author, in publication order."})
            if not abstract:
                errors.append({"field": "abstract", "message": "Enter the abstract shown on the article page."})
            if len(abstract) > 5000:
                errors.append({"field": "abstract", "message": "The abstract is longer than 5000 characters."})
            slug = str(m.get("slug") or art["slug"]).strip()
            if slug != art["slug"]:
                if art["slug_locked"]:
                    errors.append({"field": "slug", "message": "The slug is locked after the first publication; the stable URL never changes."})
                elif not SLUG.match(slug) or len(slug) > 80:
                    errors.append({"field": "slug", "message": "Use lowercase letters, digits and single hyphens (at most 80 characters)."})
                elif self.db.one("SELECT 1 FROM articles WHERE slug = ? AND id != ?", slug, art["id"]):
                    errors.append({"field": "slug", "message": f"The slug “{slug}” is already used by another article."})
            sets["metadata_json"] = dumps({"title": title, "authors": authors, "abstract": abstract, "confirmed": bool(m.get("confirmed")),
                                           "disclosureApproved": bool(m.get("disclosureApproved"))})
            new_slug = slug if slug != art["slug"] else None
        if "profile" in changes:
            sets["profile_json"] = dumps(normalize_profile(changes["profile"]))
        if "links" in changes:
            L = changes["links"] or {}
            links = {"publicationId": (L.get("publicationId") or None), "projectIds": sorted(set(L.get("projectIds") or [])),
                     "newsPostIds": sorted(set(L.get("newsPostIds") or [])), "agendaIds": sorted(set(L.get("agendaIds") or []))}
            errors += self.catalog().validate_links(links)
            sets["links_json"] = dumps(links)
        if "announcement" in changes:
            a = changes["announcement"] or {}
            mode = a.get("mode") if a.get("mode") in {"none", "new", "update"} else "none"
            ann = {"mode": mode}
            if mode == "new":
                ann.update({k: str(a.get(k, "")).strip() for k in ("title", "summary", "body", "newsSlug")})
                ann["tags"] = [t.strip() for t in (a.get("tags") or ["Preprints"]) if t.strip()][:6]
                ann["newsSlug"] = ann["newsSlug"] or slugify(ann["title"] or art["slug"])
                for k in ("title", "summary", "body"):
                    if not ann[k]:
                        errors.append({"field": f"announcement.{k}", "message": f"The announcement needs a {k}."})
                if ann["body"] and len(ann["body"]) < 180:
                    errors.append({"field": "announcement.body", "message": "Newsroom stories need a substantive body (at least about 180 characters); the site's checks reject shorter articles."})
                if not SLUG.match(ann["newsSlug"]):
                    errors.append({"field": "announcement.newsSlug", "message": "Use lowercase letters, digits and hyphens for the story URL."})
                elif ann["newsSlug"] in self.catalog().news and self.catalog().news[ann["newsSlug"]].get("preprint") != art["slug"]:
                    errors.append({"field": "announcement.newsSlug", "message": f"news/{ann['newsSlug']}/ already exists; choose “update an existing story” or another URL."})
            elif mode == "update":
                ann.update({"newsPostId": str(a.get("newsPostId", "")).strip(), "body": str(a.get("body", "")).strip()})
                if ann["newsPostId"] not in self.catalog().news:
                    errors.append({"field": "announcement.newsPostId", "message": "Choose an existing story to update."})
                if not ann["body"]:
                    errors.append({"field": "announcement.body", "message": "Write the paragraph to add to the story."})
            sets["announcement_json"] = dumps(ann)
        if "disclosure" in changes:
            disc = changes["disclosure"]
            if disc not in {"public", "withheld"}:
                errors.append({"field": "disclosure", "message": "Choose public or withheld."})
            elif disc == "withheld" and art["latest_release_id"]:
                errors.append({"field": "disclosure", "message": "This article already has public versions; published versions are permanent and cannot be withdrawn here."})
            sets["disclosure"] = disc
        if "venue" in changes:
            v, verrs = self.validate_venue(changes["venue"])
            errors += verrs
            sets["venue_json"] = dumps(v)
        if "cv" in changes:
            c = changes["cv"] or {}
            sets["cv_json"] = dumps({"section": c.get("section") if c.get("section") in cvmod.SECTIONS else None,
                                     "entryKey": re.sub(r"[^A-Za-z0-9:_-]", "", str(c.get("entryKey") or ""))[:60] or None})
        if "revision_note" in changes:
            sets["revision_note"] = str(changes["revision_note"] or "").strip()[:2000]
        if errors:
            raise Invalid(errors)
        with self.db.tx() as c:
            cur = c.execute("SELECT rev FROM drafts WHERE id = ?", (draft_id,)).fetchone()
            if cur["rev"] != rev:
                raise Conflict("This draft was changed in another tab or window. Reload to see the latest version, then reapply your edits.")
            if new_slug:
                c.execute("UPDATE articles SET slug = ? WHERE id = ? AND slug_locked = 0", (new_slug, art["id"]))
            if sets:
                cols = ", ".join(f"{k} = ?" for k in sets)
                c.execute(f"UPDATE drafts SET {cols}, rev = rev + 1, updated = ? WHERE id = ?", (*sets.values(), now(), draft_id))
        return dict(self.draft(draft_id))

    @staticmethod
    def validate_venue(raw: dict | None) -> tuple[dict, list[dict]]:
        raw = raw or {}
        v = {k: str(raw.get(k) or "").strip() for k in ("status", "name", "kind", "doi", "url", "date", "citation")}
        v["status"] = v["status"] or "preprint"
        v["confirmed"] = bool(raw.get("confirmed"))
        errors = []
        if v["status"] not in VENUE_STATUSES:
            errors.append({"field": "venue.status", "message": "Unknown venue status."})
        if v["doi"]:
            v["doi"] = re.sub(r"^https?://(dx\.)?doi\.org/", "", v["doi"])
            if not re.match(r"^10\.\d{4,9}/\S+$", v["doi"]):
                errors.append({"field": "venue.doi", "message": "A DOI looks like 10.1234/abcd."})
        if v["url"] and not re.match(r"^https://", v["url"]):
            errors.append({"field": "venue.url", "message": "Use an https:// link to the official version."})
        if v["date"] and not re.match(r"^\d{4}(-\d{2}(-\d{2})?)?$", v["date"]):
            errors.append({"field": "venue.date", "message": "Use YYYY, YYYY-MM or YYYY-MM-DD."})
        if v["status"] in {"accepted", "published", "under-review", "revision-requested"} and not v["name"]:
            errors.append({"field": "venue.name", "message": "Name the venue."})
        if v["status"] == "published" and not (v["doi"] or v["url"]):
            errors.append({"field": "venue.doi", "message": "A published version needs its DOI or official link."})
        if v["status"] in {"accepted", "published"} and not v["confirmed"]:
            errors.append({"field": "venue.confirmed", "message": "Confirm that this venue status is verified (acceptance letter or published version)."})
        if v["kind"] not in {"", "journal", "conference"}:
            errors.append({"field": "venue.kind", "message": "Choose journal or conference."})
        if v["status"] == "preprint":
            v = {"status": "preprint"}
        return v, errors

    # Builds ----------------------------------------------------------------------------------
    def enqueue_build(self, draft_id: str) -> str:
        d = self.draft(draft_id)
        profile = normalize_profile(loads(d["profile_json"]))
        bid = new_id("bld")
        self.db.run("""INSERT INTO builds(id, draft_id, snapshot_id, input_fp, profile_fp, profile_json, status, created)
                       VALUES(?,?,?,?,?,?, 'queued', ?)""",
                    bid, draft_id, d["snapshot_id"], self.store.input_fingerprint(d["snapshot_id"]), profile_fingerprint(profile), dumps(profile), now())
        self._queue.put(bid)
        return bid

    def _work(self) -> None:
        while True:
            bid = self._queue.get()
            try:
                self.run_build(bid)
            except Exception:
                self.db.run("UPDATE builds SET status = 'failed', finished = ?, diagnostics_json = ? WHERE id = ?", now(),
                            dumps([{"severity": "error", "code": "internal", "message": "ScholarPress failed while building",
                                    "action": "Retry; if it persists, see the server console.", "excerpt": traceback.format_exc()[-1500:]}]), bid)

    def run_build(self, bid: str) -> None:
        b = self.db.one("SELECT * FROM builds WHERE id = ?", bid)
        if not b or b["status"] != "queued":
            return
        self.db.run("UPDATE builds SET status = 'running', started = ? WHERE id = ?", now(), bid)
        snap = self.db.one("SELECT * FROM snapshots WHERE id = ?", b["snapshot_id"])
        work = self.cfg.data_dir / "work" / bid
        out_dir = self.cfg.data_dir / "builds" / bid
        shutil.rmtree(work, ignore_errors=True)
        try:
            self.store.materialize(b["snapshot_id"], work)
            sources = {r["path"] for r in self.store.snapshot_files(b["snapshot_id"])}
            res = self.compiler.compile(work, snap["entry"], loads(snap["bib_paths_json"]), loads(b["profile_json"]), sources, bid)
        finally:
            pass
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "build.log").write_text(res.log, encoding="utf-8")
        pdf_sha = pdf_path = None
        if res.pdf:
            pdf_sha = self.store.put_blob(res.pdf)
            pdf_path = str(self.store.blob_path(pdf_sha))
        self.db.run("""UPDATE builds SET status = ?, blocked = ?, diagnostics_json = ?, pdf_sha256 = ?, pdf_path = ?, log_path = ?, pages = ?,
                       runner = ?, toolchain = ?, finished = ? WHERE id = ?""",
                    res.status, int(res.blocked), dumps(res.diagnostics), pdf_sha, pdf_path, str(out_dir / "build.log"), res.pages,
                    res.runner, res.toolchain, now(), bid)
        shutil.rmtree(work, ignore_errors=True)

    def build(self, bid: str):
        b = self.db.one("SELECT * FROM builds WHERE id = ?", bid)
        if not b:
            raise NotFound("build")
        return b

    def latest_build(self, draft_id: str):
        return self.db.one("SELECT * FROM builds WHERE draft_id = ? ORDER BY created DESC, rowid DESC LIMIT 1", draft_id)

    # Candidates --------------------------------------------------------------------------------
    def next_version(self, article_id: str) -> int:
        row = self.db.one("SELECT MAX(version) AS v FROM releases WHERE article_id = ?", article_id)
        return (row["v"] or 0) + 1

    def news_edits_for(self, art, announcement: dict, version: int, release_date: str, publication_id: str | None) -> list[dict]:
        if announcement.get("mode") == "new":
            return [{"id": new_id("nws"), "article_id": art["id"], "publication_id": publication_id, "mode": "new", "news_slug": announcement["newsSlug"],
                     "date": release_date, "title": announcement["title"], "summary": announcement["summary"],
                     "tags_json": dumps(announcement.get("tags") or ["Preprints"]), "body": announcement["body"], "state": "pending"}]
        if announcement.get("mode") == "update":
            return [{"id": new_id("nws"), "article_id": art["id"], "publication_id": publication_id, "mode": "update", "news_slug": announcement["newsPostId"],
                     "date": release_date, "title": "", "summary": "", "tags_json": "[]", "body": announcement["body"], "state": "pending"}]
        return []

    def default_announcement(self, draft_id: str) -> dict:
        d = self.draft(draft_id)
        art = self.article(d["article_id"])
        m = loads(d["metadata_json"])
        v = self.next_version(art["id"])
        authors = ", ".join(a["name"] for a in m["authors"]) or "the authors"
        abstract = m["abstract"][:400] + ("…" if len(m["abstract"]) > 400 else "")
        return {"mode": "new", "title": f"New preprint: {m['title']}"[:140], "summary": f"{m['title']} is now available as a preprint, with a stable link and versioned PDF.",
                "newsSlug": slugify(m["title"] or art["slug"]), "tags": ["Preprints"],
                "body": (f"A new preprint is available: **[{m['title']}](/preprints/{art['slug']}/)** by {authors}.\n\n> {abstract}\n\n"
                         f"Read or download version {v}: [PDF](/preprints/{art['slug']}/v{v}/paper.pdf) · [release page](/preprints/{art['slug']}/v{v}/).")}

    def candidate(self, draft_id: str) -> dict:
        """Everything Publish depends on, its fingerprint, readiness, and a change summary per affected site surface."""
        d = self.draft(draft_id)
        art = self.article(d["article_id"])
        b = self.latest_build(draft_id)
        meta, links, ann = loads(d["metadata_json"]), loads(d["links_json"], {}), loads(d["announcement_json"], {"mode": "none"})
        venue, cvj = loads(d["venue_json"], {}), loads(d["cv_json"], {})
        version = self.next_version(art["id"])
        reasons = []
        current_profile = profile_fingerprint(normalize_profile(loads(d["profile_json"])))
        if d["status"] != "open":
            reasons.append("This draft is not open (already published or superseded).")
        if not b:
            reasons.append("Build the PDF first.")
        else:
            if b["status"] in ("queued", "running"):
                reasons.append("The build is still running.")
            elif b["status"] != "ready" or b["blocked"]:
                reasons.append("The latest build has blocking problems; fix them and rebuild.")
            if b["snapshot_id"] != d["snapshot_id"] or b["profile_fp"] != current_profile or b["input_fp"] != self.store.input_fingerprint(d["snapshot_id"]):
                reasons.append("The build is stale: sources or the build profile changed since it ran. Rebuild.")
        if not meta.get("title") or not meta.get("authors") or not meta.get("abstract"):
            reasons.append("Complete the title, authors and abstract.")
        if not meta.get("confirmed"):
            reasons.append("Review and confirm the public metadata (title, author order, affiliations, abstract, slug).")
        if d["disclosure"] != "public":
            reasons.append("Disclosure is withheld (anonymous review): nothing about this work can be released publicly.")
        elif art["disclosure"] != "public" and not meta.get("disclosureApproved"):
            reasons.append("Approve the change in disclosure from withheld to public.")
        cat = self.catalog()
        link_errors = cat.validate_links(links)
        reasons += [e["message"] for e in link_errors]
        if ann.get("mode") == "update" and ann.get("newsPostId") not in cat.news:
            reasons.append("The story selected for update no longer exists.")
        active = self.db.one("SELECT id FROM publications WHERE article_id = ? AND status IN ('staging','deploying','verifying')", art["id"])
        if active:
            reasons.append("A publication for this article is in progress.")
        release_date = date.today().isoformat()
        links_out = dict(links)
        if ann.get("mode") == "new":
            links_out["newsPostIds"] = sorted(set(links_out.get("newsPostIds") or []) | {ann["newsSlug"]})
        elif ann.get("mode") == "update":
            links_out["newsPostIds"] = sorted(set(links_out.get("newsPostIds") or []) | {ann["newsPostId"]})
        approval = {"draft": d["id"], "snapshot": d["snapshot_id"], "build": b["id"] if b else None, "pdf": b["pdf_sha256"] if b else None,
                    "version": version, "slug": art["slug"], "metadata": {k: meta.get(k) for k in ("title", "authors", "abstract")},
                    "links": links_out, "announcement": ann, "disclosure": d["disclosure"], "venue": venue, "note": d["revision_note"],
                    "profile": loads(d["profile_json"])}
        fp = fingerprint(approval)
        summary = self.change_summary(art, approval, cat, b)
        handoff = cvmod.handoff(cfg=self.cfg, slug=art["slug"], metadata=meta if meta.get("authors") else {"title": meta.get("title", ""), "authors": []},
                                venue=venue, cv=cvj, disclosure=d["disclosure"], release_date=release_date)
        return {"fingerprint": fp, "ready": not reasons, "reasons": reasons, "version": version, "release_date": release_date,
                "approval": approval, "summary": summary, "cv": handoff, "build_id": b["id"] if b else None,
                "suggestions": cat.suggest_publication(meta.get("title", "")) if not links.get("publicationId") else []}

    def candidate_object(self, draft_id: str, cand: dict, publication_id: str) -> Candidate:
        d = self.draft(draft_id)
        art = self.article(d["article_id"])
        a = cand["approval"]
        return Candidate(article_id=art["id"],
                         release={"version": a["version"], "date": cand["release_date"], "note": a["note"], "sha256": a["pdf"], "metadata": a["metadata"]},
                         links=a["links"], venue=a["venue"], disclosure=a["disclosure"],
                         news_edits=self.news_edits_for(art, a["announcement"], a["version"], cand["release_date"], publication_id))

    def change_summary(self, art, a: dict, cat, build) -> list[dict]:
        slug, v, s = art["slug"], a["version"], []
        base = self.cfg.site_url
        s.append({"surface": "Preprints", "change": f"{'New article' if v == 1 else 'New version'}: /preprints/{slug}/ shows v{v}; permanent page /preprints/{slug}/v{v}/; "
                  f"/preprints/{slug}/paper.pdf now resolves to v{v}." + (f" Earlier versions v1–v{v - 1} stay unchanged." if v > 1 else ""),
                  "links": [f"{base}/preprints/{slug}/", f"{base}/preprints/{slug}/v{v}/"]})
        pid = a["links"].get("publicationId")
        if pid and pid in cat.publications:
            p = cat.publications[pid]
            s.append({"surface": "Homepage publications", "change": f"“Read preprint” on the existing entry “{p['title']}” "
                      f"({'Published & accepted' if p['group'] == 'published' else 'Under review & ongoing'}). Counts do not change."})
        else:
            s.append({"surface": "Homepage publications", "change": "Listed under the separate Preprints tab (no existing public entry selected). Published counts do not change."})
        for pj in a["links"].get("projectIds") or []:
            s.append({"surface": "Projects", "change": f"{cat.projects.get(pj, pj)}: release “Preprint · {a['metadata']['title']}” with links to the article and every version.",
                      "links": [f"{base}/projects/{pj}/"]})
        ann = a["announcement"]
        if ann.get("mode") == "new":
            s.append({"surface": "Newsroom", "change": f"New story “{ann['title']}” at /news/{ann['newsSlug']}/, on the homepage Latest progress panel and in RSS."})
        elif ann.get("mode") == "update":
            s.append({"surface": "Newsroom", "change": f"Adds a paragraph to “{cat.news.get(ann['newsPostId'], {}).get('title', ann['newsPostId'])}”; its URL and RSS identity stay the same."})
        else:
            s.append({"surface": "Newsroom", "change": "Quiet release: no story is created or changed."})
        for ag in a["links"].get("agendaIds") or []:
            s.append({"surface": "Homepage", "change": f"The article page links back to “{cat.agenda.get(ag, ag)}”."})
        if a["venue"].get("status", "preprint") != "preprint":
            s.append({"surface": "Venue", "change": f"Article page shows {a['venue']['status']}{' · ' + a['venue'].get('name', '') if a['venue'].get('name') else ''}"
                      f"{' with DOI ' + a['venue']['doi'] if a['venue'].get('doi') else ''}. Publication groups follow the CV after its next sync."})
        s.append({"surface": "Search engines", "change": f"Sitemap adds /preprints/{slug}/v{v}/; citation metadata (Highwire, schema.org) on both pages."})
        if build and build["pdf_sha256"]:
            s.append({"surface": "Public files", "change": f"preprints/{slug}/v{v}/paper.pdf ({build['pages'] or '?'} pages, SHA-256 {build['pdf_sha256'][:12]}…), "
                      f"v{v}/citation.bib, and the latest-PDF alias. Sources, logs and drafts stay private."})
        return s

    # Downloads --------------------------------------------------------------------------------
    def file_row(self, file_id: str):
        r = self.db.one("SELECT * FROM snapshot_files WHERE id = ?", file_id)
        if not r:
            raise NotFound("file")
        return r

    def backup(self, target_dir: Path | None = None) -> Path:
        stamp = now().replace(":", "").replace("-", "")
        target = Path(target_dir or self.cfg.data_dir / "backups") / f"scholarpress-{stamp}"
        target.mkdir(parents=True, exist_ok=True)
        self.db.backup(target / "scholarpress.sqlite3")
        shutil.copytree(self.cfg.data_dir / "blobs", target / "blobs", dirs_exist_ok=True)
        shutil.copytree(self.cfg.data_dir / "builds", target / "builds", dirs_exist_ok=True)
        return target
