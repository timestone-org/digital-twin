"""切分的结果面：比例账、两段时间跨度、目标列分布、每列空值率两侧对比。

⚠ 这一组反复验的是「测试段是不是真的在训练段之后」——界面上今天只有两张表，
这个最要紧的问题一个字都没有（docs/MODELING_RESULT_VIEW_DESIGN.md §5-16）。
⚠ 两路的出处一字不差（`select_rows` 不动 provenance），所以那句话必须由后端
明说，否则用户会以为两个端口取的是两段数据。
"""

from typing import Any

from platform_server.apps.modeling.operators import (
    CellValue,
    Frame,
    FrameColumn,
    Provenance,
    registry,
)
from platform_server.apps.modeling.operators.model import (
    NO_INDEX_NOTE,
    OVERLAP_NOTE,
    RANDOM_LEAK_NOTE,
    SAME_PROVENANCE_NOTE,
    TEST_SERIES,
    TONE_SHUFFLED,
    TRAIN_SERIES,
)
from platform_server.apps.modeling.operators.reporting import ReportBlock
from platform_server.apps.modeling.services import report_budget
from platform_server.apps.modeling.services.preview import REPORT_MAX_BYTES
from unit.modeling_fakes import START_MS, STEP_MS, hints_of

TARGET = "能耗"
FEATURE = "温度"
SPARSE = "湿度"
EVENLY_SPARSE = "风速"
# 最坏负载：60 列宽帧 × 366 天逐时
WIDE_COLUMNS = 60
YEAR_ROWS = 366 * 24
# 十行按 5% 切：向下取整是 0，夹到 1 行，于是实到 10%
TEN_ROWS = 10
TINY_RATIO = 0.05


def frame_of(
    columns: dict[str, list[float | None]], *, has_index: bool = True
) -> Frame:
    """按列造一份带时间索引的数值帧。

    Args: columns, has_index。
    """
    keys = list(columns)
    height = len(columns[keys[0]])
    rows: tuple[tuple[CellValue, ...], ...] = tuple(
        tuple(columns[key][seat] for key in keys) for seat in range(height)
    )
    return Frame(
        columns=tuple(
            FrameColumn(key=key, name=key, dtype="number") for key in keys
        ),
        rows=rows,
        index=(
            tuple(START_MS + seat * STEP_MS for seat in range(height))
            if has_index
            else None
        ),
        provenance=Provenance(table_codes=("energy_h",)),
    )


def blocks_of(frame: Frame, **config: Any) -> dict[str, ReportBlock]:
    """跑一遍切分并把讲解按块种类归好。

    Args: frame, config。
    """
    operator, _ = registry.build(
        "split_dataset", {"target_column": TARGET, **config}
    )
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    operator.run({"frame": frame})
    return {block.kind: block for block in operator.report()}


def notes_of(block: ReportBlock) -> list[str]:
    """一块上收进小问号的那几句口径说明。

    Args: block。
    """
    return hints_of(block)


def ten_rows() -> Frame:
    """十行两列，目标列逐行加一。"""
    return frame_of(
        {
            FEATURE: [float(seat) for seat in range(TEN_ROWS)],
            TARGET: [float(seat) * 2 for seat in range(TEN_ROWS)],
        }
    )


def wide_frame() -> Frame:
    """60 列 × 366 天逐时，最后一列当目标列。"""
    columns: dict[str, list[float | None]] = {
        f"列{seat}": [float(row % 97) for row in range(YEAR_ROWS)]
        for seat in range(WIDE_COLUMNS - 1)
    }
    columns[TARGET] = [float(row % 31) for row in range(YEAR_ROWS)]
    return frame_of(columns)


def test_the_split_reports_the_ratio_it_actually_gave() -> None:
    """配 5% 而只有十行时实到 10%：向下取整再夹到至少一行。"""
    payload = blocks_of(ten_rows(), test_ratio=TINY_RATIO)["rows"].payload
    assert payload["before"] == TEN_ROWS
    assert payload["after"] == TEN_ROWS
    assert payload["ratio_configured"] == TINY_RATIO
    assert payload["ratio_actual"] == 0.1


