"""三个清洗算子的结果讲解：转不动的格、丢行归因、判据列的分布。

⚠ 这一组守的是「四种没有不许合并」：转不动的格与本来就空的格、因空值被丢的行
与不合条件的行、零行的帧上算不出来的空值率与真的一个空都没有——各记各的。
⚠ 因空丢弃的行数必须由后端数：前端拿「上游空值率 × 行数」推的话，摘要在第 60
列处截断时读不到这一列，会把「读不到」画成「0 行」（规格 §11 的 R-14）。
"""

from typing import Any

import pytest

from platform_server.apps.modeling.operators import (
    CellValue,
    Frame,
    FrameColumn,
    ReportBlock,
    registry,
)
from platform_server.apps.modeling.operators.cleaning_report import (
    NOTE_BLANK_COMPARED,
    NOTE_BLANK_JUDGED,
    NOTE_CAST_NO_BLANK,
    NOTE_HOLED_ALL,
    NOTE_HOLED_ANY,
    NOTE_NO_BLANK,
    OFF_AXIS_BLANK,
)
from platform_server.apps.modeling.services import report_budget
from platform_server.apps.modeling.services.preview import REPORT_MAX_BYTES

# ⚠ 两个列名的码点序与它们的空值率高低**相反**：排序按空值率还是按名字，两种写
# 法在这一组用例上答得出不同的顺序
FIRST = "露点"
SECOND = "湿度"
# 最坏负载：60 列宽帧、这么多行
WIDE_COLUMNS = 60
WIDE_ROWS = 20_000


def framed(
    rows: tuple[tuple[CellValue, ...], ...], *, dtype: str = "string"
) -> Frame:
    """两列的小帧：第一列数值、第二列按参数定类型。

    Args: rows, dtype。
    """
    return Frame(
        columns=(
            FrameColumn(key=FIRST, name=FIRST, dtype="number"),
            FrameColumn(key=SECOND, name=SECOND, dtype=dtype),
        ),
        rows=rows,
    )


def wide(*, dtype: str, cell: CellValue, rows: int) -> Frame:
    """60 列长列名的宽帧，每一格都一样。

    Args: dtype, cell, rows。
    """
    keys = tuple(
        f"很长的台账列名字第{index}列" for index in range(WIDE_COLUMNS)
    )
    return Frame(
        columns=tuple(
            FrameColumn(key=key, name=key, dtype=dtype, unit="℃")
            for key in keys
        ),
        rows=tuple(tuple(cell for _ in keys) for _ in range(rows)),
    )


def blocks_of(code: str, frame: Frame, **config: Any) -> dict[str, ReportBlock]:
    """跑一个算子并把讲解按块种类归好。

    Args: code, frame, config。
    """
    return {block.kind: block for block in report_of(code, frame, **config)}


def report_of(
    code: str, frame: Frame, **config: Any
) -> tuple[ReportBlock, ...]:
    """跑一个算子，回它的讲解。

    Args: code, frame, config。
    """
    operator, _ = registry.build(code, config)
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    operator.run({"frame": frame})
    return operator.report()


def stages_of(code: str, frame: Frame, **config: Any) -> dict[str, Any]:
    """漏斗按级名建键。

    Args: code, frame, config。
    """
    rows: list[dict[str, Any]] = blocks_of(code, frame, **config)[
        "rows"
    ].payload["funnel"]
    return {stage["name"]: stage for stage in rows}


def notes_of(block: ReportBlock) -> list[str]:
    """一块上挂的那几句话。

    Args: block。
    """
    listed: list[dict[str, Any]] = block.payload.get("notes") or []
    return [one["text"] for one in listed]


def spotless() -> Frame:
    """两列三行，一格空值都没有。"""
    return framed(((1.0, "1"), (2.0, "2"), (3.0, "3")))


