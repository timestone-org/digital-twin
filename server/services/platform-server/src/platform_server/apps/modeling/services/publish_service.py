"""把一次成功运行发布成一个不可变的模型版本。

⚠ 可服务性必须**显式、可测、界面可见**：参考实现的同类问题表现为推理时
warning 一句就跳过，用户完全不知道自己上线了一个永远返回空的模型
（docs/MODELING_DESIGN.md D9）。
"""

import sys
import uuid
from dataclasses import dataclass
from typing import Any, cast

import numpy
import sklearn
from pydantic import ValidationError
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
    ColumnKeys,
    OperatorBase,
    OperatorError,
    registry,
)
from platform_server.apps.modeling.schemas.graph import PipelineGraph
from platform_server.apps.modeling.services import presenters
from platform_server.apps.modeling.services.graph_walk import topological_order
from platform_server.apps.modeling.services.jsonshape import (
    as_dict,
    as_list,
    as_text,
    as_texts,
)
from platform_server.apps.modeling.services.serving import (
    SERVING_FORMAT_VERSION,
    compile_model,
)

# 指纹的线形版本。⚠ 与可服务表示那个版本号**各走各的**：两者形状变化的时机
# 无关，共用一个的话，升可服务表示会让所有历史指纹看起来也换了口径
FINGERPRINT_FORMAT_VERSION = "1.0"


@dataclass(frozen=True)
class NodeRecord:
    """发布时要读的一个节点的三样东西。

    ⚠ `fitted` 与 `io` **不在** `preview` 里：摘要有字节预算、超了会被静默削掉，
    而这两样是发布件的原料（docs/MODELING_PLATFORM_DESIGN.md D1 / D3）。
    """

    #: 按输出端口建键的结果摘要
    preview: dict[str, Any]
    #: 这一步学到的参数；`None` 表示这一步没有拟合语义，**或者**这次运行早于
    #: 那两列存在（历史运行），两者由算子的 `REQUIRES_FIT` 区分
    fitted: dict[str, Any] | None
    #: `{"inputs": {端口: [列 key…]}, "outputs": {端口: [列 key…]}}`
    io: dict[str, Any]


@dataclass(frozen=True)
class EntryColumn:
    """推理入口契约上的一列：调用方要提供的东西，**在特征工程之前**。

    ⚠ 与 `feature_keys` 分开：后者是**建模那一步**看到的列，在特征工程之后。
    两者只在「没有任何算子增删列」时才相等
    （docs/MODELING_PLATFORM_DESIGN.md D4）。
    """

    key: str
    dtype: str
    #: 台账列的显示名与单位，只给人看
    label: str
    unit: str
    #: 训练期均值。发布时拿它拼一行实跑——必然落在训练区间内
    mean: float
    #: `{min, max, p50, null_ratio}`，供模型 schema 用
    stats: dict[str, float]


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
    payload = as_dict(_record(records, model_id).preview.get("model"))
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


def _servable(ctx: _Publishing) -> Publishable:
    """拼出可服务表示，并当场**实跑一行**验证它真的算得出来。

    ⚠ 发布时就跑：常量列、缺参数这类问题若留到推理期才炸，就成了「模型训出来
    了、上线才发现用不了」（§7.3）。⚠ 只编译不够——编译只看形状，缺参数的那一步
    编译得过、跑起来才抛。
    Args: ctx。
    """
    features = as_texts(ctx.payload.get("feature_keys"))
    target_key = as_text(ctx.payload.get("target_key"))
    entry = _entry_of(ctx, target_key)
    if entry is None:
        return _unservable(
            "这次运行没有留下逐步的列记录，早于本次升级——"
            "请重跑一遍这条流水线再发布"
        )
    steps = _steps_of(ctx, entry)
    starved = _starved_step(ctx.graph, steps)
    if starved:
        return _unservable(starved)
    missing = sorted(set(features) - set(_last_expected(steps, entry)))
    if missing:
        return _unservable(
            f"推理链算不出模型要的这几列：{'、'.join(missing)}。"
            "请检查特征工程那几步的配置"
        )
    serving = {
        "format_version": SERVING_FORMAT_VERSION,
        "task": as_text(ctx.payload.get("task")),
        "entry_columns": [
            {"key": item.key, "dtype": item.dtype} for item in entry
        ],
        "steps": steps,
    }
    try:
        compiled = compile_model(serving)
        compiled.predict([item.mean for item in entry])
    except OperatorError as error:
        return _unservable(f"可服务表示校验没通过：{error}")
    return Publishable(
        is_servable=True,
        reason="",
        serving=serving,
        feature_keys=tuple(features),
        entry_columns=entry,
        target_key=target_key,
        algo=as_text(ctx.payload.get("algo")),
        task=as_text(ctx.payload.get("task")),
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
    ctx: _Publishing, entry: tuple[EntryColumn, ...]
) -> list[dict[str, Any]]:
    """推理链上的每一步：参数、拟合值，以及它**真正**会看到什么列。

    ⚠ `fitted` 与用户配置 `config` **并列**而不是混在一起：混在一起之后，
    推理时要先把私有键剔出去才构造得出配置。
    ⚠ 期望列是从入口**正推**出来的，不再是「所有步骤都写同一份特征列」：那份
    只在「没有任何算子增删列」时才碰巧对，而那正是 D2 要拆掉的假设。
    Args: ctx, entry。
    """
    nodes = ctx.graph.node_by_id()
    steps: list[dict[str, Any]] = []
    current: ColumnKeys = tuple(item.key for item in entry)
    for node_id in ctx.served:
        operator = registry.get(nodes[node_id].operator)
        produced = _produced_by(operator, nodes[node_id].config, current)
        steps.append(
            {
                "node_id": node_id,
                "operator": nodes[node_id].operator,
                "config": dict(nodes[node_id].config),
                "fitted": _fitted_of(
                    ctx.records,
                    node_id,
                    node_id == ctx.model_id,
                    ctx.payload,
                ),
                "expected_input_columns": list(current or ()),
                "produced_columns": list(produced or ()),
            }
        )
        if node_id != ctx.model_id:
            current = produced
    return steps


