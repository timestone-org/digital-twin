"""树回归的结果面：重要性、部分依赖、训练取值区间、限深代表树与两侧拟合分。

⚠ 这一组盯的是「树能讲什么」：它没有系数，公式一行都写不出来，所以这几张图
就是全部——而 `fitted` 空着是通道 B 的常态，不是没训出来
（docs/MODELING_RESULT_VIEW_DESIGN.md §5-19）。
⚠ 也盯「不外推」这条只有树才有的坑：训练取值区间之外一律给边界叶值，界面上
必须有一处说出来。
"""

from typing import Any

import pytest

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    registry,
)
from platform_server.apps.modeling.operators.estimators import TreeEnsemble
from platform_server.apps.modeling.operators.frame import (
    ROLE_FEATURE,
    ROLE_TARGET,
)
from platform_server.apps.modeling.operators.modelstats import TREE_DEPTH
from platform_server.apps.modeling.operators.reporting import (
    MAX_TREE_NODES,
    TIER_LARGE,
    TIER_SCALAR,
    ReportBlock,
)
from platform_server.apps.modeling.operators.treereport import (
    CHANNEL_NOTE,
    GBDT_RATE_NOTE,
    NO_EXTRAPOLATION_NOTE,
    OVERFIT_GAP,
    PDP_NOTE,
    UNLIMITED_DEPTH_NOTE,
)
from platform_server.apps.modeling.services import report_budget
from platform_server.apps.modeling.services.preview import REPORT_MAX_BYTES
from unit.modeling_fakes import hints_of

STEP = "台阶"
NOISE = "噪声"
TARGET = "产量"
ROWS = 60
# 最坏负载：60 列宽帧 × 366 天逐时
WIDE_COLUMNS = 60
YEAR_ROWS = 366 * 24
# 部分依赖最多画这么多条
PDP_CURVES = 6
# 画一条部分依赖用几个网格点
PDP_POINTS = 20


def frame_of(columns: dict[str, list[float]], target: str) -> Frame:
    """按列造一份数值帧，指定哪一列是目标列。

    Args: columns, target。
    """
    keys = list(columns)
    height = len(columns[keys[0]])
    return Frame(
        columns=tuple(
            FrameColumn(
                key=key,
                name=key,
                dtype="number",
                role=ROLE_TARGET if key == target else ROLE_FEATURE,
            )
            for key in keys
        ),
        rows=tuple(
            tuple(columns[key][seat] for key in keys) for seat in range(height)
        ),
    )


def step_frame(rows: int = ROWS) -> Frame:
    """目标是台阶函数——线性拟不好、树拟得很好。

    Args: rows。
    """
    return frame_of(
        {
            STEP: [float(seat) for seat in range(rows)],
            NOISE: [float((seat * 7) % 3) for seat in range(rows)],
            TARGET: [
                0.0 if seat < rows // 2 else 100.0 for seat in range(rows)
            ],
        },
        TARGET,
    )


def blocks_of(
    train: Frame, test: Frame | None = None, **config: Any
) -> dict[str, ReportBlock]:
    """跑一遍树回归并把讲解按区归好。

    ⚠ 按 zone 归而不是按 kind：这一步的两块都是 `breakdown`，按种类归会让
    第二块把第一块盖掉，而用例照样绿。
    Args: train, test, config。
    """
    operator, _ = registry.build("tree_regressor", config)
    operator.bind_runtime(tz_offset_minutes=0, split_plan=None)
    operator.run({"train": train, "test": test if test is not None else train})
    return {block.zone: block for block in operator.report()}


def notes_of(block: ReportBlock) -> list[str]:
    """一块上收进小问号的那几句口径说明。

    Args: block。
    """
    return hints_of(block)


def items_of(block: ReportBlock) -> dict[str, Any]:
    """按项的一组数摊成 `名字 → 值`。

    Args: block。
    """
    found: Any = block.payload["items"]
    return {str(item["name"]): item["value"] for item in found}


def wide_frame() -> Frame:
    """60 列 × 366 天逐时，最后一列当目标列。

    ⚠ 列名按台账里真有的那种长度造：重要性、区间与代表树都逐列印列名，短名字
    量出来的字节账比真实小一半。
    """
    columns: dict[str, list[float]] = {
        f"{seat}#冷冻水泵出口温度": [
            float((row * (seat + 1)) % 97) for row in range(YEAR_ROWS)
        ]
        for seat in range(WIDE_COLUMNS - 1)
    }
    columns[TARGET] = [float(row % 31) for row in range(YEAR_ROWS)]
    return frame_of(columns, TARGET)


