"""把一次成功运行发布成一个不可变的模型版本。

⚠ 可服务性必须**显式、可测、界面可见**：参考实现的同类问题表现为推理时
warning 一句就跳过，用户完全不知道自己上线了一个永远返回空的模型
（docs/MODELING_DESIGN.md D9）。
"""

import sys
import uuid
from dataclasses import dataclass
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
    OperatorError,
    registry,
)
from platform_server.apps.modeling.schemas.graph import PipelineGraph
from platform_server.apps.modeling.services import presenters
from platform_server.apps.modeling.services.graph_walk import topological_order
from platform_server.apps.modeling.services.jsonshape import (
    as_dict,
    as_text,
    as_texts,
)
from platform_server.apps.modeling.services.serving import (
    SERVING_FORMAT_VERSION,
    compile_model,
)

# 可服务表示里一步的键，与 `serving.py` 那份同源


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


def inspect_run(graph: PipelineGraph, previews: dict[str, Any]) -> Publishable:
    """扫一遍图与结果，判这次运行能不能发布。

    ⚠ 判据是**流水线的形状**加**算子的声明**，不是「跑通了没有」：跑通只说明
    训练没报错，与「这套东西在单行上算不算得出来」是两回事（§7.6）。
    Args: graph, previews。
    """
    nodes = graph.node_by_id()
    model_id = _model_node_of(graph)
    if model_id is None:
        return _unservable("这条流水线里没有建模算子，没有可发布的模型")
    payload = as_dict(as_dict(previews.get(model_id)).get("model"))
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
    return _servable(graph, previews, model_id, payload)


def _model_node_of(graph: PipelineGraph) -> str | None:
    for node in graph.nodes:
        if any(
            port.contract == CONTRACT_MODEL
            for port in registry.get(node.operator).OUTPUTS
        ):
            return node.id
    return None


def _servable(
    graph: PipelineGraph,
    previews: dict[str, Any],
    model_id: str,
    payload: dict[str, Any],
) -> Publishable:
    """拼出可服务表示，并当场编译一遍验证它真的算得出来。

    ⚠ 发布时就编译：常量列这类问题若留到推理期才炸，就成了「模型训出来了、
    上线才发现用不了」（§7.3）。
    """
    serving = {
        "format_version": SERVING_FORMAT_VERSION,
        "task": as_text(payload.get("task")),
        "input_columns": as_texts(payload.get("feature_keys")),
        "steps": _steps_of(graph, previews, model_id, payload),
    }
    try:
        compile_model(serving)
    except OperatorError as error:
        return _unservable(f"可服务表示校验没通过：{error}")
    return Publishable(
        is_servable=True,
        reason="",
        serving=serving,
        feature_keys=tuple(as_texts(serving["input_columns"])),
        target_key=as_text(payload.get("target_key")),
        algo=as_text(payload.get("algo")),
        task=as_text(payload.get("task")),
        channel="json",
    )


def _steps_of(
    graph: PipelineGraph,
    previews: dict[str, Any],
    model_id: str,
    payload: dict[str, Any],
) -> list[dict[str, Any]]:
    """训练拓扑序里推理时还要跑的那些步骤。

    ⚠ `fitted` 与用户配置 `config` **并列**而不是混在一起：混在一起之后，
    推理时要先把私有键剔出去才构造得出配置。
    """
    nodes = graph.node_by_id()
    steps: list[dict[str, Any]] = []
    for node_id in topological_order(graph):
        operator = registry.get(nodes[node_id].operator)
        if not operator.ENABLED_IN_SERVING:
            continue
        fitted = _fitted_of(previews, node_id, node_id == model_id, payload)
        steps.append(
            {
                "node_id": node_id,
                "operator": nodes[node_id].operator,
                "config": dict(nodes[node_id].config),
                "fitted": fitted,
                "expected_input_columns": as_texts(payload.get("feature_keys")),
            }
        )
    return steps


def _fitted_of(
    previews: dict[str, Any],
    node_id: str,
    is_model: bool,
    payload: dict[str, Any],
) -> dict[str, Any]:
    if is_model:
        return as_dict(payload.get("fitted"))
    return as_dict(as_dict(previews.get(node_id)).get("fitted"))


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
        "format_version": SERVING_FORMAT_VERSION,
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
