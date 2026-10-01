from __future__ import annotations
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from .config import get_settings
from .auth import current_user
from .workspace import ensure_workspace, use_workspace
from .version import APP_VERSION
from .api import router as api_router
from .api.system import startup


BACKEND_DIR = Path(__file__).resolve().parents[1]

FRONTEND_DIST_DIR = BACKEND_DIR.parent / "frontend" / "dist"

_settings = get_settings()

@asynccontextmanager
async def lifespan(_: FastAPI):
    startup()
    yield

app = FastAPI(
    title="CareerLoop API",
    version=APP_VERSION,
    docs_url="/docs" if _settings.api_docs_enabled else None,
    redoc_url="/redoc" if _settings.api_docs_enabled else None,
    openapi_url="/openapi.json" if _settings.api_docs_enabled else None,
    lifespan=lifespan,
)

_OPEN_AUTH_PATHS = {
    "/health",
    "/auth/config",
    "/auth/bootstrap",
    "/auth/login",
    "/auth/register",
}

_DOC_PATHS = {"/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"}

_REQUIRE_LOGIN_WHITELIST = _OPEN_AUTH_PATHS | (_DOC_PATHS if _settings.api_docs_enabled else set())

_PUBLIC_FRONTEND_FILES = {"/favicon.ico", "/vite.svg", "/careerloop-mark-v2.png"}

_STATIC_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable"

def static_asset_cache_control(path: str) -> str | None:
    """Return the safe long-lived cache policy for Vite's content-hashed assets."""
    return _STATIC_ASSET_CACHE_CONTROL if path.startswith("/assets/") else None

@app.middleware("http")
async def require_login(request: Request, call_next: Any) -> Any:
    path = request.url.path
    is_frontend_asset = path == "/" or path.startswith("/assets/") or path in _PUBLIC_FRONTEND_FILES
    if request.method == "OPTIONS" or is_frontend_asset or path in _REQUIRE_LOGIN_WHITELIST:
        response = await call_next(request)
        cache_control = static_asset_cache_control(path)
        if cache_control and response.status_code == 200:
            response.headers["Cache-Control"] = cache_control
        return response
    try:
        user = current_user(request.headers.get("Authorization"))
    except HTTPException as exc:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    root = ensure_workspace(int(user["id"]))
    with use_workspace(int(user["id"]), root):
        return await call_next(request)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)

if FRONTEND_DIST_DIR.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST_DIR, html=True), name="frontend")
