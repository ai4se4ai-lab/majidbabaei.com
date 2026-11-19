"""Local HTTP interface. Loopback only; no accounts: local access is the owner boundary.

Write requests need a same-origin Origin header, a valid Host, and a session-bound CSRF token. No CORS headers are
ever sent. Private files are served with Cache-Control: no-store. User data and logs render as escaped text.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import threading
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.datastructures import UploadFile

from .config import PACKAGE_DIR, Config
from .db import dumps, loads
from .service import Conflict, Invalid, NotFound, Workspace
from .store import Incoming, UploadError

SESSION_COOKIE = "sp_session"


def create_app(cfg: Config, *, workspace: Workspace | None = None, start_servers: bool = True) -> FastAPI:
    ws = workspace or Workspace(cfg)
    app = FastAPI(title="ScholarPress", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.ws = ws
    templates = Jinja2Templates(directory=str(PACKAGE_DIR / "templates"))  # autoescape on for .html
    templates.env.filters["json"] = lambda v: dumps(v)
    app.mount("/static", StaticFiles(directory=str(PACKAGE_DIR / "static")), name="static")
    secret = ws.db.meta("csrf_secret")
    if not secret:
        secret = secrets.token_hex(32)
        ws.db.set_meta("csrf_secret", secret)
    hosts = {f"127.0.0.1:{cfg.port}", f"localhost:{cfg.port}", f"[::1]:{cfg.port}"}
    origins = {f"http://{h}" for h in hosts}
    previews: dict[str, dict] = {}

    def csrf_for(session: str) -> str:
        return hmac.new(secret.encode(), session.encode(), hashlib.sha256).hexdigest()

    @app.middleware("http")
    async def guard(request: Request, call_next):
        if request.headers.get("host", "") not in hosts:
            return PlainTextResponse("ScholarPress only answers on its loopback address.", status_code=400)
        if request.method == "OPTIONS":
            return PlainTextResponse("Cross-origin requests are not supported.", status_code=405)
        session = request.cookies.get(SESSION_COOKIE)
        new_session = None
        if not session:
            session = new_session = secrets.token_urlsafe(32)
        request.state.session = session
        request.state.csrf = csrf_for(session)
        if request.method not in ("GET", "HEAD"):
            origin = request.headers.get("origin")
            if origin not in origins or request.headers.get("sec-fetch-site", "same-origin") not in ("same-origin", "none"):
                return JSONResponse({"detail": "Cross-origin write refused."}, status_code=403)
            token = request.headers.get("x-csrf-token", "")
            if new_session or not hmac.compare_digest(token, request.state.csrf):
                return JSONResponse({"detail": "Missing or invalid CSRF token. Reload the page and try again."}, status_code=403)
        response = await call_next(request)
        if new_session:
            response.set_cookie(SESSION_COOKIE, new_session, httponly=True, samesite="strict", path="/")
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
        response.headers["Content-Security-Policy"] = ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
                                                       "frame-src 'self'; object-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'")
        if not request.url.path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(Invalid)
    async def _invalid(_, exc: Invalid):
        return JSONResponse({"detail": "Some fields need attention.", "errors": exc.errors}, status_code=422)

    @app.exception_handler(UploadError)
    async def _upload(_, exc: UploadError):
        return JSONResponse({"detail": "The upload was not accepted.", "errors": exc.errors}, status_code=422)

    @app.exception_handler(Conflict)
    async def _conflict(_, exc: Conflict):
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.exception_handler(NotFound)
    async def _notfound(_, exc: NotFound):
        return JSONResponse({"detail": f"{exc} not found"}, status_code=404)

    @app.on_event("startup")
    def _startup():
        ws.start()
        if start_servers:
            from .servers import StaticServer
            try:
                app.state.staging = StaticServer(cfg.data_dir / "staging" / "current", cfg.staging_port).start()
                app.state.preview = StaticServer(cfg.data_dir / "staging" / "preview-current", cfg.preview_port).start()
            except OSError as e:
                print(f"ScholarPress: could not start the staging/preview server: {e}")

    def page(request: Request, name: str, **ctx):
        return templates.TemplateResponse(request, name, {"csrf": request.state.csrf, "cfg": cfg, "runner": ws.compiler.runner(), **ctx})

    # ---------------------------------------------------------------- views
    def article_view(a):
        latest = ws.db.one("SELECT * FROM releases WHERE id = ?", a["latest_release_id"]) if a["latest_release_id"] else None
        draft = ws.db.one("SELECT * FROM drafts WHERE article_id = ? AND status = 'open' ORDER BY created DESC, rowid DESC LIMIT 1", a["id"])
        build = ws.latest_build(draft["id"]) if draft else None
        return {"a": a, "latest": latest, "latest_meta": loads(latest["metadata_json"]) if latest else None, "draft": draft,
                "draft_meta": loads(draft["metadata_json"]) if draft else None, "build": build}

    @app.get("/", response_class=HTMLResponse)
    def articles(request: Request, q: str = "", status: str = ""):
        rows = ws.db.all("SELECT * FROM articles ORDER BY created DESC, rowid DESC")
        items = [article_view(a) for a in rows]
        ql = q.strip().lower()
        if ql:
            items = [i for i in items if ql in i["a"]["slug"] or ql in i["a"]["title"].lower()]
        if status == "published":
            items = [i for i in items if i["latest"]]
        elif status == "unpublished":
            items = [i for i in items if not i["latest"]]
        elif status == "draft-failed":
            items = [i for i in items if i["build"] and i["build"]["status"] == "failed"]
        elif status == "draft-open":
            items = [i for i in items if i["draft"]]
        return page(request, "articles.html", items=items, q=q, status=status)

    @app.get("/articles/new", response_class=HTMLResponse)
    def new_article(request: Request):
        return page(request, "upload.html", article=None, basis=None, files=[])

    @app.get("/articles/{aid}", response_class=HTMLResponse)
    def article_page(request: Request, aid: str):
        a = ws.article(aid)
        releases = ws.db.all("SELECT r.*, b.diagnostics_json, b.pages, b.log_path FROM releases r JOIN builds b ON b.id = r.build_id "
                             "WHERE r.article_id = ? AND r.state IN ('public','exposed') ORDER BY r.version DESC", aid)
        drafts = ws.db.all("SELECT * FROM drafts WHERE article_id = ? ORDER BY created DESC", aid)
        pubs = ws.db.all("SELECT * FROM publications WHERE article_id = ? ORDER BY created DESC, rowid DESC LIMIT 20", aid)
        return page(request, "article.html", v=article_view(a),
                    releases=[dict(r, meta=loads(r["metadata_json"]), diags=loads(r["diagnostics_json"]), files=ws.store.snapshot_files(r["snapshot_id"])) for r in releases],
                    drafts=drafts, pubs=pubs, links=loads(a["links_json"], {}), venue=loads(a["venue_json"], {}), catalog=ws.catalog().to_json())

    @app.get("/articles/{aid}/revise", response_class=HTMLResponse)
    def revise(request: Request, aid: str, release: str = "", draft: str = ""):
        a = ws.article(aid)
        if release:
            basis = ws.db.one("SELECT * FROM releases WHERE id = ? AND article_id = ?", release, aid)
            if not basis:
                raise NotFound("release")
            files, label = ws.store.snapshot_files(basis["snapshot_id"]), f"v{basis['version']}"
        else:
            d = ws.db.one("SELECT * FROM drafts WHERE id = ? AND article_id = ?", draft, aid) if draft else \
                ws.db.one("SELECT * FROM drafts WHERE article_id = ? ORDER BY created DESC, rowid DESC LIMIT 1", aid)
            files, label = ws.store.snapshot_files(d["snapshot_id"]), "the latest draft"
        return page(request, "upload.html", article=a, basis={"release": release, "draft": draft, "label": label}, files=files)

    @app.get("/drafts/{did}", response_class=HTMLResponse)
    def draft_page(request: Request, did: str):
        d = ws.draft(did)
        a = ws.article(d["article_id"])
        files = ws.store.snapshot_files(d["snapshot_id"])
        build = ws.latest_build(did)
        cand = ws.candidate(did)
        ann = loads(d["announcement_json"], {"mode": "none"})
        return page(request, "draft.html", d=d, a=a, files=files, build=build, cand=cand, meta=loads(d["metadata_json"]),
                    links=loads(d["links_json"], {}), ann=ann, venue=loads(d["venue_json"], {}), cvj=loads(d["cv_json"], {}),
                    profile=loads(d["profile_json"]), catalog=ws.catalog().to_json(), default_ann=ws.default_announcement(did),
                    diags=loads(build["diagnostics_json"]) if build else [], is_revision=bool(a["latest_release_id"]))

    # ---------------------------------------------------------------- private downloads
    @app.get("/files/{fid}")
    def download_file(fid: str):
        r = ws.file_row(fid)
        return FileResponse(ws.store.blob_path(r["sha256"]), filename=Path(r["path"]).name, media_type="application/octet-stream")

    @app.get("/builds/{bid}/paper.pdf")
    def build_pdf(bid: str, download: int = 0):
        b = ws.build(bid)
        if not b["pdf_path"]:
            raise NotFound("PDF")
        return FileResponse(b["pdf_path"], media_type="application/pdf", filename=f"build-{bid}.pdf",
                            content_disposition_type="attachment" if download else "inline")

    @app.get("/builds/{bid}/build.log")
    def build_log(bid: str):
        b = ws.build(bid)
        if not b["log_path"] or not Path(b["log_path"]).exists():
            raise NotFound("log")
        return FileResponse(b["log_path"], media_type="text/plain; charset=utf-8", filename=f"build-{bid}.log")

    @app.get("/releases/{rid}/paper.pdf")
    def release_pdf(rid: str):
        r = ws.db.one("SELECT * FROM releases WHERE id = ?", rid)
        if not r:
            raise NotFound("release")
        return FileResponse(ws.store.blob_path(r["pdf_sha256"]), media_type="application/pdf", filename=f"v{r['version']}.pdf")

    # ---------------------------------------------------------------- API
    async def incoming(request: Request, require_pair: bool) -> tuple[list[Incoming], dict]:
        form = await request.form()
        files: list[Incoming] = []
        errors = []
        for field, role in (("tex", "entry"), ("bib", "bibliography")):
            up = form.get(field)
            if isinstance(up, UploadFile) and up.filename:
                path = form.get(f"{field}_path") or up.filename
                files.append(Incoming(str(path), await up.read(), role, field))
            elif require_pair:
                errors.append({"field": field, "message": f"Choose the main {'.tex' if field == 'tex' else '.bib'} file."})
        supports = [u for u in form.getlist("support") if isinstance(u, UploadFile) and u.filename]
        paths = form.getlist("support_paths")
        for i, up in enumerate(supports):
            rel = (paths[i] if i < len(paths) and paths[i] else up.filename)
            files.append(Incoming(str(rel), await up.read(), "support", "support"))
        if errors:
            raise UploadError(errors)
        return files, form

    @app.post("/api/articles", status_code=201)
    async def api_create_article(request: Request):
        files, form = await incoming(request, True)
        res = ws.create_article(files, slug=(form.get("slug") or None))
        return {**res, "url": f"/drafts/{res['draft_id']}"}

    @app.post("/api/articles/{aid}/drafts", status_code=201)
    async def api_new_draft(request: Request, aid: str):
        files, form = await incoming(request, False)
        res = ws.create_revision(aid, files, basis_release_id=form.get("basis_release_id") or None,
                                 basis_draft_id=form.get("basis_draft_id") or None, remove=set(form.getlist("remove")))
        return {**res, "url": f"/drafts/{res['draft_id']}"}

    @app.patch("/api/drafts/{did}")
    async def api_patch_draft(request: Request, did: str):
        body = await request.json()
        if not isinstance(body, dict) or not isinstance(body.get("rev"), int):
            raise Invalid([{"field": "rev", "message": "The draft revision token is required."}])
        d = ws.update_draft(did, body["rev"], {k: v for k, v in body.items() if k != "rev"})
        return {"rev": d["rev"], "status": d["status"]}

    @app.post("/api/drafts/{did}/builds", status_code=202)
    def api_build(did: str):
        ws.draft(did)
        return {"build_id": ws.enqueue_build(did)}

    @app.get("/api/builds/{bid}")
    def api_get_build(bid: str):
        b = ws.build(bid)
        d = ws.draft(b["draft_id"])
        fresh = b["snapshot_id"] == d["snapshot_id"]
        return {"id": b["id"], "status": b["status"], "ready": b["status"] == "ready" and not b["blocked"] and fresh, "stale": not fresh,
                "blocked": bool(b["blocked"]), "runner": b["runner"], "toolchain": b["toolchain"], "pages": b["pages"],
                "diagnostics": loads(b["diagnostics_json"], []), "pdf": f"/builds/{bid}/paper.pdf" if b["pdf_path"] else None,
                "log": f"/builds/{bid}/build.log" if b["log_path"] else None, "pdf_sha256": b["pdf_sha256"], "started": b["started"], "finished": b["finished"]}

    @app.get("/api/drafts/{did}/candidate")
    def api_candidate(did: str):
        c = ws.candidate(did)
        return {k: c[k] for k in ("fingerprint", "ready", "reasons", "version", "summary", "cv", "build_id", "suggestions", "release_date")}

    @app.post("/api/drafts/{did}/site-preview", status_code=202)
    def api_site_preview(did: str):
        cand = ws.candidate(did)
        if not cand["build_id"] or "Build the PDF first." in cand["reasons"]:
            raise Conflict("Build a PDF before previewing the site.")
        b = ws.build(cand["build_id"])
        if not b["pdf_sha256"]:
            raise Conflict("The latest build produced no PDF.")
        state = previews[did] = {"status": "running", "fingerprint": cand["fingerprint"], "message": "Building the site preview"}

        def job():
            from .publish import StagingAdapter
            try:
                ad = StagingAdapter(ws)
                c = ws.candidate_object(did, cand, "preview")
                target = cfg.data_dir / "staging" / "previews" / did
                ad.stage(f"preview-{did}", c, ws.store.read_blob(b["pdf_sha256"]), [], into=target)
                ptr = cfg.data_dir / "staging" / "preview-current"
                ptr.write_text(str(target), encoding="utf-8")
                art = ws.article(ws.draft(did)["article_id"])
                state.update(status="ready", message="Preview ready", url=f"http://127.0.0.1:{cfg.preview_port}/preprints/{art['slug']}/")
            except Exception as e:
                state.update(status="failed", message=str(e)[:2000])
        threading.Thread(target=job, daemon=True).start()
        return state

    @app.get("/api/drafts/{did}/site-preview")
    def api_site_preview_status(did: str):
        return previews.get(did, {"status": "none"})

    @app.post("/api/drafts/{did}/publish", status_code=202)
    async def api_publish(request: Request, did: str):
        body = await request.json()
        pub = ws.publisher.request_release(did, str(body.get("build_id", "")), str(body.get("fingerprint", "")), str(body.get("idempotency_key", "")))
        return publication_json(pub["id"])

    def publication_json(pid: str) -> dict:
        p = ws.db.one("SELECT * FROM publications WHERE id = ?", pid)
        if not p:
            raise NotFound("publication")
        rel = ws.db.one("SELECT version FROM releases WHERE id = ?", p["release_id"]) if p["release_id"] else None
        return {"id": p["id"], "kind": p["kind"], "status": p["status"], "message": p["message"], "adapter": p["adapter"],
                "version": rel["version"] if rel else None, "urls": loads(p["urls_json"], {}), "steps": loads(p["steps_json"], [])[-12:],
                "article_id": p["article_id"]}

    @app.get("/api/publications/{pid}")
    def api_publication(pid: str):
        return publication_json(pid)

    @app.post("/api/articles/{aid}/updates/preview")
    async def api_update_preview(request: Request, aid: str):
        changes = await request.json()
        c = ws.publisher.metadata_candidate(aid, changes)
        return {k: c[k] for k in ("fingerprint", "ready", "reasons", "cv")} | {"approval": c["approval"]}

    @app.post("/api/articles/{aid}/updates", status_code=202)
    async def api_update(request: Request, aid: str):
        body = await request.json()
        pub = ws.publisher.request_metadata_update(aid, body.get("changes") or {}, str(body.get("fingerprint", "")), str(body.get("idempotency_key", "")))
        return publication_json(pub["id"])

    @app.get("/api/catalog")
    def api_catalog():
        return ws.catalog().to_json()

    @app.get("/healthz")
    def health():
        return {"ok": True, "runner": ws.compiler.runner(), "adapter": cfg.adapter}

    return app
