"""Fast tests: upload validation, manuscript inspection, log diagnostics, CV handoff, venue rules, site catalog."""
from __future__ import annotations

import pytest

from scholarpress import cv as cvmod
from scholarpress.db import Database
from scholarpress.diagnostics import dedupe, parse_biber_blg, parse_bibtex_blg, parse_tex_log
from scholarpress.service import Workspace
from scholarpress.site import load_catalog
from scholarpress.store import Incoming, Store, UploadError, clean_path, inspect_manuscript


@pytest.mark.parametrize("raw,ok", [
    ("main.tex", "main.tex"), ("figures/a.png", "figures/a.png"), ("figures\\a.png", "figures/a.png"), ("./x/./y.tex", "x/y.tex"),
    ("../etc/passwd", None), ("/abs/path.tex", None), ("C:/win.tex", None), ("a/../../b.tex", None), ("con.tex", None), ("sp ace.tex", None), ("", None)])
def test_clean_path(raw, ok):
    assert clean_path(raw) == ok


def test_upload_validation_reports_field_errors(tmp_path):
    store = Store(Database(tmp_path / "db.sqlite3"), tmp_path, max_files=3, max_file_mb=1, max_total_mb=1)
    files = [Incoming("main.tex", b"\\documentclass{article}", "entry", "tex"), Incoming("refs.txt", b"x", "bibliography", "bib"),
             Incoming("../x.png", b"\x89PNG\r\n\x1a\n", "support", "support"), Incoming("fig.png", b"not a png", "support", "support"),
             Incoming("Fig.PNG", b"\x89PNG\r\n\x1a\n", "support", "support"), Incoming("run.sh", b"rm -rf /", "support", "support")]
    errors = store.validate(files)
    text = " ".join(e["message"] for e in errors)
    assert {e["field"] for e in errors} >= {"bib", "support"}
    assert "Too many files" in text and "not a safe relative path" in text and "does not look like a valid PNG" in text
    assert "only by letter case" in text and ".sh files are not accepted" in text and "must be a .bib file" in text


def test_snapshot_is_immutable_and_inherits(tmp_path):
    db = Database(tmp_path / "db.sqlite3")
    store = Store(db, tmp_path)
    db.run("INSERT INTO articles(id, slug, title, created) VALUES('a1','s','t','now')")
    s1 = store.create_snapshot("a1", [Incoming("main.tex", b"v1", "entry", "tex"), Incoming("refs.bib", b"@x", "bibliography", "bib"),
                                      Incoming("fig/a.png", b"\x89PNG\r\n\x1a\nA", "support", "support"), Incoming("fig/b.png", b"\x89PNG\r\n\x1a\nB", "support", "support")])
    s2 = store.create_snapshot("a1", [Incoming("main.tex", b"v2", "entry", "tex")], parent_id=s1, remove={"fig/b.png"})
    f1 = {r["path"]: r for r in store.snapshot_files(s1)}
    f2 = {r["path"]: r for r in store.snapshot_files(s2)}
    assert set(f2) == {"main.tex", "refs.bib", "fig/a.png"}
    assert f2["main.tex"]["origin"] == "uploaded" and f2["refs.bib"]["origin"] == "inherited"
    assert store.read_blob(f1["main.tex"]["sha256"]) == b"v1" and store.read_blob(f2["main.tex"]["sha256"]) == b"v2"
    with pytest.raises(UploadError):
        store.create_snapshot("a1", [Incoming("main.tex", b"x", "entry", "tex")])  # no bibliography


def test_inspect_manuscript_detects_bibliography_declarations():
    tex = r"""\documentclass[11pt]{IEEEtran} % comment \bibliography{ignored}
    \title{A \emph{Title}} \begin{document}\begin{abstract} Short  abstract. \end{abstract}
    \bibliography{refs,more}\end{document}"""
    info = inspect_manuscript(tex)
    assert info["documentclass"] == "IEEEtran" and info["bibtex_files"] == ["refs.bib", "more.bib"] and not info["biblatex"]
    info = inspect_manuscript(r"\usepackage[backend=biber]{biblatex}\addbibresource{sources.bib}")
    assert info["biblatex"] and info["biblatex_files"] == ["sources.bib"] and info["bib_backend"] == "biber"


LOG = r"""This is pdfTeX
(./main.tex
LaTeX2e <2025-06-01>
(C:/texmf/tex/latex/base/article.cls
Document Class: article 2024/06/29 v1.4n Standard LaTeX document class
)
./main.tex:84: Undefined control sequence.
l.84 \foo
          bar
! LaTeX Error: File `figures/overview.png' not found.

See the LaTeX manual or LaTeX Companion for explanation.
l.90 \includegraphics{figures/overview.png}

LaTeX Warning: Citation `smith2024' on page 1 undefined on input line 12.
LaTeX Warning: Reference `sec:missing' on page 2 undefined on input line 30.
Overfull \hbox (12.3pt too wide) in paragraph at lines 40--41
(./sections/intro.tex
LaTeX Warning: Citation `jones2020' on page 3 undefined on input line 7.
)
)
"""


