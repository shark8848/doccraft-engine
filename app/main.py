from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.config import get_settings
from app.db import SessionLocal, engine, init_schema
from app.es import ElasticsearchStore, SearchUnavailable
from app.routers import assets, documents, option_sources, search, templates
from app.seed import seed_examples
from app.storage import PyUploadXStorage, StorageUnavailable

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("doccraft.api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.settings = settings
    app.state.es = ElasticsearchStore(settings)
    app.state.storage = PyUploadXStorage(settings)
    if settings.auto_create_schema:
        await init_schema()
    if settings.auto_init_indices:
        await app.state.es.ensure_indices()
    if settings.seed_dev_data:
        await seed_examples()
    logger.info("DocCraft API started env=%s version=%s", settings.env, settings.version)
    try:
        yield
    finally:
        app.state.storage.close()
        await app.state.es.close()
        await engine.dispose()
        logger.info("DocCraft API stopped")


app = FastAPI(
    title="DocCraft Engine API",
    version=get_settings().version,
    description="模板驱动的内容生产、发布与检索服务",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["ETag", "X-Trace-Id"],
)


@app.middleware("http")
async def trace_request(request: Request, call_next):
    trace_id = request.headers.get("X-Trace-Id") or uuid.uuid4().hex
    request.state.trace_id = trace_id
    response = await call_next(request)
    response.headers["X-Trace-Id"] = trace_id
    return response


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    if isinstance(exc.detail, dict):
        payload = dict(exc.detail)
        payload.setdefault("code", "HTTP_ERROR")
        payload.setdefault("message", str(exc.detail))
    else:
        payload = {"code": "HTTP_ERROR", "message": str(exc.detail)}
    payload.setdefault("traceId", getattr(request.state, "trace_id", None))
    return JSONResponse(status_code=exc.status_code, content=payload, headers=exc.headers)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "code": "VALIDATION_ERROR",
            "message": "请求参数校验失败",
            "details": exc.errors(),
            "traceId": getattr(request.state, "trace_id", None),
        },
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled request error trace=%s", getattr(request.state, "trace_id", None))
    return JSONResponse(
        status_code=500,
        content={
            "code": "INTERNAL_ERROR",
            "message": "服务暂时不可用，请稍后重试",
            "traceId": getattr(request.state, "trace_id", None),
        },
    )


@app.get("/healthz", tags=["system"])
async def healthz() -> dict:
    settings = get_settings()
    return {"status": "ok", "service": "doccraft-engine", "version": settings.version}


@app.get("/readyz", tags=["system"])
async def readyz(request: Request) -> dict:
    checks: dict[str, str] = {}
    status_code = 200
    try:
        async with SessionLocal() as session:
            await session.execute(text("select 1"))
        checks["postgres"] = "ok"
    except Exception as exc:  # noqa: BLE001
        checks["postgres"] = "unavailable"
        status_code = 503
        logger.warning("readiness postgres failed: %s", exc)
    try:
        await request.app.state.es.ping()
        checks["elasticsearch"] = "ok"
    except SearchUnavailable as exc:
        checks["elasticsearch"] = "unavailable"
        status_code = 503
        logger.warning("readiness elasticsearch failed: %s", exc)
    try:
        await request.app.state.storage.health()
        checks["pyuploadx"] = "ok"
    except StorageUnavailable as exc:
        checks["pyuploadx"] = "unavailable"
        status_code = 503
        logger.warning("readiness pyuploadx failed: %s", exc)
    if status_code != 200:
        raise HTTPException(
            status_code=status_code,
            detail={"code": "NOT_READY", "message": "依赖服务尚未就绪", "checks": checks},
        )
    return {"status": "ready", "checks": checks}


@app.get("/api/v1/session", tags=["system"])
async def session_info() -> dict:
    settings = get_settings()
    return {
        "tenantId": settings.default_tenant,
        "userId": settings.default_user,
        "role": settings.default_role,
        "authMode": settings.auth_mode,
        "version": settings.version,
    }


app.include_router(templates.router, prefix=get_settings().api_prefix)
app.include_router(documents.router, prefix=get_settings().api_prefix)
app.include_router(assets.router, prefix=get_settings().api_prefix)
app.include_router(search.router, prefix=get_settings().api_prefix)
app.include_router(option_sources.router, prefix=get_settings().api_prefix)


WEB_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if (WEB_DIST / "index.html").is_file():
    if (WEB_DIST / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="web-assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str) -> FileResponse:
        if full_path.startswith("api/") or full_path in {"healthz", "readyz", "docs", "redoc", "openapi.json"}:
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "接口不存在"})
        candidate = (WEB_DIST / full_path).resolve()
        if candidate.is_file() and WEB_DIST in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(WEB_DIST / "index.html")
