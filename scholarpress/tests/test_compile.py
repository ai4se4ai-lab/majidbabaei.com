"""Real builds with latexmk (marked `tex`). Each blocking case must point at the relevant source location or log."""
from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from scholarpress.db import loads
from scholarpress.service import Workspace
from scholarpress.store import Incoming

from .conftest import TEX_AVAILABLE, fixture_files

pytestmark = [pytest.mark.tex, pytest.mark.skipif(not TEX_AVAILABLE, reason="latexmk not installed")]
STARTER = Path(__file__).resolve().parents[1] / "starter"


def build(ws: Workspace, files: dict[str, bytes], *, entry: str, bib: str, profile="preserve", timeout=None):
    roles = lambda p: "entry" if p == entry else ("bibliography" if p == bib else "support")
    res = ws.create_article([Incoming(p, b, roles(p), "x") for p, b in files.items()])
    did = res["draft_id"]
    ws.update_draft(did, ws.draft(did)["rev"], {"profile": {"kind": profile, "engine": "pdflatex"}})
    if timeout:
        ws.cfg.timeout_seconds = timeout
    bid = ws.enqueue_build(did)
    ws.run_build(bid)
    b = ws.build(bid)
    return b, loads(b["diagnostics_json"]), did


def codes(diags, severity="error"):
    return {d["code"] for d in diags if d["severity"] == severity}


@pytest.fixture
def ws(cfg):
    return Workspace(cfg)


def test_bibtex_fixture_builds_and_originals_are_byte_identical(ws):
    files = fixture_files("bibtex")
    b, d, did = build(ws, files, entry="main.tex", bib="refs.bib")
    assert b["status"] == "ready" and not b["blocked"], d
    assert b["pages"] >= 1 and Path(b["pdf_path"]).read_bytes().startswith(b"%PDF-")
    for row in ws.store.snapshot_files(ws.draft(did)["snapshot_id"]):
        assert ws.store.read_blob(row["sha256"]) == files[row["path"]]
    log = Path(b["log_path"]).read_text(encoding="utf-8")
    assert "-no-shell-escape" in log and "-norc" in log


def test_biber_fixture_builds(ws):
    # No kpsewhich probing here: on MiKTeX with AutoInstall enabled, a lookup can download packages.
    b, d, _ = build(ws, fixture_files("biber"), entry="paper.tex", bib="sources.bib")
    missing = [x for x in d if x["code"] == "missing-package"]
    if missing:
        assert all("line" not in x for x in missing if "required by" in x["message"])  # system files never borrow manuscript lines
        pytest.skip(f"TeX distribution lacks {', '.join(x['key'] for x in missing)} (builds never install packages)")
    assert b["status"] == "ready", d
    assert "biber" in Path(b["log_path"]).read_text(encoding="utf-8").lower()


def test_error_inside_a_system_package_has_no_manuscript_line():
    from scholarpress.diagnostics import parse_tex_log
    log = ("(./paper.tex (C:/texmf/tex/latex/biblatex/biblatex.sty\n"
           "C:/texmf/tex/latex/biblatex/biblatex.sty:43: LaTeX Error: File `logreq.sty' not found.\n"
           "l.43 \\RequirePackage\n))\n")
    x = next(x for x in parse_tex_log(log, "paper.tex", {"paper.tex", "sources.bib"}) if x["code"] == "missing-package")
    assert x["key"] == "logreq.sty" and x["file"] == "paper.tex" and "line" not in x and "biblatex.sty" in x["message"]


def test_house_profile_compiles_the_starter(ws):
    files = {"main.tex": (STARTER / "main.tex").read_bytes(), "references.bib": (STARTER / "references.bib").read_bytes()}
    b, d, _ = build(ws, files, entry="main.tex", bib="references.bib", profile="house")
    assert b["status"] == "ready", d
    assert not codes(d)


def test_house_profile_rejects_other_classes_without_compiling(ws):
    b, d, _ = build(ws, fixture_files("bibtex"), entry="main.tex", bib="refs.bib", profile="house")
    assert b["blocked"] and "house-incompatible" in codes(d)
    assert "Preserve layout" in next(x for x in d if x["code"] == "house-incompatible")["action"]


def test_bib_filename_mismatch_is_reported_before_compiling(ws):
    files = fixture_files("bibtex")
    files["references.bib"] = files.pop("refs.bib")
    b, d, _ = build(ws, files, entry="main.tex", bib="references.bib")
    x = next(x for x in d if x["code"] == "bib-name-mismatch")
    assert b["blocked"] and x["key"] == "refs.bib" and "references.bib" in x["message"]
    assert b["pdf_path"] is None and "Build not started" in Path(b["log_path"]).read_text(encoding="utf-8")


def test_missing_citation_points_to_key_and_line(ws):
    files = fixture_files("bibtex")
    files["main.tex"] = files["main.tex"].replace(b"\\cite{knuth1984}", b"\\cite{smith2024}")
    b, d, _ = build(ws, files, entry="main.tex", bib="refs.bib")
    x = next(x for x in d if x["code"] == "undefined-citation" and x.get("key") == "smith2024")
    assert b["blocked"] and x["file"] == "main.tex" and x["line"] == 13
    assert b["pdf_path"]  # a partial preview PDF exists but cannot be published


