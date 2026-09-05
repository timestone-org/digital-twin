"""标准化与独热编码的结果面：逐列尺度、缩放前分布、类目命中与逐列类目账。

⚠ 这一份反复验的是两处会把锅算错的地方：尺度只在训练行上学（所以整帧均值不会
是 0），以及「一个类目都没命中」要分成未见过与本来就空两项
（docs/MODELING_RESULT_VIEW_DESIGN.md §11 的 R-13）。
"""

from typing import Any

import pytest

from platform_server.apps.modeling.operators import (
    CellValue,
    Frame,
    FrameColumn,
    registry,
)
from platform_server.apps.modeling.operators.featureblocks import (
    MEAN_NOTE,
    MISS_NOTE,
    SKIPPED_SCALE_REASON,
    UNIT_NOTE,
)
from platform_server.apps.modeling.operators.fitting import (
    PLAN_METHOD,
    PLAN_RANDOM_STATE,
    PLAN_TARGET,
    PLAN_TEST_RATIO,
)
from platform_server.apps.modeling.operators.reporting import ReportBlock
from platform_server.apps.modeling.services import report_budget
from platform_server.apps.modeling.services.preview import REPORT_MAX_BYTES

KEY = "温度"
OTHER = "负荷"
TEXT_KEY = "色"
# 最坏负载：60 列宽帧 × 366 天逐时；类目列按每列上限 20 个类目
WIDE_COLUMNS = 60
YEAR_ROWS = 366 * 24
MAX_CATEGORIES = 20
# √2 与 √5：总体口径标准差在 [1..5] 与 [0,2,4,6] 上的取值
ROOT_TWO = 2**0.5
ROOT_FIVE = 5**0.5


def frame_of(
    columns: dict[str, list[float | None]],
    *,
    units: dict[str, str] | None = None,
) -> Frame:
    """按列造一份数值帧，列序即给定的顺序。

    Args: columns, units（按列 key 挂单位）。
    """
    keys = list(columns)
    height = len(columns[keys[0]])
    worn = units or {}
    rows: tuple[tuple[CellValue, ...], ...] = tuple(
        tuple(columns[key][index] for key in keys) for index in range(height)
    )
    return Frame(
        columns=tuple(
            FrameColumn(
                key=key, name=key, dtype="number", unit=worn.get(key, "")
            )
            for key in keys
        ),
        rows=rows,
    )


def text_frame(columns: dict[str, list[str | None]]) -> Frame:
    """按列造一份文本帧，列序即给定的顺序。

    Args: columns。
    """
    keys = list(columns)
    height = len(columns[keys[0]])
    rows: tuple[tuple[CellValue, ...], ...] = tuple(
        tuple(columns[key][index] for key in keys) for index in range(height)
    )
    return Frame(
        columns=tuple(
            FrameColumn(key=key, name=key, dtype="string") for key in keys
        ),
        rows=rows,
    )


def half_split(target: str = OTHER) -> dict[str, Any]:
    """按时序对半切的切分计划：前一半进训练集。

    Args: target。
    """
    return {
        PLAN_TARGET: target,
        PLAN_METHOD: "time_order",
        PLAN_TEST_RATIO: 0.5,
        PLAN_RANDOM_STATE: 0,
    }


def run_of(
    code: str,
    frame: Frame,
    *,
    plan: dict[str, Any] | None = None,
    **config: Any,
) -> tuple[Frame, dict[str, ReportBlock]]:
    """跑一遍算子，回它的输出帧与按种类归好的讲解。

    Args: code, frame, plan, config。
    """
    operator, _ = registry.build(code, config)
    operator.bind_runtime(tz_offset_minutes=480, split_plan=plan)
    produced = operator.run({"frame": frame})["frame"]
    assert isinstance(produced, Frame)
    return produced, {block.kind: block for block in operator.report()}


def blocks_of(
    code: str,
    frame: Frame,
    *,
    plan: dict[str, Any] | None = None,
    **config: Any,
) -> dict[str, ReportBlock]:
    """只要讲解那一半。

    Args: code, frame, plan, config。
    """
    return run_of(code, frame, plan=plan, **config)[1]


def params_of(blocks: dict[str, ReportBlock], key: str) -> dict[str, Any]:
    """逐列表里某一列那一行的参数。

    Args: blocks, key。
    """
    rows: list[dict[str, Any]] = blocks["fits"].payload["by_column"]
    return next(row["params"] for row in rows if row["key"] == key)


