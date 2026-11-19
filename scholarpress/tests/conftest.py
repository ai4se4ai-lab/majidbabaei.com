"""Shared fixtures. Tests never touch the real site checkout: they work on a temporary copy with a synthetic
test project, test story, and test publication added."""
from __future__ import annotations

import json
import re
import shutil
import socket
import subprocess
from pathlib import Path

import pytest

from scholarpress.config import load_config
from scholarpress.publish import copy_site
from scholarpress.servers import StaticServer

REAL_SITE = Path(__file__).resolve().parents[2]
FIXTURES = Path(__file__).resolve().parent / "fixtures"
TEX_AVAILABLE = shutil.which("latexmk") is not None


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def site_template(tmp_path_factory) -> Path:
    """A copy of the real checkout plus synthetic fixtures (built once per test session)."""
    dst = tmp_path_factory.mktemp("site") / "majidbabaei.com"
    copy_site(REAL_SITE, dst)
    shutil.copytree(REAL_SITE / "node_modules", dst / "node_modules")
    # Remove any real preprint records so tests start from an empty catalog.
    shutil.rmtree(dst / "preprints", ignore_errors=True)
    (dst / "projects" / "test-project").mkdir()
    (dst / "projects" / "test-project" / "project.json").write_text(json.dumps({
        "meta": {"name": "Test Project", "theme": "Student projects", "description": "Synthetic project for ScholarPress tests.", "status": "Development"},
        "releases": [{"tag": "v0", "date": "2026-01-01", "type": "milestone", "title": "Started", "notes": "Fixture."}], "gallery": []}), encoding="utf-8")
    (dst / "news" / "posts" / "2026-11-01-test-story.md").write_text(
        "---\ntitle: Test story about ongoing work\ndate: 2026-11-01\ntags: [Research]\nsummary: A synthetic story for tests.\n---\n\nOriginal paragraph. "
        "This synthetic story stands in for an existing Newsroom article so that ScholarPress tests can link a preprint to it, "
        "append an update block, and confirm that the story keeps its original URL and RSS identity.\n", encoding="utf-8")
    rd = dst / "assets" / "research-data.js"
    text = rd.read_text(encoding="utf-8")
    data = json.loads(text[text.index("window.RESEARCH = ") + 18:text.rindex(";")])
    data["submitted"].append({"status": "Submitted", "venue": "Test Venue", "title": "A synthetic manuscript for integration tests.", "authors": "M. Babaei.",
                              "paper": None, "preprint": None, "code": None, "abstract": None, "key": "test-pub", "anonymous": False, "bibtex": "@misc{test-pub}"})
    rd.write_text(text[:text.index("window.RESEARCH = ")] + "window.RESEARCH = " + json.dumps(data, indent=1) + ";\n", encoding="utf-8")
    for tool in ("build-preprints.mjs", "build-projects.mjs", "build-calendar.mjs", "build-news.mjs"):
        subprocess.run(["node", str(dst / "tools" / tool)], cwd=dst, check=True, capture_output=True)
    return dst


@pytest.fixture
def site(site_template, tmp_path) -> Path:
    dst = tmp_path / "site" / "majidbabaei.com"
    shutil.copytree(site_template, dst)
    return dst


@pytest.fixture
def cfg(site, tmp_path):
    c = load_config(data_dir=tmp_path / "data", site_dir=site, compiler="local", timeout_seconds=240, staging_port=free_port(),
                    preview_port=free_port(), port=8765, cv_path=tmp_path / "cv.tex")
    (tmp_path / "cv.tex").write_text("\\section{Publications}\n", encoding="utf-8")
    c.ensure_dirs()
    return c


@pytest.fixture
def staging_server(cfg):
    srv = StaticServer(cfg.data_dir / "staging" / "current", cfg.staging_port).start()
    yield srv
    srv.stop()


def fixture_files(name: str) -> dict[str, bytes]:
    root = FIXTURES / name
    return {str(p.relative_to(root)).replace("\\", "/"): p.read_bytes() for p in root.rglob("*") if p.is_file()}


def strip_html(s: str) -> str:
    return re.sub(r"<[^>]+>", " ", s)
