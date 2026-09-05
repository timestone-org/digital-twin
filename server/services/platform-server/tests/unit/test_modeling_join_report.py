"""多台账对齐的就近匹配与结果面：三分账、时刻差、右行复用次数。

⚠ 就近匹配这一段有两份实现：定义式的逐行全扫（用例里那份）与真跑的双指针，
这里逐行钉住两份同答——匹配错一位不会抛任何错，只是每一行的右半边都换了个时刻。
⚠ 复用次数不是可有可无的一张图：一条右行被几十条左行命中时，这一步事实上做的
是一次前向填充，而输出帧上一个字都看不出来。
"""

from typing import Any

from platform_server.apps.modeling.operators import (
    CellValue,
    Frame,
    FrameColumn,
    registry,
)
from platform_server.apps.modeling.operators.join import _matches
from platform_server.apps.modeling.operators.reporting import ReportBlock
from platform_server.apps.modeling.services import report_budget
from platform_server.apps.modeling.services.preview import REPORT_MAX_BYTES

SECOND = 1000
# 最坏负载：右边 60 列、两边各这么多行
WIDE_COLUMNS = 60
WIDE_ROWS = 5_000
# 逐行全扫在这个量级是四亿次比较且不早停，双指针是两趟排序
BIG_ROWS = 20_000


def scan_nearest(
    left: tuple[int, ...], right: tuple[int, ...], tolerance: int
) -> list[int | None]:
    """逐行全扫的就近匹配：定义式的一份，双指针那一份要与它逐行同答。

    ⚠ 它是这条契约里唯一的判准——就近匹配错一位不会抛任何错，只是每一行的右半
    边都换了个时刻，而每个数看着都正常。
    Args: left, right, tolerance。
    """
    found: list[int | None] = []
    for moment in left:
        best: int | None = None
        best_gap = tolerance + 1
        for position, other in enumerate(right):
            gap = abs(other - moment)
            if gap < best_gap:
                best, best_gap = position, gap
        found.append(best)
    return found


def sided(key: str, moments: list[int]) -> Frame:
    """一列数值 + 时间索引。

    Args: key, moments。
    """
    return Frame(
        columns=(FrameColumn(key=key, name=key, dtype="number"),),
        rows=tuple((float(moment),) for moment in moments),
        index=tuple(moments),
    )


def report_of(
    left: Frame, right: Frame, **config: Any
) -> dict[str, ReportBlock]:
    """跑一遍对齐并把讲解按块种类归好。

    Args: left, right, config。
    """
    operator, _ = registry.build("ledger_join", {**config})
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    operator.run({"left": left, "right": right})
    return {block.kind: block for block in operator.report()}


def stages_of(left: Frame, right: Frame, **config: Any) -> dict[str, Any]:
    """三分账按级名建键。

    Args: left, right, config。
    """
    rows = report_of(left, right, **config)["rows"]
    stages: list[dict[str, Any]] = rows.payload["funnel"]
    return {stage["name"]: stage for stage in stages}


def test_the_two_pointer_walk_matches_what_the_full_scan_answered() -> None:
    """⚠ 一样近时取行号小的那一行——哪怕它的时刻在另一侧。"""
    left = (0, 5, 10)
    right = (10, 0, 0)
    assert [found.position for found in _matches(left, right, 5)] == [1, 0, 0]
    assert scan_nearest(left, right, 5) == [1, 0, 0]