def test_the_split_funnel_counts_both_sides() -> None:
    """漏斗三级：切分前十行、训练九行、测试一行。"""
    blocks = blocks_of(ten_rows(), test_ratio=TINY_RATIO)
    funnel: Any = blocks["rows"].payload["funnel"]
    assert [stage["name"] for stage in funnel] == [
        "切分前",
        TRAIN_SERIES,
        TEST_SERIES,
    ]
    assert [stage["value"] for stage in funnel] == [TEN_ROWS, 9, 1]


def test_the_split_spells_out_both_ratios_when_they_differ() -> None:
    """配的与实到的都印出来：只印一个，用户会以为自己配错了。"""
    notes = notes_of(blocks_of(ten_rows(), test_ratio=TINY_RATIO)["rows"])
    ratio_note = next(note for note in notes if "配的是" in note)
    assert "5.0%" in ratio_note
    assert "10.0%" in ratio_note
    assert "1 行" in ratio_note


def test_the_split_keeps_quiet_when_the_ratio_landed_where_it_was_asked() -> (
    None
):
    """十行切两成正好是两行：没有出入就不摆那句话。"""
    notes = notes_of(blocks_of(ten_rows(), test_ratio=0.2)["rows"])
    assert not [note for note in notes if "配的是" in note]


def test_the_split_says_the_two_ports_share_one_provenance() -> None:
    """两路的出处一字不差，那句话必须由后端明说。"""
    assert SAME_PROVENANCE_NOTE in notes_of(blocks_of(ten_rows())["rows"])


def test_the_time_ordered_split_puts_the_test_band_after_the_train_band() -> (
    None
):
    """时序切分：训练段整段在前，测试段整段在后，两段不重叠。"""
    payload = blocks_of(ten_rows(), test_ratio=TINY_RATIO)["axis"].payload
    segments: Any = payload["segments"]
    train, test = segments[0], segments[1]
    assert train["label"] == TRAIN_SERIES
    assert train["rows"] == 9
    assert test["rows"] == 1
    assert train["until"] == START_MS + 8 * STEP_MS
    assert test["since"] == START_MS + 9 * STEP_MS
    assert train["until"] < test["since"]


def test_the_time_ordered_split_names_the_first_test_moment() -> None:
    """那句话里带着测试段最早的一行，用户照它去缩取数范围。"""
    notes = notes_of(blocks_of(ten_rows(), test_ratio=TINY_RATIO)["axis"])
    assert len(notes) == 1
    assert notes[0].startswith("测试段整段在训练段之后")
    assert "2025-08-05T17:00:00+00:00" in notes[0]


def test_the_random_split_paints_both_bands_as_shuffled() -> None:
    """随机切分下两段完全交错：两段都标成打乱，并明说泄漏。"""
    blocks = blocks_of(ten_rows(), method="random", test_ratio=0.3)
    payload = blocks["axis"].payload
    segments: Any = payload["segments"]
    assert [segment["tone"] for segment in segments] == [
        TONE_SHUFFLED,
        TONE_SHUFFLED,
    ]
    assert notes_of(blocks_of(ten_rows(), method="random")["axis"]) == [
        RANDOM_LEAK_NOTE
    ]


def test_the_split_warns_when_the_two_bands_overlap_in_time() -> None:
    """行序被上游打乱过时，时序切法也会切出重叠的两段。"""
    shuffled = frame_of(
        {
            FEATURE: [float(seat) for seat in range(4)],
            TARGET: [1.0, 2.0, 3.0, 4.0],
        }
    )
    reordered = Frame(
        columns=shuffled.columns,
        rows=shuffled.rows,
        index=(START_MS + 3 * STEP_MS, START_MS, START_MS + STEP_MS, START_MS),
        provenance=shuffled.provenance,
    )
    assert notes_of(blocks_of(reordered, test_ratio=0.5)["axis"]) == [
        OVERLAP_NOTE
    ]


def test_the_split_without_a_time_index_says_so_and_draws_no_band() -> None:
    """没有时间索引时不画时间带，也不假装两段有先后。"""
    blocks = blocks_of(
        frame_of(
            {
                FEATURE: [float(seat) for seat in range(TEN_ROWS)],
                TARGET: [float(seat) for seat in range(TEN_ROWS)],
            },
            has_index=False,
        )
    )
    assert "axis" not in blocks
    assert NO_INDEX_NOTE in notes_of(blocks["rows"])