def fitted_size(code: str, frame: Frame, **config: Any) -> int:
    """讲解压进单节点预算之后的字节数；一块都没被降档丢掉才算数。

    Args: code, frame, config。
    """
    report = report_budget.fit_report(report_of(code, frame, **config))
    assert report is not None
    assert report["dropped"] == []
    return report_budget.size_of(report)


def test_the_cells_that_would_not_convert_keep_their_original_values() -> None:
    """转不动的格数与前几个原值一起报：只报个数分不出坏的是哪种占位符。"""
    frame = framed(
        ((1.0, "12.5"), (2.0, "--"), (3.0, None), (4.0, "n/a"), (5.0, "3"))
    )
    cells = blocks_of("cast_type", frame, columns=[SECOND], to="number")[
        "cells"
    ]
    assert cells.payload["by_column"] == [
        {
            "key": SECOND,
            "changed": 2,
            "low": None,
            "high": None,
            "samples": ["--", "n/a"],
        }
    ]


def test_a_column_that_converted_cleanly_is_left_out_of_the_broken_cells() -> (
    None
):
    """一格都没转坏的列不列进来——列成 0 会把真正坏掉的那列挤出上限。"""
    frame = framed(((1.0, "12.5"), (2.0, "3")))
    cells = blocks_of("cast_type", frame, columns=[SECOND], to="number")[
        "cells"
    ]
    assert cells.payload["by_column"] == []


def test_the_broken_cells_put_the_worst_column_first() -> None:
    """转坏得最多的列排前面。"""
    frame = Frame(
        columns=(
            FrameColumn(key=FIRST, name=FIRST, dtype="string"),
            FrameColumn(key=SECOND, name=SECOND, dtype="string"),
        ),
        rows=(("x", "1"), ("y", "2"), ("z", "w")),
    )
    cells = blocks_of("cast_type", frame, columns=[SECOND, FIRST], to="number")[
        "cells"
    ]
    ranked = [
        (item["key"], item["changed"]) for item in cells.payload["by_column"]
    ]
    assert ranked == [(FIRST, 3), (SECOND, 1)]


def test_the_null_ratio_bars_follow_the_same_worst_first_order() -> None:
    """空值率那几根柱与转坏格数同序，不按列名排。"""
    frame = Frame(
        columns=(
            FrameColumn(key=FIRST, name=FIRST, dtype="string"),
            FrameColumn(key=SECOND, name=SECOND, dtype="string"),
        ),
        rows=(("x", "1"), ("y", "2"), ("z", "w")),
    )
    bins = blocks_of("cast_type", frame, columns=[SECOND, FIRST], to="number")[
        "bins"
    ]
    assert [
        (item["key"], item["bins"]) for item in bins.payload["by_column"]
    ] == [(FIRST, [0.0, 1.0]), (SECOND, [0.0, round(1 / 3, 6)])]


def test_the_dtype_pairs_only_list_the_columns_that_really_changed() -> None:
    """第一列本来就是数值，转成数值不算换过类型，不进对照表。"""
    frame = framed(((1.0, "12.5"), (2.0, "3")))
    columns = blocks_of(
        "cast_type", frame, columns=[FIRST, SECOND], to="number"
    )["columns"]
    assert columns.payload["dtype_before"] == [
        {"key": SECOND, "before": "string", "after": "number"}
    ]
    assert columns.payload["kept"] == 2


def test_the_cast_reason_says_what_happens_to_the_cells_it_cannot_convert() -> (
    None
):
    """转成什么、转不动的怎么处置，两样都写在理由里。"""
    frame = framed(((1.0, "12.5"),))
    columns = blocks_of(
        "cast_type", frame, columns=[SECOND], to="number", on_error="coerce"
    )["columns"]
    assert columns.payload["reason"] == "1 列转成数值，转不动的当成空值放过"


