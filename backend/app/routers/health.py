"""健康检查。前端启动时用它确认后端可达。"""

from __future__ import annotations

from datetime import datetime, timezone
from fastapi import APIRouter

from .. import __version__

router = APIRouter(tags=["meta"])


@router.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "version": __version__,
        "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