def test_the_target_histogram_puts_both_sides_on_one_axis() -> None:
    """两路共用整列的轴：各按各的跨度分桶的话，两张图量的不是同一段。"""
    values = [float(seat) for seat in range(9)] + [100.0]
    blocks = blocks_of(
        frame_of({FEATURE: [1.0] * TEN_ROWS, TARGET: values}),
        test_ratio=TINY_RATIO,
    )
    by_column: Any = blocks["bins"].payload["by_column"]
    train, test = by_column[0], by_column[1]
    assert [train["key"], test["key"]] == [TRAIN_SERIES, TEST_SERIES]
    assert train["low"] == test["low"] == 0.0
    assert train["high"] == test["high"] == 100.0
    assert sum(train["bins"]) == 9
    assert test["bins"][-1] == 1


def test_the_null_ratios_rank_the_column_only_one_side_has() -> None:
    """两侧差得最远的列排最前：那正是「上线后整列是空」的来源。

    ⚠ 两侧一样空的列排在后面：它到处都缺，不是切分切出来的问题。
    """
    blocks = blocks_of(
        frame_of(
            {
                FEATURE: [1.0] * TEN_ROWS,
                SPARSE: [1.0] * 5 + [None] * 5,
                EVENLY_SPARSE: [None] + [1.0] * 4 + [None] + [1.0] * 4,
                TARGET: [float(seat) for seat in range(TEN_ROWS)],
            }
        ),
        test_ratio=0.5,
    )
    items: Any = blocks["breakdown"].payload["items"]
    assert [item["name"] for item in items] == [SPARSE, EVENLY_SPARSE]
    assert items[0]["before"] == 0.0
    assert items[0]["after"] == 1.0
    assert items[0]["value"] == items[0]["after"]
    assert items[1]["before"] == items[1]["after"] == 0.2


def test_the_split_leaves_the_time_band_as_the_main_picture() -> None:
    """时间带是主体图，分布与空值率是辅图：超预算时辅图先走。"""
    blocks = blocks_of(
        frame_of(
            {
                FEATURE: [1.0] * TEN_ROWS,
                SPARSE: [1.0] * 5 + [None] * 5,
                TARGET: [float(seat) for seat in range(TEN_ROWS)],
            }
        ),
        test_ratio=0.5,
    )
    assert blocks["axis"].payload["is_primary"] is True
    assert blocks["bins"].payload["is_primary"] is False
    assert blocks["breakdown"].payload["is_primary"] is False


def test_the_split_skips_the_target_chart_when_that_column_is_all_empty() -> (
    None
):
    """目标列整列是空时不画分布：一排零高的柱子说明不了任何事。"""
    blocks = blocks_of(
        frame_of(
            {
                FEATURE: [1.0] * TEN_ROWS,
                TARGET: [None] * TEN_ROWS,
            }
        ),
        test_ratio=0.5,
    )
    assert "bins" not in blocks
    assert "rows" in blocks


def test_the_split_skips_the_null_chart_when_nothing_is_missing() -> None:
    """一个空值都没有时不摆那张图：全零的两排条子说明不了任何事。"""
    assert "breakdown" not in blocks_of(ten_rows())


def test_the_worst_split_load_still_fits_the_report_budget() -> None:
    """60 列宽帧 × 366 天逐时：讲解装得下，一块都不用降档丢掉。"""
    operator, _ = registry.build(
        "split_dataset", {"target_column": TARGET, "test_ratio": 0.2}
    )
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    operator.run({"frame": wide_frame()})
    report = report_budget.fit_report(operator.report())
    assert report is not None
    assert report["dropped"] == []
    assert report_budget.size_of(report) < REPORT_MAX_BYTES


def test_the_split_report_is_empty_before_it_has_run() -> None:
    """没跑过就没有话讲：空壳块会让旧运行的弹窗出现一片白。"""
    operator, _ = registry.build("split_dataset", {"target_column": TARGET})
    assert operator.report() == ()