def test_the_two_pointer_walk_agrees_with_the_full_scan_on_messy_input() -> (
    None
):
    """乱序、重复时刻、正中间的平手：三样一起上，两份实现逐行一致。"""
    right = tuple(
        ((index * 37) % 200) * SECOND for index in range(200)
    ) + tuple(((index * 13) % 50) * SECOND for index in range(50))
    left = tuple(
        step * SECOND + (0, SECOND // 2, -3 * SECOND)[step % 3]
        for step in range(300)
    )
    tolerance = 2 * SECOND
    got = [found.position for found in _matches(left, right, tolerance)]
    assert got == scan_nearest(left, right, tolerance)


def test_the_gap_it_kept_is_the_real_distance_to_that_row() -> None:
    """留下来的时刻差就是这两行真正差的毫秒数，不是别处算的另一个数。"""
    left = (0, 3 * SECOND)
    right = (SECOND, 10 * SECOND)
    found = _matches(left, right, 5 * SECOND)
    assert [(item.position, item.gap) for item in found] == [
        (0, SECOND),
        (0, 2 * SECOND),
    ]


def test_a_row_beyond_the_tolerance_keeps_neither_row_nor_gap() -> None:
    """超出容差的既没有配到的行、也没有时刻差——不是配到了差得很远的一行。"""
    found = _matches((0,), (10 * SECOND,), SECOND)
    assert (found[0].position, found[0].gap) == (None, None)


def test_an_empty_right_side_matches_nothing() -> None:
    """右边一行都没有时逐行给 None，不是抛在指针上。"""
    assert [found.position for found in _matches((0, 1), (), SECOND)] == [
        None,
        None,
    ]


def test_twenty_thousand_rows_still_line_up_one_to_one() -> None:
    """两万对两万照旧逐行对上。

    ⚠ 逐行全扫在这个量级是四亿次比较且不早停：这条用例跑得完本身就是那条复杂度
    的看门人。
    """
    left = tuple(index * SECOND for index in range(BIG_ROWS))
    right = tuple(index * SECOND + 10 for index in range(BIG_ROWS))
    found = _matches(left, right, 100)
    assert [item.position for item in found] == list(range(BIG_ROWS))
    assert {item.gap for item in found} == {10}


def test_the_tally_splits_the_rows_three_ways() -> None:
    """两边都有 / 左有右无 / 右侧从没被用上，三笔账各记各的。"""
    left = sided("温度", [0, SECOND])
    right = sided("湿度", [0, 999 * SECOND])
    stages = stages_of(left, right, tolerance_ms=500, how="left")
    assert stages["两边都有"]["value"] == 1
    assert stages["左有右无"]["value"] == 1
    assert stages["右侧从没被用上"]["value"] == 1
    assert stages["输出行数"]["value"] == 2


def test_dropping_the_lonely_rows_shows_up_as_a_shorter_output() -> None:
    """按 inner 丢掉的那一行在输出行数与保留率上都看得见。"""
    left = sided("温度", [0, SECOND])
    right = sided("湿度", [0, 999 * SECOND])
    block = report_of(left, right, tolerance_ms=500, how="inner")["rows"]
    assert block.payload["after"] == 1
    assert block.payload["dropped"] == 1
    assert block.payload["ratio_actual"] == 0.5


def test_the_prefixed_columns_are_named_one_by_one() -> None:
    """并进来的是右边哪几列，逐个点名并说清前缀是干什么的。"""
    block = report_of(
        sided("温度", [0]), sided("湿度", [0]), tolerance_ms=SECOND
    )["columns"]
    assert block.payload["added"] == ["右_湿度"]
    assert block.payload["kept"] == 1
    assert "右_" in block.payload["reason"]


def test_one_right_row_hit_by_sixty_left_rows_is_stated_outright() -> None:
    """⚠ 一条右行被 60 条左行命中——这一步事实上做了一次前向填充。"""
    left = sided("温度", list(range(60)))
    right = sided("湿度", [0])
    bins = report_of(left, right, tolerance_ms=SECOND)["bins"]
    reuse = bins.payload["by_column"][1]
    assert reuse["key"] == "右行被命中次数"
    assert reuse["marks"] == [
        {"at": 60.0, "label": "最多被命中", "intent": "warning"}
    ]
    assert reuse["high"] == 60.0


def test_a_right_row_nobody_used_falls_off_the_reuse_axis() -> None:
    """从没被用上的右行在复用次数这条轴上没有位置，单独记一笔。"""
    left = sided("温度", [0])
    right = sided("湿度", [0, 999 * SECOND])
    reuse = report_of(left, right, tolerance_ms=500)["bins"].payload[
        "by_column"
    ][1]
    assert reuse["off_axis"] == {"label": "从没被用上", "count": 1}


def test_the_gap_histogram_draws_the_tolerance_and_the_median() -> None:
    """时刻差这条轴上钉两条线：容差在哪、这次实际差到哪。"""
    left = sided("温度", [0, 100, 200])
    right = sided("湿度", [0, 100, 200])
    gaps = report_of(left, right, tolerance_ms=SECOND)["bins"].payload[
        "by_column"
    ][0]
    assert (gaps["low"], gaps["high"]) == (0.0, float(SECOND))
    assert gaps["marks"] == [
        {"at": float(SECOND), "label": "容差", "intent": "danger"},
        {"at": 0.0, "label": "中位差", "intent": "info"},
    ]


def test_a_join_that_matched_nothing_draws_no_median_line() -> None:
    """一条都没对上时不画「中位差」——画在 0 处的一条线会被读成「差 0 毫秒」。"""
    left = sided("温度", [0, SECOND])
    right = sided("湿度", [999 * SECOND])
    gaps = report_of(left, right, tolerance_ms=500, how="left")["bins"].payload[
        "by_column"
    ][0]
    assert [mark["label"] for mark in gaps["marks"]] == ["容差"]
    assert gaps["off_axis"] == {"label": "超出容差没对上", "count": 2}


def test_the_rows_that_matched_nothing_fall_off_the_gap_axis() -> None:
    """没对上的行在时刻差这条轴上没有位置，与「差了 0 毫秒」分得清清楚楚。"""
    left = sided("温度", [0, 999 * SECOND])
    right = sided("湿度", [0])
    gaps = report_of(left, right, tolerance_ms=500)["bins"].payload[
        "by_column"
    ][0]
    assert gaps["off_axis"] == {"label": "超出容差没对上", "count": 1}
    assert sum(gaps["bins"]) == 1.0


def wide_side(prefix: str, moments: list[int]) -> Frame:
    """一份 60 列的宽帧。

    Args: prefix, moments。
    """
    keys = tuple(
        f"{prefix}很长的列名字第{index}列" for index in range(WIDE_COLUMNS)
    )
    rows: tuple[tuple[CellValue, ...], ...] = tuple(
        tuple(float(moment % 97) for _ in keys) for moment in moments
    )
    return Frame(
        columns=tuple(
            FrameColumn(key=key, name=key, dtype="number") for key in keys
        ),
        rows=rows,
        index=tuple(moments),
    )


def test_the_worst_load_still_fits_the_report_budget() -> None:
    """右边 60 列、两边各五千行：讲解装得下，一块都不用降档丢掉。"""
    left = wide_side("左", [index * SECOND for index in range(WIDE_ROWS)])
    right = wide_side("右", [index * SECOND + 7 for index in range(WIDE_ROWS)])
    operator, _ = registry.build("ledger_join", {"tolerance_ms": SECOND})
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    operator.run({"left": left, "right": right})
    report = report_budget.fit_report(operator.report())
    assert report is not None
    assert report["dropped"] == []
    assert report_budget.size_of(report) < REPORT_MAX_BYTES


def test_a_join_that_never_ran_says_nothing() -> None:
    """没跑过就一块都不讲。"""
    operator, _ = registry.build("ledger_join", {})
    assert operator.report() == ()
