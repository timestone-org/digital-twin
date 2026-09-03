"""把一次成功运行发布成一个不可变的模型版本。

⚠ 可服务性必须**显式、可测、界面可见**：参考实现的同类问题表现为推理时
warning 一句就跳过，用户完全不知道自己上线了一个永远返回空的模型
（docs/MODELING_DESIGN.md D9）。
"""

import sys
import uuid
from dataclasses import dataclass, field
from typing import Any

import numpy
import sklearn
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.modeling.crud import model_version_crud, run_crud
from platform_server.apps.modeling.errors import (
    ModelVersionNotFound,
    RunAlreadyPublished,
    RunNotPublishable,
)
from platform_server.apps.modeling.models import ModelingModelVersion
from platform_server.apps.modeling.operators import (
    CONTRACT_MODEL,
    DTYPE_NUMBER,
    OperatorError,
    registry,
)
from platform_server.apps.modeling.schemas.graph import PipelineGraph
from platform_server.apps.modeling.services import presenters
from platform_server.apps.modeling.services.entry_contract import (
    EntryColumn,
    NodeRecord,
    entry_meta,
    entry_of,
    frame_columns_of,
    record_of,
    smoke_moment,
    without_target,
)
from platform_server.apps.modeling.services.graph_walk import topological_order
from platform_server.apps.modeling.services.jsonshape import (
    as_dict,
    as_text,
    as_texts,
)
from platform_server.apps.modeling.services.model_schema import build_schema
from platform_server.apps.modeling.services.serving import (
    SERVING_FORMAT_VERSION,
    compile_model,
)

# 指纹的线形版本。⚠ 与可服务表示那个版本号**各走各的**：两者形状变化的时机
# 无关，共用一个的话，升可服务表示会让所有历史指纹看起来也换了口径
FINGERPRINT_FORMAT_VERSION = "1.0"


@dataclass(frozen=True)
class _Publishing:
    """发布一次运行要的一整包。打成一包是因为形参上限是 5。"""

    graph: PipelineGraph
    records: dict[str, NodeRecord]
    #: 推理时还要跑的那些节点，按训练时的拓扑序
    served: list[str]
    model_id: str
    #: 建模那一步的结果摘要
    payload: dict[str, Any]


@dataclass(frozen=True)
class Publishable:
    """一次运行能不能发布，以及发布出来会是什么样。"""

    is_servable: bool
    reason: str
    serving: dict[str, Any]
    feature_keys: tuple[str, ...]
    target_key: str
    algo: str
    task: str
    channel: str
    entry_columns: tuple[EntryColumn, ...] = ()
    #: 模型签名（面向人与第三方的说明）。不可服务时是空字典
    signature: dict[str, Any] = field(default_factory=dict[str, Any])


def inspect_run(
    graph: PipelineGraph, records: dict[str, NodeRecord]
) -> Publishable:
    """扫一遍图与结果，判这次运行能不能发布。

    ⚠ 判据是**流水线的形状**加**算子的声明**，不是「跑通了没有」：跑通只说明
    训练没报错，与「这套东西在单行上算不算得出来」是两回事（§7.6）。
    Args: graph, records。
    """
    nodes = graph.node_by_id()
    model_id = _model_node_of(graph)
    if model_id is None:
        return _unservable("这条流水线里没有建模算子，没有可发布的模型")
    payload = as_dict(record_of(records, model_id).preview.get("model"))
    if not payload:
        return _unservable("这次运行没有产出模型")
    windowed = [
        node_id
        for node_id in nodes
        if registry.get(nodes[node_id].operator).SERVING_NEEDS_WINDOW
    ]
    if windowed:
        return _unservable(
            "滞后 / 滚动特征在单行预测时拿不到历史窗口，本流水线暂不可上线"
        )
    channel = as_text(payload.get("serving_channel"))
    if channel != "json":
        return _unservable("这个算法的拟合参数没法用纯数据表达，暂不可上线")
    return _servable(
        _Publishing(
            graph=graph,
            records=records,
            served=_served_nodes(graph),
            model_id=model_id,
            payload=payload,
        )
    )


def _model_node_of(graph: PipelineGraph) -> str | None:
    for node in graph.nodes:
        if any(
            port.contract == CONTRACT_MODEL
            for port in registry.get(node.operator).OUTPUTS
        ):
            return node.id
    return None


