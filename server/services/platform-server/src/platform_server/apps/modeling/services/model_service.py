"""模型版本与绑定的读写。事务边界在这一层。"""

import uuid
from dataclasses import dataclass, field
from typing import Any, cast

from sqlalchemy.ext.asyncio import AsyncSession
from uuid_utils.compat import uuid7

from lib.objectstore import ObjectStore
from lib.web import Page, PageParams
from platform_server.apps.dataset.services import formula_library, formula_usage
from platform_server.apps.modeling.crud import (
    binding_crud,
    model_artifact_crud,
    model_version_crud,
    node_run_crud,
)
from platform_server.apps.modeling.models import (
    ModelingBinding,
    ModelingModelArtifact,
    ModelingModelVersion,
)
from platform_server.apps.modeling.protocols import ModelTask, ServingChannel
from platform_server.apps.modeling.schemas import (
    ModelBindingImpactOut,
    ModelBindingOut,
    ModelBindingUpdateIn,
    ModelBindingUsageOut,
    ModelFormulaOut,
    ModelVersionCreateIn,
    ModelVersionOut,
    ModelVersionSummaryOut,
    ParamMapOut,
)
from platform_server.apps.modeling.services import (
    artifact_io,
    artifact_store,
    binding_service,
    formula_registration,
)
from platform_server.apps.modeling.services.artifact_store import (
    ArtifactRejected,
)
from platform_server.apps.modeling.services.entry_contract import NodeRecord
from platform_server.apps.modeling.services.jsonshape import (
    as_dict,
    as_text,
    as_texts,
)
from platform_server.apps.modeling.services.pipeline_service import Actor
from platform_server.apps.modeling.services.publish_service import (
    Publishable,
    fingerprint,
    graph_of_run,
    inspect_run,
    model_artifact,
    require_publishable_run,
    require_version,
)


async def publish_version(
    session: AsyncSession,
    *,
    payload: ModelVersionCreateIn,
    actor: Actor,
    store: ObjectStore | None = None,
) -> ModelVersionOut:
    """把一次成功运行发布成一个不可变的版本。

    ⚠ 不可服务的运行**照样发**，只是 `servable=false` 且带原因：能看指标、能
    做对比，只是绑不上去。全拒的话，用户连「为什么不能上线」都看不到。
    ⚠ 通道 B 的次序是**先搬字节、再落两行**：反过来的话库里会指着一个还不存在
    的键。搬完落库失败只留一份没人引用的字节，那由保留期收拾。
    Args: session, payload, actor, store。
    """
    run = await require_publishable_run(session, payload.run_id)
    records = await _records_of(session, run.id)
    graph = graph_of_run(run)
    version_id = uuid7()
    binary = await _binary_of(store, graph, records, version_id)
    draft = _Draft(
        version_id=version_id,
        version=await model_version_crud.next_version(session, run.pipeline_id),
        run=run,
        payload=payload,
        actor=actor,
        verdict=_refused_if(
            inspect_run(graph, records, binary.estimator), binary.reason
        ),
        metrics=_metrics_of(records),
    )
    row = model_version_crud.add(session, _version_row(draft))
    if draft.verdict.is_servable and binary.meta:
        model_artifact_crud.add(session, _artifact_row(version_id, binary.meta))
    await session.flush()
    return _to_version_out(row)


@dataclass(frozen=True)
class _Draft:
    """要落成一行版本的一整包。打成一包是因为形参上限是 5。"""

    version_id: uuid.UUID
    version: int
    run: Any
    payload: ModelVersionCreateIn
    actor: Actor
    verdict: Publishable
    metrics: dict[str, Any]


def _version_row(draft: _Draft) -> ModelingModelVersion:
    """一行不可变的模型版本。

    ⚠ 版本 id 是**外面铸好的**：通道 B 的对象键按它拼，而字节要在这一行落库
    之前就搬到位。
    Args: draft。
    """
    verdict = draft.verdict
    return ModelingModelVersion(
        id=draft.version_id,
        pipeline_id=draft.run.pipeline_id,
        run_id=draft.run.id,
        version=draft.version,
        name=draft.payload.name,
        algo=verdict.algo or "unknown",
        task=verdict.task or "regression",
        servable=verdict.is_servable,
        serving_channel=verdict.channel,
        unservable_reason=verdict.reason or None,
        serving_json=verdict.serving,
        signature_json=verdict.signature,
        feature_keys=list(verdict.feature_keys),
        target_key=verdict.target_key,
        metrics_json=draft.metrics,
        fingerprint_json=fingerprint(
            draft.run.row_count, _table_codes_of(draft.run)
        ),
        description=draft.payload.description,
        created_by=draft.actor.user_id,
        created_by_name=draft.actor.name,
    )


