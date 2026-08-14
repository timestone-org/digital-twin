"""缩略图数据访问。一屏一行，写侧走 upsert。"""

import uuid

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from platform_server.apps.dashboard.models import DashboardThumbnail


class ThumbnailCrud(CrudBase[DashboardThumbnail]):
    """`dashboard_thumbnails` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(DashboardThumbnail)

    async def upsert(
        self, session: AsyncSession, *, dashboard_id: uuid.UUID, data: str
    ) -> DashboardThumbnail:
        """写入或整张替换，返回落库后的那一行。

        ⚠ 走 `ON CONFLICT` 而不是「先查再插」：截图是编辑器一停手就发一次的，
        同一张屏的两次保存撞在一起时，先查再插的那条会撞主键，用户看到的是 500。
        ⚠ `updated_at` 要在 `set_` 里显式推进：`onupdate` 是 ORM 层的钩子，
        核心层的 upsert 走不到它，不写就永远停在第一次写入的时刻。
        ⚠ 回读要 `populate_existing`：同一事务里若别处已经加载过这一行，
        身份映射会把旧的 `data` 原样交回来，接口于是回显上一张图。
        Args: session, dashboard_id, data。
        """
        statement = (
            insert(DashboardThumbnail)
            .values(dashboard_id=dashboard_id, data=data)
            .on_conflict_do_update(
                index_elements=[DashboardThumbnail.dashboard_id],
                set_={"data": data, "updated_at": func.now()},
            )
        )
        await session.execute(statement)
        stored = await session.get(
            DashboardThumbnail, dashboard_id, populate_existing=True
        )
        # pragma 理由：刚 upsert 过的主键在同一事务里必然查得到
        if stored is None:  # pragma: no cover
            raise RuntimeError("缩略图写入后回读为空")
        return stored


thumbnail_crud = ThumbnailCrud()