def _servable(publishing: _Publishing) -> Publishable:
    """拼出可服务表示，并当场**实跑一行**验证它真的算得出来。

    ⚠ 发布时就跑：常量列、缺参数这类问题若留到推理期才炸，就成了「模型训出来
    了、上线才发现用不了」（§7.3）。⚠ 只编译不够——编译只看形状，缺参数的那一步
    编译得过、跑起来才抛。
    Args: publishing。
    """
    target_key = as_text(publishing.payload.get("target_key"))
    entry = entry_of(
        publishing.graph,
        publishing.records,
        publishing.served,
        target_key,
    )
    if entry is None:
        return _unservable(
            "这次运行没有留下逐步的列记录，早于本次升级——"
            "请重跑一遍这条流水线再发布"
        )
    steps = _steps_of(publishing, entry)
    refused = _refusal(publishing, steps, entry)
    if refused:
        return _unservable(refused)
    serving = _serving_of(publishing, steps, entry)
    compiled = compile_model(serving)
    moment = (
        smoke_moment(publishing.graph, publishing.records, publishing.served)
        if compiled.requires_timestamp
        else None
    )
    if compiled.requires_timestamp and moment is None:
        return _unservable(
            "这条链带时间特征，而这次运行的摘要里没有留下任何时刻，"
            "发布前那一次实跑做不了——请重跑一遍这条流水线再发布"
        )
    try:
        compiled.predict([item.mean for item in entry], moment)
    except OperatorError as error:
        return _unservable(f"可服务表示校验没通过：{error}")
    return _published(publishing, serving, steps, entry)


def _refusal(
    publishing: _Publishing,
    steps: list[dict[str, Any]],
    entry: tuple[EntryColumn, ...],
) -> str:
    """不该上线的两条硬理由；都过得去就给空串。

    Args: publishing, steps, entry。
    """
    starved = _starved_step(publishing.graph, steps)
    if starved:
        return starved
    features = as_texts(publishing.payload.get("feature_keys"))
    missing = sorted(set(features) - set(_last_expected(steps, entry)))
    if missing:
        return (
            f"推理链算不出模型要的这几列：{'、'.join(missing)}。"
            "请检查特征工程那几步的配置"
        )
    return ""


def _serving_of(
    publishing: _Publishing,
    steps: list[dict[str, Any]],
    entry: tuple[EntryColumn, ...],
) -> dict[str, Any]:
    """可服务表示。推理时读的就是它，别的都不读。

    Args: publishing, steps, entry。
    """
    return {
        "format_version": SERVING_FORMAT_VERSION,
        "task": as_text(publishing.payload.get("task")),
        "entry_columns": [
            {"key": item.key, "dtype": item.dtype} for item in entry
        ],
        "steps": steps,
    }


def _published(
    publishing: _Publishing,
    serving: dict[str, Any],
    steps: list[dict[str, Any]],
    entry: tuple[EntryColumn, ...],
) -> Publishable:
    """一条可上线的结论。

    Args: publishing, serving, steps, entry。
    """
    target_key = as_text(publishing.payload.get("target_key"))
    task = as_text(publishing.payload.get("task"))
    return Publishable(
        is_servable=True,
        reason="",
        serving=serving,
        signature=build_schema(
            entry=[_as_meta(item) for item in entry],
            steps=steps,
            target=_target_meta(publishing, target_key),
            task=task,
        ),
        feature_keys=tuple(as_texts(publishing.payload.get("feature_keys"))),
        entry_columns=entry,
        target_key=target_key,
        algo=as_text(publishing.payload.get("algo")),
        task=task,
        channel="json",
    )


def _served_nodes(graph: PipelineGraph) -> list[str]:
    """推理时还要跑的那些节点，按训练时的拓扑序。

    Args: graph。
    """
    nodes = graph.node_by_id()
    return [
        node_id
        for node_id in topological_order(graph)
        if registry.get(nodes[node_id].operator).ENABLED_IN_SERVING
    ]


def _steps_of(
    publishing: _Publishing, entry: tuple[EntryColumn, ...]
) -> list[dict[str, Any]]:
    """推理链上的每一步：参数、拟合值，以及它**真正**会看到什么列。

    ⚠ `fitted` 与用户配置 `config` **并列**而不是混在一起：混在一起之后，
    推理时要先把私有键剔出去才构造得出配置。
    ⚠ 期望列取自**训练时实际流过的列**去掉目标列，不按算子的静态声明推：
    独热这类算子产出哪几列取决于数据里有哪些类目，静态推不出来，而推不出来时
    退化成「不断言」正是这道闸存在的理由（D3）。
    Args: publishing, entry。
    """
    nodes = publishing.graph.node_by_id()
    target_key = as_text(publishing.payload.get("target_key"))
    steps: list[dict[str, Any]] = []
    flowed: list[str] | None = [item.key for item in entry]
    for node_id in publishing.served:
        record = record_of(publishing.records, node_id)
        expected = _seen_by(record, flowed, target_key)
        produced = without_target(
            frame_columns_of(record, "outputs", "frame"), target_key
        )
        steps.append(
            {
                "node_id": node_id,
                "operator": nodes[node_id].operator,
                "config": dict(nodes[node_id].config),
                "fitted": _fitted_of(
                    publishing.records,
                    node_id,
                    node_id == publishing.model_id,
                    publishing.payload,
                ),
                "expected_input_columns": expected or [],
                "produced_columns": produced or [],
            }
        )
        flowed = produced if produced is not None else flowed
    return steps