def test_the_null_ratio_is_paired_before_and_after_over_one_denominator() -> (
    None
):
    """行数不变，两根柱共用同一个分母，故差值可信。"""
    frame = framed(((1.0, "1"), (2.0, "x"), (3.0, None), (4.0, "2")))
    bins = blocks_of("cast_type", frame, columns=[SECOND], to="number")["bins"]
    assert bins.payload["by_column"] == [
        {
            "key": SECOND,
            "bins": [0.25, 0.5],
            "dropped": [],
            "low": 0.0,
            "high": 1.0,
            "marks": [],
            "off_axis": None,
            "curve": None,
        }
    ]


def test_a_cast_with_no_blank_on_either_side_draws_no_bar_at_all() -> None:
    """⚠ 转前转后都没有空值时那一块整个不发。

    照发的话每列两根 0 高的横条，一排零说不出任何事，而「转坏了多少」这个问题
    在没有空值时根本不存在（规格 §2-P5）。
    """
    made = blocks_of("cast_type", spotless(), columns=[SECOND], to="number")
    assert "bins" not in made
    assert notes_of(made["columns"]) == [
        NOTE_CAST_NO_BLANK.format(columns=1, rows=3)
    ]


def test_a_frame_with_no_rows_draws_no_null_ratio_bar_at_all() -> None:
    """零行的帧上空值率是「算不出来」，不是「一个空都没有」。"""
    bins = blocks_of("cast_type", framed(()), columns=[SECOND], to="number")[
        "bins"
    ]
    assert bins.payload["by_column"][0]["bins"] == []


def test_casting_sixty_columns_of_junk_still_fits_the_report_budget() -> None:
    """60 列宽帧、两万行、每一格都转不动：讲解装得下，一块都不用降档丢掉。"""
    frame = wide(dtype="string", cell="--", rows=WIDE_ROWS)
    size = fitted_size(
        "cast_type", frame, columns=list(frame.keys), to="number"
    )
    assert size < REPORT_MAX_BYTES


def test_a_cast_that_never_ran_says_nothing() -> None:
    """没跑过就一块都不讲。"""
    operator, _ = registry.build("cast_type", {})
    assert operator.report() == ()


def holed() -> Frame:
    """五行两列，第一列空三格、第二列空两格，其中一行两列全空。"""
    return framed(
        (
            (1.0, "a"),
            (None, "b"),
            (None, None),
            (1.0, None),
            (None, "c"),
        )
    )


def test_the_dropped_rows_are_blamed_on_the_columns_that_were_blank() -> None:
    """谁害得这行被丢，逐列点名，多的排前面。"""
    rows = blocks_of("drop_missing", holed(), axis="row")["rows"]
    assert rows.payload["by_column"] == [
        {"key": FIRST, "count": 3, "ratio": 0.75},
        {"key": SECOND, "count": 2, "ratio": 0.5},
    ]


def test_a_row_blank_in_two_columns_is_blamed_on_both_of_them() -> None:
    """一行同时缺两列时两列各记一笔，故几列的占比加起来会超过 100%。"""
    rows = blocks_of("drop_missing", holed(), axis="row")["rows"]
    shares = [item["ratio"] for item in rows.payload["by_column"]]
    assert sum(shares) == 1.25


def test_the_rows_blank_in_every_watched_column_are_counted_apart() -> None:
    """整行全空与只缺一列分开数：前者要查采集，后者要查那一列。"""
    rows = blocks_of("drop_missing", holed(), axis="row")["rows"]
    assert (rows.payload["dropped"], rows.payload["dropped_blank"]) == (4, 1)
    assert rows.payload["ratio_actual"] == 0.2


def test_the_any_judge_and_the_all_judge_say_different_things() -> None:
    """两档判据在漏斗上各写各的话——写成同一句就分不出丢了哪些行。"""
    any_note = stages_of("drop_missing", holed(), axis="row", how="any")
    all_note = stages_of("drop_missing", holed(), axis="row", how="all")
    assert any_note["被判缺失"] == {
        "name": "被判缺失",
        "value": 4,
        "unit": "行",
        "note": NOTE_HOLED_ANY,
    }
    assert all_note["被判缺失"] == {
        "name": "被判缺失",
        "value": 1,
        "unit": "行",
        "note": NOTE_HOLED_ALL,
    }


