"""Command line: run the workspace, back up, or restore.

  uv run scholarpress serve [--config path]       start the workspace on http://127.0.0.1:<port>
  uv run scholarpress backup [--to DIR]           copy the database (online backup), sources, PDFs and logs
  uv run scholarpress restore BACKUP_DIR          restore into an empty data_dir (refuses to overwrite)
  uv run scholarpress check                       validate configuration and the toolchain
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

from .config import load_config


def main(argv=None):
    ap = argparse.ArgumentParser(prog="scholarpress")
    ap.add_argument("--config", help="TOML configuration file (default: $SCHOLARPRESS_CONFIG)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("serve")
    b = sub.add_parser("backup")
    b.add_argument("--to")
    r = sub.add_parser("restore")
    r.add_argument("backup_dir")
    sub.add_parser("check")
    args = ap.parse_args(argv)
    cfg = load_config(args.config)
    problems = cfg.validate()
    if problems and args.cmd != "restore":
        print("Configuration problems:\n- " + "\n- ".join(problems), file=sys.stderr)
        return 2
    if args.cmd == "serve":
        import uvicorn
        from .app import create_app
        print(f"ScholarPress: http://{cfg.host}:{cfg.port}/  (staging site: http://127.0.0.1:{cfg.staging_port}/, adapter: {cfg.adapter})")
        uvicorn.run(create_app(cfg), host=cfg.host, port=cfg.port, log_level="warning")
    elif args.cmd == "backup":
        from .service import Workspace
        print(f"Backup written to {Workspace(cfg).backup(Path(args.to) if args.to else None)}")
    elif args.cmd == "restore":
        src = Path(args.backup_dir)
        if not (src / "scholarpress.sqlite3").exists():
            print("Not a ScholarPress backup (scholarpress.sqlite3 missing).", file=sys.stderr)
            return 2
        if cfg.db_path.exists():
            print(f"Refusing to overwrite {cfg.db_path}; restore into an empty data_dir.", file=sys.stderr)
            return 2
        cfg.ensure_dirs()
        shutil.copy2(src / "scholarpress.sqlite3", cfg.db_path)
        for sub_dir in ("blobs", "builds"):
            if (src / sub_dir).exists():
                shutil.copytree(src / sub_dir, cfg.data_dir / sub_dir, dirs_exist_ok=True)
        from .service import Workspace
        ws = Workspace(cfg)
        bad = [r["sha256"] for r in ws.db.all("SELECT DISTINCT sha256 FROM snapshot_files") if not ws.store.blob_path(r["sha256"]).exists()]
        bad += [r["pdf_sha256"] for r in ws.db.all("SELECT pdf_sha256 FROM releases") if not ws.store.blob_path(r["pdf_sha256"]).exists()]
        print(f"Restored into {cfg.data_dir}. Missing blobs: {len(bad)}")
        return 1 if bad else 0
    elif args.cmd == "check":
        from .compiler import Compiler
        c = Compiler(cfg)
        runner = c.runner()
        print(f"site_dir: {cfg.site_dir}\ndata_dir: {cfg.data_dir}\ncv_path: {cfg.cv_path}\nadapter: {cfg.adapter}\nrunner: {runner}\ntoolchain: {c.toolchain(runner)}")
        if runner == "local":
            print("WARNING: the local runner is not a sandbox (time, memory and process caps only; no network or filesystem isolation, "
                  "so TeX can read your files). "
                  "Use compiler = \"docker\" with a digest-pinned image for untrusted manuscripts.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
