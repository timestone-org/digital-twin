"""块构造函数的用例：八种块各自的形状与硬上限。

⚠ 上限逐个钉：算子侧只调这些构造函数，手拼字典的那一份不会被截断，而超出的
字节要到落库那一刻才被预算静默削掉（docs/MODELING_RESULT_VIEW_DESIGN.md §4.3）。
"""

from typing import Any

from platform_server.apps.modeling.operators import reporting
from platform_server.apps.modeling.operators.reporting import (
    BLOCK_KINDS,
    NOTE_ALERT,
    NOTE_HINT,
    TIER_LARGE,
    ZONES,
    BlockAt,
    CellChange,
    ColumnBins,
    ColumnChange,
    ModelStructure,
    Pdp,
    RowCounts,
    Scale,
    TimeAxis,
)


def at(zone: Any = "step") -> BlockAt:
    """一个摆位。

    Args: zone。
    """
    return BlockAt(zone=zone, title="标题", port="frame", tier=TIER_LARGE)


def items(count: int) -> list[dict[str, Any]]:
    """一串自由形状的明细。

    Args: count。
    """
    return [{"key": f"c{index}"} for index in range(count)]


def test_a_block_carries_the_placement_it_was_given() -> None:
    """摆位四样原样落在块上——写错了界面就把它摆到别的区去。"""
    block = reporting.rows_block(at(), RowCounts(before=10, after=8))
    assert (block.zone, block.port, block.title, block.tier) == (
        "step",
        "frame",
        "标题",
        TIER_LARGE,
    )
    assert block.kind == "rows"


def test_row_counts_keep_both_ratios_apart() -> None:
    """配的比例与实际达成的比例分开记：合成一个就再也追不出差在哪。"""
    counts = RowCounts(
        before=100,
        after=90,
        dropped=10,
        dropped_blank=4,
        ratio_configured=0.05,
        ratio_actual=0.1,
    )
    payload = reporting.rows_block(at(), counts).payload
    assert payload["ratio_configured"] == 0.05
    assert payload["ratio_actual"] == 0.1
    assert payload["dropped_blank"] == 4


def test_rows_caps_the_funnel_and_the_per_column_reasons() -> None:
    """漏斗与按列归因各自截到上限。"""
    payload = reporting.rows_block(
        at(),
        RowCounts(before=1, after=1),
        funnel=items(50),
        by_column=items(50),
    ).payload
    assert len(payload["funnel"]) == reporting.MAX_FUNNEL
    assert len(payload["by_column"]) == reporting.MAX_ROW_COLUMNS


def test_rows_records_how_many_levels_there_were_before_the_cut() -> None:
    """截断前的级数一起带上：界面据它说「后面还有几级没带出来」。

    ⚠ 光看明细分不出「一共就这么多级」与「截了」——两句话要用户做的事不同。
    """
    payload = reporting.rows_block(
        at(), RowCounts(before=1, after=1), funnel=items(9)
    ).payload
    assert (payload["funnel_total"], len(payload["funnel"])) == (9, 6)


def test_rows_says_the_funnel_is_whole_when_it_fits() -> None:
    """恰好摆满六级而没被截时，记的总数就是六——不是「还有更多」。"""
    payload = reporting.rows_block(
        at(), RowCounts(before=1, after=1), funnel=items(6)
    ).payload
    assert payload["funnel_total"] == 6


def test_columns_caps_both_name_lists_and_the_dtype_table() -> None:
    """多出来的与少掉的列名各截到上限，改过类型的那张表另有一档。"""
    change = ColumnChange(
        added=[f"a{index}" for index in range(200)],
        removed=[f"r{index}" for index in range(200)],
        kept=3,
        dtype_before=items(50),
        reason="独热展开",
    )
    payload = reporting.columns_block(at(), change).payload
    assert len(payload["added"]) == reporting.MAX_COLUMN_NAMES
    assert len(payload["removed"]) == reporting.MAX_COLUMN_NAMES
    assert len(payload["dtype_before"]) == reporting.MAX_DTYPE_BEFORE
    assert payload["reason"] == "独热展开"


def test_cells_caps_the_columns_and_the_samples_inside_each() -> None:
    """按列截一次，每列的原值样例再截一次——内层不截就白截了外层。"""
    changes = [
        CellChange(
            key=f"c{index}",
            changed=index,
            samples=[float(step) for step in range(20)],
        )
        for index in range(50)
    ]
    payload = reporting.cells_block(at(), changes).payload
    assert len(payload["by_column"]) == reporting.MAX_CELL_COLUMNS
    assert all(
        len(item["samples"]) == reporting.MAX_SAMPLES
        for item in payload["by_column"]
    )


