"""交互式校验里的环检测：不重解析别的列，直接读它们落库的依赖。

⚠ 连边规则必须与保存时的整表试编译（`formula.deps._edges_of`）**同一套**：
同行引用 ∪ 指向其它公式列的本表窗口引用。只按同行引用连边的话，
`X = SUM_OVER({Y},'1h')` 与 `Y = SUM_OVER({X},'1h')` 这种环会在编辑器里显示
「公式没问题」，一点保存却报错——两个回答互相矛盾，而用户没法判断信哪个。
"""

from collections.abc import Sequence
from typing import Any, cast

from platform_server.apps.dataset.formula import FormulaDeps, topo_order
from platform_server.apps.dataset.models import DatasetColumn


def check_no_cycle(
    columns: Sequence[DatasetColumn],
    *,
    key: str | None,
    deps: FormulaDeps,
) -> None:
    """把候选公式插进这张表的依赖图，成环即抛 `FormulaError`。

    `key` 为 None 时不查环：不知道这条公式将来落在哪一列，就无从判断成不成环
    ——编辑器在用户还没选定列时就是这个状态。
    Args: columns, key, deps。
    """
    if key is None:
        return
    formula_keys = {
        column.key for column in columns if column.source == "formula"
    }
    formula_keys.add(key)
    edges = {
        column.key: _stored_edges(column, formula_keys)
        for column in columns
        if column.source == "formula" and column.key != key
    }
    edges[key] = _candidate_edges(deps, key, formula_keys)
    topo_order(edges, set(edges))


def _candidate_edges(
    deps: FormulaDeps, key: str, formula_keys: set[str]
) -> set[str]:
    """候选公式连出去的边。

    Args: deps, key, formula_keys。
    """
    return set(deps.same_row) | {
        ref.key
        for ref in deps.window
        if ref.table_code is None and ref.key in formula_keys and ref.key != key
    }


def _stored_edges(column: DatasetColumn, formula_keys: set[str]) -> set[str]:
    """一列落库的依赖里连出去的边。

    ⚠ 跨表的窗口引用天然落不进 `formula_keys`（它的 key 带表前缀且含点号，
    而列 key 禁点号），故不必另写一条过滤。
    ⚠ 依赖没落过库（`formula_deps` 是 null）的列只是**不连边**，不报错：
    保存时的整表试编译会重新解析每一列，环在那里照样拦得住。这条交互式校验
    宁可漏报也不能因为一行旧数据就把整个编辑器判成故障。
    Args: column, formula_keys。
    """
    blob = column.formula_deps or {}
    edges = set(_strings(blob.get("same_row")))
    for entry in _entries(blob.get("window")):
        target = entry.get("key")
        if (
            isinstance(target, str)
            and target in formula_keys
            and target != column.key
        ):
            edges.add(target)
    return edges


def _strings(value: Any) -> list[str]:
    """blob 里的一串字符串；形状不对就当空。

    Args: value。
    """
    if not isinstance(value, list):
        return []
    return [
        item for item in cast("list[object]", value) if isinstance(item, str)
    ]


def _entries(value: Any) -> list[dict[str, Any]]:
    """blob 里的一串对象；形状不对就当空。

    Args: value。
    """
    if not isinstance(value, list):
        return []
    return [
        cast("dict[str, Any]", item)
        for item in cast("list[object]", value)
        if isinstance(item, dict)
    ]
