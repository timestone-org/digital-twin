"""台账取数的结果面：取数漏斗、丢空列、时间覆盖、各列空值率与转坏格数。

⚠ 三处「拿不到」必须留成 None 并说清为什么：台账当前几列、窗口命中几行、以及
触顶时的实际起点——拿手里这一份的数去顶替，界面上的账就成了假账（规格 §2-P4）。
"""

from datetime import UTC, datetime
from typing import Any

from platform_server.apps.modeling.operators import (
    PREFETCHED_KEY,
    CellValue,
    Frame,
    FrameColumn,
    Provenance,
    registry,
)
from platform_server.apps.modeling.operators.reporting import ReportBlock
from platform_server.apps.modeling.operators.source import (
    NOTE_NO_BLANK,
    NOTE_NO_ROWS,
)
from platform_server.apps.modeling.services import report_budget
from platform_server.apps.modeling.services.preview import (
    REPORT_MAX_BYTES,
    summarize,
)

HOUR_MS = 3_600_000
SINCE = datetime(2026, 1, 1, tzinfo=UTC)
UNTIL = datetime(2026, 2, 1, tzinfo=UTC)
# 最坏负载：60 列宽帧 × 366 天逐时
WIDE_COLUMNS = 60
YEAR_ROWS = 366 * 24


def frame_of(
    keys: tuple[str, ...],
    rows: tuple[tuple[CellValue, ...], ...],
    *,
    is_truncated: bool = False,
    coerce_failed: tuple[int, ...] = (),
) -> Frame:
    """造一份带时刻与出处的取数帧。

    Args: keys, rows, is_truncated, coerce_failed。
    """
    failures = coerce_failed or tuple(0 for _ in keys)
    return Frame(
        columns=tuple(
            FrameColumn(key=key, name=key, dtype="number", coerce_failed=failed)
            for key, failed in zip(keys, failures, strict=True)
        ),
        rows=rows,
        index=tuple(index * HOUR_MS for index in range(len(rows))),
        provenance=Provenance(
            table_codes=("energy_h",),
            since=SINCE,
            until=UNTIL,
            is_truncated=is_truncated,
        ),
    )


def report_of(frame: Frame, **config: Any) -> dict[str, list[ReportBlock]]:
    """跑一遍取数并把讲解按块种类归好。

    Args: frame, config。
    """
    operator, _ = registry.build("ledger_source", {**config})
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    operator.run({PREFETCHED_KEY: frame})
    found: dict[str, list[ReportBlock]] = {}
    for block in operator.report():
        found.setdefault(block.kind, []).append(block)
    return found


def funnel_of(frame: Frame, **config: Any) -> dict[str, Any]:
    """取数漏斗按级名建键。

    Args: frame, config。
    """
    rows = report_of(frame, **config)["rows"][0]
    stages: list[dict[str, Any]] = rows.payload["funnel"]
    return {stage["name"]: stage for stage in stages}


def small_frame(*, is_truncated: bool = False) -> Frame:
    """三列五行，其中一列整列全空。

    Args: is_truncated。
    """
    return frame_of(
        ("温度", "负荷", "湿度"),
        tuple((float(index), 1.0, None) for index in range(5)),
        is_truncated=is_truncated,
    )


def test_a_source_that_never_ran_says_nothing() -> None:
    """没跑过就一块都不讲——空壳会让界面摆出一片空白的分区。"""
    operator, _ = registry.build("ledger_source", {"table_code": "energy_h"})
    assert operator.report() == ()


def test_the_funnel_counts_the_columns_down_in_three_steps() -> None:
    """台账几列 → 选中几列 → 丢空列后剩几列。"""
    stages = funnel_of(
        small_frame(),
        table_code="energy_h",
        should_drop_empty_columns=True,
    )
    assert stages["选中"]["value"] == 3
    assert stages["丢空列后"]["value"] == 2


def test_the_ledger_column_count_is_known_only_when_all_columns_are_taken() -> (
    None
):
    """留空表示取全部列，那时交进来这几列就是台账当前的全部。"""
    stages = funnel_of(small_frame(), table_code="energy_h")
    assert stages["台账列数"]["value"] == 3
    assert stages["台账列数"]["note"] == ""


def test_picking_columns_leaves_the_ledger_column_count_unknown() -> None:
    """⚠ 点名取了几列时，台账当前一共几列没跟着交进来——留 None 并说清。"""
    stages = funnel_of(
        small_frame(), table_code="energy_h", columns=["温度", "负荷"]
    )
    assert stages["台账列数"]["value"] is None
    assert "没跟着交进来" in stages["台账列数"]["note"]


def test_the_funnel_counts_the_rows_down_in_three_steps() -> None:
    """窗口命中 → 上限 → 实取。没触顶时命中就是实取，这个数是准的。"""
    stages = funnel_of(small_frame(), table_code="energy_h", row_limit=1000)
    assert stages["窗口命中"]["value"] == 5
    assert stages["行数上限"]["value"] == 1000
    assert stages["实取"]["value"] == 5


