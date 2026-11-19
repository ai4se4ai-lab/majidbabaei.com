"""CV handoff: the exact entry and placement for the maintained LaTeX CV (docs/02_Curriculum_Vitae.tex).

ScholarPress never edits the CV. It prepares the entry in the CV's own \\cvpublication format, names the intended
subsection, and reports "applied" only when the maintained CV source actually contains the stable preprint URL
(and, after a venue update, the DOI). Anonymous or withheld work produces no export.
"""
from __future__ import annotations

import re
from pathlib import Path

SECTIONS = {
    "preprints": "Submitted Manuscripts and Current Research → Preprints (new subsection, if not present)",
    "submitted": "Submitted Manuscripts and Current Research → Submitted, under review, or revision requested",
    "ongoing": "Submitted Manuscripts and Current Research → On-going projects",
    "journal": "Publications → Refereed journal articles published or accepted",
    "conference": "Publications → Refereed conference and workshop papers",
}
STATUS_LABEL = {"preprint": "Preprint", "under-review": "Submitted", "revision-requested": "Revision requested", "accepted": "To appear", "published": ""}


def tex_escape(s: str) -> str:
    s = s.replace("\\", r"\textbackslash{}")
    s = re.sub(r"([&%$#_{}])", r"\\\1", s)
    return s.replace("~", r"\textasciitilde{}").replace("^", r"\textasciicircum{}")


def cv_authors(names: list[str], owner: str) -> str:
    def one(n: str) -> str:
        if n.strip().lower() == owner.lower():
            return r"\me"
        parts = n.split()
        if len(parts) > 1:  # "Jane Q. Doe" -> "J.\ Q.\ Doe" (the CV's initials style)
            return r"\ ".join(f"{p[0]}." for p in parts[:-1]) + r"\ " + tex_escape(parts[-1])
        return tex_escape(n)
    items = [one(n) for n in names]
    if len(items) <= 2:
        return r"\ and ".join(items) if len(items) == 2 and items[0] == r"\me" else " and ".join(items)
    return ", ".join(items[:-1]) + ", and " + items[-1]


def default_section(venue: dict | None) -> str:
    status = (venue or {}).get("status") or "preprint"
    if status in {"under-review", "revision-requested"}:
        return "submitted"
    if status in {"accepted", "published"}:
        return (venue or {}).get("kind") == "conference" and "conference" or "journal"
    return "preprints"


def handoff(*, cfg, slug: str, metadata: dict, venue: dict | None, cv: dict | None, disclosure: str, release_date: str) -> dict:
    cv = cv or {}
    if disclosure != "public":
        return {"status": "withheld", "section": None, "entry": None,
                "note": "Withheld while the work is anonymous for review. Keep the full entry in the private CV only."}
    venue = venue or {}
    section = cv.get("section") if cv.get("section") in SECTIONS else default_section(venue)
    if venue.get("status") in {"accepted", "published"} and section not in {"journal", "conference"}:
        section = default_section(venue)  # a confirmed venue moves the same entry to its refereed section
    url = f"{cfg.site_url}/preprints/{slug}/"
    label = cv.get("entryKey") or slug
    year = (venue.get("date") or release_date or "")[:4]
    status = STATUS_LABEL.get(venue.get("status") or "preprint", "")
    entry = (rf"\item\label{{pub:{label}}} \cvpublication{{{cv_authors([a['name'] for a in metadata['authors']], cfg.owner_name)}}}"
             rf"{{{tex_escape(metadata['title'])}}}{{{tex_escape(venue.get('name') or '')}}}{{}}{{{year}}}{{}}{{{tex_escape(venue.get('doi') or '')}}}{{{status}}}"
             rf" Preprint: \url{{{url}}}")
    applied, note = False, "Review the entry and add it to the CV, then rebuild the CV PDF and run the lab-site sync."
    path: Path | None = cfg.cv_path
    if path and Path(path).exists():
        text = Path(path).read_text(encoding="utf-8", errors="replace")
        has_url = url in text
        has_doi = not venue.get("doi") or venue["doi"] in text
        applied = has_url and has_doi
        if has_url and not has_doi:
            note = "The CV links the preprint but does not yet carry the confirmed DOI; update the same entry."
        elif applied:
            note = "Found in the maintained CV source."
    else:
        note = "The maintained CV source is not available here; deliver this entry and placement by hand. Status stays pending."
    return {"status": "applied" if applied else ("ready-for-review" if path else "pending"), "section": section,
            "sectionLabel": SECTIONS[section], "entry": entry, "note": note, "cvPath": str(path) if path else None}
