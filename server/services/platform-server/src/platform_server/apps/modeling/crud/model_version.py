"""模型版本的数据访问。版本内容不可变，故只有建、查、删三种动作。"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from platform_server.apps.modeling.models import ModelingModelVersion

# 版本列表按版本号倒序，最新的在前
NEWEST_FIRST = (
    ModelingModelVersion.version.desc(),
    ModelingModelVersion.id.desc(),
)


class ModelVersionCrud(CrudBase[ModelingModelVersion]):
    """`modeling_model_versions` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(ModelingModelVersion)

    async def next_version(
        self, session: AsyncSession, pipeline_id: uuid.UUID
    ) -> int:
        """这条流水线的下一个版本号。

        ⚠ 并发发布靠 `(pipeline_id, version)` 的唯一约束兜底，不靠这里算得准：
        两次发布同时读到同一个最大值时，后插的那条会被数据库拒掉。
        Args: session, pipeline_id。
        """
        rows = await session.execute(
            select(func.max(ModelingModelVersion.version)).where(
                ModelingModelVersion.pipeline_id == pipeline_id
            )
        )
        return int(rows.scalar_one() or 0) + 1

    async def get_by_run(
        self, session: AsyncSession, run_id: uuid.UUID
    ) -> ModelingModelVersion | None:
        """一次运行发布出来的版本；没发布过给 None。

        Args: session, run_id。
        """
        rows = await session.execute(
            select(ModelingModelVersion).where(
                ModelingModelVersion.run_id == run_id
            )
        )
        return rows.scalars().first()

    async def page(
        self,
        session: AsyncSession,
        *,
        pipeline_id: uuid.UUID | None,
        offset: int,
        limit: int,
    ) -> tuple[list[ModelingModelVersion], int]:
        """按流水线筛一页版本。

        Args: session, pipeline_id, offset, limit。
        """
        statement = select(ModelingModelVersion)
        if pipeline_id is not None:
            statement = statement.where(
                ModelingModelVersion.pipeline_id == pipeline_id
            )
        return await self.list_page(
            session,
            statement=statement.order_by(*NEWEST_FIRST),
            offset=offset,
            limit=limit,
        )

    async def published_run_ids(
        self, session: AsyncSession, pipeline_id: uuid.UUID | None
    ) -> frozenset[uuid.UUID]:
        """发布过模型版本的那些运行 id。

        ⚠ 保留期清理靠它绕开这些运行：版本行的 `run_id` 是 RESTRICT 外键，
        删它们会在 DELETE 那一刻炸，而那时清理已经走了一半。
        Args: session, pipeline_id（给 None 就是全库）。
        """
        statement = select(ModelingModelVersion.run_id)
        if pipeline_id is not None:
            statement = statement.where(
                ModelingModelVersion.pipeline_id == pipeline_id
            )
        rows = await session.execute(statement)
        return frozenset(rows.scalars().all())

    async def count_of_pipeline(
        self, session: AsyncSession, pipeline_id: uuid.UUID
    ) -> int:
        """一条流水线下有几个版本。删流水线前要问一次。

        Args: session, pipeline_id。
        """
        return await self.count(
            session,
            statement=select(ModelingModelVersion).where(
                ModelingModelVersion.pipeline_id == pipeline_id
            ),
        )


model_version_crud = ModelVersionCrud()