def test_a_truncated_window_cannot_say_how_many_rows_it_matched() -> None:
    """⚠ 触顶时窗口里究竟命中多少行没跟着交进来——留 None，不拿实取顶替。"""
    stages = funnel_of(small_frame(is_truncated=True), table_code="energy_h")
    assert stages["窗口命中"]["value"] is None
    assert "触顶" in stages["窗口命中"]["note"]


def test_the_dropped_empty_columns_are_named() -> None:
    """丢掉的整列全空的列逐个点名，不只给一个数。"""
    blocks = report_of(
        small_frame(),
        table_code="energy_h",
        should_drop_empty_columns=True,
    )
    payload = blocks["columns"][0].payload
    assert payload["removed"] == ["湿度"]
    assert payload["kept"] == 2


def test_an_empty_column_that_was_kept_is_still_called_out() -> None:
    """没开丢空列时那一列照样点出来：它在下游会算出一堆空。"""
    payload = report_of(small_frame(), table_code="energy_h")["columns"][0]
    assert payload.payload["removed"] == []
    assert "1 列整列全空" in payload.payload["reason"]


def test_the_axis_prints_the_real_ends_beside_the_requested_ones() -> None:
    """⚠ 实际取到的那一段与请求的那一段并排给（规格 D-7）。

    触顶时留下的是最新那批，实际起点比请求起点晚得多；只印一个的话出处那行字
    是假的，用户照它缩时间范围会缩错一头。
    """
    axis = report_of(small_frame(is_truncated=True), table_code="energy_h")[
        "axis"
    ][0].payload
    assert axis["actual_since"] == "1970-01-01T00:00:00+00:00"
    assert axis["actual_until"] == "1970-01-01T04:00:00+00:00"
    assert axis["segments"] == [
        {
            "since": int(SINCE.timestamp() * 1000),
            "until": int(UNTIL.timestamp() * 1000),
            "label": "请求区间",
            "tone": "requested",
        }
    ]


def test_the_axis_carries_the_business_timezone() -> None:
    """时区偏移由运行环境注入，界面拿不到。

    不带出去的话按 UTC 画，在东八区整体偏八小时且每个数看着完全正常。
    """
    axis = report_of(small_frame(), table_code="energy_h")["axis"][0]
    assert axis.payload["tz_offset_minutes"] == 480


def test_a_frame_without_moments_draws_no_time_axis() -> None:
    """没有时刻就不摆时间覆盖那一块，不摆一条空轴。"""
    frame = Frame(
        columns=(FrameColumn(key="温度", name="温度", dtype="number"),),
        rows=((1.0,),),
    )
    assert "axis" not in report_of(frame, table_code="energy_h")


def test_blank_cells_and_unconvertible_ones_are_counted_apart() -> None:
    """⚠ 空的格与转坏的格分开数。

    合成一个空值率之后，用户会去查采集为什么没上来，而真因是这一列的类型配错了。
    """
    frame = frame_of(
        ("温度",),
        ((None,), (None,), (None,), (1.0,)),
        coerce_failed=(2,),
    )
    bins = report_of(frame, table_code="energy_h")["bins"][0]
    column = bins.payload["by_column"][0]
    assert column["bins"] == [0.25, 0.5]
    assert column["labels"] == ["空的格", "转坏的格"]


def test_the_blank_share_is_laid_out_on_a_nought_to_one_axis() -> None:
    """⚠ 两端是 0 与 1，不是 0 与总行数。

    铺在行数轴上的话，界面把这两撮当成一条分布画直方图：刻度、箱数与那条参考线
    量的都不是它们，而每个数看着都完全正常。
    """
    frame = frame_of(("温度",), ((None,), (1.0,), (2.0,), (3.0,)))
    column = report_of(frame, table_code="energy_h")["bins"][0].payload[
        "by_column"
    ][0]
    assert (column["low"], column["high"]) == (0.0, 1.0)


def test_the_blank_cells_are_not_counted_a_second_time_off_the_axis() -> None:
    """⚠ 空的格已经是条子本身，再挂一笔离轴的就是同一撮数了两遍。

    图注会印成「共 1255 行；空的格 1255 行（不在这条轴上）」，读者相加得 2510。
    """
    frame = frame_of(("温度",), ((None,), (1.0,)))
    column = report_of(frame, table_code="energy_h")["bins"][0].payload[
        "by_column"
    ][0]
    assert column["off_axis"] is None


def test_the_blank_block_draws_no_reference_line() -> None:
    """⚠ 取数这一步没有阈值可比，一条线都不画。

    两根柱铺在 `[0, 总行数]` 上时箱宽恒是总行数的一半，画在那儿的线永远贴着两柱
    交界，对任何一列、任何空值率都长得一模一样——一比特信息都没有。
    """
    frame = frame_of(("温度",), ((None,), (1.0,)))
    column = report_of(frame, table_code="energy_h")["bins"][0].payload[
        "by_column"
    ][0]
    assert column["marks"] == []


