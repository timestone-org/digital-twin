"""模板发布、读取、启停与配置审计。"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import current_traceparent, parse_traceparent
from lib.web import Page, PageParams
from platform_server.apps.modeling.crud.template import (
    add_audit,
    instances,
    lock_pipeline,
    templates,
)
from platform_server.apps.modeling.errors import (
    PipelineNotFound,
    TemplateNotFound,
    TemplateUnavailable,
)
from platform_server.apps.modeling.models.template import (
    ModelingConfigurationAudit,
    ModelingTemplate,
)
from platform_server.apps.modeling.schemas.graph import PipelineGraph
from platform_server.apps.modeling.schemas.template import (
    ModelingConfigurationOut,
    ModelingTemplateCreateIn,
    ModelingTemplateOut,
    ModelingTemplateUpdateIn,
)
from platform_server.apps.modeling.services.configuration import (
    describe_configuration,
    require_template_graph,
)
from platform_server.apps.modeling.services.pipeline_service import Actor


async def create_template(
    session: AsyncSession, payload: ModelingTemplateCreateIn, actor: Actor
) -> ModelingTemplateOut:
    pipeline = await lock_pipeline(session, payload.pipeline_id)
    if pipeline is None:
        raise PipelineNotFound("模板设计不存在")
    if await instances.get(session, pipeline.id):
        raise TemplateUnavailable(
            "请在模板设计中发布，模型实例只用于配置和训练"
        )
    graph = require_template_graph(
        PipelineGraph.model_validate(pipeline.graph_json)
    )
    row = templates.add(
        session,
        ModelingTemplate(
            pipeline_id=pipeline.id,
            code=pipeline.code,
            name=payload.name,
            description=payload.description,
            version=await templates.next_version(session, pipeline.id),
            graph_json=graph.model_dump(mode="json"),
            created_by=actor.user_id,
            created_by_name=actor.name,
        ),
    )
    await session.flush()
    record_audit(
        session, actor, "template_published", row.id, (None, row.graph_json)
    )
    return to_template(row)


async def list_templates(
    session: AsyncSession, keyword: str | None, page: PageParams
) -> Page[ModelingTemplateOut]:
    rows, total = await templates.page(
        session, keyword=keyword, offset=page.offset, limit=page.size
    )
    return Page[ModelingTemplateOut](
        items=[to_template(row) for row in rows],
        page=page.page,
        size=page.size,
        total=total,
    )


async def require_template(
    session: AsyncSession, template_id: uuid.UUID
) -> ModelingTemplate:
    row = await templates.get(session, template_id)
    if row is None:
        raise TemplateNotFound("建模模板不存在")
    return row


async def get_template(
    session: AsyncSession, template_id: uuid.UUID
) -> ModelingTemplateOut:
    return to_template(await require_template(session, template_id))


async def get_configuration(
    session: AsyncSession, template_id: uuid.UUID
) -> ModelingConfigurationOut:
    row = await require_template(session, template_id)
    return describe_configuration(PipelineGraph.model_validate(row.graph_json))


async def update_template(
    session: AsyncSession,
    template_id: uuid.UUID,
    payload: ModelingTemplateUpdateIn,
    actor: Actor,
) -> ModelingTemplateOut:
    row = await templates.lock(session, template_id)
    if row is None:
        raise TemplateNotFound("建模模板不存在")
    before: dict[str, object] = {"is_enabled": row.is_enabled}
    row.is_enabled = payload.is_enabled
    record_audit(
        session,
        actor,
        "template_availability_changed",
        row.id,
        (before, {"is_enabled": row.is_enabled}),
    )
    await session.flush()
    return to_template(row)


def to_template(row: ModelingTemplate) -> ModelingTemplateOut:
    return ModelingTemplateOut(
        id=row.id,
        pipeline_id=row.pipeline_id,
        code=row.code,
        name=row.name,
        description=row.description,
        version=row.version,
        node_count=len(PipelineGraph.model_validate(row.graph_json).nodes),
        is_enabled=row.is_enabled,
        created_by_name=row.created_by_name,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def record_audit(
    session: AsyncSession,
    actor: Actor,
    action: str,
    target: uuid.UUID,
    changes: tuple[dict[str, object] | None, dict[str, object] | None],
) -> None:
    add_audit(
        session,
        ModelingConfigurationAudit(
            actor_id=actor.user_id,
            source_ip=actor.source_ip,
            action=action,
            target_id=target,
            trace_id=parse_traceparent(current_traceparent()) or "",
            before_json=changes[0],
            after_json=changes[1],
        ),
    )
