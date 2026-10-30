"""模型实例创建、集中配置与修订保护。"""

import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from lib.web import Page, PageParams
from platform_server.apps.modeling.crud import pipeline_crud, run_crud
from platform_server.apps.modeling.crud.template import (
    InstanceRecord,
    instances,
    templates,
)
from platform_server.apps.modeling.errors import (
    GraphInvalid,
    InstanceNotFound,
    InstanceRevisionConflict,
    PipelineCodeTaken,
    RunNotFound,
    TemplateNotFound,
    TemplateUnavailable,
)
from platform_server.apps.modeling.models import ModelingPipeline
from platform_server.apps.modeling.models.template import ModelingInstance
from platform_server.apps.modeling.schemas.graph import PipelineGraph
from platform_server.apps.modeling.schemas.template import (
    ModelingConfigurationOut,
    ModelingInstanceConfigureIn,
    ModelingInstanceCreateIn,
    ModelingInstanceOut,
)
from platform_server.apps.modeling.services.configuration import (
    configure_graph,
    describe_configuration,
    require_template_graph,
)
from platform_server.apps.modeling.services.graph_walk import source_table_codes
from platform_server.apps.modeling.services.pipeline_service import Actor
from platform_server.apps.modeling.services.presenters import to_run_summary
from platform_server.apps.modeling.services.template_service import record_audit


async def create_instance(
    session: AsyncSession, payload: ModelingInstanceCreateIn, actor: Actor
) -> ModelingInstanceOut:
    template = await templates.lock(session, payload.template_id)
    if template is None:
        raise TemplateNotFound("建模模板不存在")
    if not template.is_enabled:
        raise TemplateUnavailable("模板已停用，请选择可用模板")
    graph = PipelineGraph.model_validate(template.graph_json)
    graph = (
        configure_graph(graph, payload.configuration)
        if payload.configuration is not None
        else require_template_graph(graph)
    )
    pipeline = pipeline_crud.add(
        session,
        ModelingPipeline(
            code=payload.code,
            name=payload.name,
            description=payload.description,
            graph_json=graph.model_dump(mode="json"),
            source_table_codes=list(source_table_codes(graph)),
            created_by=actor.user_id,
            created_by_name=actor.name,
        ),
    )
    try:
        await session.flush()
    except IntegrityError as error:
        raise PipelineCodeTaken("模型编码已经被占用") from error
    instances.add(
        session,
        ModelingInstance(id=pipeline.id, template_id=template.id, revision=1),
    )
    record_audit(
        session,
        actor,
        "instance_created",
        pipeline.id,
        (None, pipeline.graph_json),
    )
    await session.flush()
    return await get_instance(session, pipeline.id)


async def list_instances(
    session: AsyncSession, keyword: str | None, page: PageParams
) -> Page[ModelingInstanceOut]:
    rows, total = await instances.page(
        session, keyword=keyword, offset=page.offset, limit=page.size
    )
    return Page[ModelingInstanceOut](
        items=[to_instance(row) for row in rows],
        page=page.page,
        size=page.size,
        total=total,
    )


async def require_instance(
    session: AsyncSession, instance_id: uuid.UUID
) -> InstanceRecord:
    record = await instances.record(session, instance_id)
    if record is None:
        raise InstanceNotFound("模型实例不存在")
    return record


async def lock_instance(
    session: AsyncSession, instance_id: uuid.UUID
) -> InstanceRecord:
    if await instances.lock(session, instance_id) is None:
        raise InstanceNotFound("模型实例不存在")
    return await require_instance(session, instance_id)


async def get_instance(
    session: AsyncSession, instance_id: uuid.UUID
) -> ModelingInstanceOut:
    return to_instance(await require_instance(session, instance_id))


async def get_configuration(
    session: AsyncSession,
    instance_id: uuid.UUID,
    run_id: uuid.UUID | None = None,
) -> ModelingConfigurationOut:
    record = await require_instance(session, instance_id)
    graph = PipelineGraph.model_validate(record.pipeline.graph_json)
    if run_id is not None:
        graph = await _historical_graph(session, record, run_id)
    result = describe_configuration(graph)
    return result.model_copy(update={"instance": to_instance(record)})


async def _historical_graph(
    session: AsyncSession, record: InstanceRecord, run_id: uuid.UUID
) -> PipelineGraph:
    run = await run_crud.get(session, run_id)
    if run is None or run.pipeline_id != record.instance.id:
        raise RunNotFound("本模型实例下没有这次训练记录")
    snapshot = PipelineGraph.model_validate(run.graph_snapshot)
    current = PipelineGraph.model_validate(record.pipeline.graph_json)
    if _structure_of(snapshot) != _structure_of(current):
        raise GraphInvalid(
            "历史运行的流水线结构与当前模型不一致，不能用于优化配置"
        )
    require_template_graph(snapshot)
    return snapshot


def _structure_of(graph: PipelineGraph) -> dict[str, object]:
    return {
        "format_version": graph.format_version,
        "nodes": sorted((node.id, node.operator) for node in graph.nodes),
        "edges": sorted(edge.model_dump_json() for edge in graph.edges),
    }


async def configure_instance(
    session: AsyncSession,
    instance_id: uuid.UUID,
    payload: ModelingInstanceConfigureIn,
    actor: Actor,
) -> ModelingInstanceOut:
    record = await lock_instance(session, instance_id)
    if record.instance.revision != payload.expected_revision:
        raise InstanceRevisionConflict("模型配置已经更新，请重新加载后再保存")
    if await run_crud.active_of(session, instance_id):
        raise InstanceRevisionConflict(
            "模型正在训练，请等待结束或取消后再修改配置"
        )
    graph = configure_graph(
        PipelineGraph.model_validate(record.pipeline.graph_json),
        payload.configuration,
    )
    before = _configuration_snapshot(record)
    record.pipeline.graph_json = graph.model_dump(mode="json")
    record.pipeline.source_table_codes = list(source_table_codes(graph))
    if payload.name is not None:
        record.pipeline.name = payload.name
    if "description" in payload.model_fields_set:
        record.pipeline.description = payload.description
    record.instance.revision += 1
    record_audit(
        session,
        actor,
        "instance_configured",
        instance_id,
        (before, _configuration_snapshot(record)),
    )
    await session.flush()
    return to_instance(record)


def to_instance(record: InstanceRecord) -> ModelingInstanceOut:
    row = record.pipeline
    template = record.template
    return ModelingInstanceOut(
        id=row.id,
        code=row.code,
        name=row.name,
        description=row.description,
        template_id=template.id,
        template_name=template.name,
        template_version=template.version,
        revision=record.instance.revision,
        latest_run=(
            to_run_summary(record.latest_run) if record.latest_run else None
        ),
        created_at=record.instance.created_at,
        updated_at=record.instance.updated_at,
    )


def _configuration_snapshot(record: InstanceRecord) -> dict[str, object]:
    return {
        "graph": record.pipeline.graph_json,
        "name": record.pipeline.name,
        "description": record.pipeline.description,
    }
