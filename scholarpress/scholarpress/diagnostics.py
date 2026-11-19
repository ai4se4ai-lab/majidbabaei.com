"""Turn final TeX/BibTeX/Biber logs into structured diagnostics.

Each diagnostic: severity (error blocks publication; warning needs review), code, message, file, line, key, action,
and a log excerpt when the toolchain gives no reliable location.
"""
from __future__ import annotations

import re
from pathlib import PurePosixPath

GRAPHICS = {".png", ".jpg", ".jpeg", ".pdf", ".eps"}
Q = r"[`'‘’\"]"  # LaTeX quotes vary by kernel version


def diag(severity, code, message, action, *, file=None, line=None, key=None, excerpt=None) -> dict:
    d = {"severity": severity, "code": code, "message": message, "action": action}
    if file:
        d["file"] = file
    if line:
        d["line"] = int(line)
    if key:
        d["key"] = key
    if excerpt:
        d["excerpt"] = excerpt.strip()[:1200]
    return d


def _norm(path: str, workdir_markers=("./",)) -> str:
    p = path.replace("\\", "/")
    for m in workdir_markers:
        if p.startswith(m):
            p = p[len(m):]
    return re.sub(r"^/work/", "", p)


class FileTracker:
    """Approximate the file stack TeX prints as '(./file.tex ... )' to attribute warnings to a source file."""

    OPEN = re.compile(r"\((\.{0,2}/?[^\s()]+?\.(?:tex|ltx|bbl|sty|cls|cfg|def|clo|aux|toc|out|fd|ldf|dict|cbx|bbx|lbx))(?=[\s()]|$)")

    def __init__(self, entry: str):
        self.entry = entry

    def files_at(self, text: str) -> list[tuple[int, str]]:
        """Return (offset, current-source-file) change points."""
        stack: list[str] = []
        points = [(0, self.entry)]
        i = 0
        while i < len(text):
            ch = text[i]
            if ch == "(":
                m = self.OPEN.match(text, i)
                if m:
                    stack.append(_norm(m.group(1)))
                    points.append((i, self._current(stack)))
                    i = m.end()
                    continue
                stack.append("")
            elif ch == ")" and stack:
                stack.pop()
                points.append((i, self._current(stack)))
            i += 1
        return points

    def _current(self, stack):
        for f in reversed(stack):
            if f.endswith((".tex", ".ltx")) and not f.startswith(("/", "C:", "c:")) and "texmf" not in f.lower() and "miktex" not in f.lower():
                return f
        return self.entry


def _file_at(points, offset, sources: set[str], entry: str) -> str:
    current = entry
    for off, f in points:
        if off > offset:
            break
        current = f
    return current if current in sources else entry


