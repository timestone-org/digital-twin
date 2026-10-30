"""模板版本与实例的分页、锁和审计存储。"""

import uuid
from dataclasses import dataclass
from typing import cast

from sqlalchemy import ColumnElement, Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from platform_server.apps.modeling.models import (
    ModelingModelVersion,
    ModelingPipeline,
    ModelingRuleVersion,
    ModelingRun,
)
from platform_server.apps.modeling.models.template import (
    ModelingConfigurationAudit,
    ModelingInstance,
    ModelingTemplate,
)


@dataclass(frozen=True)
class InstanceRecord:
    instance: ModelingInstance
    pipeline: ModelingPipeline
    template: ModelingTemplate
    latest_run: ModelingRun | None
    latest_model_version_id: uuid.UUID | None


class TemplateCrud(CrudBase[ModelingTemplate]):
    def __init__(self) -> None:
        super().__init__(ModelingTemplate)

    async def lock(
        self, session: AsyncSession, template_id: uuid.UUID
    ) -> ModelingTemplate | None:
        return await session.scalar(
            select(ModelingTemplate)
            .where(ModelingTemplate.id == template_id)
            .with_for_update()
        )

    async def page(
        self,
        session: AsyncSession,
        *,
        keyword: str | None,
        offset: int,
        limit: int,
    ) -> tuple[list[ModelingTemplate], int]:
        statement = select(ModelingTemplate).order_by(
            ModelingTemplate.created_at.desc(), ModelingTemplate.id.desc()
        )
        if keyword:
            statement = statement.where(
                ModelingTemplate.name.contains(keyword, autoescape=True)
                | ModelingTemplate.code.contains(keyword, autoescape=True)
            )
        return await self.list_page(
            session, statement=statement, offset=offset, limit=limit
        )

    async def next_version(
        self, session: AsyncSession, pipeline_id: uuid.UUID
    ) -> int:
        value = await session.scalar(
            select(func.max(ModelingTemplate.version)).where(
                ModelingTemplate.pipeline_id == pipeline_id
            )
        )
        return (value or 0) + 1


class InstanceCrud(CrudBase[ModelingInstance]):
    def __init__(self) -> None:
        super().__init__(ModelingInstance)

    async def lock(
        self, session: AsyncSession, instance_id: uuid.UUID
    ) -> ModelingInstance | None:
        return await session.scalar(
            select(ModelingInstance)
            .where(ModelingInstance.id == instance_id)
            .with_for_update()
        )

    async def record(
        self, session: AsyncSession, instance_id: uuid.UUID
    ) -> InstanceRecord | None:
        result = await session.execute(
            records_statement().where(ModelingInstance.id == instance_id)
        )
        row = result.one_or_none()
        return InstanceRecord(*row) if row else None

    async def page(
        self,
        session: AsyncSession,
        *,
        keyword: str | None,
        offset: int,
        limit: int,
    ) -> tuple[list[InstanceRecord], int]:
        statement = records_statement()
        if keyword:
            statement = statement.where(
                ModelingPipeline.name.contains(keyword, autoescape=True)
                | ModelingPipeline.code.contains(keyword, autoescape=True)
            )
        count = await session.scalar(
            select(func.count()).select_from(statement.subquery())
        )
        result = await session.execute(
            statement.order_by(
                ModelingInstance.updated_at.desc(), ModelingInstance.id.desc()
            )
            .offset(offset)
            .limit(limit)
        )
        return [InstanceRecord(*row) for row in result.all()], count or 0


def records_statement() -> Select[
    tuple[
        ModelingInstance,
        ModelingPipeline,
        ModelingTemplate,
        ModelingRun,
        uuid.UUID | None,
    ]
]:
    latest = (
        select(ModelingRun.id)
        .where(ModelingRun.pipeline_id == ModelingInstance.id)
        .order_by(ModelingRun.created_at.desc(), ModelingRun.id.desc())
        .limit(1)
        .correlate(ModelingInstance)
        .scalar_subquery()
    )
    # 外联接可返回空版本，SQLAlchemy 的 coalesce 标注没有体现这一点。
    published_version_id = cast(
        "ColumnElement[uuid.UUID | None]",
        func.coalesce(ModelingModelVersion.id, ModelingRuleVersion.id),
    )
    return (
        select(
            ModelingInstance,
            ModelingPipeline,
            ModelingTemplate,
            ModelingRun,
            published_version_id,
        )
        .join(ModelingPipeline, ModelingPipeline.id == ModelingInstance.id)
        .join(
            ModelingTemplate,
            ModelingTemplate.id == ModelingInstance.template_id,
        )
        .outerjoin(ModelingRun, ModelingRun.id == latest)
        .outerjoin(
            ModelingModelVersion, ModelingModelVersion.run_id == ModelingRun.id
        )
        .outerjoin(
            ModelingRuleVersion, ModelingRuleVersion.run_id == ModelingRun.id
        )
    )


def add_audit(session: AsyncSession, row: ModelingConfigurationAudit) -> None:
    session.add(row)


async def lock_pipeline(
    session: AsyncSession, pipeline_id: uuid.UUID
) -> ModelingPipeline | None:
    return await session.scalar(
        select(ModelingPipeline)
        .where(ModelingPipeline.id == pipeline_id)
        .with_for_update()
    )


async def has_templates(session: AsyncSession, pipeline_id: uuid.UUID) -> bool:
    return (
        await session.scalar(
            select(ModelingTemplate.id)
            .where(ModelingTemplate.pipeline_id == pipeline_id)
            .limit(1)
        )
        is not None
    )


templates = TemplateCrud()
instances = InstanceCrud()
