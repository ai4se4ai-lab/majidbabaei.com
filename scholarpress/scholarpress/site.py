"""Read the website checkout's existing collections so link targets are chosen by readable name and validated by ID.

Sources (all inside the majidbabaei.com checkout):
  assets/research-data.js   publications (key, title, status group, anonymous flag) and research projects (CV-generated)
  projects/<slug>/project.json   local-only projects ("meta" block)
  news/posts/*.md           Newsroom stories (slug from the file name; title/date from front matter)
"""
from __future__ import annotations

import difflib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

AGENDA = {"research": "Research agenda", "software": "Research software & artifacts", "publications": "Publications", "students": "Students"}
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def project_slug(name: str) -> str:
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", name.split(" / ")[0].lower()))


def slugify(text: str, limit: int = 60) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s[:limit].rstrip("-") or "preprint"


def _js_object(path: Path, var: str):
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8")
    start = text.index(f"window.{var} = ") + len(f"window.{var} = ")
    end = text.rindex(";")
    return json.loads(text[start:end])


def front_matter(text: str) -> dict:
    m = re.match(r"^﻿?---\r?\n(.*?)\r?\n---\r?\n?", text, re.S)
    meta = {}
    if m:
        for line in m.group(1).splitlines():
            kv = re.match(r"^([A-Za-z]+):\s*(.*)$", line)
            if kv:
                meta[kv.group(1)] = kv.group(2).strip().strip("\"'")
    return meta


@dataclass
class Catalog:
    publications: dict[str, dict] = field(default_factory=dict)
    projects: dict[str, str] = field(default_factory=dict)
    news: dict[str, dict] = field(default_factory=dict)
    agenda: dict[str, str] = field(default_factory=lambda: dict(AGENDA))

    def public_publications(self):
        return {k: v for k, v in self.publications.items() if not v["anonymous"]}

    def suggest_publication(self, title: str) -> list[dict]:
        """Title similarity is only a suggestion; the author confirms a match."""
        norm = lambda s: re.sub(r"[^a-z0-9 ]", "", s.lower())
        scored = []
        for key, p in self.public_publications().items():
            ratio = difflib.SequenceMatcher(None, norm(title), norm(p["title"])).ratio()
            if ratio >= 0.6:
                scored.append({"key": key, "title": p["title"], "group": p["group"], "score": round(ratio, 2)})
        return sorted(scored, key=lambda x: -x["score"])[:3]

    def validate_links(self, links: dict) -> list[dict]:
        errors = []
        pid = links.get("publicationId")
        if pid:
            p = self.publications.get(pid)
            if not p:
                errors.append({"field": "publicationId", "message": f"Publication “{pid}” no longer exists in the site data. Choose another entry or none."})
            elif p["anonymous"]:
                errors.append({"field": "publicationId", "message": "That publication is anonymous for review; it cannot be linked publicly."})
        for pj in links.get("projectIds") or []:
            if pj not in self.projects:
                errors.append({"field": "projectIds", "message": f"Project “{pj}” was not found under projects/. Remove it or pick an existing project."})
        for n in links.get("newsPostIds") or []:
            if n not in self.news:
                errors.append({"field": "newsPostIds", "message": f"News story “{n}” was not found in news/posts/. Remove it or pick an existing story."})
        for a in links.get("agendaIds") or []:
            if a not in self.agenda:
                errors.append({"field": "agendaIds", "message": f"Unknown homepage section “{a}”."})
        return errors

    def to_json(self) -> dict:
        return {
            "publications": [{"key": k, **{x: v[x] for x in ("title", "group", "venue", "status")}} for k, v in self.public_publications().items()],
            "projects": [{"id": k, "name": v} for k, v in sorted(self.projects.items(), key=lambda kv: kv[1].lower())],
            "news": [{"id": k, **v} for k, v in sorted(self.news.items(), key=lambda kv: kv[1]["date"], reverse=True)],
            "agenda": [{"id": k, "name": v} for k, v in self.agenda.items()],
        }


def load_catalog(site_dir: Path) -> Catalog:
    cat = Catalog()
    research = _js_object(site_dir / "assets" / "research-data.js", "RESEARCH") or {"projects": [], "published": [], "submitted": []}
    for group in ("published", "submitted"):
        for p in research.get(group, []):
            cat.publications[p["key"]] = {"title": p["title"], "group": group, "anonymous": bool(p.get("anonymous")),
                                          "venue": p.get("venue", ""), "status": p.get("status") or p.get("year", "")}
    for p in research.get("projects", []):
        cat.projects[project_slug(p["name"])] = p["name"]
    pdir = site_dir / "projects"
    if pdir.exists():
        for f in sorted(pdir.iterdir()):
            pj = f / "project.json"
            if f.is_dir() and f.name not in cat.projects and pj.exists():
                meta = json.loads(pj.read_text(encoding="utf-8")).get("meta")
                if meta and meta.get("name"):
                    cat.projects[f.name] = meta["name"]
    ndir = site_dir / "news" / "posts"
    if ndir.exists():
        for f in sorted(ndir.glob("*.md")):
            meta = front_matter(f.read_text(encoding="utf-8"))
            slug = re.sub(r"^\d{4}(-\d{2}){0,2}-", "", f.stem)
            cat.news[slug] = {"title": meta.get("title", slug), "date": meta.get("date", ""), "file": f.name, "preprint": meta.get("preprint", "")}
    return cat