def _refused_if(verdict: Publishable, reason: str) -> Publishable:
    """产物那一侧的理由**盖过**图那一侧的结论。

    ⚠ 顺序不能反：字节取不回来时，图看上去仍然完全正常，`inspect_run` 会给出
    一个「可上线」——而那个版本上线后每一格都是空的。
    Args: verdict, reason。
    """
    if not reason:
        return verdict
    return Publishable(
        is_servable=False,
        reason=reason,
        serving={},
        feature_keys=(),
        target_key=verdict.target_key,
        algo=verdict.algo,
        task=verdict.task,
        channel=verdict.channel,
    )


@dataclass(frozen=True)
class _Binary:
    """通道 B 那一份：搬好的产物元信息，加上已经加载回来的模型本体。"""

    meta: dict[str, Any] = field(default_factory=dict[str, Any])
    estimator: object | None = None
    #: 取不回来时那句人话；取得回来是空串
    reason: str = ""


async def _binary_of(
    store: ObjectStore | None,
    graph: Any,
    records: dict[str, NodeRecord],
    version_id: uuid.UUID,
) -> _Binary:
    """通道 B 的发布前置：读回来验一遍，再搬到版本自己的键下。

    ⚠ 读回来这一趟不能省：光有一份产物元信息证明不了那些字节还在、还读得回来。
    读不回来就当不可服务发布出去，理由写在版本上——那比「上线后每一格都空着」
    强得多（D10）。
    Args: store, graph, records, version_id。
    """
    meta = model_artifact(graph, records)
    if not meta:
        return _Binary()
    if store is None:
        return _Binary(reason="本部署没有配对象存储，二进制模型上不了线")
    try:
        estimator = await artifact_io.fetch(store, meta)
        promoted = await artifact_io.promote(
            store, meta, artifact_store.model_key(str(version_id))
        )
    except ArtifactRejected as error:
        return _Binary(reason=str(error))
    return _Binary(meta=promoted, estimator=estimator)


def _artifact_row(
    version_id: uuid.UUID, meta: dict[str, Any]
) -> ModelingModelArtifact:
    return ModelingModelArtifact(
        model_version_id=version_id,
        object_key=as_text(meta.get("object_key")),
        digest=as_text(meta.get("digest")),
        size_bytes=int(meta.get("size_bytes") or 0),
        format_version=int(meta.get("format_version") or 0),
        runtime_json=as_dict(meta.get("runtime")),
    )


async def register_formula(
    session: AsyncSession, *, version_id: uuid.UUID, fx_code: str, actor: Actor
) -> ModelFormulaOut:
    """一键把一个版本注册成库公式并绑上。两件事在同一个事务里。

    Args: session, version_id, fx_code, actor。
    """
    registered = await formula_registration.register_formula(
        session, version_id=version_id, fx_code=fx_code, actor=actor
    )
    return ModelFormulaOut(
        formula=registered.formula,
        binding=_to_binding_out(registered.binding, is_orphaned=False),
    )


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
    payload: ModelBindingUpdateIn,
) -> ModelBindingImpactOut:
    """换版本 / 启停，回执带影响面。

    Args: session, binding_id, payload。
    """
    version_id = payload.model_version_id
    is_enabled = payload.is_enabled
    is_remap_confirmed = payload.is_remap_confirmed
    row = await binding_service.require_binding(session, binding_id)
    if version_id is not None:
        row = await binding_service.rebind(
            session,
            binding_id=binding_id,
            version_id=version_id,
            is_remap_confirmed=is_remap_confirmed,
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


async def _records_of(
    session: AsyncSession, run_id: uuid.UUID
) -> dict[str, NodeRecord]:
    """逐节点取回发布要用的三样东西。

    Args: session, run_id。
    """
    rows = await node_run_crud.list_by_run(session, run_id)
    return {
        row.node_id: NodeRecord(
            preview=as_dict(row.preview_json),
            fitted=row.fitted_json,
            io=as_dict(row.io_json),
        )
        for row in rows
    }


def _metrics_of(records: dict[str, NodeRecord]) -> dict[str, Any]:
    """发布时冻结的指标。找不到评估节点时给空字典，不编数。

    Args: records。
    """
    for record in records.values():
        metrics = as_dict(record.preview.get("metrics"))
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
        signature=as_dict(row.signature_json),
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
