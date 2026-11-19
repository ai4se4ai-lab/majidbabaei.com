"""Export adapter: write the public preprint catalog into a website tree and run the site's own builders.

The export is deterministic and idempotent. Every publish rewrites the complete public catalog from the database
(all public releases plus the candidate), so a retry or the next normal site rebuild reproduces the same files.
Articles whose disclosure is not "public" are never written. Published PDF paths never receive different bytes.
"""
from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from .db import Database, loads
from .store import Store, sha256

NEWS_MARK = "scholarpress"


class ExportError(Exception):
    pass


class ImmutabilityError(ExportError):
    pass


@dataclass
class Candidate:
    """Changes not yet public: a new release and/or new article state, plus approved news edits."""
    article_id: str
    release: dict | None = None          # {version, date, note, sha256, metadata}
    links: dict | None = None
    venue: dict | None = None
    disclosure: str | None = None
    news_edits: list[dict] = field(default_factory=list)


def public_state(db: Database, candidate: Candidate | None = None) -> list[dict]:
    """The public catalog: one record per article with at least one released version (public, exposed, or candidate)."""
    records = []
    for art in db.all("SELECT * FROM articles ORDER BY slug"):
        cand = candidate if candidate and candidate.article_id == art["id"] else None
        rels = db.all("SELECT * FROM releases WHERE article_id = ? AND state IN ('public','exposed') ORDER BY version", art["id"])
        versions = [{"version": r["version"], "date": r["release_date"], "note": r["note"], "sha256": r["pdf_sha256"], **_meta(loads(r["metadata_json"]))}
                    for r in rels]
        if cand and cand.release and not any(v["version"] == cand.release["version"] for v in versions):
            r = cand.release
            versions.append({"version": r["version"], "date": r["date"], "note": r.get("note", ""), "sha256": r["sha256"], **_meta(r["metadata"])})
        if not versions:
            continue
        disclosure = cand.disclosure if cand and cand.disclosure else art["disclosure"]
        if disclosure != "public":
            continue
        links = cand.links if cand and cand.links is not None else loads(art["links_json"], {})
        venue = cand.venue if cand and cand.venue is not None else loads(art["venue_json"], {})
        records.append({
            "articleId": art["id"], "slug": art["slug"], "disclosure": "public",
            "links": {k: links.get(k) or ([] if k != "publicationId" else None) for k in ("publicationId", "projectIds", "newsPostIds", "agendaIds")},
            "venue": venue or None,
            "versions": sorted(versions, key=lambda v: v["version"]),
        })
    return records


def _meta(m: dict) -> dict:
    return {"title": m["title"], "authors": [{"name": a["name"], **({"affiliation": a["affiliation"]} if a.get("affiliation") else {})} for a in m["authors"]],
            "abstract": m["abstract"]}


def news_edits(db: Database, candidate: Candidate | None = None) -> list[dict]:
    rows = [dict(r) for r in db.all("SELECT * FROM news_edits WHERE state = 'public' ORDER BY id")]
    if candidate:
        rows += candidate.news_edits
    public_articles = {a["id"]: a for a in db.all("SELECT id, slug, disclosure FROM articles")}
    out = []
    for e in rows:
        art = public_articles.get(e["article_id"])
        disclosure = candidate.disclosure if candidate and candidate.article_id == e["article_id"] and candidate.disclosure else (art and art["disclosure"])
        if art and disclosure == "public":
            out.append({**e, "article_slug": art["slug"]})
    return out


def _fm_value(s: str) -> str:
    return re.sub(r"\s+", " ", str(s)).strip()


def render_new_story(e: dict) -> str:
    tags = json.loads(e["tags_json"]) if isinstance(e.get("tags_json"), str) else e.get("tags", [])
    tags = tags or ["Preprints"]
    return (f"---\ntitle: {_fm_value(e['title'])}\ndate: {e['date']}\ntags: [{', '.join(_fm_value(t) for t in tags)}]\n"
            f"summary: {_fm_value(e['summary'])}\npreprint: {e['article_slug']}\n---\n\n{e['body'].strip()}\n")


def apply_story_update(text: str, e: dict) -> str:
    begin = f"<!-- {NEWS_MARK}:begin {e['article_id']} -->"
    end = f"<!-- {NEWS_MARK}:end {e['article_id']} -->"
    block = f"{begin}\n\n{e['body'].strip()}\n\n{end}"
    pattern = re.compile(re.escape(begin) + r".*?" + re.escape(end), re.S)
    if pattern.search(text):
        return pattern.sub(lambda _: block, text)
    return text.rstrip("\n") + "\n\n" + block + "\n"


