"""Source ingestion: validation, content-addressed immutable blobs, and source snapshots.

Uploaded bytes are stored once under blobs/<sha256> and never modified; builds work on temporary copies.
"""
from __future__ import annotations

import hashlib
import os
import re
import shutil
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from .db import Database, dumps, new_id, now

ALLOWED = {".tex", ".bib", ".sty", ".cls", ".bst", ".png", ".jpg", ".jpeg", ".pdf"}
SEGMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._+-]*$")
RESERVED = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}


class UploadError(Exception):
    def __init__(self, errors: list[dict]):
        super().__init__("; ".join(e["message"] for e in errors))
        self.errors = errors


@dataclass
class Incoming:
    path: str      # relative path as given by the author
    data: bytes
    role: str      # entry | bibliography | support
    field: str     # form field, for field-level errors


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def clean_path(raw: str) -> str | None:
    """Normalize a relative upload path; None when it could escape the build directory or is not portable."""
    if not raw or "\x00" in raw:
        return None
    p = raw.replace("\\", "/").strip()
    if p.startswith("/") or re.match(r"^[A-Za-z]:", p):
        return None
    parts = [s for s in p.split("/") if s not in ("", ".")]
    if not parts or any(s == ".." or not SEGMENT.match(s) or s.split(".")[0].lower() in RESERVED for s in parts):
        return None
    if len(parts) > 8 or len("/".join(parts)) > 200:
        return None
    return "/".join(parts)


class Store:
    def __init__(self, db: Database, data_dir: Path, *, max_files=200, max_file_mb=50, max_total_mb=200):
        self.db = db
        self.blobs = Path(data_dir) / "blobs"
        self.blobs.mkdir(parents=True, exist_ok=True)
        self.max_files, self.max_file = max_files, max_file_mb * 1024 * 1024
        self.max_total = max_total_mb * 1024 * 1024

    # Blobs ---------------------------------------------------------------------------
    def blob_path(self, digest: str) -> Path:
        if not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError("bad digest")
        return self.blobs / digest[:2] / digest

    def put_blob(self, data: bytes) -> str:
        digest = sha256(data)
        target = self.blob_path(digest)
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            tmp = target.with_suffix(f".tmp{os.getpid()}")
            tmp.write_bytes(data)
            os.replace(tmp, target)
            try:
                os.chmod(target, 0o444)
            except OSError:
                pass
        return digest

    def read_blob(self, digest: str) -> bytes:
        data = self.blob_path(digest).read_bytes()
        if sha256(data) != digest:
            raise IOError(f"blob {digest} is corrupt")
        return data

    # Validation ------------------------------------------------------------------------
    def validate(self, files: list[Incoming], inherited: dict[str, dict] | None = None) -> list[dict]:
        errors: list[dict] = []
        seen: dict[str, str] = {k.lower(): k for k in (inherited or {})}
        total = 0
        if len(files) + len(inherited or {}) > self.max_files:
            errors.append({"field": "support", "message": f"Too many files: the limit is {self.max_files}."})
        for f in files:
            p = clean_path(f.path)
            if p is None:
                errors.append({"field": f.field, "message": f"“{f.path}” is not a safe relative path. Use letters, digits, dot, dash or underscore, without “..” or drive letters."})
                continue
            ext = PurePosixPath(p).suffix.lower()
            if ext not in ALLOWED:
                errors.append({"field": f.field, "message": f"“{p}”: {ext or 'no extension'} files are not accepted. Allowed: {', '.join(sorted(ALLOWED))}."})
            if f.role == "entry" and ext != ".tex":
                errors.append({"field": f.field, "message": "The main manuscript must be a .tex file."})
            if f.role == "bibliography" and ext != ".bib":
                errors.append({"field": f.field, "message": "The bibliography must be a .bib file."})
            if len(f.data) == 0:
                errors.append({"field": f.field, "message": f"“{p}” is empty."})
            if len(f.data) > self.max_file:
                errors.append({"field": f.field, "message": f"“{p}” is larger than {self.max_file // 1048576} MB."})
            if ext in {".png"} and not f.data.startswith(b"\x89PNG\r\n\x1a\n") or ext in {".jpg", ".jpeg"} and not f.data.startswith(b"\xff\xd8") \
                    or ext == ".pdf" and not f.data.lstrip()[:5] == b"%PDF-":
                errors.append({"field": f.field, "message": f"“{p}” does not look like a valid {ext[1:].upper()} file."})
            if ext in {".tex", ".bib", ".sty", ".cls", ".bst"} and b"\x00" in f.data:
                errors.append({"field": f.field, "message": f"“{p}” contains binary data; text sources expected."})
            key = p.lower()
            if key in seen and seen[key] != p:
                errors.append({"field": f.field, "message": f"“{p}” differs from “{seen[key]}” only by letter case."})
            elif sum(1 for e in files if clean_path(e.path) == p) > 1:
                errors.append({"field": f.field, "message": f"“{p}” was uploaded more than once."})
            seen.setdefault(key, p)
            total += len(f.data)
        if total > self.max_total:
            errors.append({"field": "support", "message": f"Uploads total more than {self.max_total // 1048576} MB."})
        # De-duplicate repeated messages (duplicates are reported once per path).
        unique, out = set(), []
        for e in errors:
            k = (e["field"], e["message"])
            if k not in unique:
                unique.add(k)
                out.append(e)
        return out

    # Snapshots -------------------------------------------------------------------------
    def create_snapshot(self, article_id: str, files: list[Incoming], *, parent_id: str | None = None,
                        remove: set[str] | None = None) -> str:
        """Create an immutable snapshot from new uploads plus files inherited from parent_id (minus `remove`)."""
        inherited: dict[str, dict] = {}
        if parent_id:
            for row in self.db.all("SELECT * FROM snapshot_files WHERE snapshot_id = ?", parent_id):
                inherited[row["path"]] = dict(row)
        new_paths = {clean_path(f.path) for f in files}
        new_roles = {f.role for f in files}
        for path, row in list(inherited.items()):
            # A new entry or bibliography replaces the previous one; explicitly removed assets are dropped.
            if path in new_paths or (remove and path in remove) or (row["role"] in new_roles and row["role"] in {"entry", "bibliography"}):
                inherited.pop(path)
        errors = self.validate(files, inherited)
        entries = [f for f in files if f.role == "entry"] or [r for r in inherited.values() if r["role"] == "entry"]
        bibs = [f for f in files if f.role == "bibliography"] or [r for r in inherited.values() if r["role"] == "bibliography"]
        if not entries:
            errors.append({"field": "tex", "message": "Upload the main .tex file."})
        if not bibs:
            errors.append({"field": "bib", "message": "Upload the .bib bibliography."})
        if errors:
            raise UploadError(errors)
        sid = new_id("snp")
        entry = clean_path(entries[0].path) if isinstance(entries[0], Incoming) else entries[0]["path"]
        bib_paths = [clean_path(b.path) if isinstance(b, Incoming) else b["path"] for b in bibs]
        with self.db.tx() as c:
            c.execute("INSERT INTO snapshots(id, article_id, parent_id, entry, bib_paths_json, created) VALUES(?,?,?,?,?,?)",
                      (sid, article_id, parent_id, entry, dumps(bib_paths), now()))
            for f in files:
                digest = self.put_blob(f.data)
                c.execute("INSERT INTO snapshot_files(id, snapshot_id, path, role, origin, size, sha256) VALUES(?,?,?,?,?,?,?)",
                          (new_id("fil"), sid, clean_path(f.path), f.role, "uploaded", len(f.data), digest))
            for path, row in inherited.items():
                c.execute("INSERT INTO snapshot_files(id, snapshot_id, path, role, origin, size, sha256) VALUES(?,?,?,?,?,?,?)",
                          (new_id("fil"), sid, path, row["role"], "inherited", row["size"], row["sha256"]))
        return sid

    def snapshot_files(self, snapshot_id: str):
        return self.db.all("SELECT * FROM snapshot_files WHERE snapshot_id = ? ORDER BY role != 'entry', role != 'bibliography', path", snapshot_id)

    def materialize(self, snapshot_id: str, target: Path) -> None:
        target.mkdir(parents=True, exist_ok=True)
        root = target.resolve()
        for row in self.snapshot_files(snapshot_id):
            dest = (target / row["path"]).resolve()
            if root not in dest.parents:
                raise ValueError(f"path escapes build directory: {row['path']}")
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(self.blob_path(row["sha256"]), dest)
            os.chmod(dest, 0o644)

    def input_fingerprint(self, snapshot_id: str) -> str:
        snap = self.db.one("SELECT entry, bib_paths_json FROM snapshots WHERE id = ?", snapshot_id)
        rows = [(r["path"], r["sha256"], r["role"]) for r in self.snapshot_files(snapshot_id)]
        return sha256(dumps({"entry": snap["entry"], "bibs": snap["bib_paths_json"], "files": sorted(rows)}).encode())