def parse_tex_log(log: str, entry: str, sources: set[str]) -> list[dict]:
    out: list[dict] = []
    points = FileTracker(entry).files_at(log)
    lines = log.splitlines()
    offsets, pos = [], 0
    for ln in lines:
        offsets.append(pos)
        pos += len(ln) + 1

    def excerpt(i, before=1, after=6):
        return "\n".join(lines[max(0, i - before): i + after])

    def source_line(i):
        for j in range(i, min(i + 12, len(lines))):
            m = re.match(r"^l\.(\d+)\b", lines[j])
            if m:
                return m.group(1)
        return None

    seen_error_lines = set()
    for i, ln in enumerate(lines):
        here = _file_at(points, offsets[i], sources, entry)
        # File-line-error format: ./main.tex:84: Undefined control sequence.
        fle = re.match(r"^((?:[A-Za-z]:)?[^:\s][^:]*?\.(?:tex|ltx|sty|cls|bbl)):(\d+): (.*)$", ln)
        if ln.startswith("! ") or fle:
            msg = (fle.group(3) if fle else ln[2:]).strip()
            file = _norm(fle.group(1)) if fle else here
            line = fle.group(2) if fle else source_line(i)
            if file not in sources:
                # The error is inside an installed package or class: its line number is not a manuscript line.
                if fle:
                    msg = f"{msg} (raised inside {PurePosixPath(file.replace(chr(92), '/')).name})"
                file, line = here, None
            seen_error_lines.add(i)
            missing = re.search(rf"File {Q}([^`'‘’\"]+){Q} not found", msg)
            if missing:
                name = missing.group(1)
                ext = PurePosixPath(name).suffix.lower()
                if ext in GRAPHICS or "pdftex.def" in msg or "graphics" in msg.lower():
                    out.append(diag("error", "missing-figure", f"Missing figure “{name}”", f"Upload “{name}” with its relative path, or correct the \\includegraphics path, then rebuild.",
                                    file=file if file in sources else entry, line=line, key=name))
                elif ext == ".cls":
                    out.append(diag("error", "missing-class", f"Document class file “{name}” is not available", f"Upload “{name}” as a supporting file, or choose a class installed in the build image.", file=file if file in sources else entry, line=line, key=name))
                elif ext in {".sty", ""} or not ext:
                    inside = re.search(r"\(raised inside ([^)]+)\)", msg)
                    out.append(diag("error", "missing-package", f"Package “{name}” is not available" + (f" (required by {inside.group(1)})" if inside else ""),
                                    f"Install “{name}” in the TeX distribution used for builds (MiKTeX Console, tlmgr, or the Docker image), "
                                    "or upload it as a supporting file. Builds never download packages.", file=file if file in sources else entry, line=line, key=name))
                elif ext == ".bst":
                    out.append(diag("error", "missing-bst", f"Bibliography style “{name}” is not available", f"Upload “{name}” or use a standard style.", file=file if file in sources else entry, line=line, key=name))
                elif ext == ".bib":
                    out.append(diag("error", "missing-bibliography", f"Bibliography file “{name}” not found", f"Upload “{name}” or correct the bibliography declaration.", file=file if file in sources else entry, line=line, key=name))
                else:
                    out.append(diag("error", "missing-file", f"Input file “{name}” not found", f"Upload “{name}” with the relative path the manuscript expects.", file=file if file in sources else entry, line=line, key=name))
                continue
            if re.search(r"Emergency stop|Fatal error occurred|job aborted", msg, re.I):
                out.append(diag("error", "fatal", "TeX stopped with a fatal error", "Fix the first error reported above, then rebuild.", excerpt=excerpt(i, 3, 3)))
                continue
            ucs = re.match(r"Undefined control sequence", msg)
            cmd = None
            if ucs:
                for j in range(i, min(i + 6, len(lines))):
                    m = re.search(r"(\\[A-Za-z@]+)\s*$", lines[j])
                    if lines[j].startswith("l.") and m:
                        cmd = m.group(1)
                        break
            out.append(diag("error", "undefined-command" if ucs else "tex-error",
                            f"Undefined control sequence{f' {cmd}' if cmd else ''}" if ucs else msg,
                            "Define the command, load the package that provides it, or fix the typo, then rebuild." if ucs
                            else "Correct the source at the reported location, then rebuild. See the log excerpt.",
                            file=file if file in sources else (entry if not fle else file), line=line, key=cmd, excerpt=excerpt(i, 0, 6)))
            continue
        m = re.search(rf"(?:LaTeX|Package natbib) Warning: Citation {Q}([^`'‘’\"]+){Q}(?: on page \d+)? undefined(?: on input line (\d+))?", ln)
        if m:
            out.append(diag("error", "undefined-citation", f"Undefined citation “{m.group(1)}”", "Check the key in the .bib file (spelling and case), then rebuild.",
                            file=here, line=m.group(2), key=m.group(1)))
            continue
        m = re.search(rf"LaTeX Warning: Reference {Q}([^`'‘’\"]+){Q} on page \d+ undefined(?: on input line (\d+))?", ln)
        if m:
            out.append(diag("error", "undefined-reference", f"Undefined reference “{m.group(1)}”", "Add the matching \\label or correct the \\ref key, then rebuild.",
                            file=here, line=m.group(2), key=m.group(1)))
            continue
        m = re.search(r"Package biblatex Warning: The following entry could not be found", ln)
        if m:
            nxt = lines[i + 1:i + 3]
            key = None
            for t in nxt:
                k = re.search(r"\(biblatex\)\s+in the database:\s*(\S+)|\(biblatex\)\s+(\S+)\s*$", t)
                if k:
                    key = k.group(1) or k.group(2)
            out.append(diag("error", "undefined-citation", f"Undefined citation “{key or '?'}” (biblatex)", "Check the key in the .bib file, then rebuild.", file=here, key=key))
            continue
        m = re.search(rf"LaTeX Warning: File {Q}([^`'‘’\"]+){Q} not found(?: on input line (\d+))?", ln)
        if m:
            name = m.group(1)
            code = "missing-figure" if PurePosixPath(name).suffix.lower() in GRAPHICS else "missing-file"
            out.append(diag("error", code, f"Missing file “{name}”", f"Upload “{name}” with its relative path, then rebuild.", file=here, line=m.group(2), key=name))
            continue
        m = re.match(r"^No file (.+\.bbl)\.", ln)
        if m:
            out.append(diag("warning", "no-bbl", f"No bibliography output ({m.group(1)}) was produced", "Check that the document cites at least one entry and that the bibliography declaration names the uploaded .bib file."))
            continue
        m = re.match(r"^(Overfull|Underfull) \\([hv])box \(([^)]+)\).*?(?:at lines? (\d+)(?:--\d+)?)?$", ln)
        if m and m.group(1) == "Overfull":
            out.append(diag("warning", "overfull-box", f"Overfull \\{m.group(2)}box ({m.group(3)})", "Review the layout at this location in the PDF; rephrase, hyphenate, or resize the content.",
                            file=here, line=m.group(4)))
            continue
        if re.search(r"LaTeX Warning: (?:Label\(s\) may have changed|There were undefined references)", ln):
            continue  # summarised by the specific warnings above
        if re.search(r"Rerun to get (?:cross-references|citations|outlines) right", ln):
            out.append(diag("warning", "not-converged", "Cross-references did not converge", "Rebuild; if it persists, check for labels that change on every run."))
    return out