def test_the_tree_hands_back_three_node_level_blocks() -> None:
    """三块都挂在节点上，且降档时先走的是那张大图，不是第一区那几行字。"""
    operator, _ = registry.build("tree_regressor", {"n_estimators": 5})
    operator.bind_runtime(tz_offset_minutes=0, split_plan=None)
    frame = step_frame()
    operator.run({"train": frame, "test": frame})
    assert [
        (block.kind, block.zone, block.tier, block.port)
        for block in operator.report()
    ] == [
        ("breakdown", "step", TIER_SCALAR, ""),
        ("breakdown", "stats", TIER_SCALAR, ""),
        ("structure", "charts", TIER_LARGE, ""),
    ]


def test_the_tree_says_where_its_parameters_went() -> None:
    """通道 B 那句话必须在第一区：空着的 `fitted` 不是「还没训出来」。"""
    assert notes_of(blocks_of(step_frame())["step"]) == [CHANNEL_NOTE]


def test_the_gist_counts_the_two_sides_apart() -> None:
    """训练行数与打分行数各记各的：两个端口喂的是两份帧。"""
    counts = items_of(blocks_of(step_frame(), step_frame(20))["step"])
    assert counts["训练行数"] == ROWS
    assert counts["特征列数"] == 2
    assert counts["打分行数"] == 20


def test_the_boosted_trees_own_up_to_a_learning_rate_nobody_can_see() -> None:
    """ν=0.1 是 sklearn 的默认、本仓没暴露——那就得由这句话说出来。"""
    notes = notes_of(blocks_of(step_frame(), shape="gbdt")["step"])
    assert notes == [CHANNEL_NOTE, GBDT_RATE_NOTE]


def test_the_forest_does_not_borrow_the_boosting_note() -> None:
    """随机森林没有学习率这回事，那句话不许出现在它这儿。"""
    assert GBDT_RATE_NOTE not in notes_of(blocks_of(step_frame())["step"])


def test_the_ensemble_shape_counts_trees_depth_and_leaves() -> None:
    """几棵、最深几层、多少个叶子——这三个数一个字都不在 `fitted` 里。"""
    numbers = items_of(blocks_of(step_frame(), n_estimators=7)["stats"])
    assert numbers["树的棵数"] == 7
    assert numbers["最深几层"] == 1
    assert numbers["叶子总数"] == 14


def test_the_boosted_ensemble_is_counted_the_same_way() -> None:
    """提升树的 `estimators_` 是每轮一排，摊不平的话这三个数会全是空。"""
    numbers = items_of(
        blocks_of(step_frame(), shape="gbdt", n_estimators=4)["stats"]
    )
    assert numbers["树的棵数"] == 4
    assert numbers["最深几层"] >= 1
    assert numbers["叶子总数"] >= 4


def test_an_unfitted_ensemble_has_no_depth_instead_of_zero() -> None:
    """还没拟合的集成给的是「没有」不是 0：0 层会被读成「一棵都没长」。"""
    shape = TreeEnsemble(
        kind="forest", n_estimators=3, max_depth=None, random_state=0
    ).shape
    assert shape.count == 0
    assert shape.depth is None
    assert shape.leaves is None


def test_both_sides_get_their_own_score() -> None:
    """训练分与测试分并排：只印一个的话，背下来的那种看着一样好。"""
    numbers = items_of(blocks_of(step_frame(), n_estimators=10)["stats"])
    assert numbers["训练集 R²"] == pytest.approx(0.9886, abs=1e-3)
    assert numbers["测试集 R²"] == pytest.approx(0.9886, abs=1e-3)


def test_a_flat_target_gets_no_score_instead_of_a_zero() -> None:
    """目标列一点不变时 R² 没有定义：给 `None` 不给 0。"""
    flat = frame_of(
        {
            STEP: [float(seat) for seat in range(ROWS)],
            TARGET: [5.0] * ROWS,
        },
        TARGET,
    )
    numbers = items_of(blocks_of(flat, n_estimators=5)["stats"])
    assert numbers["训练集 R²"] is None
    assert numbers["测试集 R²"] is None


