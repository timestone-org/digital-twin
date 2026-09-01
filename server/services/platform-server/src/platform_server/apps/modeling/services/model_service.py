"""模型版本与绑定的读写。事务边界在这一层。"""

import uuid
from typing import Any, cast

from sqlalchemy.ext.asyncio import AsyncSession

from lib.web import Page, PageParams
from platform_server.apps.dataset.services import formula_library, formula_usage
from platform_server.apps.modeling.crud import (
    binding_crud,
    model_version_crud,
    node_run_crud,
)
from platform_server.apps.modeling.models import (
    ModelingBinding,
    ModelingModelVersion,
)
from platform_server.apps.modeling.protocols import ModelTask, ServingChannel
from platform_server.apps.modeling.schemas import (
    ModelBindingImpactOut,
    ModelBindingOut,
    ModelBindingUsageOut,
    ModelVersionCreateIn,
    ModelVersionOut,
    ModelVersionSummaryOut,
    ParamMapOut,
)
from platform_server.apps.modeling.services import binding_service
from platform_server.apps.modeling.services.jsonshape import (
    as_dict,
    as_texts,
)
from platform_server.apps.modeling.services.pipeline_service import Actor
from platform_server.apps.modeling.services.publish_service import (
    fingerprint,
    graph_of_run,
    inspect_run,
    require_publishable_run,
    require_version,
)


async def publish_version(
    session: AsyncSession, *, payload: ModelVersionCreateIn, actor: Actor
) -> ModelVersionOut:
    """把一次成功运行发布成一个不可变的版本。

    ⚠ 不可服务的运行**照样发**，只是 `servable=false` 且带原因：能看指标、能
    做对比，只是绑不上去。全拒的话，用户连「为什么不能上线」都看不到。
    Args: session, payload, actor。
    """
    run = await require_publishable_run(session, payload.run_id)
    previews = await _previews_of(session, run.id)
    verdict = inspect_run(graph_of_run(run), previews)
    row = model_version_crud.add(
        session,
        ModelingModelVersion(
            pipeline_id=run.pipeline_id,
            run_id=run.id,
            version=await model_version_crud.next_version(
                session, run.pipeline_id
            ),
            name=payload.name,
            algo=verdict.algo or "unknown",
            task=verdict.task or "regression",
            servable=verdict.is_servable,
            serving_channel=verdict.channel,
            unservable_reason=verdict.reason or None,
            serving_json=verdict.serving,
            feature_keys=list(verdict.feature_keys),
            target_key=verdict.target_key,
            metrics_json=_metrics_of(previews),
            fingerprint_json=fingerprint(run.row_count, _table_codes_of(run)),
            description=payload.description,
            created_by=actor.user_id,
            created_by_name=actor.name,
        ),
    )
    await session.flush()
    return _to_version_out(row)


async def list_versions(
    session: AsyncSession, *, pipeline_id: uuid.UUID | None, page: PageParams
) -> Page[ModelVersionSummaryOut]:
    """版本列表。

    Args: session, pipeline_id, page。
    """
    rows, total = await model_version_crud.page(
        session, pipeline_id=pipeline_id, offset=page.offset, limit=page.size
    )
    return Page[ModelVersionSummaryOut](
        items=[_to_summary(row) for row in rows],
        page=page.page,
        size=page.size,
        total=total,
    )


async def get_version(
    session: AsyncSession, version_id: uuid.UUID
) -> ModelVersionOut:
    """版本详情。

    Args: session, version_id。
    """
    return _to_version_out(await require_version(session, version_id))


async def retire_version(session: AsyncSession, version_id: uuid.UUID) -> None:
    """退役一个版本。还有绑定指着它时 409。

    Args: session, version_id。
    """
    row = await require_version(session, version_id)
    await binding_service.require_retirable(session, row.id)
    await model_version_crud.delete(session, row)