def test_undefined_label_points_to_line(ws):
    files = fixture_files("bibtex")
    files["main.tex"] = files["main.tex"].replace(b"Section~\\ref{sec:method}", b"Section~\\ref{sec:missing}")
    b, d, _ = build(ws, files, entry="main.tex", bib="refs.bib")
    x = next(x for x in d if x["code"] == "undefined-reference")
    assert b["blocked"] and x["key"] == "sec:missing" and x["line"] == 13


def test_missing_figure_is_named(ws):
    files = fixture_files("bibtex")
    files.pop("figures/dot.png")
    b, d, _ = build(ws, files, entry="main.tex", bib="refs.bib")
    x = next(x for x in d if x["code"] == "missing-figure")
    assert b["blocked"] and x["key"] == "figures/dot.png" and x["file"] == "main.tex" and x["line"] == 21


def test_malformed_source_reports_tex_error_with_line(ws):
    files = fixture_files("bibtex")
    files["main.tex"] = files["main.tex"].replace(b"We cite prior work", b"We \\undefinedmacro cite prior work")
    b, d, _ = build(ws, files, entry="main.tex", bib="refs.bib")
    x = next(x for x in d if x["code"] == "undefined-command")
    assert b["blocked"] and x["line"] == 13 and x["key"] == "\\undefinedmacro"


def test_timeout_stops_the_build_and_keeps_a_log(ws):
    files = fixture_files("bibtex")
    files["main.tex"] = files["main.tex"].replace(b"\\maketitle", b"\\maketitle\\def\\loop{\\loop}\\loop")
    b, d, _ = build(ws, files, entry="main.tex", bib="refs.bib", timeout=15)
    assert b["blocked"] and "timeout" in codes(d)
    assert Path(b["log_path"]).exists() and "timed out" in Path(b["log_path"]).read_text(encoding="utf-8")


def test_end_to_end_real_builds_v1_broken_revision_v2(cfg, staging_server):
    """Completion criterion with real latexmk builds through the HTTP API and the staging site."""
    import time
    from fastapi.testclient import TestClient  # noqa: F401
    from scholarpress.app import create_app
    from scholarpress.publish import http_get
    from .test_app import Client, confirm_metadata, publish, upload
    ws = Workspace(cfg)
    ws.start()  # background build worker
    client = Client(create_app(cfg, workspace=ws, start_servers=False))
    try:
        def build_via_api(did):
            bid = client.post(f"/api/drafts/{did}/builds").json()["build_id"]
            for _ in range(600):
                b = client.get(f"/api/builds/{bid}").json()
                if b["status"] not in ("queued", "running"):
                    return b
                time.sleep(1)
            raise AssertionError("build did not finish")

        did = upload(client, slug="real-build").json()["draft_id"]
        aid = ws.draft(did)["article_id"]
        confirm_metadata(client, ws, did)
        b1 = build_via_api(did)
        assert b1["ready"], b1["diagnostics"]
        p1, _ = publish(client, ws, did)
        assert p1["status"] == "published", p1
        v1 = http_get(f"http://127.0.0.1:{cfg.staging_port}/preprints/real-build/v1/paper.pdf")[2]
        assert hashlib.sha256(v1).hexdigest() == b1["pdf_sha256"]

        files = fixture_files("bibtex")
        broken = client.post(f"/api/articles/{aid}/drafts", files=[("tex", ("main.tex", files["main.tex"].replace(b"\\cite{knuth1984}", b"\\cite{nobody2026}"), "text/x-tex"))],
                             data={"basis_release_id": ws.article(aid)["latest_release_id"]}).json()["draft_id"]
        confirm_metadata(client, ws, broken)
        bb = build_via_api(broken)
        assert not bb["ready"] and any(d.get("key") == "nobody2026" and d.get("line") == 13 for d in bb["diagnostics"])
        assert http_get(f"http://127.0.0.1:{cfg.staging_port}/preprints/real-build/paper.pdf")[2] == v1

        fixed = client.post(f"/api/articles/{aid}/drafts", files=[("tex", ("main.tex", files["main.tex"].replace(b"A dot.", b"A revised dot."), "text/x-tex"))],
                            data={"basis_draft_id": broken}).json()["draft_id"]
        confirm_metadata(client, ws, fixed)
        b2 = build_via_api(fixed)
        assert b2["ready"], b2["diagnostics"]
        p2, _ = publish(client, ws, fixed)
        assert p2["status"] == "published" and p2["version"] == 2, p2
        assert http_get(f"http://127.0.0.1:{cfg.staging_port}/preprints/real-build/v1/paper.pdf")[2] == v1
        assert hashlib.sha256(http_get(f"http://127.0.0.1:{cfg.staging_port}/preprints/real-build/v2/paper.pdf")[2]).hexdigest() == b2["pdf_sha256"]
    finally:
        client.close()
