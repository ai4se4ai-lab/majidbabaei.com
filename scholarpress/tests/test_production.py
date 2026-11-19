"""Production adapter against a local bare repository standing in for GitHub (nothing leaves the machine)."""
from __future__ import annotations

import hashlib
import subprocess

import pytest

from scholarpress.publish import Publisher
from scholarpress.service import Workspace

from .test_app import Client, confirm_metadata, fake_build, make_pdf, upload, wait_publication
from scholarpress.app import create_app


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


@pytest.fixture
def prod(cfg, site, tmp_path, monkeypatch):
    bare = tmp_path / "remote.git"
    git(tmp_path, "init", "--bare", "-b", "main", str(bare))
    git(site, "init", "-b", "main")
    git(site, "config", "user.name", "ScholarPress Test")
    git(site, "config", "user.email", "test@example.invalid")
    git(site, "config", "core.autocrlf", "false")
    git(site, "add", "-A")
    git(site, "commit", "-m", "fixture site")
    git(site, "remote", "add", "origin", str(bare))
    git(site, "push", "origin", "main")
    cfg.adapter = "production"
    cfg.verify_timeout_seconds = 5
    cfg.verify_interval_seconds = 1
    seen = {}

    def deployed(self, adapter, candidate, log):
        # Stand-in for GitHub Pages: the pushed commit is the deployment. Check it carries the exact bytes.
        head = git(bare, "rev-parse", "main")
        seen["head"] = head
        return {"checked": [], "article": "https://majidbabaei.com/preprints/x/"}
    monkeypatch.setattr(Publisher, "verify", deployed)
    ws = Workspace(cfg)
    client = Client(create_app(cfg, workspace=ws, start_servers=False))
    yield client, ws, bare, seen
    client.close()


def test_production_publish_pushes_one_release_commit(prod, site):
    client, ws, bare, seen = prod
    did = upload(client, slug="prod-paper").json()["draft_id"]
    confirm_metadata(client, ws, did)
    client.patch(f"/api/drafts/{did}", json={"rev": ws.draft(did)["rev"], "links": {"projectIds": ["test-project"]}})
    pdf = make_pdf("prod")
    fake_build(ws, did, pdf)
    base = git(bare, "rev-parse", "main")
    cand = client.get(f"/api/drafts/{did}/candidate").json()
    r = client.post(f"/api/drafts/{did}/publish", json={"build_id": cand["build_id"], "fingerprint": cand["fingerprint"], "idempotency_key": "kp"})
    p = wait_publication(client, r.json()["id"], timeout=300)
    assert p["status"] == "published", "\n".join(p["steps"])
    head = git(bare, "rev-parse", "main")
    assert head != base and seen["head"] == head
    assert git(bare, "rev-parse", f"{head}~1") == base  # exactly one fast-forward commit
    files = git(bare, "show", "--name-only", "--format=", head).splitlines()
    assert "preprints/prod-paper/v1/paper.pdf" in files and "preprints/prod-paper/preprint.json" in files and "assets/preprints-data.js" in files
    blob = subprocess.run(["git", "show", f"{head}:preprints/prod-paper/v1/paper.pdf"], cwd=bare, capture_output=True, check=True).stdout
    assert hashlib.sha256(blob).hexdigest() == hashlib.sha256(pdf).hexdigest()
    assert git(site, "rev-parse", "HEAD") == head  # clean checkout was fast-forwarded
    receipt = ws.db.one("SELECT receipt_json FROM releases WHERE state = 'public'")["receipt_json"]
    assert head in receipt


def test_production_refuses_when_checkout_has_unpushed_commits(prod, site):
    client, ws, bare, _ = prod
    (site / "README.md").write_text((site / "README.md").read_text(encoding="utf-8") + "\nlocal change\n", encoding="utf-8")
    git(site, "commit", "-am", "unpushed work")
    did = upload(client, slug="prod-paper-2").json()["draft_id"]
    confirm_metadata(client, ws, did)
    fake_build(ws, did, make_pdf("p2"))
    base = git(bare, "rev-parse", "main")
    cand = client.get(f"/api/drafts/{did}/candidate").json()
    r = client.post(f"/api/drafts/{did}/publish", json={"build_id": cand["build_id"], "fingerprint": cand["fingerprint"], "idempotency_key": "kp2"})
    p = wait_publication(client, r.json()["id"], timeout=120)
    assert p["status"] == "failed" and "differs from origin/main" in p["message"]
    assert git(bare, "rev-parse", "main") == base
    assert ws.db.one("SELECT COUNT(*) AS n FROM releases")["n"] == 0