def test_the_unconvertible_count_cannot_outgrow_the_blank_one() -> None:
    """⚠ 转坏格数是取数那一刻记下的，行少了它不跟着少——夹回空格数以内。

    不夹的话那根条的第一段是负数，界面上是一根反着长的柱子。
    """
    frame = frame_of(
        ("温度",), ((None,), (1.0,), (2.0,), (3.0,)), coerce_failed=(5,)
    )
    column = report_of(frame, table_code="energy_h")["bins"][0].payload[
        "by_column"
    ][0]
    assert column["bins"] == [0.0, 0.25]


def notes_of(frame: Frame, **config: Any) -> list[str]:
    """漏斗上挂的那几句话。

    Args: frame, config。
    """
    rows = report_of(frame, **config)["rows"][0]
    listed: list[dict[str, Any]] = rows.payload.get("notes") or []
    return [one["text"] for one in listed]


def clean_frame() -> Frame:
    """三列四行，一格空值都没有。"""
    return frame_of(
        ("温度", "负荷", "湿度"),
        tuple((float(index), 1.0, 2.0) for index in range(4)),
    )


def test_a_frame_without_a_single_blank_draws_no_histogram_at_all() -> None:
    """⚠ 一格空值都没有时那一块整个不发。

    照发的话每列两段 0 长的条，界面照实画成一排零长的条，几百像素的版面说的是
    零，图注还写着「最高的一列是 0%」。
    """
    assert "bins" not in report_of(clean_frame(), table_code="energy_h")


def test_the_clean_news_lands_as_one_line_on_the_funnel() -> None:
    """不发那一块不等于不说：这件好消息落成第一区的一句话。"""
    assert notes_of(clean_frame(), table_code="energy_h") == [
        NOTE_NO_BLANK.format(columns=3, rows=4)
    ]


def test_a_window_that_matched_no_row_says_so_in_its_own_words() -> None:
    """⚠ 「一行都没取到」与「真的一格空值都没有」不是同一件事（规格 §2-P5）。

    两句合成一句会把「这段窗口是空的」读成「这段数据很干净」。
    """
    empty = frame_of(("温度", "负荷"), ())
    assert notes_of(empty, table_code="energy_h") == [NOTE_NO_ROWS]
    assert "bins" not in report_of(empty, table_code="energy_h")


def test_a_frame_with_one_blank_still_draws_it_and_says_nothing_extra() -> None:
    """有空值就照常发那一块，漏斗上也不挂那句话。"""
    blocks = report_of(small_frame(), table_code="energy_h")
    assert [item["key"] for item in blocks["bins"][0].payload["by_column"]] == [
        "湿度"
    ]
    assert notes_of(small_frame(), table_code="energy_h") == []


def test_a_column_without_a_single_blank_is_left_out() -> None:
    """一个空都没有的列不列进来——列成 0 会把真正空着的那列挤出上限。"""
    keys = tuple(f"c{index}" for index in range(10))
    rows = tuple(
        tuple(None if index == 9 and step == 0 else 1.0 for index in range(10))
        for step in range(4)
    )
    bins = report_of(frame_of(keys, rows), table_code="energy_h")["bins"][0]
    assert [item["key"] for item in bins.payload["by_column"]] == ["c9"]


def test_the_dirtiest_columns_come_first_and_only_eight_are_kept() -> None:
    """空得最多的排前面，八列封顶——宽帧逐列画会把这一块撑到几十 KB。"""
    keys = tuple(f"c{index}" for index in range(20))
    rows = tuple(
        tuple(None if index <= step else 1.0 for index in range(20))
        for step in range(20)
    )
    bins = report_of(frame_of(keys, rows), table_code="energy_h")["bins"][0]
    listed = [column["key"] for column in bins.payload["by_column"]]
    assert listed == [f"c{index}" for index in range(8)]


def wide_frame() -> Frame:
    """最坏负载：60 列 × 366 天逐时，每列都有空格与转坏格。"""
    keys = tuple(f"很长的列名字第{index}列" for index in range(WIDE_COLUMNS))
    rows = tuple(
        tuple(
            None if (row + index) % 7 == 0 else float(row % 97)
            for index in range(WIDE_COLUMNS)
        )
        for row in range(YEAR_ROWS)
    )
    return frame_of(keys, rows, coerce_failed=tuple(range(WIDE_COLUMNS)))


def test_the_worst_load_still_fits_the_report_budget() -> None:
    """60 列宽帧 × 366 天逐时：讲解装得下，一块都不用降档丢掉。"""
    operator, _ = registry.build("ledger_source", {"table_code": "energy_h"})
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    operator.run({PREFETCHED_KEY: wide_frame()})
    report = report_budget.fit_report(operator.report())
    assert report is not None
    assert report["dropped"] == []
    assert report_budget.size_of(report) < REPORT_MAX_BYTES


def test_the_column_stat_finally_carries_the_unconvertible_cell_count() -> None:
    """⚠ `coerce_failed` 从上线到现在全仓零读取，列统计不带它就没人看得见。"""
    frame = frame_of(("温度",), ((None,), (1.0,)), coerce_failed=(1,))
    stat = summarize(frame)["columns"][0]
    assert stat["coerce_failed"] == 1