async def list_bindings(session: AsyncSession) -> list[ModelBindingOut]:
    """全部绑定，逐条现算孤儿标志。

    Args: session。
    """
    rows = await binding_crud.list_all(session)
    library = await formula_library.load_library(session)
    return [
        _to_binding_out(row, is_orphaned=row.fx_code not in library.entries)
        for row in rows
    ]


async def bind(
    session: AsyncSession, *, draft: binding_service.BindingDraft, actor: Actor
) -> ModelBindingOut:
    """建一条绑定。

    Args: session, draft, actor。
    """
    row = await binding_service.create_binding(
        session, draft=draft, actor=actor
    )
    return _to_binding_out(row, is_orphaned=False)


async def update_binding(
    session: AsyncSession,
    *,
    binding_id: uuid.UUID,
    version_id: uuid.UUID | None,
    is_enabled: bool | None,
) -> ModelBindingImpactOut:
    """换版本 / 启停，回执带影响面。

    Args: session, binding_id, version_id, is_enabled。
    """
    row = await binding_service.require_binding(session, binding_id)
    if version_id is not None:
        row = await binding_service.rebind(
            session, binding_id=binding_id, version_id=version_id
        )
    if is_enabled is not None:
        row = await binding_service.set_enabled(
            session, binding_id=binding_id, is_enabled=is_enabled
        )
    usages = await formula_usage.find_usages(session, row.fx_code)
    return ModelBindingImpactOut(
        **_to_binding_out(row, is_orphaned=False).model_dump(),
        usages=[
            ModelBindingUsageOut(
                table_code=item.table_code, column_key=item.column_key
            )
            for item in usages
        ],
    )


async def _previews_of(
    session: AsyncSession, run_id: uuid.UUID
) -> dict[str, Any]:
    rows = await node_run_crud.list_by_run(session, run_id)
    return {row.node_id: as_dict(row.preview_json) for row in rows}


def _metrics_of(previews: dict[str, Any]) -> dict[str, Any]:
    """发布时冻结的指标。找不到评估节点时给空字典，不编数。

    Args: previews。
    """
    for preview in previews.values():
        metrics = as_dict(as_dict(preview).get("metrics"))
        if metrics.get("kind") == "metrics":
            return as_dict(metrics.get("metrics"))
    return {}


def _table_codes_of(run: Any) -> list[str]:
    graph = graph_of_run(run)
    return sorted(
        {
            str(node.config.get("table_code"))
            for node in graph.nodes
            if node.config.get("table_code")
        }
    )


def _to_summary(row: ModelingModelVersion) -> ModelVersionSummaryOut:
    return ModelVersionSummaryOut(
        id=row.id,
        pipeline_id=row.pipeline_id,
        run_id=row.run_id,
        version=row.version,
        name=row.name,
        algo=row.algo,
        task=cast("ModelTask", row.task),
        is_servable=row.servable,
        serving_channel=cast("ServingChannel", row.serving_channel),
        unservable_reason=row.unservable_reason,
        feature_keys=as_texts(row.feature_keys),
        target_key=row.target_key,
        created_by_name=row.created_by_name,
        created_at=row.created_at,
    )


def _to_version_out(row: ModelingModelVersion) -> ModelVersionOut:
    return ModelVersionOut(
        **_to_summary(row).model_dump(),
        metrics={
            key: _as_number(value)
            for key, value in as_dict(row.metrics_json).items()
        },
        fingerprint=as_dict(row.fingerprint_json),
        description=row.description,
    )


def _as_number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _to_binding_out(
    row: ModelingBinding, *, is_orphaned: bool
) -> ModelBindingOut:
    return ModelBindingOut(
        id=row.id,
        fx_code=row.fx_code,
        model_version_id=row.model_version_id,
        param_map=[
            ParamMapOut(
                param=str(as_dict(item).get("param", "")),
                feature=str(as_dict(item).get("feature", "")),
            )
            for item in row.param_map_json
        ],
        is_enabled=row.is_enabled,
        is_orphaned=is_orphaned,
        created_by_name=row.created_by_name,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )
