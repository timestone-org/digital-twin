"""滞后与滚动的结果面：新增列、空出来的行、窗口示意，以及分母那条告警。

⚠ 这一份反复验的是**分母逐行不同**：窗口里的空值先被滤掉再折，「近三期均值」在
缺失多的段上可能只是一个点的值，而它与满窗口的均值在图上长得一模一样
（docs/MODELING_RESULT_VIEW_DESIGN.md §11 的 R-24）。
"""

from typing import Any

from platform_server.apps.modeling.operators import (
    CellValue,
    Frame,
    FrameColumn,
    registry,
)
from platform_server.apps.modeling.operators.reporting import ReportBlock
from platform_server.apps.modeling.operators.windowblocks import (
    ORDER_NOTE,
    SERVING_ALERT,
    ZERO_FILL_NOTE,
    valid_counts,
)
from platform_server.apps.modeling.services import report_budget
from platform_server.apps.modeling.services.preview import REPORT_MAX_BYTES

# 最坏负载：60 列宽帧 × 366 天
WIDE_COLUMNS = 60
YEAR_ROWS = 366
HOURLY_ROWS = 366 * 24
ALL_STATS = ["mean", "sum", "min", "max", "std"]


def frame_of(columns: dict[str, list[float | None]]) -> Frame:
    """按列造一份数值帧，列序即给定的顺序。

    Args: columns。
    """
    keys = list(columns)
    height = len(columns[keys[0]])
    rows: tuple[tuple[CellValue, ...], ...] = tuple(
        tuple(columns[key][index] for key in keys) for index in range(height)
    )
    return Frame(
        columns=tuple(
            FrameColumn(key=key, name=key, dtype="number") for key in keys
        ),
        rows=rows,
    )


def run_of(
    code: str, frame: Frame, **config: Any
) -> tuple[Frame, dict[str, ReportBlock]]:
    """跑一遍算子，回它的输出帧与按种类归好的讲解。

    Args: code, frame, config。
    """
    operator, _ = registry.build(code, config)
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    produced = operator.run({"frame": frame})["frame"]
    assert isinstance(produced, Frame)
    return produced, {block.kind: block for block in operator.report()}


def by_column(blocks: dict[str, ReportBlock]) -> list[dict[str, Any]]:
    """行数账里按列的那一栏。

    Args: blocks。
    """
    listed: list[dict[str, Any]] = blocks["rows"].payload["by_column"]
    return listed


def blank_count(frame: Frame, key: str) -> int:
    """输出帧上这一列真正有多少个空格。

    Args: frame, key。
    """
    return sum(1 for value in frame.values_of(key) if value is None)


def gappy() -> Frame:
    """一列带缺口的数：窗口 3 之下，有几行的分母不满。"""
    return frame_of({"甲": [1.0, None, 3.0, 4.0, None, None, 7.0, 8.0]})


def wide_numbers(rows: int) -> Frame:
    """最坏负载：60 列，逐列的空格分布各不相同。

    Args: rows。
    """
    return frame_of(
        {
            f"很长的列名字第{index}列": [
                None if (row + index) % 41 == 0 else float(row % 97)
                for row in range(rows)
            ]
            for index in range(WIDE_COLUMNS)
        }
    )


def test_a_window_operator_that_never_ran_says_nothing() -> None:
    """没跑过就一块都不讲。"""
    for code in ("lag_feature", "rolling_feature"):
        operator, _ = registry.build(code, {})
        assert operator.report() == ()


def test_the_lag_block_says_how_many_levels_survived_the_dedupe() -> None:
    """配了三个档位、去重排序之后只剩两个——造出来的列数照后者。"""
    _, blocks = run_of(
        "lag_feature",
        frame_of({"甲": [1.0, 2.0, 3.0, 4.0, 5.0]}),
        columns=["甲"],
        lags=[3, 1, 1],
    )
    payload = blocks["columns"].payload
    assert payload["added"] == ["甲@lag1", "甲@lag3"]
    assert payload["reason"] == (
        "1 列 × 2 个档位造出 2 列；参数里写了 3 个档位，去重排序之后是 1、3"
    )
    assert payload["alerts"] == [SERVING_ALERT]
    assert payload["notes"] == [ORDER_NOTE]


def test_the_head_of_every_lag_column_is_blank_and_counted() -> None:
    """@lag3 的前 3 行、@lag1 的前 1 行是空的，多的排前面。"""
    produced, blocks = run_of(
        "lag_feature",
        frame_of({"甲": [1.0, 2.0, 3.0, 4.0, 5.0]}),
        columns=["甲"],
        lags=[1, 3],
    )
    assert by_column(blocks) == [
        {"key": "甲@lag3", "count": 3, "ratio": 0.6},
        {"key": "甲@lag1", "count": 1, "ratio": 0.2},
    ]
    assert blank_count(produced, "甲@lag3") == 3
    assert blocks["rows"].payload["before"] == 5
    assert blocks["rows"].payload["after"] == 5
    assert blocks["rows"].payload["notes"] == [ZERO_FILL_NOTE]


def test_a_lag_longer_than_the_frame_blanks_every_row() -> None:
    """滞后 10 期而只有 4 行：整列都是空的，占比是 1 不是 2.5。"""
    produced, blocks = run_of(
        "lag_feature",
        frame_of({"甲": [1.0, 2.0, 3.0, 4.0]}),
        columns=["甲"],
        lags=[10],
    )
    assert by_column(blocks) == [{"key": "甲@lag10", "count": 4, "ratio": 1.0}]
    assert blank_count(produced, "甲@lag10") == 4