def reason_of(blocks: dict[str, ReportBlock], key: str) -> str:
    """逐列表里某一列那一行的跳过理由。

    Args: blocks, key。
    """
    rows: list[dict[str, Any]] = blocks["fits"].payload["by_column"]
    return next(row["skipped_reason"] for row in rows if row["key"] == key)


def items_of(blocks: dict[str, ReportBlock]) -> list[dict[str, Any]]:
    """按项那一组数里的每一条。

    Args: blocks。
    """
    listed: list[dict[str, Any]] = blocks["breakdown"].payload["items"]
    return listed


def item_of(blocks: dict[str, ReportBlock], name: str) -> dict[str, Any]:
    """按项那一组数里叫这个名字的那一条。

    Args: blocks, name。
    """
    return next(item for item in items_of(blocks) if item["name"] == name)


def marks_of(blocks: dict[str, ReportBlock], key: str) -> list[dict[str, Any]]:
    """分布图里某一列的那几条参考线。

    Args: blocks, key。
    """
    listed: list[dict[str, Any]] = blocks["bins"].payload["by_column"]
    found = next(column for column in listed if column["key"] == key)
    marks: list[dict[str, Any]] = found["marks"]
    return marks


def wide_numbers() -> Frame:
    """最坏负载：60 列 × 366 天逐时，逐列跨度与空格分布各不相同。"""
    return frame_of(
        {
            f"很长的列名字第{index}列": [
                (
                    None
                    if (row + index) % 41 == 0
                    else float((row % 97) * (index + 1)) + 0.123456789
                )
                for row in range(YEAR_ROWS)
            ]
            for index in range(WIDE_COLUMNS)
        }
    )


def wide_categories(columns: int, categories: int) -> Frame:
    """最坏负载：若干类目列，每列这么多个长名字类目。

    Args: columns, categories。
    """
    return text_frame(
        {
            f"类目列第{index}列": [
                f"名字长一点的类目第{(row + index) % categories}个"
                for row in range(YEAR_ROWS)
            ]
            for index in range(columns)
        }
    )


def test_a_standardize_that_never_ran_says_nothing() -> None:
    """没跑过就一块都不讲——空壳会让界面摆出一片空白的分区。"""
    operator, _ = registry.build("standardize", {})
    assert operator.report() == ()


def test_the_scale_table_carries_the_center_and_the_span() -> None:
    """[1..5] 外加一个空格：μ=3、σ=√2，拟合样本是 5 个而不是 6 行。"""
    blocks = blocks_of(
        "standardize", frame_of({KEY: [1.0, 2.0, 3.0, 4.0, 5.0, None]})
    )
    params = params_of(blocks, KEY)
    assert params["center"] == 3.0
    assert params["scale"] == pytest.approx(ROOT_TWO)
    assert params["fit_rows"] == 5
    assert blocks["fits"].payload["total_rows"] == 6
    assert params["before_min"] == 1.0
    assert params["before_p50"] == 3.0
    assert params["before_max"] == 5.0
    assert params["after_min"] == pytest.approx(-2.0 / ROOT_TWO)
    assert params["after_mean"] == pytest.approx(0.0)
    assert blocks["fits"].payload["method"] == "zscore"


def test_the_scale_comes_from_the_training_rows_only() -> None:
    """训练段 [0,2,4,6] 上 μ=3、σ=√5，整帧均值却是 51.5——印的是训练段那份。"""
    values = [0.0, 2.0, 4.0, 6.0, 100.0, 100.0, 100.0, 100.0]
    blocks = blocks_of(
        "standardize",
        frame_of({KEY: values, OTHER: [1.0] * 8}),
        plan=half_split(),
        columns=[KEY],
    )
    params = params_of(blocks, KEY)
    assert params["center"] == 3.0
    assert params["scale"] == pytest.approx(ROOT_FIVE)
    assert params["fit_rows"] == 4
    assert params["before_mean"] == 51.5
    assert params["after_mean"] == pytest.approx((51.5 - 3.0) / ROOT_FIVE)
    assert blocks["fits"].payload["train_rows"] == 4
    assert blocks["fits"].payload["total_rows"] == 8


