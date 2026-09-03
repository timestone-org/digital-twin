"""结果摘要：把一个输出端口的负载折算成**有硬上限**的可视表示。

⚠ 上限不是优化是必须：参考实现把完整行矩阵写进一个累积的 JSON、且每跑完一个
节点重写一次整份文件，十万行八个节点就是几个 GB，详情接口再整包读进内存
（docs/MODELING_DESIGN.md D19）。
"""

import json
from typing import Any

from platform_server.apps.modeling.operators import (
    CellValue,
    Frame,
    MetricsPayload,
    ModelPayload,
)

# 摘要的硬上限。⚠ 常量集中在这一处，界面按 `*_truncated` 如实标注
PREVIEW_ROWS = 200
PREVIEW_COLS = 60
PREVIEW_MAX_BYTES = 256 * 1024
# 逐级降档的行数，最后一档只留形状与列统计
FALLBACK_ROWS = (50, 20, 0)
# 一次运行全部摘要合计的上限，超了之后的节点只留统计
RUN_PREVIEW_MAX_BYTES = 8 * 1024 * 1024

KIND_FRAME = "frame"
KIND_MODEL = "model"
KIND_METRICS = "metrics"


def summarize(payload: object) -> dict[str, Any]:
    """按负载的类型出一份摘要。认不出来的给一个明说认不出来的兜底。

    ⚠ 摘要里带 `kind`，前端按它**显式派发**视图。参考实现靠结构嗅探派发，
    后端改一个拼写就静默降级成 JSON 视图且没有任何告警（设计文档 D21）。
    Args: payload。
    """
    if isinstance(payload, Frame):
        return _frame_preview(payload, PREVIEW_ROWS)
    if isinstance(payload, ModelPayload):
        return _model_preview(payload)
    if isinstance(payload, MetricsPayload):
        return _metrics_preview(payload)
    return {"kind": "unknown", "note": "这一步的结果没有可展示的摘要"}


def fit_budget(preview: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """把一份摘要压进字节上限，回 `(摘要, 是否被截断)`。

    Args: preview。
    """
    if _size_of(preview) <= PREVIEW_MAX_BYTES:
        return preview, bool(preview.get("rows_truncated"))
    if preview.get("kind") != KIND_FRAME:
        return _stripped(preview), True
    for rows in FALLBACK_ROWS:
        trimmed = _trim_rows(preview, rows)
        if _size_of(trimmed) <= PREVIEW_MAX_BYTES:
            return trimmed, True
    return _stripped(preview), True


def _frame_preview(frame: Frame, rows: int) -> dict[str, Any]:
    """一份帧的摘要：形状 + 每列统计 + 前若干行。

    Args: frame, rows。
    """
    columns = frame.columns[:PREVIEW_COLS]
    head = [list(row[:PREVIEW_COLS]) for row in frame.rows[:rows]]
    index = None if frame.index is None else list(frame.index[:rows])
    return {
        "kind": KIND_FRAME,
        "shape": {"rows": frame.row_count, "cols": len(frame.columns)},
        "columns": [_column_stat(frame, column.key) for column in columns],
        "index_name": frame.index_name,
        "index_head": index,
        "head": head,
        "rows_truncated": frame.row_count > rows,
        "cols_truncated": len(frame.columns) > PREVIEW_COLS,
        "provenance": _provenance(frame),
    }


def _column_stat(frame: Frame, key: str) -> dict[str, Any]:
    """一列的统计。非数值列只给空值率与唯一值个数。

    Args: frame, key。
    """
    column = frame.column_of(key)
    values = frame.values_of(key)
    present = [value for value in values if value is not None]
    stat: dict[str, Any] = {
        "key": column.key,
        "name": column.name,
        "dtype": column.dtype,
        "role": column.role,
        "unit": column.unit,
        "null_ratio": _ratio(len(values) - len(present), len(values)),
        "n_unique": len({str(value) for value in present}),
    }
    numbers = [float(value) for value in present if _is_number(value)]
    stat.update(_number_stat(numbers))
    return stat


def _number_stat(numbers: list[float]) -> dict[str, float | None]:
    """数值列的四个数；一个数都没有时全给 None，不给 0。

    Args: numbers。
    """
    if not numbers:
        return {"min": None, "max": None, "mean": None, "p50": None}
    ordered = sorted(numbers)
    return {
        "min": ordered[0],
        "max": ordered[-1],
        "mean": sum(ordered) / len(ordered),
        "p50": ordered[len(ordered) // 2],
    }


def _model_preview(payload: ModelPayload) -> dict[str, Any]:
    """一个模型的摘要。

    Args: payload。
    """
    return {
        "kind": KIND_MODEL,
        "algo": payload.algo,
        "task": payload.task,
        "hyper_params": dict(payload.hyper_params),
        "feature_keys": list(payload.feature_keys),
        "target_key": payload.target_key,
        "serving_channel": payload.serving_channel,
        "fitted": payload.fitted,
    }


def _metrics_preview(payload: MetricsPayload) -> dict[str, Any]:
    """一次评估的摘要，含供画图的两组数。

    Args: payload。
    """
    return {
        "kind": KIND_METRICS,
        "task": payload.task,
        "metrics": dict(payload.metrics),
        "pairs": [list(pair) for pair in payload.pairs],
        "pairs_truncated": payload.is_truncated,
        "residual_bins": [list(item) for item in payload.residual_bins],
        "labels": list(payload.labels),
        "matrix": [list(row) for row in payload.matrix],
    }


def _provenance(frame: Frame) -> dict[str, Any]:
    source = frame.provenance
    return {
        "table_codes": list(source.table_codes),
        "since": None if source.since is None else source.since.isoformat(),
        "until": None if source.until is None else source.until.isoformat(),
        "is_truncated": source.is_truncated,
    }


def _trim_rows(preview: dict[str, Any], rows: int) -> dict[str, Any]:
    trimmed = dict(preview)
    trimmed["head"] = preview["head"][:rows]
    index = preview.get("index_head")
    trimmed["index_head"] = None if index is None else index[:rows]
    trimmed["rows_truncated"] = True
    return trimmed


def _stripped(preview: dict[str, Any]) -> dict[str, Any]:
    """只留下形状与统计的最后一档。

    Args: preview。
    """
    kept = {
        key: value
        for key, value in preview.items()
        if key not in {"head", "index_head", "pairs", "fitted"}
    }
    kept["rows_truncated"] = True
    return kept


def _size_of(preview: dict[str, Any]) -> int:
    return len(json.dumps(preview, ensure_ascii=False).encode())


def _ratio(part: int, whole: int) -> float:
    return 0.0 if whole == 0 else part / whole


def _is_number(value: CellValue) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)
