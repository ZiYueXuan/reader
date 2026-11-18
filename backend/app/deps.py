"""路由层公共依赖。"""

from __future__ import annotations

from fastapi import Header, HTTPException, status

from .config import settings


async def require_token(authorization: str | None = Header(default=None)) -> None:
    """配置了 ``READER_TOKEN`` 才校验，本机自用时留空即可。"""
    if not settings.token:
        return
    expected = f"Bearer {settings.token}"
    if authorization != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="访问口令无效",
            headers={"WWW-Authenticate": "Bearer"},
        )