def test_the_step_block_says_the_mean_will_not_be_zero() -> None:
    """μ 只在训练行上学这条口径必须随讲解一起给，不然会被当成没生效。"""
    blocks = blocks_of("standardize", frame_of({KEY: [1.0, 2.0, 3.0]}))
    assert MEAN_NOTE in blocks["cells"].payload["notes"]


def test_a_standardized_column_drops_the_unit_it_used_to_wear() -> None:
    """z 分数没有量纲：缩放过的那列清掉单位，没缩放的那列原样留着。"""
    frame = frame_of(
        {KEY: [1.0, 2.0, 3.0], OTHER: [4.0, 5.0, 6.0]},
        units={KEY: "℃", OTHER: "kW"},
    )
    produced, _ = run_of("standardize", frame, columns=[KEY])
    assert produced.column_of(KEY).unit == ""
    assert produced.column_of(OTHER).unit == "kW"
    assert frame.column_of(KEY).unit == "℃"


def test_the_unit_note_shows_up_when_any_scaled_column_wore_one() -> None:
    """两列一起缩放、只有一列带着单位：这句口径照说。"""
    frame = frame_of(
        {KEY: [1.0, 2.0, 3.0], OTHER: [4.0, 5.0, 6.0]}, units={KEY: "℃"}
    )
    blocks = blocks_of("standardize", frame)
    assert UNIT_NOTE in blocks["cells"].payload["notes"]


def test_the_unit_note_stays_away_when_no_column_wore_one() -> None:
    """原本就没单位时不说这句废话——每一句都占用户一行注意力。"""
    blocks = blocks_of("standardize", frame_of({KEY: [1.0, 2.0, 3.0]}))
    assert blocks["cells"].payload["notes"] == [MEAN_NOTE]


def test_the_cells_block_counts_the_numbers_it_replaced() -> None:
    """换得多的列排前面：满的那列换 5 个数，空一格的那列 4 个。"""
    blocks = blocks_of(
        "standardize",
        frame_of(
            {
                KEY: [1.0, 2.0, None, 4.0, 8.0],
                OTHER: [1.0, 2.0, 3.0, 4.0, 5.0],
            }
        ),
    )
    changed: list[dict[str, Any]] = blocks["cells"].payload["by_column"]
    assert [row["key"] for row in changed] == [OTHER, KEY]
    assert [row["changed"] for row in changed] == [5, 4]
    assert changed[1]["samples"] == [1.0, 2.0, 4.0]


def test_a_column_that_is_not_a_number_reports_no_points_at_all() -> None:
    """算不出来的四个点给 `None`：NaN 落进讲解会写出不合法的 JSON。"""
    blocks = blocks_of(
        "standardize", frame_of({KEY: [float("nan"), float("nan")]})
    )
    params = params_of(blocks, KEY)
    assert params["before_min"] is None
    assert params["before_p50"] is None
    assert params["before_mean"] is None
    assert params["before_max"] is None


def test_a_one_hot_with_no_columns_says_it_encoded_nothing() -> None:
    """一列都没配的独热是个空转的节点，讲解要照实说，不能一声不吭。"""
    blocks = blocks_of("one_hot", text_frame({TEXT_KEY: ["红", "蓝"]}))
    assert blocks["columns"].payload["added"] == []
    assert blocks["columns"].payload["reason"] == "0 列编成 0 个 0/1 列"
    assert items_of(blocks) == []


def test_a_skipped_constant_column_keeps_its_row_and_says_why() -> None:
    """常量列按配置放过：这一列照进尺度表，尺度那两栏空着并写明原因。"""
    frame = frame_of({KEY: [7.0, 7.0, 7.0], OTHER: [1.0, 2.0, 3.0]})
    blocks = blocks_of("standardize", frame, on_constant_column="skip")
    assert params_of(blocks, KEY)["center"] is None
    assert params_of(blocks, KEY)["scale"] is None
    assert params_of(blocks, KEY)["fit_rows"] == 3
    assert reason_of(blocks, KEY) == SKIPPED_SCALE_REASON
    assert reason_of(blocks, OTHER) == ""
    assert [row["key"] for row in blocks["cells"].payload["by_column"]] == [
        OTHER
    ]