def test_tex_log_diagnostics_have_locations():
    d = dedupe(parse_tex_log(LOG, "main.tex", {"main.tex", "sections/intro.tex", "refs.bib"}))
    by = {(x["code"], x.get("key")): x for x in d}
    assert by[("undefined-command", "\\foo")]["line"] == 84 and by[("undefined-command", "\\foo")]["file"] == "main.tex"
    assert by[("missing-figure", "figures/overview.png")]["line"] == 90
    assert by[("undefined-citation", "smith2024")] == {**by[("undefined-citation", "smith2024")], "file": "main.tex", "line": 12}
    assert by[("undefined-citation", "jones2020")]["file"] == "sections/intro.tex"
    assert by[("undefined-reference", "sec:missing")]["line"] == 30
    overfull = by[("overfull-box", None)]
    assert overfull["severity"] == "warning" and overfull["line"] == 40
    assert all(x["severity"] == "error" for x in d if x["code"] != "overfull-box")


def test_bibliography_logs():
    blg = 'Database file #1: refs.bib\nWarning--I didn\'t find a database entry for "ghost"\nI couldn\'t open database file missing.bib\n'
    codes = {(x["code"], x.get("key")) for x in parse_bibtex_blg(blg, {"refs.bib"})}
    assert ("undefined-citation", "ghost") in codes and ("missing-bibliography", "missing.bib") in codes
    biber = "INFO - This is Biber 2.22\nWARN - I didn't find a database entry for 'lost' (section 0)\nERROR - Cannot find 'nope.bib'!\n"
    codes = {(x["code"], x.get("key")) for x in parse_biber_blg(biber)}
    assert ("undefined-citation", "lost") in codes and ("missing-bibliography", "nope.bib") in codes


class FakeCfg:
    site_url = "https://majidbabaei.com"
    owner_name = "Majid Babaei"
    cv_path = None


def test_cv_handoff_formats_entry_and_reports_pending(tmp_path):
    meta = {"title": "Safe & Sound: 100% Checks", "authors": [{"name": "Majid Babaei"}, {"name": "Jane Q. Doe"}, {"name": "Ali Ezaz"}]}
    h = cvmod.handoff(cfg=FakeCfg(), slug="safe-sound", metadata=meta, venue={"status": "preprint"}, cv={}, disclosure="public", release_date="2026-11-19")
    assert h["status"] == "pending" and h["section"] == "preprints"
    assert r"\cvpublication{\me, J.\ Q.\ Doe, and A.\ Ezaz}{Safe \& Sound: 100\% Checks}" in h["entry"]
    assert r"\url{https://majidbabaei.com/preprints/safe-sound/}" in h["entry"]
    cvfile = tmp_path / "cv.tex"
    cvfile.write_text("... https://majidbabaei.com/preprints/safe-sound/ ...", encoding="utf-8")
    cfg = FakeCfg()
    cfg.cv_path = cvfile
    assert cvmod.handoff(cfg=cfg, slug="safe-sound", metadata=meta, venue={}, cv={}, disclosure="public", release_date="2026")["status"] == "applied"
    pub = cvmod.handoff(cfg=cfg, slug="safe-sound", metadata=meta, venue={"status": "published", "doi": "10.1/x", "name": "TSE"}, cv={}, disclosure="public", release_date="2026")
    assert pub["status"] == "ready-for-review" and "DOI" in pub["note"] and pub["section"] == "journal"
    w = cvmod.handoff(cfg=cfg, slug="s", metadata=meta, venue={}, cv={}, disclosure="withheld", release_date="2026")
    assert w["status"] == "withheld" and w["entry"] is None


def test_venue_rules():
    v, errs = Workspace.validate_venue({"status": "published", "name": "TSE"})
    assert {e["field"] for e in errs} == {"venue.doi", "venue.confirmed"}
    v, errs = Workspace.validate_venue({"status": "published", "name": "TSE", "doi": "https://doi.org/10.1109/TSE.2026.1", "confirmed": True, "date": "2026-12-01"})
    assert not errs and v["doi"] == "10.1109/TSE.2026.1"
    v, errs = Workspace.validate_venue({"status": "preprint", "name": "ignored"})
    assert v == {"status": "preprint"} and not errs


def test_catalog_reads_site_collections(site_template):
    cat = load_catalog(site_template)
    assert "test-project" in cat.projects and "test-story" in cat.news and "test-pub" in cat.publications
    assert cat.publications["anonymous-review-1"]["anonymous"]
    assert "anonymous-review-1" not in cat.public_publications()
    errs = cat.validate_links({"publicationId": "anonymous-review-1", "projectIds": ["nope"], "newsPostIds": ["missing"], "agendaIds": ["research"]})
    assert {e["field"] for e in errs} == {"publicationId", "projectIds", "newsPostIds"}
    assert cat.suggest_publication("A synthetic manuscript for integration tests")[0]["key"] == "test-pub"
