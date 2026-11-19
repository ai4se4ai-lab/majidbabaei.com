"""HTTP-level tests: security boundary, the full release cycle on the staging adapter, conflicts, recovery, and redaction.

Builds are inserted directly (fake_build) so these run without TeX; tests/test_compile.py exercises real builds.
"""
from __future__ import annotations

import hashlib
import io
import re
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter

from scholarpress.app import create_app
from scholarpress.compiler import normalize_profile, profile_fingerprint
from scholarpress.db import dumps, loads, new_id, now
from scholarpress.publish import StagingAdapter, http_get
from scholarpress.service import Workspace

from .conftest import fixture_files

BASE = "http://127.0.0.1:8765"
ORIGIN = {"Origin": BASE}


def make_pdf(label: str) -> bytes:
    w = PdfWriter()
    w.add_blank_page(width=612, height=792)
    w.add_metadata({"/Title": label})
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


def fake_build(ws: Workspace, draft_id: str, pdf: bytes | None, *, blocked=False) -> str:
    d = ws.draft(draft_id)
    prof = normalize_profile(loads(d["profile_json"]))
    bid = new_id("bld")
    sha = ws.store.put_blob(pdf) if pdf else None
    log = ws.cfg.data_dir / "builds" / bid / "build.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    log.write_text("fake build log", encoding="utf-8")
    diags = [{"severity": "error", "code": "undefined-citation", "message": "Undefined citation “ghost”", "action": "Fix it.", "file": "main.tex", "line": 3, "key": "ghost"}] if blocked else []
    ws.db.run("""INSERT INTO builds(id, draft_id, snapshot_id, input_fp, profile_fp, profile_json, toolchain, runner, status, blocked, diagnostics_json,
                 pdf_sha256, pdf_path, log_path, pages, created, started, finished) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
              bid, draft_id, d["snapshot_id"], ws.store.input_fingerprint(d["snapshot_id"]), profile_fingerprint(prof), dumps(prof), "fake", "fake",
              "failed" if blocked else "ready", int(blocked), dumps(diags), sha, str(ws.store.blob_path(sha)) if sha else None, str(log), 1, now(), now(), now())
    return bid


class Client:
    def __init__(self, app):
        self.c = TestClient(app, base_url=BASE)
        self.c.__enter__()
        html = self.c.get("/").text
        self.csrf = re.search(r'name="csrf-token" content="([^"]+)"', html).group(1)

    def h(self):
        return {**ORIGIN, "X-CSRF-Token": self.csrf}

    def get(self, url, **kw):
        return self.c.get(url, **kw)

    def post(self, url, **kw):
        return self.c.post(url, headers=self.h(), **kw)

    def patch(self, url, **kw):
        return self.c.patch(url, headers=self.h(), **kw)

    def close(self):
        self.c.__exit__(None, None, None)


@pytest.fixture
def app_ws(cfg, staging_server):
    ws = Workspace(cfg)
    app = create_app(cfg, workspace=ws, start_servers=False)
    client = Client(app)
    yield client, ws
    client.close()


def upload(client, files=None, slug=None):
    files = files or fixture_files("bibtex")
    multipart = [("tex", ("main.tex", files["main.tex"], "text/x-tex")), ("bib", ("refs.bib", files["refs.bib"], "text/plain")),
                 ("support", ("dot.png", files["figures/dot.png"], "image/png"))]
    data = {"support_paths": "figures/dot.png", **({"slug": slug} if slug else {})}
    return client.post("/api/articles", files=multipart, data=data)


def rev(ws, did):
    return ws.draft(did)["rev"]


def wait_publication(client, pid, timeout=180):
    deadline = time.time() + timeout
    while time.time() < deadline:
        p = client.get(f"/api/publications/{pid}").json()
        if p["status"] in ("published", "failed"):
            return p
        time.sleep(0.5)
    raise AssertionError("publication did not finish")


def confirm_metadata(client, ws, did, title="Synthetic Integration Manuscript", **extra):
    r = client.patch(f"/api/drafts/{did}", json={"rev": rev(ws, did), "metadata": {
        "title": title, "abstract": "A synthetic manuscript for ScholarPress integration tests.", "confirmed": True,
        "authors": [{"name": "Majid Babaei", "affiliation": "University of the Fraser Valley"}, {"name": "Test Coauthor", "affiliation": ""}]}, **extra})
    assert r.status_code == 200, r.text
    return r


def publish(client, ws, did, key=None):
    cand = client.get(f"/api/drafts/{did}/candidate").json()
    assert cand["ready"], cand["reasons"]
    r = client.post(f"/api/drafts/{did}/publish", json={"build_id": cand["build_id"], "fingerprint": cand["fingerprint"], "idempotency_key": key or new_id("k")})
    assert r.status_code == 202, r.text
    return wait_publication(client, r.json()["id"]), cand


def fetch(cfg, path):
    return http_get(f"http://127.0.0.1:{cfg.staging_port}{path}")


# ------------------------------------------------------------------------------------------------ security

def test_security_boundary(app_ws):
    client, ws = app_ws
    assert TestClient(client.c.app, base_url="http://evil.example").get("/").status_code == 400  # DNS-rebinding guard
    r = client.c.post("/api/articles", headers={"Origin": "http://evil.example", "X-CSRF-Token": client.csrf})
    assert r.status_code == 403
    r = client.c.post("/api/articles", headers={**ORIGIN})
    assert r.status_code == 403 and "CSRF" in r.json()["detail"]
    r = client.c.post("/api/articles", headers={**ORIGIN, "X-CSRF-Token": client.csrf, "Sec-Fetch-Site": "cross-site"})
    assert r.status_code == 403
    r = client.c.options("/api/articles", headers=ORIGIN)
    assert r.status_code == 405 and "access-control-allow-origin" not in r.headers
    g = client.get("/")
    assert g.headers["cache-control"] == "no-store" and "frame-ancestors" in g.headers["content-security-policy"]
    assert client.c.get("/api/articles").status_code == 405  # writes are never GET


def test_create_article_downloads_originals_and_escapes_user_data(app_ws):
    client, ws = app_ws
    r = upload(client)
    assert r.status_code == 201, r.text
    did = r.json()["draft_id"]
    files = fixture_files("bibtex")
    for row in ws.store.snapshot_files(ws.draft(did)["snapshot_id"]):
        got = client.get(f"/files/{row['id']}")
        assert got.status_code == 200 and got.headers["cache-control"] == "no-store"
        assert hashlib.sha256(got.content).hexdigest() == hashlib.sha256(files[row["path"]]).hexdigest()
    confirm_metadata(client, ws, did, title="<script>alert(1)</script> Title")
    page = client.get(f"/drafts/{did}").text
    assert "<script>alert(1)</script>" not in page and "&lt;script&gt;alert(1)&lt;/script&gt;" in page
    bad = client.post("/api/articles", files=[("tex", ("main.tex", b"x", "text/x-tex"))])
    assert bad.status_code == 422 and any(e["field"] == "bib" for e in bad.json()["errors"])


# ------------------------------------------------------------------------------------------------ release cycle

def test_release_cycle_v1_broken_revision_v2_and_doi_update(app_ws, cfg):
    client, ws = app_ws
    did = upload(client).json()["draft_id"]
    aid = ws.draft(did)["article_id"]
    confirm_metadata(client, ws, did)
    r = client.patch(f"/api/drafts/{did}", json={"rev": rev(ws, did), "links": {"publicationId": "test-pub", "projectIds": ["test-project"], "newsPostIds": [], "agendaIds": ["research"]},
                                                "announcement": {**ws.default_announcement(did), "newsSlug": "synthetic-preprint"}, "cv": {"section": "preprints"}})
    assert r.status_code == 200, r.text
    pdf1 = make_pdf("v1")
    fake_build(ws, did, pdf1)
    cand = client.get(f"/api/drafts/{did}/candidate").json()
    assert cand["ready"] and cand["version"] == 1
    surfaces = {s["surface"] for s in cand["summary"]}
    assert {"Preprints", "Homepage publications", "Projects", "Newsroom", "Public files"} <= surfaces
    # Stale approval: a change after the preview invalidates its fingerprint.
    client.patch(f"/api/drafts/{did}", json={"rev": rev(ws, did), "revision_note": "First public version."})
    stale = client.post(f"/api/drafts/{did}/publish", json={"build_id": cand["build_id"], "fingerprint": cand["fingerprint"], "idempotency_key": "k-stale"})
    assert stale.status_code == 409 and "out of date" in stale.json()["detail"]

    key = "k-v1"
    p1, cand1 = publish(client, ws, did, key)
    assert p1["status"] == "published", p1
    assert p1["version"] == 1 and p1["urls"]["article"].endswith(f"/preprints/{ws.article(aid)['slug']}/")
    slug = ws.article(aid)["slug"]
    # Duplicate click with the same key: same publication, no second release.
    again = client.post(f"/api/drafts/{did}/publish", json={"build_id": cand1["build_id"], "fingerprint": cand1["fingerprint"], "idempotency_key": key})
    assert again.json()["id"] == p1["id"]
    assert ws.db.one("SELECT COUNT(*) AS n FROM releases WHERE article_id = ?", aid)["n"] == 1
    assert ws.article(aid)["slug_locked"] == 1

    # Every surface links the same stable article.
    s, h, body = fetch(cfg, f"/preprints/{slug}/v1/paper.pdf")
    assert s == 200 and h["content-type"] == "application/pdf" and body == pdf1
    assert fetch(cfg, f"/preprints/{slug}/paper.pdf")[2] == pdf1
    landing = fetch(cfg, f"/preprints/{slug}/")[2].decode()
    assert "citation_pdf_url" in landing and "/projects/test-project/" in landing and "#pub-test-pub" in landing and "news/synthetic-preprint/" in landing
    assert f'"publicationId": "test-pub"' in fetch(cfg, "/assets/preprints-data.js")[2].decode()
    assert f"preprints/{slug}/" in fetch(cfg, "/projects/test-project/")[2].decode()
    story = fetch(cfg, "/news/synthetic-preprint/")[2].decode()
    assert f"/preprints/{slug}/v1/paper.pdf" in story
    assert "/news/synthetic-preprint/" in fetch(cfg, "/news/feed.xml")[2].decode()
    assert f"/preprints/{slug}/v1/" in fetch(cfg, "/sitemap.xml")[2].decode()
    assert fetch(cfg, f"/preprints/{slug}/v1/citation.bib")[2].startswith(b"@misc{")
    assert fetch(cfg, f"/preprints/{slug}/v1/paper.pdf")[1].get("cache-control", "").endswith("immutable")
    # Range requests are served.
    import urllib.request
    req = urllib.request.Request(f"http://127.0.0.1:{cfg.staging_port}/preprints/{slug}/v1/paper.pdf", headers={"Range": "bytes=0-7"})
    with urllib.request.urlopen(req) as rr:
        assert rr.status == 206 and rr.read() == pdf1[:8]
    # CV export references the stable link.
    assert f"https://majidbabaei.com/preprints/{slug}/" in cand1["cv"]["entry"]

    # A broken revision leaves v1 current.
    files = fixture_files("bibtex")
    r = client.post(f"/api/articles/{aid}/drafts", files=[("tex", ("main.tex", files["main.tex"].replace(b"knuth1984", b"ghost"), "text/x-tex"))],
                    data={"basis_release_id": ws.article(aid)["latest_release_id"]})
    assert r.status_code == 201, r.text
    did2 = r.json()["draft_id"]
    snap2 = {f["path"]: f["origin"] for f in ws.store.snapshot_files(ws.draft(did2)["snapshot_id"])}
    assert snap2 == {"main.tex": "uploaded", "refs.bib": "inherited", "figures/dot.png": "inherited"}
    confirm_metadata(client, ws, did2)
    fake_build(ws, did2, make_pdf("broken"), blocked=True)
    c2 = client.get(f"/api/drafts/{did2}/candidate").json()
    assert not c2["ready"] and any("blocking" in x for x in c2["reasons"])
    refused = client.post(f"/api/drafts/{did2}/publish", json={"build_id": c2["build_id"], "fingerprint": c2["fingerprint"], "idempotency_key": "k-broken"})
    assert refused.status_code == 409
    assert fetch(cfg, f"/preprints/{slug}/paper.pdf")[2] == pdf1
    assert ws.db.one("SELECT COUNT(*) AS n FROM releases WHERE article_id = ?", aid)["n"] == 1

    # Fixed revision becomes v2; v1 stays byte-identical, and the v1 story link still resolves to v1.
    pdf2 = make_pdf("v2")
    fake_build(ws, did2, pdf2)
    p2, _ = publish(client, ws, did2)
    assert p2["status"] == "published" and p2["version"] == 2, p2
    assert fetch(cfg, f"/preprints/{slug}/v1/paper.pdf")[2] == pdf1
    assert fetch(cfg, f"/preprints/{slug}/v2/paper.pdf")[2] == pdf2
    assert fetch(cfg, f"/preprints/{slug}/paper.pdf")[2] == pdf2
    v1_page = fetch(cfg, f"/preprints/{slug}/v1/")[2].decode()
    assert "see the latest version (v2)" in v1_page
    story = fetch(cfg, "/news/synthetic-preprint/")[2].decode()
    assert f"/preprints/{slug}/v1/paper.pdf" in story
    news_rows = ws.db.all("SELECT * FROM news_edits WHERE article_id = ?", aid)
    assert len(news_rows) == 1  # the revision published quietly
    project_page = fetch(cfg, "/projects/test-project/")[2].decode()
    assert project_page.count(f"preprint-{slug}") == 1 and f"preprints/{slug}/v2/" in project_page

    # Metadata-only venue update: DOI shown, no new version, CV handoff carries the DOI.
    changes = {"venue": {"status": "published", "name": "Test Journal", "kind": "journal", "doi": "10.1234/test.5678", "date": "2026-12-01",
                         "citation": "M. Babaei and T. Coauthor. Synthetic. Test Journal, 2026.", "confirmed": True},
               "links": {"publicationId": "test-pub", "projectIds": ["test-project"], "newsPostIds": ["synthetic-preprint"], "agendaIds": ["research"]}}
    prev = client.post(f"/api/articles/{aid}/updates/preview", json=changes).json()
    assert prev["ready"], prev
    assert "10.1234/test.5678" in prev["cv"]["entry"] and prev["cv"]["section"] == "journal"
    r = client.post(f"/api/articles/{aid}/updates", json={"changes": changes, "fingerprint": prev["fingerprint"], "idempotency_key": "k-doi"})
    assert r.status_code == 202, r.text
    pu = wait_publication(client, r.json()["id"])
    assert pu["status"] == "published", pu
    assert ws.db.one("SELECT COUNT(*) AS n FROM releases WHERE article_id = ?", aid)["n"] == 2
    landing = fetch(cfg, f"/preprints/{slug}/")[2].decode()
    assert "10.1234/test.5678" in landing and "Test Journal" in landing
    assert fetch(cfg, f"/preprints/{slug}/v1/paper.pdf")[2] == pdf1  # history intact

    # Private material never ships.
    live = Path((cfg.data_dir / "staging" / "current").read_text(encoding="utf-8"))
    leaked = [p for p in live.rglob("*") if p.is_file() and (p.suffix in {".tex", ".log", ".blg", ".sqlite3"} or p.name == "preprint.json"
                                                              or (p.suffix == ".bib" and p.name != "citation.bib"))]
    assert not leaked, leaked
    assert not any(b"fake build log" in p.read_bytes() for p in live.rglob("*.html"))


def test_second_tab_conflict_and_idempotency_key_reuse(app_ws):
    client, ws = app_ws
    did = upload(client).json()["draft_id"]
    r0 = rev(ws, did)
    assert client.patch(f"/api/drafts/{did}", json={"rev": r0, "revision_note": "tab A"}).status_code == 200
    stale = client.patch(f"/api/drafts/{did}", json={"rev": r0, "revision_note": "tab B"})
    assert stale.status_code == 409 and "another tab" in stale.json()["detail"]
    assert ws.draft(did)["revision_note"] == "tab A"
    confirm_metadata(client, ws, did)
    fake_build(ws, did, make_pdf("x"))
    cand = client.get(f"/api/drafts/{did}/candidate").json()
    # Another publication in progress blocks a second one (catalog concurrency).
    ws.db.run("INSERT INTO publications(id, kind, article_id, idempotency_key, fingerprint, adapter, status, created, updated) VALUES('pub_busy','metadata',?,'busy','f','staging','deploying','n','n')",
              ws.draft(did)["article_id"])
    busy = client.post(f"/api/drafts/{did}/publish", json={"build_id": cand["build_id"], "fingerprint": cand["fingerprint"], "idempotency_key": "k1"})
    assert busy.status_code == 409 and "in progress" in busy.json()["detail"]
    ws.db.run("DELETE FROM publications WHERE id = 'pub_busy'")
    p, _ = publish(client, ws, did, "k1")
    assert p["status"] == "published"
    misuse = client.post(f"/api/drafts/{did}/publish", json={"build_id": cand["build_id"], "fingerprint": "0" * 64, "idempotency_key": "k1"})
    assert misuse.status_code == 409


def test_activation_failure_keeps_old_release_and_frees_version(app_ws, cfg, monkeypatch):
    client, ws = app_ws
    did = upload(client).json()["draft_id"]
    aid = ws.draft(did)["article_id"]
    confirm_metadata(client, ws, did)
    fake_build(ws, did, make_pdf("x"))

    def boom(self, staged):
        raise RuntimeError("simulated host failure during activation")
    monkeypatch.setattr(StagingAdapter, "activate", boom)
    cand = client.get(f"/api/drafts/{did}/candidate").json()
    r = client.post(f"/api/drafts/{did}/publish", json={"build_id": cand["build_id"], "fingerprint": cand["fingerprint"], "idempotency_key": "k-boom"})
    p = wait_publication(client, r.json()["id"])
    assert p["status"] == "failed" and "previous release remains live" in p["message"]
    assert ws.db.one("SELECT COUNT(*) AS n FROM releases WHERE article_id = ?", aid)["n"] == 0
    assert not (cfg.data_dir / "staging" / "current").exists()
    monkeypatch.undo()
    # Retrying the same attempt reserves v1 again and succeeds.
    r = client.post(f"/api/drafts/{did}/publish", json={"build_id": cand["build_id"], "fingerprint": cand["fingerprint"], "idempotency_key": "k-boom"})
    p = wait_publication(client, r.json()["id"])
    assert p["status"] == "published" and p["version"] == 1


def test_restart_recovers_builds_and_activated_publication(app_ws, cfg, monkeypatch):
    client, ws = app_ws
    did = upload(client).json()["draft_id"]
    aid = ws.draft(did)["article_id"]
    confirm_metadata(client, ws, did)
    fake_build(ws, did, make_pdf("x"))
    # Simulate a crash right after activation: verification never ran.
    def crash(self, adapter, candidate, log):
        raise SystemExit("process killed")
    monkeypatch.setattr("scholarpress.publish.Publisher.verify", crash)
    cand = client.get(f"/api/drafts/{did}/candidate").json()
    pid = new_id("pub")
    from scholarpress.publish import Publisher
    with pytest.raises(SystemExit):
        # Run synchronously so the "crash" leaves the attempt in 'verifying'.
        ws.publisher._run = Publisher._run.__get__(ws.publisher)
        ws.publisher.request_release(did, cand["build_id"], cand["fingerprint"], "k-crash", run_async=False)
    row = ws.db.one("SELECT * FROM publications WHERE idempotency_key = 'k-crash'")
    assert row["status"] == "verifying" and row["activated"] == 1
    ws.db.run("UPDATE builds SET status = 'running' WHERE draft_id = ?", did)
    monkeypatch.undo()
    ws2 = Workspace(cfg)  # restart
    ws2.recover()
    assert ws2.db.one("SELECT status FROM builds WHERE draft_id = ?", did)["status"] == "interrupted"
    row = ws2.db.one("SELECT * FROM publications WHERE idempotency_key = 'k-crash'")
    assert row["status"] == "published", row["message"]
    assert ws2.db.one("SELECT state FROM releases WHERE article_id = ?", aid)["state"] == "public"


def test_withheld_work_is_absent_from_every_public_output(app_ws, cfg):
    client, ws = app_ws
    # Public article B, published normally.
    did_b = upload(client, slug="public-paper").json()["draft_id"]
    confirm_metadata(client, ws, did_b, title="Openly Released Paper")
    fake_build(ws, did_b, make_pdf("b"))
    # Withheld article A with distinctive identifiers.
    files = fixture_files("bibtex")
    files["main.tex"] = files["main.tex"].replace(b"Synthetic Integration Manuscript", b"Zebra Quokka Redacted Study")
    did_a = upload(client, files=files, slug="zebra-quokka").json()["draft_id"]
    r = client.patch(f"/api/drafts/{did_a}", json={"rev": rev(ws, did_a), "disclosure": "withheld", "metadata": {
        "title": "Zebra Quokka Redacted Study", "abstract": "Quokka abstract.", "confirmed": True, "authors": [{"name": "Hidden Author"}]}})
    assert r.status_code == 200
    bad = client.patch(f"/api/drafts/{did_a}", json={"rev": rev(ws, did_a), "links": {"publicationId": "anonymous-review-1"}})
    assert bad.status_code == 422
    fake_build(ws, did_a, make_pdf("a"))
    ca = client.get(f"/api/drafts/{did_a}/candidate").json()
    assert not ca["ready"] and any("withheld" in x.lower() for x in ca["reasons"]) and ca["cv"]["status"] == "withheld" and ca["cv"]["entry"] is None
    refused = client.post(f"/api/drafts/{did_a}/publish", json={"build_id": ca["build_id"], "fingerprint": ca["fingerprint"], "idempotency_key": "k-a"})
    assert refused.status_code == 409
    p, _ = publish(client, ws, did_b)
    assert p["status"] == "published"
    live = Path((cfg.data_dir / "staging" / "current").read_text(encoding="utf-8"))
    for f in live.rglob("*"):
        if f.is_file() and f.suffix in {".html", ".js", ".json", ".xml", ".bib", ".txt", ".ics"}:
            text = f.read_text(encoding="utf-8", errors="replace")
            assert "Zebra Quokka" not in text and "zebra-quokka" not in text and "Hidden Author" not in text, f
    assert not (live / "preprints" / "zebra-quokka").exists()


def test_update_existing_story_keeps_its_url_and_feed_identity(app_ws, cfg):
    client, ws = app_ws
    did = upload(client, slug="story-linked").json()["draft_id"]
    confirm_metadata(client, ws, did)
    r = client.patch(f"/api/drafts/{did}", json={"rev": rev(ws, did), "announcement": {"mode": "update", "newsPostId": "test-story",
                                                "body": "Update: the preprint is now available at [its stable page](/preprints/story-linked/)."}})
    assert r.status_code == 200, r.text
    fake_build(ws, did, make_pdf("s"))
    p, _ = publish(client, ws, did)
    assert p["status"] == "published", p
    story = fetch(cfg, "/news/test-story/")[2].decode()
    assert "Original paragraph." in story and "/preprints/story-linked/" in story and "scholarpress:begin" not in story
    feed = fetch(cfg, "/news/feed.xml")[2].decode()
    assert feed.count("<guid>https://majidbabaei.com/news/test-story/</guid>") == 1
    assert "news/test-story/" in fetch(cfg, "/preprints/story-linked/")[2].decode()
    assert not (cfg.site_dir / "preprints" / "story-linked").exists()  # the staging adapter never writes into the checkout