def test_the_zscore_lines_stand_one_sigma_apart() -> None:
    """[1..5] 上三条线落在 3−√2、3、3+√2。"""
    blocks = blocks_of(
        "standardize", frame_of({KEY: [1.0, 2.0, 3.0, 4.0, 5.0]})
    )
    marks = marks_of(blocks, KEY)
    assert [mark["at"] for mark in marks] == pytest.approx(
        [3.0 - ROOT_TWO, 3.0, 3.0 + ROOT_TWO]
    )
    assert marks[1]["label"] == "z = 0（μ）"


def test_the_minmax_lines_stand_where_zero_and_one_land() -> None:
    """[10,20,30,40] 压到 0~1：两条线落在 10 与 40。"""
    blocks = blocks_of(
        "standardize",
        frame_of({KEY: [10.0, 20.0, 30.0, 40.0]}),
        method="minmax",
    )
    marks = marks_of(blocks, KEY)
    assert [mark["at"] for mark in marks] == [10.0, 40.0]
    assert [mark["label"] for mark in marks] == ["压到 0", "压到 1"]


def test_the_widest_column_leads_the_distribution_charts() -> None:
    """跨度大的列排前面：画得下的那几张是量级最悬殊的那几列。"""
    blocks = blocks_of(
        "standardize",
        frame_of(
            {
                "A 窄": [1.0, 2.0, 3.0],
                "Z 宽": [0.0, 500.0, 1000.0],
            }
        ),
    )
    listed: list[dict[str, Any]] = blocks["bins"].payload["by_column"]
    assert [column["key"] for column in listed] == ["Z 宽", "A 窄"]


def test_the_distribution_chart_is_the_one_that_goes_first() -> None:
    """分布图是辅图：超预算时它先走，逐列尺度表最后丢。"""
    blocks = blocks_of("standardize", frame_of({KEY: [1.0, 2.0, 3.0]}))
    assert blocks["bins"].payload["is_primary"] is False
    assert "is_primary" not in blocks["fits"].payload


def test_the_worst_standardize_load_still_fits_the_report_budget() -> None:
    """60 列宽帧 × 366 天逐时：讲解装得下，一块都不用降档丢掉。"""
    operator, _ = registry.build("standardize", {})
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    operator.run({"frame": wide_numbers()})
    report = report_budget.fit_report(operator.report())
    assert report is not None
    assert report["dropped"] == []
    assert report_budget.size_of(report) < REPORT_MAX_BYTES


def test_the_worst_standardize_load_keeps_the_tables_within_their_caps() -> (
    None
):
    """60 列全进尺度表、只有 8 列进分布图、格子账最多 12 列。"""
    blocks = blocks_of("standardize", wide_numbers())
    assert len(blocks["fits"].payload["by_column"]) == WIDE_COLUMNS
    assert len(blocks["bins"].payload["by_column"]) == 8
    assert len(blocks["cells"].payload["by_column"]) == 12


def test_a_one_hot_that_never_ran_says_nothing() -> None:
    """没跑过就一块都不讲。"""
    operator, _ = registry.build("one_hot", {})
    assert operator.report() == ()


def test_the_category_hits_are_counted_on_the_whole_frame() -> None:
    """类目在训练段定、命中却在整帧上数：红在训练段见 2 次，整帧命中 3 行。"""
    frame = text_frame(
        {TEXT_KEY: ["红", "红", "蓝", "蓝", "红", "绿", "绿", None]}
    )
    blocks = blocks_of(
        "one_hot",
        frame,
        plan=half_split(TEXT_KEY),
        columns=[TEXT_KEY],
    )
    red = item_of(blocks, f"{TEXT_KEY}=红")
    assert red["value"] == 3
    assert red["fit_count"] == 2
    assert red["kept"] is True
    assert red["position"] == 0
    assert red["ratio"] == 0.375


def test_the_two_kinds_of_miss_are_reported_apart() -> None:
    """未见过的类目 2 行、本来就空的 1 行——合成一笔账会把锅算错。"""
    frame = text_frame(
        {TEXT_KEY: ["红", "红", "蓝", "蓝", "红", "绿", "绿", None]}
    )
    blocks = blocks_of(
        "one_hot", frame, plan=half_split(TEXT_KEY), columns=[TEXT_KEY]
    )
    params = params_of(blocks, TEXT_KEY)
    assert params["hit_rows"] == 5
    assert params["unseen_rows"] == 2
    assert params["blank_rows"] == 1
    assert params["unseen_ratio"] == 0.25
    assert params["blank_ratio"] == 0.125
    assert MISS_NOTE in blocks["fits"].payload["notes"]