def _seen_by(
    record: NodeRecord, flowed: list[str] | None, target_key: str
) -> list[str] | None:
    """这一步在推理时会看到哪些列。

    ⚠ 建模那一步的输入端口叫 `train` / `test`，推理时却只有一份帧——那时候拿
    上一步流出来的列，而不是它训练时的两个入口。
    Args: record, flowed, target_key。
    """
    seen = without_target(
        frame_columns_of(record, "inputs", "frame"), target_key
    )
    if seen is not None:
        return seen
    if flowed is not None:
        return flowed
    return without_target(
        frame_columns_of(record, "inputs", "train"), target_key
    )


def _last_expected(
    steps: list[dict[str, Any]], entry: tuple[EntryColumn, ...]
) -> list[str]:
    """建模那一步会看到的列。

    Args: steps, entry。
    """
    if not steps:
        return [item.key for item in entry]
    return as_texts(steps[-1]["expected_input_columns"])


def _fitted_of(
    records: dict[str, NodeRecord],
    node_id: str,
    is_model: bool,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """这一步学到的参数。建模那一步在它自己的摘要里，其余在记录上。

    Args: records, node_id, is_model, payload。
    """
    if is_model:
        return as_dict(payload.get("fitted"))
    return as_dict(record_of(records, node_id).fitted)


def _starved_step(graph: PipelineGraph, steps: list[dict[str, Any]]) -> str:
    """有没有哪一步该带参数却是空的；有就给一句人话，没有就给空串。

    ⚠ 这是**必须拦下**的一条：空参数不会报错，它会让那一步在推理时拿请求里的
    单行重新拟合，算出一个与线上模型毫无关系的数（缺陷 A）。
    Args: graph, steps。
    """
    nodes = graph.node_by_id()
    for step in steps:
        operator = registry.get(nodes[as_text(step["node_id"])].operator)
        if operator.REQUIRES_FIT and not step["fitted"]:
            return (
                f"步骤「{operator.NAME}」没有可用的拟合参数。"
                "推理时它会拿单行重新拟合，算出来的数与训练结果无关，"
                "故不可上线——请重跑一遍这条流水线再发布"
            )
    return ""


def _as_meta(item: EntryColumn) -> dict[str, Any]:
    """入口列摊成模型签名生成器吃的形状。

    Args: item。
    """
    return {
        "key": item.key,
        "label": item.label,
        "unit": item.unit,
        "dtype": item.dtype,
        "stats": dict(item.stats),
    }


def _target_meta(publishing: _Publishing, target_key: str) -> dict[str, Any]:
    """目标列的类型、显示名与单位；取数摘要里没有就只留 key。

    Args: publishing, target_key。
    """
    if not publishing.served:
        return {"key": target_key}
    stat = entry_meta(
        publishing.graph, publishing.records, publishing.served[0]
    ).get(target_key, {})
    return {
        "key": target_key,
        "label": as_text(stat.get("name")) or target_key,
        "unit": as_text(stat.get("unit")),
        "dtype": as_text(stat.get("dtype")) or DTYPE_NUMBER,
    }


def _unservable(reason: str) -> Publishable:
    return Publishable(
        is_servable=False,
        reason=reason,
        serving={},
        feature_keys=(),
        target_key="",
        algo="",
        task="",
        channel="json",
    )


def fingerprint(
    row_count: int | None, table_codes: list[str]
) -> dict[str, Any]:
    """这个版本是拿什么训出来的、在什么环境里训的。

    ⚠ 记下依赖版本不是留档：跨版本反序列化与跨版本数值差异都会让「同一个模型」
    算出不同的数，而没有指纹的话没人查得出来。
    Args: row_count, table_codes。
    """
    return {
        "format_version": FINGERPRINT_FORMAT_VERSION,
        "python": sys.version.split()[0],
        "numpy": numpy.__version__,
        "sklearn": sklearn.__version__,
        "rows": row_count,
        "table_codes": sorted(table_codes),
    }


async def require_version(
    session: AsyncSession, version_id: uuid.UUID
) -> ModelingModelVersion:
    """取模型版本，取不到即 404。

    Args: session, version_id。
    """
    row = await model_version_crud.get(session, version_id)
    if row is None:
        raise ModelVersionNotFound("模型版本不存在")
    return row


async def require_publishable_run(
    session: AsyncSession, run_id: uuid.UUID
) -> Any:
    """取一次可发布的运行：必须成功、且还没发布过。

    Args: session, run_id。
    """
    run = await run_crud.get(session, run_id)
    if run is None or run.status != "succeeded":
        raise RunNotPublishable("只有成功跑完的运行才能发布成模型版本")
    if await model_version_crud.get_by_run(session, run.id) is not None:
        raise RunAlreadyPublished("这次运行已经发布过一个版本了")
    return run


def graph_of_run(run: Any) -> PipelineGraph:
    """一次运行当时那份图。

    Args: run。
    """
    return presenters.graph_of(run.graph_snapshot)
