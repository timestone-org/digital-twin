"""推理入口契约：调用方到底要提供哪几列，以及那几列长什么样。

拆成一个模块是因为它有自己的一套判据——「训练时那一步**真正**看到了什么」——
而发布那一侧只是它的消费者（docs/MODELING_PLATFORM_DESIGN.md D4）。
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, cast

from platform_server.apps.modeling.operators import DTYPE_NUMBER
from platform_server.apps.modeling.schemas.graph import PipelineGraph
from platform_server.apps.modeling.services.jsonshape import (
    as_dict,
    as_list,
    as_text,
)


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
    """入口契约上的一列：调用方要提供的东西，**在特征工程之前**。

    ⚠ 与 `feature_keys` 分开：后者是**建模那一步**看到的列，在特征工程之后。
    两者只在「没有任何算子增删列」时才相等。
    """

    key: str
    dtype: str
    #: 台账列的显示名与单位，只给人看
    label: str
    unit: str
    #: 训练期均值。发布时拿它拼一行实跑——必然落在训练区间内
    mean: float
    #: `{min, max, p50, null_ratio}`，供模型签名用
    stats: dict[str, float]


def record_of(records: dict[str, NodeRecord], node_id: str) -> NodeRecord:
    """某个节点的记录；没有记录时给一份空的，不抛。

    Args: records, node_id。
    """
    return records.get(node_id) or NodeRecord(preview={}, fitted=None, io={})


def entry_of(
    graph: PipelineGraph,
    records: dict[str, NodeRecord],
    served: list[str],
    target_key: str,
) -> tuple[EntryColumn, ...] | None:
    """调用方必须提供的那几列，**在特征工程之前**。

    取推理链第一步训练时**真正**看到的那些列，去掉目标列。派生列不在其中——
    它们由管线自己造。
    ⚠ 顺序照训练时那份，不排序：绑定按位置映射，重排会让存量绑定静默错位。
    读不到逐步列记录时给 `None`，由调用方判成「这次运行早于本次升级」。
    Args: graph, records, served, target_key。
    """
    if not served:
        return ()
    first = served[0]
    seen = as_dict(record_of(records, first).io.get("inputs")).get("frame")
    if not isinstance(seen, list):
        return None
    meta = entry_meta(graph, records, first)
    return tuple(
        _entry_column(as_text(key), meta)
        for key in cast("list[object]", seen)
        if as_text(key) != target_key
    )


def entry_meta(
    graph: PipelineGraph, records: dict[str, NodeRecord], first: str
) -> dict[str, dict[str, Any]]:
    """入口那些列的元信息，取自上游那一步的结果摘要里的列统计。

    ⚠ 用列统计而不是摘要里的前几行：`head` 会被字节预算削掉，而统计不会。
    均值还必然落在训练区间内，拿它做发布期那一次实跑不会触发外推告警。
    Args: graph, records, first。
    """
    upstream = upstream_of(graph, first, "frame")
    if upstream is None:
        return {}
    node_id, port = upstream
    stats = as_list(
        as_dict(record_of(records, node_id).preview.get(port)).get("columns")
    )
    return {as_text(as_dict(item).get("key")): as_dict(item) for item in stats}


def smoke_moment(
    graph: PipelineGraph, records: dict[str, NodeRecord], served: list[str]
) -> datetime | None:
    """发布时那一次实跑用哪个时刻。

    先取摘要里第一行的时刻，取不到再退回训练窗口的起点。
    ⚠ 不拿「现在」顶替：时间特征在训练窗口之外算出来的月份 / 星期与训练时见过的
    分布对不上，那一次实跑就验不到真正会发生的事。
    Args: graph, records, served。
    """
    if not served:
        return None
    upstream = upstream_of(graph, served[0], "frame")
    if upstream is None:
        return None
    node_id, port = upstream
    preview = as_dict(record_of(records, node_id).preview.get(port))
    head = as_list(preview.get("index_head"))
    if head and isinstance(head[0], (int | float)):
        return datetime.fromtimestamp(float(head[0]) / 1000, UTC)
    return _parsed_moment(
        as_text(as_dict(preview.get("provenance")).get("since"))
    )


def upstream_of(
    graph: PipelineGraph, node_id: str, port: str
) -> tuple[str, str] | None:
    """某个节点某个输入端口接的是谁的哪个输出端口。

    Args: graph, node_id, port。
    """
    for edge in graph.edges:
        if edge.to_node == node_id and edge.to_port == port:
            return edge.from_node, edge.from_port
    return None


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


def _parsed_moment(text: str) -> datetime | None:
    """摘要里那个 ISO 串。读不动就当没有。

    Args: text。
    """
    try:
        return datetime.fromisoformat(text) if text else None
    except ValueError:  # pragma: no cover —— 那一格是后端自己写的 ISO 串
        return None


def _number(value: object) -> float:
    return float(value) if isinstance(value, (int | float)) else 0.0
