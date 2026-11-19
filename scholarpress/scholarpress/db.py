"""SQLite state. Status fields are independent: build status, article publication state, and publication attempts."""
from __future__ import annotations

import json
import secrets
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  slug_locked INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  created TEXT NOT NULL,
  latest_release_id TEXT,
  -- current public state (changed only by a verified release or metadata update)
  links_json TEXT NOT NULL DEFAULT '{}',
  venue_json TEXT NOT NULL DEFAULT '{}',
  disclosure TEXT NOT NULL DEFAULT 'public',
  cv_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id),
  parent_id TEXT REFERENCES snapshots(id),
  entry TEXT NOT NULL,
  bib_paths_json TEXT NOT NULL,
  created TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshot_files (
  id TEXT PRIMARY KEY,               -- opaque download id
  snapshot_id TEXT NOT NULL REFERENCES snapshots(id),
  path TEXT NOT NULL,
  role TEXT NOT NULL,                -- entry | bibliography | support
  origin TEXT NOT NULL,              -- uploaded | inherited
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  UNIQUE (snapshot_id, path)
);
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id),
  snapshot_id TEXT NOT NULL REFERENCES snapshots(id),
  basis_release_id TEXT REFERENCES releases(id),
  metadata_json TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  links_json TEXT NOT NULL DEFAULT '{}',
  announcement_json TEXT NOT NULL DEFAULT '{"mode":"none"}',
  venue_json TEXT NOT NULL DEFAULT '{}',
  disclosure TEXT NOT NULL DEFAULT 'public',
  cv_json TEXT NOT NULL DEFAULT '{}',
  revision_note TEXT NOT NULL DEFAULT '',
  rev INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open',  -- open | published | superseded
  created TEXT NOT NULL,
  updated TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS builds (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES drafts(id),
  snapshot_id TEXT NOT NULL REFERENCES snapshots(id),
  input_fp TEXT NOT NULL,
  profile_fp TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  toolchain TEXT,
  runner TEXT,
  status TEXT NOT NULL,              -- queued | running | ready | failed | interrupted
  blocked INTEGER NOT NULL DEFAULT 1,
  diagnostics_json TEXT NOT NULL DEFAULT '[]',
  pdf_sha256 TEXT,
  pdf_path TEXT,
  log_path TEXT,
  pages INTEGER,
  created TEXT NOT NULL,
  started TEXT,
  finished TEXT
);
CREATE TABLE IF NOT EXISTS releases (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id),
  version INTEGER NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL,               -- reserved | exposed | public
  metadata_json TEXT NOT NULL,
  snapshot_id TEXT NOT NULL REFERENCES snapshots(id),
  build_id TEXT NOT NULL REFERENCES builds(id),
  pdf_sha256 TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  release_date TEXT NOT NULL,
  published TEXT,
  receipt_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE (article_id, version)
);
CREATE TABLE IF NOT EXISTS news_edits (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id),
  release_id TEXT REFERENCES releases(id),
  publication_id TEXT,
  mode TEXT NOT NULL,                -- new | update
  news_slug TEXT NOT NULL,
  date TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  body TEXT NOT NULL,
  state TEXT NOT NULL,               -- pending | public
  UNIQUE (article_id, news_slug, mode)
);
CREATE TABLE IF NOT EXISTS publications (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                -- release | metadata
  article_id TEXT NOT NULL REFERENCES articles(id),
  draft_id TEXT,
  release_id TEXT,
  build_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  fingerprint TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  adapter TEXT NOT NULL,
  status TEXT NOT NULL,              -- staging | deploying | verifying | published | failed
  activated INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  urls_json TEXT NOT NULL DEFAULT '{}',
  steps_json TEXT NOT NULL DEFAULT '[]',
  receipt_json TEXT NOT NULL DEFAULT '{}',
  created TEXT NOT NULL,
  updated TEXT NOT NULL
);
"""


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


class Database:
    """One connection per thread; writes are serialized by SQLite (WAL) plus a process-level lock."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        self.write_lock = threading.RLock()
        with self.connect() as c:
            c.executescript(SCHEMA)

    def connect(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(self.path, timeout=30, isolation_level=None, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys = ON")
            self._local.conn = conn
        return conn

    # Small helpers -----------------------------------------------------------------
    def one(self, sql: str, *args):
        return self.connect().execute(sql, args).fetchone()

    def all(self, sql: str, *args):
        return self.connect().execute(sql, args).fetchall()

    def run(self, sql: str, *args):
        with self.write_lock:
            return self.connect().execute(sql, args)

    def tx(self):
        return _Tx(self)

    def meta(self, key: str, default: str | None = None) -> str | None:
        row = self.one("SELECT value FROM meta WHERE key = ?", key)
        return row["value"] if row else default

    def set_meta(self, key: str, value: str) -> None:
        self.run("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value)

    def backup(self, target: Path) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        dst = sqlite3.connect(target)
        try:
            self.connect().backup(dst)
        finally:
            dst.close()


class _Tx:
    def __init__(self, db: Database):
        self.db = db

    def __enter__(self) -> sqlite3.Connection:
        self.db.write_lock.acquire()
        self.conn = self.db.connect()
        self.conn.execute("BEGIN IMMEDIATE")
        return self.conn

    def __exit__(self, exc_type, exc, tb):
        try:
            self.conn.execute("ROLLBACK" if exc_type else "COMMIT")
        finally:
            self.db.write_lock.release()
        return False


def loads(text: str | None, default=None):
    if text is None:
        return default
    return json.loads(text)


def dumps(value) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
