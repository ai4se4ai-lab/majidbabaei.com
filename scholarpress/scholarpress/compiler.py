"""Isolated LaTeX builds with latexmk.

Every attempt runs in a fresh directory holding only the manuscript inputs. Shell escape is disabled, uploaded build
configuration is ignored (-norc; latexmkrc files are not accepted uploads), and arguments are fixed lists.

Runners:
  docker  network-disabled, non-root, read-only root, capped memory/CPU/processes, digest-pinned TeX Live image.
  local   latexmk on this machine with the same arguments, a wall-clock timeout, and memory/process caps (a Windows Job
          Object, or rlimits on POSIX). It is NOT a sandbox: there is no network or filesystem isolation, and the TeX
          engine can read files the user can read. The UI says so.
Builds run in place (no -outdir): with an output directory, MiKTeX's BibTeX can resolve a same-named .bib from the
TeX tree instead of the uploaded one.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import signal
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path

from .config import PACKAGE_DIR, Config
from .diagnostics import dedupe, diag, parse_biber_blg, parse_bibtex_blg, parse_tex_log
from .pdfcheck import check_pdf
from .store import inspect_manuscript

HOUSE_CLASS = "scholarpress-preprint"


def _parse_bytes(text: str) -> int:
    m = {"k": 1 << 10, "m": 1 << 20, "g": 1 << 30}
    text = str(text).strip().lower()
    return int(float(text[:-1]) * m[text[-1]]) if text and text[-1] in m else int(text)


def _posix_limits(cfg) -> None:  # runs in the child before exec (local runner on Linux/macOS)
    import resource
    mem = _parse_bytes(cfg.memory)
    for res, value in ((resource.RLIMIT_AS, mem), (resource.RLIMIT_NPROC, cfg.pids_limit),
                       (resource.RLIMIT_FSIZE, cfg.max_output_mb * 1024 * 1024), (resource.RLIMIT_CPU, cfg.timeout_seconds + 30)):
        try:
            resource.setrlimit(res, (value, value))
        except (ValueError, OSError):
            pass


class WindowsJob:
    """A Windows Job Object: every descendant of latexmk joins it, so the whole tree can be terminated together,
    and memory and process counts are capped (local runner only)."""

    def __init__(self, memory_bytes: int, max_processes: int):
        import ctypes
        from ctypes import wintypes
        self.k32 = k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.CreateJobObjectW.restype = wintypes.HANDLE
        k32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        k32.OpenProcess.restype = wintypes.HANDLE
        k32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        k32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        k32.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        k32.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
        k32.CloseHandle.argtypes = [wintypes.HANDLE]
        self.handle = k32.CreateJobObjectW(None, None)

        class IO(ctypes.Structure):
            _fields_ = [(n, ctypes.c_ulonglong) for n in ("r", "w", "o", "rb", "wb", "ob")]

        class BASIC(ctypes.Structure):
            _fields_ = [("PerProcessUserTimeLimit", ctypes.c_longlong), ("PerJobUserTimeLimit", ctypes.c_longlong),
                        ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t), ("MaximumWorkingSetSize", ctypes.c_size_t),
                        ("ActiveProcessLimit", wintypes.DWORD), ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD),
                        ("SchedulingClass", wintypes.DWORD)]

        class EXT(ctypes.Structure):
            _fields_ = [("BasicLimitInformation", BASIC), ("IoInfo", IO), ("ProcessMemoryLimit", ctypes.c_size_t),
                        ("JobMemoryLimit", ctypes.c_size_t), ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

        info = EXT()
        KILL_ON_CLOSE, ACTIVE_PROCESS, JOB_MEMORY = 0x2000, 0x0008, 0x0200
        info.BasicLimitInformation.LimitFlags = KILL_ON_CLOSE | ACTIVE_PROCESS | JOB_MEMORY
        info.BasicLimitInformation.ActiveProcessLimit = max_processes
        info.JobMemoryLimit = memory_bytes
        if not k32.SetInformationJobObject(self.handle, 9, ctypes.byref(info), ctypes.sizeof(info)):  # JobObjectExtendedLimitInformation
            raise OSError(ctypes.get_last_error(), "SetInformationJobObject failed")

    def assign(self, proc: subprocess.Popen) -> None:
        h = self.k32.OpenProcess(0x0001 | 0x0100, False, proc.pid)  # PROCESS_TERMINATE | PROCESS_SET_QUOTA
        try:
            self.k32.AssignProcessToJobObject(self.handle, h)
        finally:
            self.k32.CloseHandle(h)

    def terminate(self) -> None:
        self.k32.TerminateJobObject(self.handle, 1)

    def close(self) -> None:
        if self.handle:
            self.k32.CloseHandle(self.handle)  # KILL_ON_JOB_CLOSE ends any survivor
            self.handle = None
ENGINES = {"pdflatex": "-pdf", "xelatex": "-xelatex", "lualatex": "-lualatex"}


@dataclass
class BuildResult:
    status: str                       # ready | failed
    blocked: bool
    diagnostics: list[dict]
    runner: str
    toolchain: str
    pdf: bytes | None = None
    log: str = ""
    pages: int | None = None
    timings: dict = field(default_factory=dict)


def profile_fingerprint(profile: dict) -> str:
    return hashlib.sha256(json.dumps(profile, sort_keys=True).encode()).hexdigest()


def normalize_profile(profile: dict | None) -> dict:
    p = dict(profile or {})
    kind = p.get("kind") if p.get("kind") in {"house", "preserve"} else "preserve"
    engine = p.get("engine") if p.get("engine") in ENGINES else "pdflatex"
    return {"kind": kind, "engine": engine}


class Compiler:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self._toolchain_cache: dict[str, str] = {}

    # Runner selection ------------------------------------------------------------------
    def docker_available(self) -> bool:
        if "@sha256:" not in (self.cfg.docker_image or ""):
            return False
        try:
            r = subprocess.run([self.cfg.docker, "info", "--format", "{{.ServerVersion}}"], capture_output=True, timeout=10, text=True)
            return r.returncode == 0 and r.stdout.strip() != ""
        except (OSError, subprocess.TimeoutExpired):
            return False

    def runner(self) -> str:
        if self.cfg.compiler == "docker":
            return "docker"
        if self.cfg.compiler == "local":
            return "local"
        return "docker" if self.docker_available() else "local"

    def toolchain(self, runner: str) -> str:
        if runner in self._toolchain_cache:
            return self._toolchain_cache[runner]
        if runner == "docker":
            value = f"docker:{self.cfg.docker_image}"
        else:
            parts = []
            for cmd in ([self.cfg.latexmk, "-v"], ["pdflatex", "--version"], ["bibtex", "--version"], ["biber", "--version"]):
                try:
                    out = subprocess.run(cmd, capture_output=True, text=True, timeout=30).stdout.strip().splitlines()
                    parts.append(next((l for l in out if l.strip()), "?"))
                except (OSError, subprocess.TimeoutExpired):
                    parts.append(f"{cmd[0]}: unavailable")
            value = "local:" + " | ".join(parts)
        digest = hashlib.sha256(value.encode()).hexdigest()[:16]
        self._toolchain_cache[runner] = f"{value} [{digest}]"
        return self._toolchain_cache[runner]

    def _is_miktex(self) -> bool:
        return "MiKTeX" in self.toolchain("local")

    # Build -----------------------------------------------------------------------------------
    def prepare(self, workdir: Path, entry: str, bib_paths: list[str], profile: dict, sources: set[str]) -> tuple[str, list[dict]]:
        """Checks before compiling. Returns the entry point to compile and blocking/advisory diagnostics."""
        problems: list[dict] = []
        if profile["kind"] == "house" and (workdir / "preprint.tex").exists():
            entry = "preprint.tex"
        tex = (workdir / entry).read_text(encoding="utf-8", errors="replace")
        info = inspect_manuscript(tex)
        if profile["kind"] == "house":
            if info["documentclass"] != HOUSE_CLASS:
                problems.append(diag("error", "house-incompatible",
                                     f"The manuscript uses the “{info['documentclass']}” class, not the house preprint style",
                                     "Choose “Preserve layout” to compile the original class, or upload a house-style adaptation "
                                     "(\\documentclass{scholarpress-preprint}, or a preprint.tex entry point) for review.", file=entry))
            else:
                shutil.copyfile(PACKAGE_DIR / "tex" / f"{HOUSE_CLASS}.cls", workdir / f"{HOUSE_CLASS}.cls")
        entry_dir = str(Path(entry).parent).replace("\\", "/")
        declared = info["biblatex_files"] if info["biblatex"] else info["bibtex_files"]
        uploaded = {p for p in sources if p.endswith(".bib")}
        for name in declared:
            rel = name if entry_dir in ("", ".") else f"{entry_dir}/{name}"
            if rel not in uploaded and name not in uploaded:
                hint = f" Uploaded: {', '.join(sorted(Path(b).name for b in bib_paths))}." if bib_paths else ""
                problems.append(diag("error", "bib-name-mismatch", f"The manuscript declares “{name}”, which was not uploaded.{hint}",
                                     f"Rename the uploaded .bib to “{name}”, or change the declaration to the uploaded file name.", file=entry, key=name))
        if not declared:
            problems.append(diag("warning", "no-bibliography-declared", "No \\bibliography or \\addbibresource declaration was found",
                                 "Add a bibliography declaration if the paper has references.", file=entry))
        for rc in ("latexmkrc", ".latexmkrc"):
            if (workdir / rc).exists():
                (workdir / rc).unlink()
        return entry, problems

    def command(self, runner: str, entry: str, engine: str) -> list[str]:
        args = ["-norc", ENGINES[engine], "-interaction=nonstopmode", "-file-line-error", "-no-shell-escape", "-bibtex-cond1",
                "-f-", entry]
        if runner == "local" and self._is_miktex():
            # Never download packages during a build; report missing ones instead.
            tool = {"pdflatex": "pdflatex", "xelatex": "xelatex", "lualatex": "lualatex"}[engine]
            args.insert(1, f"-{engine}={tool} --disable-installer --max-print-line=1000 -no-shell-escape %O %S")
        if runner == "docker":
            return [self.cfg.docker, "run", "--rm", "--name", None, "--network", "none", "--read-only",
                    "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", self.cfg.docker_user,
                    "--memory", self.cfg.memory, "--memory-swap", self.cfg.memory, "--cpus", self.cfg.cpus,
                    "--pids-limit", str(self.cfg.pids_limit), "--tmpfs", "/tmp:rw,size=256m",
                    "-e", "HOME=/tmp", "-e", "max_print_line=1000", "-e", "TEXMFVAR=/tmp/texmf-var",
                    "--mount", None, "-w", "/work", self.cfg.docker_image, "latexmk", *args]
        return [self.cfg.latexmk, *args]

    def compile(self, workdir: Path, entry: str, bib_paths: list[str], profile: dict, sources: set[str], build_id: str) -> BuildResult:
        profile = normalize_profile(profile)
        runner = self.runner()
        toolchain = self.toolchain(runner)
        t0 = time.monotonic()
        entry, pre = self.prepare(workdir, entry, bib_paths, profile, sources)
        if any(d["severity"] == "error" and d["code"] in {"house-incompatible", "bib-name-mismatch"} for d in pre):
            return BuildResult("failed", True, dedupe(pre), runner, toolchain, log="Build not started: fix the issues above.\n")
        cmd = self.command(runner, entry, profile["engine"])
        name = f"scholarpress-{build_id}"
        if runner == "docker":
            cmd[cmd.index("--name") + 1] = name
            cmd[cmd.index("--mount") + 1] = f"type=bind,src={workdir.resolve()},dst=/work"
        env = {k: v for k, v in os.environ.items() if not k.upper().startswith(("GIT_", "GH_", "GITHUB_", "SSH_", "AWS_", "AZURE_", "GOOGLE_"))}
        env.update({"max_print_line": "1000", "openout_any": "p", "openin_any": "p", "shell_escape": "f"})
        timed_out = False
        # Console output goes to a file, not a pipe: an orphaned engine holding a pipe open could otherwise block the build.
        console_path = workdir.parent / f"{workdir.name}.console.txt"
        job = None
        try:
            with open(console_path, "wb") as console_file:
                if os.name == "nt":
                    proc = subprocess.Popen(cmd, cwd=workdir, stdout=console_file, stderr=subprocess.STDOUT, env=env,
                                            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
                    if runner == "local":
                        job = WindowsJob(memory_bytes=_parse_bytes(self.cfg.memory), max_processes=self.cfg.pids_limit)
                        job.assign(proc)
                else:
                    proc = subprocess.Popen(cmd, cwd=workdir, stdout=console_file, stderr=subprocess.STDOUT, env=env, start_new_session=True,
                                            preexec_fn=(lambda: _posix_limits(self.cfg)) if runner == "local" else None)
                try:
                    proc.wait(timeout=self.cfg.timeout_seconds)
                except subprocess.TimeoutExpired:
                    timed_out = True
                    self._kill(proc, runner, name, job)
                    proc.wait(timeout=30)
                code = proc.returncode
        except OSError as e:
            return BuildResult("failed", True, [diag("error", "toolchain-missing", f"Could not start the compiler: {e}",
                                                     "Install latexmk/TeX (local runner) or start Docker and pin docker_image.")], runner, toolchain)
        finally:
            if job:
                job.close()  # kills anything still alive in the job
        elapsed = time.monotonic() - t0
        console = console_path.read_bytes().decode("utf-8", "replace") if console_path.exists() else ""
        console_path.unlink(missing_ok=True)
        stem = Path(entry).with_suffix("")
        log_path, pdf_path = workdir / f"{stem}.log", workdir / f"{stem}.pdf"
        tex_log = log_path.read_text(encoding="utf-8", errors="replace") if log_path.exists() else ""
        blg_path = workdir / f"{stem}.blg"
        blg = blg_path.read_text(encoding="utf-8", errors="replace") if blg_path.exists() else ""
        diagnostics = list(pre)
        diagnostics += parse_tex_log(tex_log, entry, sources)
        if blg:
            diagnostics += parse_biber_blg(blg) if "biber" in blg[:200].lower() else parse_bibtex_blg(blg, {p for p in sources if p.endswith('.bib')})
        if timed_out:
            diagnostics.append(diag("error", "timeout", f"The build exceeded {self.cfg.timeout_seconds} seconds and was stopped",
                                    "Look for an infinite loop or a very large figure; simplify, then rebuild. The partial log is available."))
        size = sum(p.stat().st_size for p in workdir.rglob("*") if p.is_file())
        if size > self.cfg.max_output_mb * 1024 * 1024:
            diagnostics.append(diag("error", "output-limit", f"Build output exceeded {self.cfg.max_output_mb} MB", "Reduce figure sizes or generated output."))
        pdf = pdf_path.read_bytes() if pdf_path.exists() else None
        pages = None
        if pdf is None:
            diagnostics.append(diag("error", "no-pdf", "No PDF was produced", "Fix the first error in the list, then rebuild. The build log is available for download."))
        else:
            ok, pages, msg = check_pdf(pdf)
            if not ok:
                diagnostics.append(diag("error", "pdf-invalid", f"The PDF failed the structural check: {msg}", "Rebuild; if it persists, check figures embedded as PDF."))
        if code not in (0, None) and not timed_out and not any(d["severity"] == "error" for d in diagnostics):
            diagnostics.append(diag("error", "compiler-failed", f"latexmk exited with status {code}", "See the build log for the failing step.",
                                    excerpt="\n".join(console.splitlines()[-25:])))
        diagnostics = dedupe(diagnostics)
        blocked = any(d["severity"] == "error" for d in diagnostics)
        log = (f"== ScholarPress build {build_id}\n== runner: {runner}\n== toolchain: {toolchain}\n== command: {' '.join(c for c in cmd if c)}\n"
               f"== exit status: {code}{' (timed out)' if timed_out else ''}; {elapsed:.1f}s\n\n== latexmk output\n{console}\n\n== {stem}.log\n{tex_log}\n"
               + (f"\n== {stem}.blg\n{blg}\n" if blg else ""))
        return BuildResult("failed" if blocked else "ready", blocked, diagnostics, runner, toolchain, pdf=pdf, log=log, pages=pages,
                           timings={"seconds": round(elapsed, 2)})

    def _kill(self, proc: subprocess.Popen, runner: str, name: str, job=None) -> None:
        if runner == "docker":
            subprocess.run([self.cfg.docker, "kill", name], capture_output=True, timeout=30)
        if job:
            job.terminate()
        if os.name == "nt":
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True)
        else:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