def _produced_by(
    operator: type[OperatorBase], raw: dict[str, Any], current: ColumnKeys
) -> ColumnKeys:
    """这一步吃 `current` 会吐出哪些列。参数不合法时当成推不出来。

    Args: operator, raw, current。
    """
    try:
        config = operator.CONFIG_MODEL.model_validate(raw)
    except ValidationError:
        return None
    return operator.describe_columns(config, {"frame": current}).get("frame")


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
    return as_dict(_record(records, node_id).fitted)


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


def _entry_of(
    ctx: _Publishing, target_key: str
) -> tuple[EntryColumn, ...] | None:
    """推理入口契约：调用方必须提供的那几列，**在特征工程之前**。

    取推理链第一步训练时**真正**看到的那些列，去掉目标列。派生列不在其中——
    它们由管线自己造（docs/MODELING_PLATFORM_DESIGN.md D4）。
    ⚠ 顺序照训练时那份，不排序：绑定按位置映射，重排会让存量绑定静默错位。
    读不到逐步列记录时给 `None`，由调用方判成「这次运行早于本次升级」。
    Args: ctx, target_key。
    """
    if not ctx.served:
        return ()
    first = ctx.served[0]
    seen = as_dict(_record(ctx.records, first).io.get("inputs")).get("frame")
    if not isinstance(seen, list):
        return None
    meta = _entry_meta(ctx, first)
    return tuple(
        _entry_column(as_text(key), meta)
        for key in cast("list[object]", seen)
        if as_text(key) != target_key
    )


def _entry_column(key: str, meta: dict[str, dict[str, Any]]) -> EntryColumn:
    """一个入口列的类型、标签、单位与训练期统计。

    Args: key, meta。
    """
    stat = meta.get(key, {})
    return EntryColumn(
        key=key,
        dtype=as_text(stat.get("dtype")) or DTYPE_NUMBER,
        label=as_text(stat.get("name")) or key,
        unit=as_text(stat.get("unit")),
        mean=_number(stat.get("mean")),
        stats={
            name: _number(stat.get(name))
            for name in ("min", "max", "p50", "null_ratio")
        },
    )


def _entry_meta(ctx: _Publishing, first: str) -> dict[str, dict[str, Any]]:
    """入口那些列的元信息，取自上游那一步的结果摘要里的列统计。

    ⚠ 用列统计而不是摘要里的前几行：`head` 会被字节预算削掉，而统计不会。
    均值还必然落在训练区间内，拿它做发布期那一次实跑不会触发外推告警。
    Args: ctx, first。
    """
    upstream = _upstream_of(ctx.graph, first, "frame")
    if upstream is None:
        return {}
    node_id, port = upstream
    stats = as_list(
        as_dict(_record(ctx.records, node_id).preview.get(port)).get("columns")
    )
    return {as_text(as_dict(item).get("key")): as_dict(item) for item in stats}


def _number(value: object) -> float:
    return float(value) if isinstance(value, (int | float)) else 0.0


def _upstream_of(
    graph: PipelineGraph, node_id: str, port: str
) -> tuple[str, str] | None:
    """某个节点某个输入端口接的是谁的哪个输出端口。

    Args: graph, node_id, port。
    """
    for edge in graph.edges:
        if edge.to_node == node_id and edge.to_port == port:
            return edge.from_node, edge.from_port
    return None


def _record(records: dict[str, NodeRecord], node_id: str) -> NodeRecord:
    """某个节点的记录；没有记录时给一份空的，不抛。

    Args: records, node_id。
    """
    return records.get(node_id) or NodeRecord(preview={}, fitted=None, io={})


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
