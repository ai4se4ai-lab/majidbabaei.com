"""Configuration. Values come from a TOML file (see config.example.toml); nothing here holds credentials.

Deployment credentials stay with git (credential manager / SSH agent) outside the browser and the compiler.
"""
from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field, fields
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent


def default_data_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or os.path.join(Path.home(), ".local", "share")
    return Path(base) / "ScholarPress"


def default_site_dir() -> Path:
    # scholarpress/ lives inside the majidbabaei.com checkout.
    return PACKAGE_DIR.parent.parent


@dataclass
class Config:
    data_dir: Path = field(default_factory=default_data_dir)
    site_dir: Path = field(default_factory=default_site_dir)
    cv_path: Path | None = None  # maintained CV source, read-only (used to detect whether a handoff was applied)
    host: str = "127.0.0.1"
    port: int = 8765
    # Compiler: "docker" (isolated, digest-pinned image), "local" (latexmk on this machine, no shell escape),
    # or "auto" (docker when the daemon answers and an image is pinned, otherwise local).
    compiler: str = "auto"
    docker_image: str = ""  # must be pinned by digest, e.g. texlive/texlive@sha256:<digest>
    docker_user: str = "1000:1000"
    timeout_seconds: int = 180
    memory: str = "2g"
    cpus: str = "2"
    pids_limit: int = 256
    max_output_mb: int = 200
    max_files: int = 200
    max_file_mb: int = 50
    max_total_mb: int = 200
    latexmk: str = "latexmk"
    docker: str = "docker"
    node: str = "node"
    extra_path: list = field(default_factory=list)  # extra PATH entries for TeX tools (for example a Perl bin directory)
    git: str = "git"
    # Publishing adapter: "staging" (local site release served on staging_port) or "production" (git push to the Pages repo).
    adapter: str = "staging"
    staging_port: int = 8766
    preview_port: int = 8767
    production_remote: str = "origin"
    production_branch: str = "main"
    production_base_url: str = "https://majidbabaei.com"
    verify_timeout_seconds: int = 900
    verify_interval_seconds: int = 15
    site_url: str = "https://majidbabaei.com"
    owner_name: str = "Majid Babaei"  # rendered as \me in CV handoffs

    @property
    def db_path(self) -> Path:
        return self.data_dir / "scholarpress.sqlite3"

    def ensure_dirs(self) -> None:
        for sub in ("blobs", "builds", "work", "staging", "backups"):
            (self.data_dir / sub).mkdir(parents=True, exist_ok=True)

    def validate(self) -> list[str]:
        problems = []
        if self.compiler not in {"auto", "docker", "local"}:
            problems.append("compiler must be auto, docker, or local")
        if self.compiler == "docker" and "@sha256:" not in self.docker_image:
            problems.append("docker_image must be pinned by digest (name@sha256:...)")
        if self.adapter not in {"staging", "production"}:
            problems.append("adapter must be staging or production")
        if self.host not in {"127.0.0.1", "::1", "localhost"}:
            problems.append("host must be a loopback address; the workspace is never exposed to a network")
        if not (self.site_dir / "tools" / "build-preprints.mjs").exists():
            problems.append(f"site_dir {self.site_dir} is not a majidbabaei.com checkout with tools/build-preprints.mjs")
        try:
            self.data_dir.resolve().relative_to(self.site_dir.resolve())
            problems.append("data_dir must be outside the site checkout (sources, logs and drafts are private)")
        except ValueError:
            pass
        return problems


def load_config(path: str | os.PathLike | None = None, **overrides) -> Config:
    path = path or os.environ.get("SCHOLARPRESS_CONFIG")
    values: dict = {}
    if path:
        with open(path, "rb") as f:
            values = tomllib.load(f)
    values.update({k: v for k, v in overrides.items() if v is not None})
    known = {f.name for f in fields(Config)}
    unknown = set(values) - known
    if unknown:
        raise ValueError(f"Unknown configuration keys: {', '.join(sorted(unknown))}")
    for key in ("data_dir", "site_dir", "cv_path"):
        if values.get(key):
            values[key] = Path(values[key]).expanduser()
    cfg = Config(**values)
    if cfg.cv_path is None:
        candidate = cfg.site_dir.parent / "docs" / "02_Curriculum_Vitae.tex"
        cfg.cv_path = candidate if candidate.exists() else None
    return cfg
