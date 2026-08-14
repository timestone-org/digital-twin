"""缩略图读写。事务边界在这一层：crud 不提交，api 不写业务。"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from platform_server.apps.dashboard.crud.thumbnail import thumbnail_crud
from platform_server.apps.dashboard.errors import (
    ThumbnailNotFound,
    ThumbnailTooLarge,
)
from platform_server.apps.dashboard.models.thumbnail import (
    MAX_THUMBNAIL_CHARS,
)
from platform_server.apps.dashboard.schemas.thumbnail import (
    ThumbnailOut,
    ThumbnailPutIn,
)
from platform_server.apps.dashboard.services.dashboard_service import (
    require_dashboard,
)

_logger = get_logger("platform.dashboard.thumbnail")


async def get_thumbnail(
    session: AsyncSession, *, dashboard_id: uuid.UUID
) -> ThumbnailOut:
    """取一张屏的缩略图，没有就 404（前端据此显示占位图）。

    ⚠ 查得到就直接回，查不到才再问一次大屏在不在：两种 404 的处置完全不同，
    「屏还没截过图」要显示占位图，「没这张屏」要把卡片从列表里去掉。
    Args: session, dashboard_id。
    """
    stored = await thumbnail_crud.get(session, dashboard_id)
    if stored is not None:
        return ThumbnailOut.model_validate(stored)
    await require_dashboard(session, dashboard_id)
    raise ThumbnailNotFound("这张大屏还没有缩略图")


async def put_thumbnail(
    session: AsyncSession, *, dashboard_id: uuid.UUID, payload: ThumbnailPutIn
) -> ThumbnailOut:
    """整张替换缩略图。超出体积上限一律 413，不静默截断。

    Args: session, dashboard_id, payload。
    """
    await require_dashboard(session, dashboard_id)
    require_within_limit(payload.data)
    stored = await thumbnail_crud.upsert(
        session, dashboard_id=dashboard_id, data=payload.data
    )
    await session.flush()
    _logger.info(
        "dashboard_thumbnail_stored",
        "大屏缩略图已保存",
        dashboard_id=str(dashboard_id),
        chars=len(payload.data),
    )
    return ThumbnailOut.model_validate(stored)


def require_within_limit(data: str) -> None:
    """体积闸。超了 413，不是 422——客户端要据此改小截图再发一次。

    Args: data。
    """
    if len(data) > MAX_THUMBNAIL_CHARS:
        raise ThumbnailTooLarge(
            f"缩略图超出上限（最多 {MAX_THUMBNAIL_CHARS} 个字符），"
            "请降低截图分辨率或改用 JPEG"
        )