def test_each_watched_column_gets_its_own_null_ratio_bar_worst_first() -> None:
    """判据看的那几列各画一根柱，最空的排前面。"""
    bins = blocks_of("drop_missing", holed(), axis="row")["bins"]
    assert [
        (item["key"], item["bins"]) for item in bins.payload["by_column"]
    ] == [(FIRST, [0.6]), (SECOND, [0.4])]


def test_only_the_subset_columns_are_watched() -> None:
    """配了 subset 就只看那几列，别的列既不判也不画。"""
    bins = blocks_of("drop_missing", holed(), axis="row", subset=[SECOND])[
        "bins"
    ]
    assert [item["key"] for item in bins.payload["by_column"]] == [SECOND]


def test_dropping_holed_rows_out_of_a_wide_frame_fits_the_report_budget() -> (
    None
):
    """60 列宽帧、两万行、每一行都缺一格：讲解装得下。"""
    frame = wide(dtype="string", cell=None, rows=WIDE_ROWS)
    rows = tuple(
        tuple(
            None if index == seat % WIDE_COLUMNS else "x"
            for index in range(WIDE_COLUMNS)
        )
        for seat in range(WIDE_ROWS - 1)
    )
    kept = (tuple("x" for _ in range(WIDE_COLUMNS)),)
    frame = Frame(columns=frame.columns, rows=(*rows, *kept))
    assert fitted_size("drop_missing", frame, axis="row") < REPORT_MAX_BYTES


def leaky() -> Frame:
    """四行两列：第一列空三格（0.75），第二列空一格（0.25）。"""
    return framed(((1.0, "a"), (None, None), (None, "b"), (None, "c")))


def test_the_columns_over_the_line_are_named_and_the_line_is_stated() -> None:
    """丢掉的是哪几列、线画在哪，两样都说。"""
    columns = blocks_of(
        "drop_missing", leaky(), axis="col", max_null_ratio=0.5
    )["columns"]
    assert columns.payload["removed"] == [FIRST]
    assert columns.payload["kept"] == 1
    assert columns.payload["reason"] == "空值率超过 0.5 的列被丢掉"


def test_the_emptiest_column_left_standing_sits_next_to_the_line() -> None:
    """配的那条线与留下来最空的那一列摆在一起，才看得出线再调低会丢掉谁。"""
    rows = blocks_of("drop_missing", leaky(), axis="col", max_null_ratio=0.5)[
        "rows"
    ]
    assert rows.payload["ratio_configured"] == 0.5
    assert rows.payload["ratio_actual"] == 0.25


def test_dropping_columns_leaves_the_row_count_alone() -> None:
    """这一档一行都不丢，账记在列上。"""
    rows = blocks_of("drop_missing", leaky(), axis="col", max_null_ratio=0.5)[
        "rows"
    ]
    assert (rows.payload["before"], rows.payload["after"]) == (4, 4)
    assert rows.payload["dropped"] == 0
    stages = stages_of("drop_missing", leaky(), axis="col", max_null_ratio=0.5)
    assert [
        stages[name]["value"] for name in ("进来", "空值率超过阈值", "留下")
    ] == [
        2,
        1,
        1,
    ]
    assert stages["进来"]["unit"] == "列"


def test_every_column_gets_a_bar_against_the_threshold_line() -> None:
    """每一列一根柱，柱上都钉着那条阈值线。"""
    bins = blocks_of("drop_missing", leaky(), axis="col", max_null_ratio=0.5)[
        "bins"
    ]
    assert [
        (item["key"], item["bins"], item["marks"])
        for item in bins.payload["by_column"]
    ] == [
        (FIRST, [0.75], [{"at": 0.5, "label": "阈值", "intent": "danger"}]),
        (SECOND, [0.25], [{"at": 0.5, "label": "阈值", "intent": "danger"}]),
    ]