def test_fits_keeps_train_rows_and_total_rows_apart() -> None:
    """训练行与总行分开：带拟合的算子只在训练行上学，两个数不一样才是对的。"""
    payload = reporting.fits_block(
        at(),
        method="mean",
        train_rows=160,
        total_rows=200,
        by_column=items(200),
    ).payload
    assert (payload["train_rows"], payload["total_rows"]) == (160, 200)
    assert len(payload["by_column"]) == reporting.MAX_FIT_COLUMNS


def test_bins_caps_the_columns_the_buckets_and_the_marks() -> None:
    """三层上限各自生效。"""
    by_column = [
        ColumnBins(
            key=f"c{index}",
            bins=[float(step) for step in range(100)],
            marks=items(20),
            off_axis={"label": "上界之外", "count": 3},
        )
        for index in range(30)
    ]
    payload = reporting.bins_block(at(), by_column).payload
    assert len(payload["by_column"]) == reporting.MAX_BIN_COLUMNS
    first = payload["by_column"][0]
    assert len(first["bins"]) == reporting.MAX_BINS
    assert len(first["marks"]) == reporting.MAX_MARKS
    assert first["off_axis"] == {"label": "上界之外", "count": 3}


def test_bins_carries_the_dropped_share_of_each_bucket() -> None:
    """逐桶被丢掉的行数与桶高同序带出去，并按同一个上限截。"""
    over = reporting.MAX_BINS + 5
    column = ColumnBins(
        key="c0",
        bins=[float(step) for step in range(over)],
        dropped=[1.0] * over,
    )
    first = reporting.bins_block(at(), [column]).payload["by_column"][0]
    assert first["dropped"] == [1.0] * reporting.MAX_BINS
    assert len(first["dropped"]) == len(first["bins"])


def test_bins_carries_the_normal_curve_when_the_column_has_one() -> None:
    """正态参考曲线的两个参数原样带出去；没有就是 None。"""
    with_curve = ColumnBins(key="c0", bins=[1.0], curve={"mean": 0.5, "sd": 2})
    payload = reporting.bins_block(at(), [with_curve, ColumnBins(key="c1")])
    assert payload.payload["by_column"][0]["curve"] == {"mean": 0.5, "sd": 2}
    assert payload.payload["by_column"][1]["curve"] is None


def test_bins_without_off_axis_says_none_instead_of_an_empty_shell() -> None:
    """没有落在轴外的就是 None：空壳会让界面画一个 0 根的柱子。"""
    payload = reporting.bins_block(at(), [ColumnBins(key="c0")]).payload
    assert payload["by_column"][0]["off_axis"] is None


def test_axis_caps_occupancy_gaps_and_segments() -> None:
    """占用率、缺口、区段三样各截到上限。"""
    axis = TimeAxis(
        bucket_ms=3_600_000,
        tz_offset_minutes=480,
        actual_since="2026-09-01T00:00:00Z",
        actual_until="2026-09-02T00:00:00Z",
        occupancy=[float(index) for index in range(500)],
        gaps=items(50),
        segments=items(50),
    )
    payload = reporting.axis_block(at(), axis).payload
    assert len(payload["occupancy"]) == reporting.MAX_OCCUPANCY
    assert len(payload["gaps"]) == reporting.MAX_GAPS
    assert len(payload["segments"]) == reporting.MAX_SEGMENTS
    assert payload["actual_since"] == "2026-09-01T00:00:00Z"


def test_breakdown_carries_its_own_scale_instead_of_the_metrics_dict() -> None:
    """按项的数自带口径与单位：塞进扁平的指标字典会被套上别人的阈值与单位。"""
    scale = Scale(label="ΔR²", unit="", score_kind="delta_r2", baseline=0.0)
    payload = reporting.breakdown_block(at(), scale, items(200)).payload
    assert payload["unit"] == ""
    assert payload["score_kind"] == "delta_r2"
    assert payload["baseline"] == 0.0
    assert len(payload["items"]) == reporting.MAX_ITEMS