def test_the_unlimited_depth_warning_shows_up_only_when_depth_is_free() -> None:
    """没限深度时训练分必然贴着 1，那句话得摆出来；限了就不摆。"""
    free = blocks_of(step_frame(), n_estimators=5)["stats"]
    capped = blocks_of(step_frame(), n_estimators=5, max_depth=2)["stats"]
    assert UNLIMITED_DEPTH_NOTE in notes_of(free)
    assert UNLIMITED_DEPTH_NOTE not in notes_of(capped)


def test_a_memorised_forest_gets_called_out() -> None:
    """训练分远高于测试分时明说它把训练数据背下来了，并把两个数印全。"""
    stats = blocks_of(_noisy(seed=1), _noisy(seed=2), n_estimators=20)["stats"]
    numbers = items_of(stats)
    told = next(
        note for note in notes_of(stats) if note.startswith("训练集 R²")
    )
    assert numbers["训练集 R²"] > numbers["测试集 R²"] + 0.2
    assert f"{numbers['训练集 R²']:.3f}" in told
    assert f"{numbers['测试集 R²']:.3f}" in told


def test_a_small_gap_between_the_two_sides_is_not_called_memorising() -> None:
    """两侧差七个百分点不算背下来：门槛是 0.2，差一点就喊等于狼来了。"""
    stats = blocks_of(_ramp(0.0), _ramp(6.0), n_estimators=10)["stats"]
    numbers = items_of(stats)
    gap = numbers["训练集 R²"] - numbers["测试集 R²"]
    assert 0.0 < gap < OVERFIT_GAP
    assert not [
        note for note in notes_of(stats) if note.startswith("训练集 R²")
    ]


def test_the_importances_are_ranked_before_they_are_cut() -> None:
    """按重要性从高到低排：按列序截的话，最重要的那列排在第 61 位就没了。"""
    found: Any = blocks_of(step_frame(), n_estimators=10)["charts"].payload[
        "importances"
    ]
    assert [item["key"] for item in found] == [STEP, NOISE]
    assert found[0]["value"] == pytest.approx(1.0, abs=0.05)
    assert found[1]["value"] < 0.05


def test_the_training_ranges_are_the_range_this_model_dares_answer_in() -> None:
    """每列的训练取值区间照实给：区间之外树只会给边界上的那个叶值。"""
    found: Any = blocks_of(step_frame(), n_estimators=5)["charts"].payload[
        "ranges"
    ]
    assert found[0] == {"key": STEP, "low": 0.0, "high": float(ROWS - 1)}
    assert found[1] == {"key": NOISE, "low": 0.0, "high": 2.0}


def test_the_chart_block_says_the_tree_will_not_extrapolate() -> None:
    """「不外推」是树独有的坑，界面上必须有一处说出来。"""
    notes = notes_of(blocks_of(step_frame(), n_estimators=5)["charts"])
    assert NO_EXTRAPOLATION_NOTE in notes
    assert PDP_NOTE in notes


def test_the_sample_tree_is_capped_at_three_levels() -> None:
    """代表树限深 3、限节点 31：全结构一棵就能把整份讲解挤没。"""
    tree: Any = blocks_of(_wiggly(), n_estimators=5)["charts"].payload["tree"]
    assert tree["depth"] == TREE_DEPTH
    assert 1 < len(tree["nodes"]) <= MAX_TREE_NODES
    root = tree["nodes"][0]
    assert root["parent"] == -1
    assert root["is_leaf"] is False
    assert root["samples"] > 0
    assert {node["branch"] for node in tree["nodes"][1:3]} == {"low", "high"}
    assert root["key"] == STEP
    assert 0.0 < root["threshold"] < float(ROWS - 1)
    leaf = next(node for node in tree["nodes"] if node["is_leaf"])
    assert leaf["key"] == ""
    assert leaf["threshold"] is None


def test_the_partial_dependence_follows_the_important_columns() -> None:
    """列多时挑重要性最高的几列画。

    ⚠ 换列要连矩阵一起换位：只把 key 排个序的话，每条曲线动的都是别的列，
    而画出来的图看着完全正常。
    """
    curves: Any = blocks_of(_only_the_last_matters(), n_estimators=10)[
        "charts"
    ].payload["pdp"]
    assert len(curves) == PDP_CURVES
    assert curves[0]["key"] == "列7"
    heights = [point[1] for point in curves[0]["points"]]
    assert len(curves[0]["points"]) == PDP_POINTS
    assert max(heights) - min(heights) > 50


