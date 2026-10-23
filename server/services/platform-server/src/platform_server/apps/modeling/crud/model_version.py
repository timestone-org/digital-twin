"""训练与规则版本的统一读取，分页与排序在数据库完成。"""

import uuid

from sqlalchemy import Subquery, func, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.modeling.models import (
    ModelingModelVersion,
    ModelingPipeline,
    ModelingRuleVersion,
    ModelVersion,
)


def _identities() -> Subquery:
    return union_all(
        select(
            ModelingModelVersion.id,
            ModelingModelVersion.version,
            ModelingModelVersion.pipeline_id,
            ModelingModelVersion.run_id,
        ),
        select(
            ModelingRuleVersion.id,
            ModelingRuleVersion.version,
            ModelingRuleVersion.pipeline_id,
            ModelingRuleVersion.run_id,
        ),
    ).subquery()


class ModelVersionCrud:
    """两个版本存储的统一数据访问；旧版本表任务集合保持不变。"""

    async def get(
        self, session: AsyncSession, entity_id: uuid.UUID
    ) -> ModelVersion | None:
        """按全局版本标识查找。Args: session, entity_id。"""
        trained = await session.get(ModelingModelVersion, entity_id)
        return trained or await session.get(ModelingRuleVersion, entity_id)

    def add(self, session: AsyncSession, entity: ModelVersion) -> ModelVersion:
        session.add(entity)
        return entity

    async def delete(self, session: AsyncSession, entity: ModelVersion) -> None:
        await session.delete(entity)

    async def next_version(
        self, session: AsyncSession, pipeline_id: uuid.UUID
    ) -> int:
        """按流水线取跨存储的下一版本号。Args: session, pipeline_id。"""
        await session.execute(
            select(ModelingPipeline.id)
            .where(ModelingPipeline.id == pipeline_id)
            .with_for_update()
        )
        versions = _identities()
        rows = await session.execute(
            select(func.max(versions.c.version)).where(
                versions.c.pipeline_id == pipeline_id
            )
        )
        return int(rows.scalar_one() or 0) + 1

    async def get_by_run(
        self, session: AsyncSession, run_id: uuid.UUID
    ) -> ModelVersion | None:
        """查一次运行发布的版本。Args: session, run_id。"""
        trained = await session.scalar(
            select(ModelingModelVersion).where(
                ModelingModelVersion.run_id == run_id
            )
        )
        if trained is not None:
            return trained
        return await session.scalar(
            select(ModelingRuleVersion).where(
                ModelingRuleVersion.run_id == run_id
            )
        )

    async def page(
        self,
        session: AsyncSession,
        *,
        pipeline_id: uuid.UUID | None,
        offset: int,
        limit: int,
    ) -> tuple[list[ModelVersion], int]:
        """数据库统一分页。Args: session, pipeline_id, offset, limit。"""
        versions = _identities()
        selected = select(versions.c.id)
        if pipeline_id is not None:
            selected = selected.where(versions.c.pipeline_id == pipeline_id)
        total = await session.scalar(
            select(func.count()).select_from(selected.subquery())
        )
        found = await session.scalars(
            selected.order_by(versions.c.version.desc(), versions.c.id.desc())
            .offset(offset)
            .limit(limit)
        )
        identities = [uuid.UUID(str(item)) for item in found.all()]
        if not identities:
            return [], int(total or 0)
        trained = await session.scalars(
            select(ModelingModelVersion).where(
                ModelingModelVersion.id.in_(identities)
            )
        )
        rules = await session.scalars(
            select(ModelingRuleVersion).where(
                ModelingRuleVersion.id.in_(identities)
            )
        )
        by_id: dict[uuid.UUID, ModelVersion] = {
            item.id: item for item in (*trained.all(), *rules.all())
        }
        return [
            by_id[identity] for identity in identities if identity in by_id
        ], int(total or 0)

    async def published_run_ids(
        self, session: AsyncSession, pipeline_id: uuid.UUID | None
    ) -> frozenset[uuid.UUID]:
        """保留期清理必须保护两个存储的来源运行。Args: session, pipeline_id。"""
        versions = _identities()
        selected = select(versions.c.run_id)
        if pipeline_id is not None:
            selected = selected.where(versions.c.pipeline_id == pipeline_id)
        rows = await session.scalars(selected)
        return frozenset(uuid.UUID(str(item)) for item in rows.all())

    async def count_of_pipeline(
        self, session: AsyncSession, pipeline_id: uuid.UUID
    ) -> int:
        """删除流水线前计数全部版本。Args: session, pipeline_id。"""
        versions = _identities()
        found = await session.scalar(
            select(func.count())
            .select_from(versions)
            .where(versions.c.pipeline_id == pipeline_id)
        )
        return int(found or 0)


model_version_crud = ModelVersionCrud()