def test_the_lag_sketch_points_at_the_row_each_level_reads() -> None:
    """示意图：当前行在最右，@lag1 指着它左边一格、@lag3 指着左边三格。"""
    _, blocks = run_of(
        "lag_feature",
        frame_of({"甲": [1.0, 2.0, 3.0, 4.0, 5.0]}),
        columns=["甲"],
        lags=[1, 3],
    )
    payload = blocks["axis"].payload
    assert payload["scale"] == "index"
    assert payload["is_primary"] is False
    assert [(item["label"], item["since"]) for item in payload["segments"]] == [
        ("当前行", 3),
        ("滞后 1 期取的那一行", 2),
        ("滞后 3 期取的那一行", 0),
    ]


def test_the_valid_sample_count_follows_the_blanks_row_by_row() -> None:
    """m_i 是窗口里的非空个数：滑过一段全空之后它会掉到 0 再爬回来。"""
    assert valid_counts([1.0, 2.0, None, None, 5.0], 2) == [2, 1, 0, 1]
    assert valid_counts([1.0, 2.0, 3.0], 3) == [3]
    assert valid_counts([1.0, 2.0], 3) == []


def test_the_rolling_report_counts_head_and_empty_windows_apart() -> None:
    """窗口没满的头几行与窗口里一个数都没有的行分开记，合计与真空格数一致。"""
    produced, blocks = run_of(
        "rolling_feature",
        frame_of({"甲": [1.0, None, None, None, 5.0]}),
        columns=["甲"],
        window=3,
        stats=["mean"],
    )
    assert by_column(blocks) == [
        {
            "key": "甲@mean3",
            "count": 3,
            "ratio": 0.6,
            "head": 2,
            "empty": 1,
        }
    ]
    assert blank_count(produced, "甲@mean3") == 3


def test_the_denominator_alert_names_the_column_and_the_numbers() -> None:
    """⚠ 分母逐行不同这条必须带着数说：哪一列、几行没填满、最少的一行几个点。"""
    _, blocks = run_of(
        "rolling_feature",
        gappy(),
        columns=["甲"],
        window=3,
        stats=["mean"],
    )
    assert blocks["rows"].payload["alerts"] == [
        "窗口里的空值先被滤掉再折，所以分母逐行不同："
        "「甲」有 6 行的窗口没填满（最少的一行只用了 1 个点），"
        "它们与用满 3 个点算出来的结果在图上长得一模一样"
    ]


def test_no_denominator_alert_when_every_window_is_full() -> None:
    """一行都没缺时不许乱喊：喊了的话真出事那次就没人再看这条了。"""
    _, blocks = run_of(
        "rolling_feature",
        frame_of({"甲": [1.0, 2.0, 3.0, 4.0]}),
        columns=["甲"],
        window=2,
        stats=["mean"],
    )
    assert "alerts" not in blocks["rows"].payload
    assert blocks["columns"].payload["alerts"] == [SERVING_ALERT]


def test_the_sample_count_chart_is_anchored_at_zero_and_the_window() -> None:
    """有效样本数的轴钉在 0 与窗口宽度之间，满窗口那一处画一条线。"""
    _, blocks = run_of(
        "rolling_feature",
        gappy(),
        columns=["甲"],
        window=3,
        stats=["mean"],
    )
    column = blocks["bins"].payload["by_column"][0]
    assert column["key"] == "甲"
    assert column["low"] == 0.0
    assert column["high"] == 3.0
    assert sum(column["bins"]) == 6
    assert column["marks"] == [
        {"at": 3.0, "label": "窗口填满", "intent": "info"}
    ]
    assert blocks["bins"].payload["notes"] == [
        "只数了窗口已满的那些行：开头 2 行本来就给空值，不进这张图"
    ]


def test_the_rolling_sketch_says_the_window_includes_this_row() -> None:
    """示意图：窗口那一段盖住 3 行，当前行是最右那一格。"""
    _, blocks = run_of(
        "rolling_feature",
        gappy(),
        columns=["甲"],
        window=3,
        stats=["mean"],
    )
    payload = blocks["axis"].payload
    assert payload["scale"] == "index"
    listed = [
        (item["label"], item["since"], item["until"])
        for item in payload["segments"]
    ]
    assert listed == [
        ("窗口 3 行", 0, 3),
        ("当前行", 2, 3),
    ]
    assert payload["notes"] == [
        "窗口连当前行一起数：窗口 3 就是「当前行 + 前 2 行」"
    ]


def test_the_worst_lag_load_still_fits_the_report_budget() -> None:
    """60 列 × 366 天逐时 × 20 个档位：讲解装得下，一块都不用降档丢掉。"""
    frame = wide_numbers(HOURLY_ROWS)
    operator, _ = registry.build(
        "lag_feature",
        {"columns": list(frame.keys), "lags": list(range(1, 21))},
    )
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    operator.run({"frame": frame})
    report = report_budget.fit_report(operator.report())
    assert report is not None
    assert report["dropped"] == []
    assert report_budget.size_of(report) < REPORT_MAX_BYTES
    assert len(report["blocks"]) == 3


def test_the_worst_rolling_load_still_fits_the_report_budget() -> None:
    """60 列 × 366 天 × 五个统计量：讲解装得下，一块都不用降档丢掉。"""
    frame = wide_numbers(YEAR_ROWS)
    operator, _ = registry.build(
        "rolling_feature",
        {"columns": list(frame.keys), "window": 24, "stats": ALL_STATS},
    )
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    operator.run({"frame": frame})
    report = report_budget.fit_report(operator.report())
    assert report is not None
    assert report["dropped"] == []
    assert report_budget.size_of(report) < REPORT_MAX_BYTES
    assert len(report["blocks"]) == 4
