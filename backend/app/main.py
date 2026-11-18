"""FastAPI 入口。

本地启动::

    python -m uvicorn app.main:app --reload --reload-dir backend --app-dir backend
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import __version__
from .config import settings
from .db import init_db
from .routers import books_router, health_router
from .services import storage


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    init_db()
    storage.cleanup_stale_temps()
    yield


app = FastAPI(
    title="Reader API",
    version=__version__,
    summary="自用电子书阅读器后端",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# 错误统一成 {"error": {"code", "message"}}，前端只需读一个字段。
@app.exception_handler(StarletteHTTPException)
async def http_error(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.status_code, "message": str(exc.detail)}},
        headers=getattr(exc, "headers", None),
    )


@app.exception_handler(RequestValidationError)
async def validation_error(
        _request: Request, exc: RequestValidationError
) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else {}
    field = ".".join(str(part) for part in first.get("loc", ())[1:]) or "请求"
    return JSONResponse(
        status_code=422,
        content={
            "error": {"code": "invalid_request", "message": f"{field} 不合法"}
        },
    )


app.include_router(health_router, prefix="/api")
app.include_router(books_router, prefix="/api")