@pytest.mark.parametrize("axis", ["row", "col"])
def test_a_frame_without_a_blank_draws_no_null_ratio_bar(axis: str) -> None:
    """丢行丢列两档同理：一格空值都没有时那一块不发。

    ⚠ 每列一根零高的柱说不出任何事（规格 §2-P5）；好消息落成行数账上的一句话。
    """
    made = blocks_of("drop_missing", spotless(), axis=axis)
    assert "bins" not in made
    assert notes_of(made["rows"]) == [NOTE_NO_BLANK.format(columns=2, rows=3)]


def test_a_frame_with_no_rows_still_draws_the_bar_it_cannot_compute() -> None:
    """⚠ 零行的帧上「算不出来」照发，不许跟着好消息一起被吞掉（规格 §2-P5）。"""
    made = blocks_of("drop_missing", framed(()), axis="col")
    assert made["bins"].payload["by_column"][0]["bins"] == []
    assert notes_of(made["rows"]) == []


def test_dropping_empty_columns_out_of_a_wide_frame_fits_the_budget() -> None:
    """60 列宽帧、两万行、一半的列整列全空：讲解装得下。"""
    frame = wide(dtype="string", cell=None, rows=WIDE_ROWS)
    rows = tuple(
        tuple(None if index % 2 == 0 else "x" for index in range(WIDE_COLUMNS))
        for _ in range(WIDE_ROWS)
    )
    frame = Frame(columns=frame.columns, rows=rows)
    size = fitted_size("drop_missing", frame, axis="col", max_null_ratio=0.5)
    assert size < REPORT_MAX_BYTES


def gapped() -> Frame:
    """五行，判据列取值 1 / 空 / 5 / 空 / 9。"""
    return Frame(
        columns=(FrameColumn(key=FIRST, name=FIRST, dtype="number"),),
        rows=((1.0,), (None,), (5.0,), (None,), (9.0,)),
    )


def test_the_blank_rows_a_comparison_dropped_are_counted_by_the_backend() -> (
    None
):
    """空值在比较档一律被丢，这个数由后端数出来，不留给前端推。"""
    rows = blocks_of(
        "filter_rows", gapped(), column=FIRST, op="gte", value=5.0
    )["rows"]
    assert rows.payload["dropped"] == 3
    assert rows.payload["dropped_blank"] == 2
    assert rows.payload["ratio_actual"] == 0.4


def test_the_is_blank_judge_drops_no_row_for_being_blank() -> None:
    """这一档专挑空值留下，被丢的三行没有一行是「因为空」被丢的。"""
    rows = blocks_of("filter_rows", gapped(), column=FIRST, op="is_blank")[
        "rows"
    ]
    assert rows.payload["dropped"] == 3
    assert rows.payload["dropped_blank"] == 0


def test_the_funnel_adds_up_to_the_rows_that_stayed() -> None:
    """进来 = 因空丢弃 + 不合条件 + 留下，四级账要合得上。"""
    stages = stages_of(
        "filter_rows", gapped(), column=FIRST, op="gte", value=5.0
    )
    assert [
        stages[name]["value"] for name in ("进来", "空值", "不合条件", "留下")
    ] == [
        5,
        2,
        1,
        2,
    ]
    assert stages["空值"]["note"] == NOTE_BLANK_COMPARED


def test_the_blank_judge_says_blanks_have_their_own_fate() -> None:
    """空值这一档单独判，漏斗上那句话跟着换。"""
    stages = stages_of("filter_rows", gapped(), column=FIRST, op="not_blank")
    assert stages["空值"]["note"] == NOTE_BLANK_JUDGED


def test_the_blank_rows_stand_on_their_own_bar_off_the_axis() -> None:
    """空值在数轴上没有位置，单独一根离轴柱，不混进任何一个桶。"""
    bins = blocks_of(
        "filter_rows", gapped(), column=FIRST, op="gte", value=5.0
    )["bins"]
    column = bins.payload["by_column"][0]
    assert column["off_axis"] == {"label": OFF_AXIS_BLANK, "count": 2}
    assert sum(column["bins"]) == 3.0
    assert (column["low"], column["high"]) == (1.0, 9.0)


