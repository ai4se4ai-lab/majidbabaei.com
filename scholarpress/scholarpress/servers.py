"""Read-only static servers for the staging release and site previews (loopback only).

Each request resolves the active release directory from a pointer file, so activation is a single atomic file replace.
Responses mimic the production host's important behaviour: application/pdf for PDFs, byte ranges, index.html folders.
"""
from __future__ import annotations

import mimetypes
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
         ".json": "application/json", ".xml": "application/xml", ".pdf": "application/pdf", ".svg": "image/svg+xml",
         ".bib": "text/plain; charset=utf-8", ".ics": "text/calendar; charset=utf-8", ".webp": "image/webp", ".png": "image/png",
         ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8"}


def make_handler(pointer: Path):
    class Handler(BaseHTTPRequestHandler):
        server_version = "ScholarPressStaging/1.0"

        def log_message(self, *args):  # quiet
            pass

        def _root(self) -> Path | None:
            try:
                p = Path(pointer.read_text(encoding="utf-8").strip())
                return p if p.is_dir() else None
            except OSError:
                return None

        def do_HEAD(self):
            self.do_GET(head=True)

        def do_GET(self, head=False):
            root = self._root()
            if root is None:
                self.send_error(503, "No release is active yet")
                return
            path = unquote(urlsplit(self.path).path)
            target = (root / ("." + path)).resolve()
            if root.resolve() not in target.parents and target != root.resolve():
                self.send_error(403)
                return
            if target.is_dir():
                if not path.endswith("/"):
                    self.send_response(301)
                    self.send_header("Location", path + "/")
                    self.end_headers()
                    return
                target = target / "index.html"
            if not target.is_file():
                nf = root / "404.html"
                body = nf.read_bytes() if nf.exists() else b"Not found"
                self.send_response(404)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                if not head:
                    self.wfile.write(body)
                return
            data = target.read_bytes()
            ctype = TYPES.get(target.suffix.lower()) or mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            status, start, end = 200, 0, len(data) - 1
            rng = self.headers.get("Range")
            m = re.match(r"bytes=(\d*)-(\d*)$", rng or "")
            if m and (m.group(1) or m.group(2)):
                if m.group(1):
                    start = int(m.group(1))
                    end = int(m.group(2)) if m.group(2) else len(data) - 1
                else:
                    start = max(0, len(data) - int(m.group(2)))
                if start >= len(data) or start > end:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{len(data)}")
                    self.end_headers()
                    return
                status, end = 206, min(end, len(data) - 1)
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(end - start + 1))
            if status == 206:
                self.send_header("Content-Range", f"bytes {start}-{end}/{len(data)}")
            # Numbered release files are immutable; everything else revalidates (production: GitHub Pages sets max-age=600).
            immutable = re.search(r"/preprints/[^/]+/v\d+/", path) is not None
            self.send_header("Cache-Control", "public, max-age=31536000, immutable" if immutable else "no-cache")
            self.end_headers()
            if not head:
                self.wfile.write(data[start:end + 1])

    return Handler


class StaticServer:
    def __init__(self, pointer: Path, port: int, host: str = "127.0.0.1"):
        self.httpd = ThreadingHTTPServer((host, port), make_handler(pointer))
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True, name=f"static-{self.port}")

    def start(self):
        self.thread.start()
        return self

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()