def write_catalog(db: Database, store: Store, tree: Path, candidate: Candidate | None = None, candidate_pdf: bytes | None = None) -> dict:
    """Write records, PDFs and news edits into `tree`. Returns a summary of touched paths."""
    touched: list[str] = []
    records = public_state(db, candidate)
    pdir = tree / "preprints"
    pdir.mkdir(exist_ok=True)
    for rec in records:
        folder = pdir / rec["slug"]
        folder.mkdir(exist_ok=True)
        for v in rec["versions"]:
            target = folder / f"v{v['version']}" / "paper.pdf"
            if candidate and candidate.release and candidate.article_id == rec["articleId"] and v["version"] == candidate.release["version"] and candidate_pdf is not None:
                data = candidate_pdf
            else:
                row = db.one("SELECT b.pdf_path FROM releases r JOIN builds b ON b.id = r.build_id WHERE r.article_id = ? AND r.version = ?", rec["articleId"], v["version"])
                data = store.read_blob(v["sha256"]) if store.blob_path(v["sha256"]).exists() else Path(row["pdf_path"]).read_bytes()
            if sha256(data) != v["sha256"]:
                raise ImmutabilityError(f"stored PDF for {rec['slug']} v{v['version']} does not match its recorded hash")
            if target.exists():
                if sha256(target.read_bytes()) != v["sha256"]:
                    raise ImmutabilityError(f"{target.relative_to(tree)} already exists with different bytes; published versions never change")
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            touched.append(str(target.relative_to(tree)))
        rec_path = folder / "preprint.json"
        content = json.dumps(rec, indent=1, ensure_ascii=False) + "\n"
        if not rec_path.exists() or rec_path.read_text(encoding="utf-8") != content:
            rec_path.write_text(content, encoding="utf-8", newline="\n")
            touched.append(str(rec_path.relative_to(tree)))
    posts = tree / "news" / "posts"
    for e in news_edits(db, candidate):
        if e["mode"] == "new":
            path = posts / f"{e['date']}-{e['news_slug']}.md"
            others = [p for p in posts.glob(f"*-{e['news_slug']}.md") if re.sub(r"^\d{4}(-\d{2}){0,2}-", "", p.stem) == e["news_slug"] and p != path]
            if others:
                raise ExportError(f"news slug “{e['news_slug']}” is already used by {others[0].name}")
            if path.exists() and f"preprint: {e['article_slug']}" not in path.read_text(encoding="utf-8"):
                raise ExportError(f"{path.name} exists and was not written by ScholarPress for this article")
            content = render_new_story(e)
        else:
            matches = [p for p in posts.glob("*.md") if re.sub(r"^\d{4}(-\d{2}){0,2}-", "", p.stem) == e["news_slug"]]
            if not matches:
                raise ExportError(f"news story “{e['news_slug']}” to update was not found")
            path = matches[0]
            content = apply_story_update(path.read_text(encoding="utf-8"), e)
        if not path.exists() or path.read_text(encoding="utf-8") != content:
            path.write_text(content, encoding="utf-8", newline="\n")
            touched.append(str(path.relative_to(tree)))
    return {"records": records, "touched": touched}


def run_site_builders(tree: Path, node: str = "node", check_only: bool = False) -> list[str]:
    logs = []
    for tool in ("build-preprints.mjs", "build-projects.mjs", "build-calendar.mjs", "build-news.mjs"):
        args = [node, str(tree / "tools" / tool)] + (["--check"] if check_only else [])
        r = subprocess.run(args, cwd=tree, capture_output=True, text=True, timeout=300)
        logs.append(f"$ node tools/{tool}{' --check' if check_only else ''}\n{r.stdout}{r.stderr}")
        if r.returncode != 0:
            raise ExportError(f"tools/{tool} failed:\n{(r.stderr or r.stdout).strip()[:2000]}")
    return logs


def run_public_build(tree: Path, node: str = "node") -> list[str]:
    logs = []
    for tool in ("build-public.mjs", "check-public.mjs"):
        r = subprocess.run([node, str(tree / "tools" / tool)], cwd=tree, capture_output=True, text=True, timeout=300)
        logs.append(f"$ node tools/{tool}\n{r.stdout}{r.stderr}")
        if r.returncode != 0:
            raise ExportError(f"tools/{tool} failed:\n{(r.stderr or r.stdout).strip()[:2000]}")
    return logs