def test_the_rows_a_filter_cut_are_shaded_bucket_by_bucket() -> None:
    """被筛掉的那些行逐桶标出来：只报一个总数看不出这一刀砍在哪一头。

    ⚠ 三行落在轴上（1 / 5 / 9），`>=5` 只砍掉最左那一行——丢弃段整段照搬桶高
    的话，这张图会把留下的两行也画成丢弃。
    """
    column = blocks_of(
        "filter_rows", gapped(), column=FIRST, op="gte", value=5.0
    )["bins"].payload["by_column"][0]
    assert sum(column["bins"]) == 3.0
    assert sum(column["dropped"]) == 1.0
    assert column["dropped"][0] == 1.0
    assert column["dropped"][-1] == 0.0


def test_a_judge_that_keeps_only_blanks_shades_every_bucket_on_the_axis() -> (
    None
):
    """空值档留下的全在轴外，故轴上那三行整个是丢弃段。"""
    column = blocks_of("filter_rows", gapped(), column=FIRST, op="is_blank")[
        "bins"
    ].payload["by_column"][0]
    assert sum(column["dropped"]) == 3.0
    assert column["dropped"][0] == 1.0
    assert column["dropped"][-1] == 1.0


def test_the_threshold_gets_a_line_on_the_histogram() -> None:
    """比较档在阈值处钉一条线，空值档一条都不钉——那一档不看比较值。"""
    compared = blocks_of(
        "filter_rows", gapped(), column=FIRST, op="gte", value=5.0
    )["bins"]
    judged = blocks_of("filter_rows", gapped(), column=FIRST, op="not_blank")[
        "bins"
    ]
    assert compared.payload["by_column"][0]["marks"] == [
        {"at": 5.0, "label": "阈值", "intent": "danger"}
    ]
    assert judged.payload["by_column"][0]["marks"] == []


def test_a_non_numeric_judge_column_gets_no_histogram_at_all() -> None:
    """文本列画不出分布，那一块整个不讲——空图会被读成「这一列全是空」。"""
    frame = framed(((1.0, "a"), (2.0, None)))
    kinds = [
        block.kind
        for block in report_of(
            "filter_rows", frame, column=SECOND, op="not_blank"
        )
    ]
    assert kinds == ["rows"]


def test_filtering_a_wide_frame_still_fits_the_report_budget() -> None:
    """60 列宽帧、两万行、四十个桶：讲解装得下。"""
    frame = wide(dtype="number", cell=1.0, rows=WIDE_ROWS)
    rows = tuple(
        tuple(float(seat % 997) for _ in range(WIDE_COLUMNS))
        for seat in range(WIDE_ROWS)
    )
    frame = Frame(columns=frame.columns, rows=rows)
    size = fitted_size(
        "filter_rows", frame, column=frame.keys[0], op="gte", value=1.0
    )
    assert size < REPORT_MAX_BYTES


def test_a_filter_that_never_ran_says_nothing() -> None:
    """没跑过就一块都不讲。"""
    operator, _ = registry.build("filter_rows", {"column": FIRST})
    assert operator.report() == ()


def test_a_drop_that_never_ran_says_nothing() -> None:
    """没跑过就一块都不讲。"""
    operator, _ = registry.build("drop_missing", {})
    assert operator.report() == ()


def test_every_cleaning_operator_says_something_in_the_first_zone() -> None:
    """三个算子都必须产出至少一块 step 区的块——那是「这一步做了什么」。"""
    made = (
        report_of("cast_type", framed(((1.0, "1"),)), columns=[SECOND]),
        report_of("drop_missing", holed(), axis="row"),
        report_of("drop_missing", leaky(), axis="col"),
        report_of("filter_rows", gapped(), column=FIRST, op="not_blank"),
    )
    assert all(any(block.zone == "step" for block in blocks) for blocks in made)
