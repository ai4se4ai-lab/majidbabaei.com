"""Publication: reserve a version, stage the complete site release, activate it atomically, verify, then record success.

Adapters
  staging     Builds the full public site (_site/) from a copy of the checkout plus the public catalog, and activates it
              by atomically switching the pointer file served by the local staging server (http://127.0.0.1:<staging_port>).
  production  Builds the same release in a temporary git worktree at the checkout's HEAD (which must equal the remote
              branch), commits it, and pushes HEAD to the Pages branch; GitHub Actions deploys the site as one artifact.
              Verification polls the live domain. Credentials stay with git; the compiler never sees them.

Failure handling
  Before activation, a failure aborts cleanly: the old release stays live and the reserved version number is freed.
  After activation, a failed verification restores the previous staging release where safe; the exposed version is kept
  ("exposed") so its number and bytes are never reused. Retrying with the same idempotency key reuses the reservation.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import threading
import time
import traceback
import urllib.error
import urllib.request
from pathlib import Path

from .db import dumps, loads, new_id, now
from .export import Candidate, ExportError, public_state, run_public_build, run_site_builders, write_catalog

ACTIVE = ("staging", "deploying", "verifying")
SKIP_COPY = {".git", "node_modules", "_site", "scholarpress", ".taste-skill", "private-drafts", "__pycache__"}


class PublishError(Exception):
    pass


def http_get(url: str, timeout: int = 20) -> tuple[int, dict, bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": "ScholarPress-verify/1.0", "Cache-Control": "no-cache"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, b""
    except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
        return 0, {}, str(e).encode()


def copy_site(src: Path, dst: Path) -> None:
    def ignore(dirpath, names):
        return [n for n in names if (Path(dirpath) == src and n in SKIP_COPY) or n == "__pycache__"]
    shutil.copytree(src, dst, ignore=ignore)


class StagingAdapter:
    name = "staging"

    def __init__(self, ws):
        self.ws = ws
        self.root = ws.cfg.data_dir / "staging"
        self.pointer = self.root / "current"
        self.previous = self.root / "previous"

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.ws.cfg.staging_port}"

    def live_dir(self) -> Path | None:
        if self.pointer.exists():
            p = Path(self.pointer.read_text(encoding="utf-8").strip())
            return p if p.exists() else None
        return None

    def ensure_node_modules(self) -> None:
        src = self.ws.cfg.site_dir / "node_modules"
        dst = self.root / "node_modules"
        stamp = self.root / "node_modules.lock"
        lock = (self.ws.cfg.site_dir / "package-lock.json").read_bytes() if (self.ws.cfg.site_dir / "package-lock.json").exists() else b""
        if not src.exists():
            raise PublishError("The site checkout has no node_modules; run `npm ci` in majidbabaei.com first.")
        if not dst.exists() or not stamp.exists() or stamp.read_bytes() != lock:
            shutil.rmtree(dst, ignore_errors=True)
            shutil.copytree(src, dst)
            stamp.write_bytes(lock)

    def stage(self, pub_id: str, candidate: Candidate | None, pdf: bytes | None, log: list[str], *, into: Path | None = None) -> dict:
        self.ensure_node_modules()
        work = self.root / "work" / pub_id
        shutil.rmtree(work, ignore_errors=True)
        work.parent.mkdir(parents=True, exist_ok=True)
        src = work / "src"
        copy_site(self.ws.cfg.site_dir, src)
        summary = write_catalog(self.ws.db, self.ws.store, src, candidate, pdf)
        log.append(f"Exported {len(summary['records'])} public article(s); touched {len(summary['touched'])} file(s).")
        log += run_site_builders(src, self.ws.cfg.node)
        log += run_public_build(src, self.ws.cfg.node)
        target = into or (self.root / "releases" / pub_id)
        shutil.rmtree(target, ignore_errors=True)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src / "_site"), str(target))
        shutil.rmtree(work, ignore_errors=True)
        return {"site": str(target), "touched": summary["touched"]}

    def activate(self, staged: dict) -> dict:
        prev = self.pointer.read_text(encoding="utf-8").strip() if self.pointer.exists() else ""
        tmp = self.pointer.with_suffix(".tmp")
        tmp.write_text(staged["site"], encoding="utf-8")
        self.previous.write_text(prev, encoding="utf-8")
        os.replace(tmp, self.pointer)  # atomic switch of the served release
        return {"adapter": "staging", "site": staged["site"], "previous": prev, "activated": now()}

    def is_active(self, receipt: dict) -> bool:
        return self.pointer.exists() and self.pointer.read_text(encoding="utf-8").strip() == receipt.get("site")

    def rollback(self, receipt: dict) -> str:
        prev = receipt.get("previous")
        if prev and Path(prev).exists():
            tmp = self.pointer.with_suffix(".tmp")
            tmp.write_text(prev, encoding="utf-8")
            os.replace(tmp, self.pointer)
            return "Restored the previous staging release."
        return "No previous staging release to restore."

    def cleanup(self, keep: int = 3) -> None:
        rel = self.root / "releases"
        if not rel.exists():
            return
        live = {self.pointer.read_text(encoding="utf-8").strip() if self.pointer.exists() else "",
                self.previous.read_text(encoding="utf-8").strip() if self.previous.exists() else ""}
        dirs = sorted((d for d in rel.iterdir() if d.is_dir()), key=lambda d: d.stat().st_mtime, reverse=True)
        for d in dirs[keep:]:
            if str(d) not in live:
                shutil.rmtree(d, ignore_errors=True)


class ProductionAdapter:
    name = "production"

    def __init__(self, ws):
        self.ws = ws
        self.cfg = ws.cfg

    @property
    def base_url(self) -> str:
        return self.cfg.production_base_url.rstrip("/")

    def git(self, *args, cwd=None, check=True) -> str:
        r = subprocess.run([self.cfg.git, *args], cwd=cwd or self.cfg.site_dir, capture_output=True, text=True, timeout=600)
        if check and r.returncode != 0:
            raise PublishError(f"git {' '.join(args)} failed: {(r.stderr or r.stdout).strip()[:1500]}")
        return r.stdout.strip()

    def stage(self, pub_id: str, candidate: Candidate | None, pdf: bytes | None, log: list[str], *, into: Path | None = None) -> dict:
        remote, branch = self.cfg.production_remote, self.cfg.production_branch
        self.git("fetch", remote, branch)
        head, upstream = self.git("rev-parse", "HEAD"), self.git("rev-parse", f"{remote}/{branch}")
        if head != upstream:
            raise PublishError(f"The site checkout's HEAD ({head[:10]}) differs from {remote}/{branch} ({upstream[:10]}). "
                               "Push or reconcile those commits first, so a release never publishes unrelated work.")
        wt = self.cfg.data_dir / "staging" / "worktrees" / pub_id
        if wt.exists():
            self.git("worktree", "remove", "--force", str(wt), check=False)
            shutil.rmtree(wt, ignore_errors=True)
        wt.parent.mkdir(parents=True, exist_ok=True)
        self.git("worktree", "add", "--detach", str(wt), head)
        nm = self.cfg.site_dir / "node_modules"
        if nm.exists() and not (wt / "node_modules").exists():
            shutil.copytree(nm, wt / "node_modules")
        summary = write_catalog(self.ws.db, self.ws.store, wt, candidate, pdf)
        log.append(f"Exported {len(summary['records'])} public article(s) into a worktree at {head[:10]}.")
        log += run_site_builders(wt, self.cfg.node)
        log += run_public_build(wt, self.cfg.node)
        r = subprocess.run([self.cfg.node, "--test", "tools/news.test.mjs", "tools/calendar.test.mjs", "tools/preprints.test.mjs"], cwd=wt,
                           capture_output=True, text=True, timeout=600)
        log.append(f"$ npm test\n{r.stdout[-3000:]}{r.stderr[-2000:]}")
        if r.returncode != 0:
            raise PublishError("The site tests failed in the staged release; nothing was pushed.")
        self.git("add", "-A", "preprints", "assets", "news", "projects", "sitemap.xml", cwd=wt)
        if not self.git("status", "--porcelain", cwd=wt):
            return {"worktree": str(wt), "commit": head, "base": head, "touched": []}
        message = f"Publish preprint changes ({pub_id})\n\nGenerated by ScholarPress from approved release records."
        self.git("-c", "core.hooksPath=", "commit", "-m", message, cwd=wt)
        return {"worktree": str(wt), "commit": self.git("rev-parse", "HEAD", cwd=wt), "base": head, "touched": summary["touched"]}

    def activate(self, staged: dict) -> dict:
        remote, branch = self.cfg.production_remote, self.cfg.production_branch
        if staged["commit"] != staged["base"]:
            # Fast-forward only: a concurrent push elsewhere makes this fail and leaves the old release live.
            self.git("push", remote, f"{staged['commit']}:refs/heads/{branch}", cwd=staged["worktree"])
        receipt = {"adapter": "production", "commit": staged["commit"], "base": staged["base"], "remote": remote, "branch": branch, "activated": now()}
        # Bring the author's checkout forward when it is clean and still at the base commit.
        if not self.git("status", "--porcelain", check=False) and self.git("rev-parse", "HEAD") == staged["base"]:
            self.git("merge", "--ff-only", staged["commit"], check=False)
            receipt["checkout"] = "fast-forwarded"
        else:
            receipt["checkout"] = "not updated (local changes); pull to receive the release commit"
        self.git("worktree", "remove", "--force", staged["worktree"], check=False)
        return receipt

    def is_active(self, receipt: dict) -> bool:
        out = self.git("ls-remote", receipt.get("remote", self.cfg.production_remote), f"refs/heads/{receipt.get('branch', self.cfg.production_branch)}", check=False)
        return bool(receipt.get("commit")) and out.startswith(receipt["commit"])

    def rollback(self, receipt: dict) -> str:
        return ("The release commit is on the Pages branch. Numbered versions are permanent; fix the cause and retry "
                "(the same reservation is reused), or revert the commit manually if the index must change.")

    def cleanup(self, keep: int = 3) -> None:
        self.git("worktree", "prune", check=False)


class Publisher:
    def __init__(self, ws):
        self.ws = ws
        self.lock = threading.Lock()   # catalog lock: one publication changes the public index at a time
        self.threads: dict[str, threading.Thread] = {}

    def adapter(self):
        return ProductionAdapter(self.ws) if self.ws.cfg.adapter == "production" else StagingAdapter(self.ws)

    # Requests ------------------------------------------------------------------------------
    def request_release(self, draft_id: str, build_id: str, fp: str, key: str, *, run_async: bool = True) -> dict:
        from .service import Conflict, Invalid
        if not key or len(key) > 120:
            raise Invalid([{"field": "idempotency_key", "message": "An idempotency key is required."}])
        db = self.ws.db
        existing = db.one("SELECT * FROM publications WHERE idempotency_key = ?", key)
        if existing:
            if existing["fingerprint"] != fp or existing["draft_id"] != draft_id:
                raise Conflict("This idempotency key was used for a different approval.")
            if existing["status"] == "failed" and self.ws.draft(draft_id)["status"] == "open":
                return self._retry(existing, run_async)
            return dict(existing)
        cand = self.ws.candidate(draft_id)
        if cand["fingerprint"] != fp:
            raise Conflict("The approved preview is out of date: the PDF, metadata, links, announcement or disclosure changed. Review the new preview and approve again.")
        if cand["build_id"] != build_id:
            raise Conflict("The approved build is no longer the latest build for this draft.")
        if not cand["ready"]:
            raise Conflict("Not ready to publish: " + " ".join(cand["reasons"]))
        d = self.ws.draft(draft_id)
        pid = new_id("pub")
        with db.tx() as c:
            if c.execute("SELECT 1 FROM publications WHERE status IN ('staging','deploying','verifying')").fetchone():
                raise Conflict("Another publication is in progress; wait for it to finish, then review again.")
            version = (c.execute("SELECT MAX(version) AS v FROM releases WHERE article_id = ?", (d["article_id"],)).fetchone()["v"] or 0) + 1
            if version != cand["version"]:
                raise Conflict("The version number changed since the preview; review again.")
            rid = new_id("rel")
            c.execute("""INSERT INTO releases(id, article_id, version, request_id, state, metadata_json, snapshot_id, build_id, pdf_sha256, note, release_date)
                         VALUES(?,?,?,?, 'reserved', ?,?,?,?,?,?)""",
                      (rid, d["article_id"], version, key, dumps(cand["approval"]["metadata"]), d["snapshot_id"], build_id, cand["approval"]["pdf"],
                       cand["approval"]["note"], cand["release_date"]))
            c.execute("""INSERT INTO publications(id, kind, article_id, draft_id, release_id, build_id, idempotency_key, fingerprint, payload_json, adapter, status, created, updated)
                         VALUES(?, 'release', ?,?,?,?,?,?,?,?, 'staging', ?, ?)""",
                      (pid, d["article_id"], draft_id, rid, build_id, key, fp, dumps(cand), self.adapter().name, now(), now()))
        return self._launch(pid, run_async)

    def request_metadata_update(self, article_id: str, changes: dict, fp: str, key: str, *, run_async: bool = True) -> dict:
        from .service import Conflict, Invalid
        db = self.ws.db
        existing = db.one("SELECT * FROM publications WHERE idempotency_key = ?", key)
        if existing:
            if existing["fingerprint"] != fp:
                raise Conflict("This idempotency key was used for a different update.")
            if existing["status"] == "failed":
                return self._retry(existing, run_async)
            return dict(existing)
        cand = self.metadata_candidate(article_id, changes)
        if cand["fingerprint"] != fp:
            raise Conflict("The approved update preview is out of date; review it again.")
        if not cand["ready"]:
            raise Invalid([{"field": "update", "message": r} for r in cand["reasons"]])
        pid = new_id("pub")
        with db.tx() as c:
            if c.execute("SELECT 1 FROM publications WHERE status IN ('staging','deploying','verifying')").fetchone():
                raise Conflict("Another publication is in progress; wait for it to finish, then review again.")
            c.execute("""INSERT INTO publications(id, kind, article_id, idempotency_key, fingerprint, payload_json, adapter, status, created, updated)
                         VALUES(?, 'metadata', ?,?,?,?,?, 'staging', ?, ?)""",
                      (pid, article_id, key, fp, dumps(cand), self.adapter().name, now(), now()))
        return self._launch(pid, run_async)

    def metadata_candidate(self, article_id: str, changes: dict) -> dict:
        """A venue/DOI/association update for current public views; no new PDF version."""
        ws = self.ws
        art = ws.article(article_id)
        reasons = []
        if not art["latest_release_id"]:
            reasons.append("Publish a first version before updating public metadata.")
        venue, verrs = ws.validate_venue(changes.get("venue", loads(art["venue_json"], {})))
        reasons += [e["message"] for e in verrs]
        L = changes.get("links", loads(art["links_json"], {})) or {}
        links = {"publicationId": L.get("publicationId") or None, "projectIds": sorted(set(L.get("projectIds") or [])),
                 "newsPostIds": sorted(set(L.get("newsPostIds") or [])), "agendaIds": sorted(set(L.get("agendaIds") or []))}
        cat = ws.catalog()
        reasons += [e["message"] for e in cat.validate_links(links)]
        ann = changes.get("announcement") or {"mode": "none"}
        if ann.get("mode") == "update":
            if ann.get("newsPostId") not in cat.news or not ann.get("body"):
                reasons.append("Choose the story to update and write the added paragraph.")
            links["newsPostIds"] = sorted(set(links["newsPostIds"]) | {ann.get("newsPostId")})
        elif ann.get("mode") == "new":
            for k in ("title", "summary", "body", "newsSlug"):
                if not ann.get(k):
                    reasons.append(f"The announcement needs a {k}.")
            links["newsPostIds"] = sorted(set(links["newsPostIds"]) | {ann.get("newsSlug")})
        if art["disclosure"] != "public":
            reasons.append("This work is withheld; nothing can be published.")
        approval = {"article": article_id, "links": links, "venue": venue, "announcement": ann,
                    "current": {"links": loads(art["links_json"], {}), "venue": loads(art["venue_json"], {})}}
        fp = hashlib.sha256(dumps(approval).encode()).hexdigest()
        latest = ws.db.one("SELECT metadata_json FROM releases WHERE id = ?", art["latest_release_id"]) if art["latest_release_id"] else None
        from . import cv as cvmod
        handoff = cvmod.handoff(cfg=ws.cfg, slug=art["slug"], metadata=loads(latest["metadata_json"]) if latest else {"title": art["title"], "authors": []},
                                venue=venue, cv=loads(art["cv_json"], {}), disclosure=art["disclosure"], release_date=venue.get("date") or "")
        return {"fingerprint": fp, "ready": not reasons, "reasons": reasons, "approval": approval, "cv": handoff}

    def _retry(self, pub, run_async):
        rel = self.ws.db.one("SELECT * FROM releases WHERE id = ?", pub["release_id"]) if pub["release_id"] else None
        if pub["kind"] == "release" and not rel:
            # The reservation was released after a clean abort; reserve the next number again.
            d = self.ws.draft(pub["draft_id"])
            with self.ws.db.tx() as c:
                version = (c.execute("SELECT MAX(version) AS v FROM releases WHERE article_id = ?", (d["article_id"],)).fetchone()["v"] or 0) + 1
                cand = loads(pub["payload_json"])
                if version != cand["version"]:
                    from .service import Conflict
                    raise Conflict("The version number changed; review the preview again.")
                rid = new_id("rel")
                c.execute("""INSERT INTO releases(id, article_id, version, request_id, state, metadata_json, snapshot_id, build_id, pdf_sha256, note, release_date)
                             VALUES(?,?,?,?, 'reserved', ?,?,?,?,?,?)""",
                          (rid, d["article_id"], version, pub["idempotency_key"], dumps(cand["approval"]["metadata"]), d["snapshot_id"], pub["build_id"],
                           cand["approval"]["pdf"], cand["approval"]["note"], cand["release_date"]))
                c.execute("UPDATE publications SET release_id = ? WHERE id = ?", (rid, pub["id"]))
        self.ws.db.run("UPDATE publications SET status = 'staging', message = 'Retrying', updated = ? WHERE id = ?", now(), pub["id"])
        return self._launch(pub["id"], run_async)

    def _launch(self, pid: str, run_async: bool) -> dict:
        if run_async:
            t = threading.Thread(target=self.run, args=(pid,), name=f"publish-{pid}", daemon=True)
            self.threads[pid] = t
            t.start()
        else:
            self.run(pid)
        return dict(self.ws.db.one("SELECT * FROM publications WHERE id = ?", pid))

    # Procedure -------------------------------------------------------------------------------
    def _set(self, pid, **fields):
        cols = ", ".join(f"{k} = ?" for k in fields)
        self.ws.db.run(f"UPDATE publications SET {cols}, updated = ? WHERE id = ?", *fields.values(), now(), pid)

    def run(self, pid: str) -> None:
        with self.lock:
            self._run(pid)

    def _candidate_for(self, pub) -> tuple[Candidate, bytes | None, dict]:
        cand = loads(pub["payload_json"])
        if pub["kind"] == "release":
            c = self.ws.candidate_object(pub["draft_id"], cand, pub["id"])
            pdf = self.ws.store.read_blob(cand["approval"]["pdf"])
            return c, pdf, cand
        a = cand["approval"]
        art = self.ws.article(pub["article_id"])
        edits = self.ws.news_edits_for(art, a["announcement"], 0, (a["venue"].get("date") or now()[:10]) if a["announcement"].get("mode") else now()[:10], pub["id"])
        for e in edits:
            e["date"] = now()[:10]
        return Candidate(article_id=pub["article_id"], links=a["links"], venue=a["venue"], disclosure="public", news_edits=edits), None, cand

    def _run(self, pid: str) -> None:
        db = self.ws.db
        pub = db.one("SELECT * FROM publications WHERE id = ?", pid)
        adapter = self.adapter()
        log: list[str] = loads(pub["steps_json"], [])
        receipt = loads(pub["receipt_json"], {})
        try:
            candidate, pdf, cand = self._candidate_for(pub)
            rel = db.one("SELECT * FROM releases WHERE id = ?", pub["release_id"]) if pub["release_id"] else None
            if rel and pdf is not None and hashlib.sha256(pdf).hexdigest() != rel["pdf_sha256"]:
                raise PublishError("The approved PDF bytes do not match the reservation.")
            # 1. Stage
            self._set(pid, status="staging", message="Building the complete site release", steps_json=dumps(log))
            staged = adapter.stage(pid, candidate, pdf, log)
            self._set(pid, steps_json=dumps(log), message="Staged; activating")
            # 2. Activate
            self._set(pid, status="deploying", message=f"Activating on {adapter.name}")
            receipt = adapter.activate(staged)
            self._set(pid, activated=1, receipt_json=dumps(receipt))
            if rel:
                db.run("UPDATE releases SET state = 'exposed', receipt_json = ? WHERE id = ?", dumps(receipt), rel["id"])
            # 3. Verify
            self._set(pid, status="verifying", message=f"Verifying {adapter.base_url}")
            urls = self.verify(adapter, candidate, log)
            # 4. Record success (only now does the local latest-release pointer move)
            self._finalize(pub, candidate, receipt, urls)
            log.append("Published and verified.")
            self._set(pid, status="published", message="Published and verified", urls_json=dumps(urls), steps_json=dumps(log))
            adapter.cleanup()
        except Exception as e:
            log.append(f"FAILED: {e}\n{traceback.format_exc()[-2000:]}")
            pub = db.one("SELECT * FROM publications WHERE id = ?", pid)
            if not pub["activated"]:
                self._abort_reservation(pub)
                msg = f"{e} The previous release remains live; nothing was published."
            else:
                undo = adapter.rollback(receipt)
                msg = f"Verification failed after activation: {e} {undo} The numbered version stays reserved for a retry."
            self._set(pid, status="failed", message=msg, steps_json=dumps(log))

    def _abort_reservation(self, pub) -> None:
        """A definitive pre-activation abort frees the reserved number (it was never public)."""
        if pub["release_id"]:
            self.ws.db.run("DELETE FROM releases WHERE id = ? AND state = 'reserved'", pub["release_id"])
            self.ws.db.run("UPDATE publications SET release_id = NULL WHERE id = ? AND NOT EXISTS (SELECT 1 FROM releases WHERE id = ?)", pub["id"], pub["release_id"])

    def _finalize(self, pub, candidate: Candidate, receipt: dict, urls: dict) -> None:
        with self.ws.db.tx() as c:
            if pub["release_id"]:
                c.execute("UPDATE releases SET state = 'public', published = ?, receipt_json = ? WHERE id = ?", (now(), dumps(receipt), pub["release_id"]))
                c.execute("UPDATE articles SET latest_release_id = ?, slug_locked = 1, title = ? WHERE id = ?",
                          (pub["release_id"], candidate.release["metadata"]["title"], pub["article_id"]))
                c.execute("UPDATE drafts SET status = 'published', updated = ? WHERE id = ?", (now(), pub["draft_id"]))
            c.execute("UPDATE articles SET links_json = ?, venue_json = ?, disclosure = ? WHERE id = ?",
                      (dumps(candidate.links or {}), dumps(candidate.venue or {}), candidate.disclosure or "public", pub["article_id"]))
            if pub["kind"] == "release":
                d = c.execute("SELECT cv_json FROM drafts WHERE id = ?", (pub["draft_id"],)).fetchone()
                c.execute("UPDATE articles SET cv_json = ? WHERE id = ?", (d["cv_json"], pub["article_id"]))
            for e in candidate.news_edits:
                c.execute("""INSERT INTO news_edits(id, article_id, release_id, publication_id, mode, news_slug, date, title, summary, tags_json, body, state)
                             VALUES(?,?,?,?,?,?,?,?,?,?,?, 'public')
                             ON CONFLICT(article_id, news_slug, mode) DO UPDATE SET body = excluded.body, publication_id = excluded.publication_id""",
                          (e["id"], e["article_id"], pub["release_id"], pub["id"], e["mode"], e["news_slug"], e["date"], e["title"], e["summary"], e["tags_json"], e["body"]))

    # Verification ----------------------------------------------------------------------------
    def verify(self, adapter, candidate: Candidate, log: list[str]) -> dict:
        cfg = self.ws.cfg
        deadline = time.monotonic() + (cfg.verify_timeout_seconds if adapter.name == "production" else 30)
        last = []
        while True:
            problems, urls = self._check(adapter.base_url, candidate)
            if not problems:
                log.append(f"Verified {len(urls['checked'])} URL(s) on {adapter.base_url}.")
                return urls
            last = problems
            if time.monotonic() > deadline:
                raise PublishError("Public verification failed: " + "; ".join(last[:6]))
            log.append(f"Waiting for deployment: {last[0]}")
            time.sleep(cfg.verify_interval_seconds if adapter.name == "production" else 1)

    def _check(self, base: str, candidate: Candidate) -> tuple[list[str], dict]:
        records = {r["articleId"]: r for r in public_state(self.ws.db, candidate)}
        rec = records.get(candidate.article_id)
        problems, checked = [], []
        if not rec:
            return ["the article is not in the public catalog"], {"checked": []}
        slug, latest = rec["slug"], rec["versions"][-1]

        def get(path):
            status, headers, body = http_get(f"{base}{path}")
            checked.append(path)
            return status, headers, body

        status, _, body = get(f"/preprints/{slug}/")
        if status != 200 or f"v{latest['version']}/paper.pdf".encode() not in body:
            problems.append(f"/preprints/{slug}/ does not show v{latest['version']} (HTTP {status})")
        if candidate.venue and candidate.venue.get("doi") and candidate.venue["doi"].encode() not in body:
            problems.append(f"/preprints/{slug}/ does not show the DOI yet")
        for v in rec["versions"] if candidate.release else [latest]:
            status, headers, body = get(f"/preprints/{slug}/v{v['version']}/paper.pdf")
            if status != 200 or not headers.get("content-type", "").startswith("application/pdf") or hashlib.sha256(body).hexdigest() != v["sha256"]:
                problems.append(f"/preprints/{slug}/v{v['version']}/paper.pdf is missing, not application/pdf, or has different bytes (HTTP {status})")
            status, _, body = get(f"/preprints/{slug}/v{v['version']}/")
            if status != 200:
                problems.append(f"/preprints/{slug}/v{v['version']}/ returned HTTP {status}")
        status, _, body = get(f"/preprints/{slug}/paper.pdf")
        if status != 200 or hashlib.sha256(body).hexdigest() != latest["sha256"]:
            problems.append(f"/preprints/{slug}/paper.pdf does not resolve to v{latest['version']}")
        status, _, body = get("/preprints/")
        if status != 200 or f'href="{slug}/"'.encode() not in body:
            problems.append("/preprints/ does not list the article")
        status, _, body = get("/assets/preprints-data.js")
        if status != 200 or f'"slug": "{slug}"'.encode() not in body:
            problems.append("homepage data (assets/preprints-data.js) does not include the article")
        status, _, body = get("/")
        if status != 200 or b"assets/preprints-data.js" not in body:
            problems.append("the homepage does not load the preprint data")
        for pj in rec["links"]["projectIds"]:
            status, _, body = get(f"/projects/{pj}/")
            if status != 200 or f"preprints/{slug}/".encode() not in body:
                problems.append(f"/projects/{pj}/ does not link the preprint")
        for e in candidate.news_edits:
            status, _, body = get(f"/news/{e['news_slug']}/")
            if status != 200 or f"/preprints/{slug}/".encode() not in body:
                problems.append(f"/news/{e['news_slug']}/ does not link the preprint")
        if any(e["mode"] == "new" for e in candidate.news_edits):
            status, _, body = get("/news/feed.xml")
            for e in candidate.news_edits:
                if e["mode"] == "new" and f"/news/{e['news_slug']}/".encode() not in body:
                    problems.append("RSS does not include the new story")
        status, _, body = get("/sitemap.xml")
        if status != 200 or f"/preprints/{slug}/v{latest['version']}/".encode() not in body:
            problems.append("the sitemap does not list the release")
        return problems, {"checked": checked, "article": f"{base}/preprints/{slug}/", "version": f"{base}/preprints/{slug}/v{latest['version']}/",
                          "pdf": f"{base}/preprints/{slug}/v{latest['version']}/paper.pdf", "latest_pdf": f"{base}/preprints/{slug}/paper.pdf"}

    # Recovery --------------------------------------------------------------------------------
    def reconcile_all(self) -> None:
        for pub in self.ws.db.all("SELECT * FROM publications WHERE status IN ('staging','deploying','verifying')"):
            self.reconcile(pub["id"])

    def reconcile(self, pid: str) -> None:
        db = self.ws.db
        pub = db.one("SELECT * FROM publications WHERE id = ?", pid)
        adapter = self.adapter()
        receipt = loads(pub["receipt_json"], {})
        log = loads(pub["steps_json"], [])
        if receipt and adapter.is_active(receipt):
            try:
                candidate, _, _ = self._candidate_for(pub)
                urls = self.verify(adapter, candidate, log)
                self._finalize(pub, candidate, receipt, urls)
                self._set(pid, status="published", activated=1, message="Recovered after restart: release verified", urls_json=dumps(urls), steps_json=dumps(log))
                return
            except Exception as e:
                self._set(pid, status="failed", activated=1, message=f"Interrupted after activation; verification failed: {e}. Retry to reuse the reservation.")
                return
        self._abort_reservation(pub)
        self._set(pid, status="failed", message="Interrupted before activation; the previous release remains live. Publish again to retry.")