def parse_bibtex_blg(blg: str, bib_files: set[str]) -> list[dict]:
    out = []
    for i, ln in enumerate(blg.splitlines()):
        m = re.search(r'I couldn\'t open database file (\S+)', ln)
        if m:
            name = m.group(1)
            out.append(diag("error", "missing-bibliography", f"BibTeX could not open “{name}”", f"Upload “{name}” or change \\bibliography{{…}} to name the uploaded file.", key=name))
            continue
        m = re.search(r'I didn\'t find a database entry for "([^"]+)"', ln)
        if m:
            out.append(diag("error", "undefined-citation", f"No .bib entry for “{m.group(1)}”", "Add the entry to the bibliography or fix the citation key, then rebuild.", key=m.group(1)))
            continue
        m = re.search(r"I couldn't open style file (\S+)", ln)
        if m:
            out.append(diag("error", "missing-bst", f"Bibliography style “{m.group(1)}” is not available", "Upload the .bst file or use a standard style.", key=m.group(1)))
            continue
        m = re.match(r"^(.*)---line (\d+) of file (\S+)", ln)
        if m:
            out.append(diag("error", "bib-syntax", f"BibTeX syntax error: {m.group(1).strip()}", "Fix the entry at this line of the .bib file, then rebuild.", file=m.group(3), line=m.group(2)))
            continue
        m = re.match(r"^Warning--(.*?)(?: in (\S+))?$", ln)
        if m:
            out.append(diag("warning", "bib-warning", f"BibTeX: {m.group(1).strip()}", "Review the bibliography entry.", key=m.group(2)))
    return out


def parse_biber_blg(blg: str) -> list[dict]:
    out = []
    for ln in blg.splitlines():
        m = re.search(r"(?:ERROR|WARN) - .*?Cannot find (?:file )?'([^']+)'", ln) or re.search(r"ERROR - Cannot find '([^']+)'", ln)
        if m:
            out.append(diag("error", "missing-bibliography", f"Biber could not find “{m.group(1)}”", "Upload the file named in \\addbibresource, or correct the declaration.", key=m.group(1)))
            continue
        m = re.search(r"WARN - I didn't find a database entry for '([^']+)'", ln)
        if m:
            out.append(diag("error", "undefined-citation", f"No .bib entry for “{m.group(1)}”", "Add the entry to the bibliography or fix the citation key, then rebuild.", key=m.group(1)))
            continue
        m = re.search(r"ERROR - (?:BibTeX subsystem: )?(.*?(?:line (\d+)).*)$", ln) or re.search(r"ERROR - (.*)$", ln)
        if m:
            line = m.group(2) if m.re.groups >= 2 else None
            out.append(diag("error", "bib-syntax", f"Biber: {m.group(1).strip()}", "Fix the reported .bib problem, then rebuild.", line=line))
    return out


def dedupe(items: list[dict]) -> list[dict]:
    seen, out = set(), []
    for d in items:
        k = (d["code"], d.get("key"), d.get("file"), d.get("line"), d["message"] if not d.get("key") else "")
        if k in seen:
            continue
        seen.add(k)
        out.append(d)
    # Citation problems reported by both TeX and BibTeX: keep the TeX one (it has the source line).
    tex_keys = {d.get("key") for d in out if d["code"] == "undefined-citation" and d.get("line")}
    out = [d for d in out if not (d["code"] == "undefined-citation" and not d.get("line") and d.get("key") in tex_keys)]
    # A generic "fatal error" adds nothing when a specific cause was found.
    if any(d["severity"] == "error" and d["code"] not in {"fatal", "no-pdf", "compiler-failed"} for d in out):
        out = [d for d in out if d["code"] != "fatal"]
    order = {"error": 0, "warning": 1, "info": 2}
    return sorted(out, key=lambda d: order[d["severity"]])