# ---------------------------------------------------------------------------------------------
# Manuscript inspection (before compiling)

def strip_comments(tex: str) -> str:
    return re.sub(r"(?<!\\)%.*", "", tex)


def inspect_manuscript(tex: str) -> dict:
    body = strip_comments(tex)
    cls = re.search(r"\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}", body)
    bibtex = [n.strip() for m in re.finditer(r"\\bibliography\s*\{([^}]*)\}", body) for n in m.group(1).split(",") if n.strip()]
    biblatex = [m.group(1).strip() for m in re.finditer(r"\\addbibresource\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}", body)]
    uses_biblatex = bool(re.search(r"\\usepackage\s*(?:\[[^\]]*\])?\s*\{[^}]*\bbiblatex\b", body))
    backend = re.search(r"backend\s*=\s*(\w+)", body) if uses_biblatex else None
    title = re.search(r"\\title\s*(?:\[[^\]]*\])?\s*\{((?:[^{}]|\{[^{}]*\})*)\}", body)
    abstract = re.search(r"\\begin\{abstract\}(.*?)\\end\{abstract\}", body, re.S)
    return {
        "documentclass": cls.group(1).strip() if cls else None,
        "bibtex_files": [n if n.endswith(".bib") else f"{n}.bib" for n in bibtex],
        "biblatex_files": [n if n.endswith(".bib") else f"{n}.bib" for n in biblatex],
        "biblatex": uses_biblatex,
        "bib_backend": (backend.group(1).lower() if backend else ("biber" if uses_biblatex else "bibtex")),
        "title": re.sub(r"\s+", " ", title.group(1)).strip() if title else "",
        "abstract": re.sub(r"\s+", " ", abstract.group(1)).strip() if abstract else "",
    }