def test_the_cut_categories_stay_in_the_ranking_marked_as_dropped() -> None:
    """keep_top 砍掉的那个类目照排在后面：留没留下与编码位分开写。"""
    frame = text_frame({TEXT_KEY: ["红"] * 3 + ["蓝"] * 2 + ["绿"]})
    blocks = blocks_of(
        "one_hot",
        frame,
        columns=[TEXT_KEY],
        max_categories=2,
        on_many_categories="keep_top",
    )
    assert [item["name"] for item in items_of(blocks)] == [
        f"{TEXT_KEY}=红",
        f"{TEXT_KEY}=蓝",
        f"{TEXT_KEY}=绿",
    ]
    green = item_of(blocks, f"{TEXT_KEY}=绿")
    assert green["kept"] is False
    assert green["position"] is None
    assert green["fit_count"] == 1
    params = params_of(blocks, TEXT_KEY)
    assert params["categories"] == 3
    assert params["kept"] == 2
    assert params["cut"] == 1
    assert params["unseen_rows"] == 1


def test_the_column_diff_names_what_got_encoded() -> None:
    """原列去掉、编出来两列，列名与帧上真正造出来的那两列逐字相同。"""
    frame = text_frame({TEXT_KEY: ["红", "红", "蓝"]})
    produced, blocks = run_of("one_hot", frame, columns=[TEXT_KEY])
    change = blocks["columns"].payload
    assert change["added"] == [f"{TEXT_KEY}=红", f"{TEXT_KEY}=蓝"]
    assert change["removed"] == [TEXT_KEY]
    assert change["kept"] == 2
    assert list(produced.keys) == change["added"]


def test_the_worst_one_hot_load_still_fits_the_report_budget() -> None:
    """3 列 × 每列 20 个类目 × 366 天逐时：讲解装得下，一块都不用丢。"""
    operator, _ = registry.build(
        "one_hot",
        {
            "columns": [f"类目列第{index}列" for index in range(3)],
            "max_categories": MAX_CATEGORIES,
        },
    )
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    operator.run({"frame": wide_categories(3, MAX_CATEGORIES)})
    report = report_budget.fit_report(operator.report())
    assert report is not None
    assert report["dropped"] == []
    assert report_budget.size_of(report) < REPORT_MAX_BYTES


def test_the_one_hot_ranking_stops_at_sixty_items() -> None:
    """4 列 × 20 个类目 = 80 条，排行截到 60 条，逐列账仍是 4 行。"""
    blocks = blocks_of(
        "one_hot",
        wide_categories(4, MAX_CATEGORIES),
        columns=[f"类目列第{index}列" for index in range(4)],
        max_categories=MAX_CATEGORIES,
    )
    assert len(items_of(blocks)) == 60
    assert len(blocks["fits"].payload["by_column"]) == 4


def test_each_of_the_three_puts_something_in_the_first_zone() -> None:
    """三个算子各至少讲一句「这一步做了什么」——那一区空着就只剩裸骨架。"""
    numbers = frame_of({KEY: [1.0, 2.0, 3.0], OTHER: [4.0, 5.0, 7.0]})
    zones = {
        "standardize": blocks_of("standardize", numbers),
        "select_feature": blocks_of("select_feature", numbers, top_k=1),
        "one_hot": blocks_of(
            "one_hot",
            text_frame({TEXT_KEY: ["红", "红", "蓝"]}),
            columns=[TEXT_KEY],
        ),
    }
    for blocks in zones.values():
        assert "step" in {block.zone for block in blocks.values()}


def test_a_replayed_standardize_reports_nothing() -> None:
    """回灌参数的那一趟没有学到任何东西，讲解只属于训练那一次。"""
    frame = frame_of({KEY: [1.0, 2.0, 3.0]})
    operator, _ = registry.build("standardize", {})
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    operator.run({"frame": frame})
    replayed, _ = registry.build("standardize", {})
    replayed.bind_runtime(tz_offset_minutes=480, split_plan=None)
    replayed.load_fitted(operator.dump_fitted() or {})
    replayed.run({"frame": frame})
    assert operator.report() != ()
    assert replayed.report() == ()