def test_the_partial_dependence_says_how_many_columns_it_left_out() -> None:
    """只画了六条就得说清一共有几列，否则用户以为别的列不重要。"""
    notes = notes_of(
        blocks_of(_only_the_last_matters(), n_estimators=10)["charts"]
    )
    assert "特征有 8 列，部分依赖只画重要性最高的那 6 列" in notes


def test_a_narrow_frame_draws_every_curve_and_leaves_out_no_note() -> None:
    """两列就画两条，不摆「只画了几列」那句话。"""
    blocks = blocks_of(step_frame(), n_estimators=5)
    curves: Any = blocks["charts"].payload["pdp"]
    assert [curve["key"] for curve in curves] == [STEP, NOISE]
    assert not [
        note for note in notes_of(blocks["charts"]) if "部分依赖只画" in note
    ]


def test_the_inside_chart_stays_the_main_picture() -> None:
    """重要性与部分依赖是主体图：超预算时它最后才走。"""
    assert blocks_of(step_frame())["charts"].payload["is_primary"] is True


def test_the_worst_tree_load_still_fits_the_report_budget() -> None:
    """60 列宽帧 × 366 天逐时：讲解装得下，一块都不用降档丢掉。"""
    operator, _ = registry.build("tree_regressor", {"n_estimators": 3})
    operator.bind_runtime(tz_offset_minutes=0, split_plan=None)
    frame = wide_frame()
    operator.run({"train": frame, "test": frame})
    blocks = {block.zone: block for block in operator.report()}
    inside: Any = blocks["charts"].payload
    assert len(inside["importances"]) == WIDE_COLUMNS - 1
    assert len(inside["ranges"]) == WIDE_COLUMNS - 1
    assert len(inside["pdp"]) == PDP_CURVES
    report = report_budget.fit_report(operator.report())
    assert report is not None
    assert report["dropped"] == []
    assert report_budget.size_of(report) < REPORT_MAX_BYTES


def test_the_tree_report_is_empty_before_it_has_run() -> None:
    """没跑过就没有话讲：空壳块会让旧运行的弹窗出现一片白。"""
    operator, _ = registry.build("tree_regressor", {})
    assert operator.report() == ()


def _noisy(*, seed: int) -> Frame:
    """目标与特征之间没有关系：没限深的树会把它整份背下来。

    Args: seed。
    """
    return frame_of(
        {
            STEP: [float(seat) for seat in range(ROWS)],
            NOISE: [float((seat * 13) % 7) for seat in range(ROWS)],
            TARGET: [
                float((seat * 37 + seat * seed) % 101) for seat in range(ROWS)
            ],
        },
        TARGET,
    )


def _wiggly() -> Frame:
    """目标分成好几段——树要多分几层才拟得住，代表树才有得画。"""
    return frame_of(
        {
            STEP: [float(seat) for seat in range(ROWS)],
            NOISE: [float((seat * 7) % 3) for seat in range(ROWS)],
            TARGET: [float((seat // 5) * 10) for seat in range(ROWS)],
        },
        TARGET,
    )


def _only_the_last_matters() -> Frame:
    """八列特征，只有最后一列与目标有关。

    ⚠ 另外七列要**互不相关**：都写成行号的函数的话，它们与那一列同步起落，
    树照样分得开，这一条就验不到「挑对了列」。
    """
    columns: dict[str, list[float]] = {
        f"列{seat}": [_mixed(row, seat) for row in range(ROWS)]
        for seat in range(8)
    }
    columns["列7"] = [float(row % 5) for row in range(ROWS)]
    columns[TARGET] = [value * 20.0 for value in columns["列7"]]
    return frame_of(columns, TARGET)


def _mixed(row: int, seat: int) -> float:
    """一串看着像随机、其实每次都一样的数。

    ⚠ 定死而不取随机源：随机的用例会时绿时红，而这一条要验的是挑列，不是运气。
    Args: row, seat。
    """
    return float((row * 2654435761 + seat * 40503) % 1013) / 10.0


def _ramp(shift: float) -> Frame:
    """目标随特征线性抬升，`shift` 是拿来把两侧拉开一点点的扰动。

    Args: shift。
    """
    return frame_of(
        {
            STEP: [float(seat) for seat in range(ROWS)],
            NOISE: [float((seat * 7) % 3) for seat in range(ROWS)],
            TARGET: [
                float(seat) + shift * float((seat % 3) - 1)
                for seat in range(ROWS)
            ],
        },
        TARGET,
    )