def test_structure_caps_every_one_of_its_six_parts() -> None:
    """重要度、区间、树、部分依赖、载荷、解释方差六样各自截断。"""
    structure = ModelStructure(
        importances=items(200),
        ranges=items(200),
        tree={"depth": 3, "nodes": items(100)},
        pdp=[
            Pdp(
                key=f"c{index}",
                points=[[float(step), 1.0] for step in range(50)],
            )
            for index in range(30)
        ],
        loadings=[[float(col) for col in range(40)] for _ in range(40)],
        explained=[float(index) for index in range(50)],
    )
    payload = reporting.structure_block(at(), structure).payload
    assert len(payload["importances"]) == reporting.MAX_IMPORTANCES
    assert len(payload["ranges"]) == reporting.MAX_RANGES
    assert len(payload["tree"]["nodes"]) == reporting.MAX_TREE_NODES
    assert len(payload["pdp"]) == reporting.MAX_PDP
    assert len(payload["pdp"][0]["points"]) == reporting.MAX_PDP_POINTS
    assert len(payload["loadings"]) == reporting.MAX_LOADINGS
    assert len(payload["loadings"][0]) == reporting.MAX_LOADING_WIDTH
    assert len(payload["explained"]) == reporting.MAX_EXPLAINED


def test_structure_without_a_tree_says_none() -> None:
    """没有代表树就是 None，不是空字典。"""
    payload = reporting.structure_block(at(), ModelStructure()).payload
    assert payload["tree"] is None


def test_every_kind_in_the_roster_has_a_constructor() -> None:
    """花名册上的每一种都造得出来，且回的 kind 与花名册对得上。

    ⚠ 反过来也钉：构造函数造出一种花名册上没有的 kind 时，前端派发表查不到它，
    而 typecheck 与 lint 双双放行。
    """
    built = {block.kind for block in every_block()}
    assert built == set(BLOCK_KINDS)
    assert len(BLOCK_KINDS) == 8


def test_every_block_lands_in_a_known_zone() -> None:
    """每一块的区都在花名册里——区写错的表现是那一块整个不渲染。"""
    for zone in ZONES:
        block = reporting.rows_block(at(zone), RowCounts(before=1, after=1))
        assert block.zone in ZONES
    assert ZONES == ("step", "stats", "charts", "formula", "table")


def test_a_block_outside_the_charts_zone_carries_no_main_picture_mark() -> None:
    """只有图区的块标主次：别的区没有「辅图先走」这一档，多一个键是噪声。"""
    block = reporting.rows_block(at(), RowCounts(before=1, after=1))
    assert "is_primary" not in block.payload


def test_a_chart_carries_the_main_picture_mark_it_was_given() -> None:
    """图区的块把主次原样带进 payload：预算降档照它决定谁先走（§4.6）。"""
    for is_primary in (True, False):
        block = reporting.bins_block(
            BlockAt(
                zone="charts",
                title="标题",
                port="frame",
                tier=TIER_LARGE,
                is_primary=is_primary,
            ),
            [ColumnBins(key="c0")],
        )
        assert block.payload["is_primary"] is is_primary


def test_the_two_kinds_of_note_share_one_key_and_say_which_they_are() -> None:
    """两档合在一个 `notes` 键里，逐句带 `level`；空话不挂。

    ⚠ 分成两个键的话，「必须整条摆出来」这条区分只活在写了第二个键的那几个
    模块里，其余模块的告警会被一起收进小问号（规格 §11 的 R-24）。
    """
    plain = reporting.rows_block(at(), RowCounts(before=1, after=1))
    made = reporting.annotated(
        reporting.annotated(plain, NOTE_ALERT, ("会读错的那句", "")),
        NOTE_HINT,
        ("口径那句",),
    )
    assert made.payload["notes"] == [
        {"level": "alert", "text": "会读错的那句"},
        {"level": "hint", "text": "口径那句"},
    ]
    assert "notes" not in reporting.annotated(plain, NOTE_HINT, ("",)).payload


def test_annotating_a_block_changes_nothing_but_the_notes() -> None:
    """挂话只多一个键：块的种类、区、标题与档位一个字都不动。"""
    plain = reporting.rows_block(at(), RowCounts(before=1, after=1))
    made = reporting.annotated(plain, NOTE_HINT, ("一句",))
    assert (made.kind, made.zone, made.title, made.tier) == (
        plain.kind,
        plain.zone,
        plain.title,
        plain.tier,
    )
    assert made.payload["before"] == 1


def every_block() -> list[Any]:
    """八种块各造一个。"""
    return [
        reporting.rows_block(at(), RowCounts(before=1, after=1)),
        reporting.columns_block(at(), ColumnChange()),
        reporting.cells_block(at(), [CellChange(key="c0", changed=1)]),
        reporting.fits_block(at(), method="mean", train_rows=1, total_rows=1),
        reporting.bins_block(at(), [ColumnBins(key="c0")]),
        reporting.axis_block(at(), TimeAxis()),
        reporting.breakdown_block(at(), Scale(), []),
        reporting.structure_block(at(), ModelStructure()),
    ]
