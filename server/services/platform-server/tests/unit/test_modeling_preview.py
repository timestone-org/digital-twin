"""结果摘要的用例：上限、降档、两个截断标志各自为真。"""

import json
from typing import Any

from platform_server.apps.modeling.operators import (
    CellValue,
    Frame,
    FrameColumn,
    MetricsPayload,
    ModelPayload,
)
from platform_server.apps.modeling.services import preview


def big_frame(rows: int, cols: int) -> Frame:
    """造一个大帧。

    Args: rows, cols。
    """
    columns = tuple(
        FrameColumn(key=f"c{index}", name=f"列{index}", dtype="number")
        for index in range(cols)
    )
    matrix: list[tuple[CellValue, ...]] = [
        tuple(float(row * index % 97) for index in range(cols))
        for row in range(rows)
    ]
    return Frame(columns=columns, rows=tuple(matrix))


def byte_size(summary: dict[str, Any]) -> int:
    """一份摘要序列化之后占多少字节。

    Args: summary。
    """
    return len(json.dumps(summary, ensure_ascii=False).encode())


def metrics_with_big_matrix(labels: int) -> MetricsPayload:
    """混淆矩阵撑爆上限的评估结果。高基数分类真会这样。

    Args: labels。
    """
    return MetricsPayload(
        task="classification",
        metrics={"accuracy": 0.9},
        labels=tuple(f"类目{index}" for index in range(labels)),
        matrix=tuple(
            tuple(index * 100_000 + column for column in range(labels))
            for index in range(labels)
        ),
    )


def metrics_with_big_pairs(count: int) -> MetricsPayload:
    """散点对撑爆上限的评估结果。

    Args: count。
    """
    return MetricsPayload(
        task="regression",
        metrics={"r2": 0.98},
        pairs=tuple(
            (float(index), float(index) + 0.5) for index in range(count)
        ),
        is_truncated=True,
    )


def model_with_many_features(count: int) -> ModelPayload:
    """特征名多到撑爆上限的模型。独热展开高基数列真会这样。

    Args: count。
    """
    keys = tuple(f"设备{index}_状态_独热" for index in range(count))
    return ModelPayload(
        algo="linear_regression",
        task="regression",
        feature_keys=keys,
        target_key="能耗",
        fitted={"coef": dict.fromkeys(keys, 0.5), "intercept": 1.0},
    )


def test_a_huge_frame_is_capped_by_rows_and_columns() -> None:
    """十万行两百列进来，出去的摘要只有上限那么多行与列。"""
    summary = preview.summarize(big_frame(100_000, 200))
    assert len(summary["head"]) == preview.PREVIEW_ROWS
    assert len(summary["columns"]) == preview.PREVIEW_COLS


def test_row_and_column_truncation_are_flagged_separately() -> None:
    """行截断与列截断**各有各的标志位**：只置一个，界面就分不清被切了什么。"""
    summary = preview.summarize(big_frame(100_000, 200))
    assert summary["rows_truncated"] is True
    assert summary["cols_truncated"] is True


def test_a_small_frame_is_not_flagged_as_truncated() -> None:
    """本来就这么少的帧不许被标成截断——那会劝用户去缩一个不需要缩的范围。"""
    summary = preview.summarize(big_frame(5, 3))
    assert summary["rows_truncated"] is False
    assert summary["cols_truncated"] is False


def test_the_byte_budget_is_enforced() -> None:
    """序列化之后必须压进字节上限。"""
    fitted, _ = preview.fit_budget(preview.summarize(big_frame(100_000, 200)))
    size = len(json.dumps(fitted, ensure_ascii=False).encode())
    assert size <= preview.PREVIEW_MAX_BYTES


def test_an_oversized_preview_downgrades_step_by_step() -> None:
    """超上限时逐级降到更少的行，而不是一刀切成空。"""
    wide = big_frame(preview.PREVIEW_ROWS, 60)
    fitted, truncated = preview.fit_budget(preview.summarize(wide))
    assert truncated is False
    assert len(fitted["head"]) == preview.PREVIEW_ROWS


def test_an_unknown_payload_gets_an_honest_placeholder() -> None:
    """认不出来的负载给一句明说认不出来的兜底，不静默给空。"""
    assert preview.summarize(object())["kind"] == "unknown"


def test_a_metrics_summary_is_capped_by_bytes_too() -> None:
    """非帧摘要走的是另一条分支，同样必须压进字节上限。

    ⚠ 大键黑名单摘不动的东西（这里是混淆矩阵）不会让它自己变小。
    """
    summary = preview.summarize(metrics_with_big_matrix(260))
    assert byte_size(summary) > preview.PREVIEW_MAX_BYTES
    fitted, truncated = preview.fit_budget(summary)
    assert truncated is True
    assert byte_size(fitted) <= preview.PREVIEW_MAX_BYTES


def test_a_model_summary_is_capped_by_bytes_too() -> None:
    """模型摘要同理：摘掉 `fitted` 之后剩下的特征名清单仍可能超上限。"""
    summary = preview.summarize(model_with_many_features(12_000))
    assert byte_size(summary) > preview.PREVIEW_MAX_BYTES
    fitted, truncated = preview.fit_budget(summary)
    assert truncated is True
    assert byte_size(fitted) <= preview.PREVIEW_MAX_BYTES


def test_stripping_that_is_not_enough_falls_to_the_last_tier() -> None:
    """摘完大键还超上限时再降一档，只留下类型与一句说明。"""
    fitted, _ = preview.fit_budget(
        preview.summarize(model_with_many_features(12_000))
    )
    assert set(fitted) == {"kind", "note"}
    assert fitted["kind"] == preview.KIND_MODEL
    assert fitted["note"]


def test_stripping_keeps_the_keys_the_publish_path_reads() -> None:
    """降档摘的是画图用的大键，`kind`/`task`/`metrics` 必须原样留下。

    ⚠ 这三个键是黑名单守着的：改成白名单的话，`model_service._metrics_of` 读
    `preview["metrics"]["metrics"]` 会取到空字典，发布出去的模型版本指标全空、
    后端不报错、界面只是一片空白。
    """
    summary = preview.summarize(metrics_with_big_pairs(30_000))
    assert byte_size(summary) > preview.PREVIEW_MAX_BYTES
    fitted, truncated = preview.fit_budget(summary)
    assert truncated is True
    assert fitted["kind"] == preview.KIND_METRICS
    assert fitted["task"] == "regression"
    assert fitted["metrics"] == {"r2": 0.98}
