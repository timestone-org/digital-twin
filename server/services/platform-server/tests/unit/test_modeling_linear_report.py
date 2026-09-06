"""线性族的结果面：系数与可比贡献、两侧拟合分、共线性、几率比与收敛。

⚠ 这一组反复验的是三件今天界面上一个字都没有、而只有这一步看得见的事：秩亏
（系数会剧烈摇摆而 R² 照样很高）、每列的 σ（系数可不可比）、以及逻辑回归收没
收敛（docs/MODELING_RESULT_VIEW_DESIGN.md §5-17 与 §5-18）。
"""

import math
import statistics
from collections.abc import Mapping, Sequence
from typing import Any

import pytest

from platform_server.apps.modeling.operators import (
    CellValue,
    Frame,
    FrameColumn,
    Provenance,
    registry,
)
from platform_server.apps.modeling.operators.linearreport import (
    DEFAULTS_NOTE,
    PROBABILITY_NOTE,
    LogitTrained,
    Trained,
    logit_blocks,
)
from platform_server.apps.modeling.operators.reporting import ReportBlock
from platform_server.apps.modeling.services import report_budget
from platform_server.apps.modeling.services.preview import REPORT_MAX_BYTES
from unit.modeling_fakes import START_MS, STEP_MS, hints_of

TARGET = "能耗"
WARM = "温度"
LOAD = "负荷"
TWIN = "负荷副本"
# 真实关系：能耗 = 2×温度 + 3×负荷 + 5
SLOPE_WARM = 2.0
SLOPE_LOAD = 3.0
INTERCEPT = 5.0
# 最坏负载：60 列宽帧 × 366 天逐时
WIDE_COLUMNS = 60
YEAR_ROWS = 366 * 24
ROWS = 20
TEST_RATIO = 0.3
# 20 行按三成切：测试 6 行，训练是前 14 行
TRAIN_ROWS = 14
# 逻辑回归的迭代上限，sklearn 的默认
MAX_ROUNDS = 100
# 把测试段整体抬高这么多，好让两侧的分不一样
SHIFT = 50.0


def frame_of(columns: Mapping[str, Sequence[float | None]]) -> Frame:
    """按列造一份带时间索引的数值帧。空格照原样留着，不补 0。

    Args: columns。
    """
    keys = list(columns)
    height = len(columns[keys[0]])
    rows: tuple[tuple[CellValue, ...], ...] = tuple(
        tuple(columns[key][seat] for key in keys) for seat in range(height)
    )
    return Frame(
        columns=tuple(
            FrameColumn(
                key=key,
                name=key,
                dtype="number",
                unit="千瓦时" if key == TARGET else "",
            )
            for key in keys
        ),
        rows=rows,
        index=tuple(START_MS + seat * STEP_MS for seat in range(height)),
        provenance=Provenance(table_codes=("energy_h",)),
    )


def warm_of(seat: int) -> float:
    """温度这一列：跨度不到十度。

    Args: seat。
    """
    return 20.0 + (seat % 13) * 0.7


def load_of(seat: int) -> float:
    """负荷这一列：跨度九十，与温度差一个量级。

    Args: seat。
    """
    return 400.0 + (seat % 7) * 15.0


def linear_columns(rows: int = ROWS) -> dict[str, list[float]]:
    """严格线性的三列，能拿它逐个系数手算核对。

    Args: rows。
    """
    warm = [warm_of(seat) for seat in range(rows)]
    load = [load_of(seat) for seat in range(rows)]
    return {
        WARM: warm,
        LOAD: load,
        TARGET: [
            SLOPE_WARM * one + SLOPE_LOAD * other + INTERCEPT
            for one, other in zip(warm, load, strict=True)
        ],
    }


def split_of(frame: Frame) -> dict[str, Any]:
    """先切一刀：目标列的角色由切分算子打上。

    Args: frame。
    """
    splitter, _ = registry.build(
        "split_dataset",
        {"target_column": TARGET, "test_ratio": TEST_RATIO},
    )
    splitter.bind_runtime(tz_offset_minutes=480, split_plan=None)
    return splitter.run({"frame": frame})


def blocks_of(
    code: str, frame: Frame, **config: Any
) -> tuple[ReportBlock, ...]:
    """切一刀再拟合一次，把讲解**整串**交出来。

    ⚠ 不按区（也不按种类）归成字典：同一区里本来就可以有好几块（③ 区三张图），
    归成字典时后面那几块会静默盖掉前面那几块，而字节预算那条用例正是照这份
    字典记账的——图越大它越量不到。
    Args: code, frame, config。
    """
    parts = split_of(frame)
    operator, _ = registry.build(code, config)
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    operator.run({"train": parts["train"], "test": parts["test"]})
    return operator.report()


def zoned(blocks: Sequence[ReportBlock], zone: str) -> ReportBlock:
    """某一区的第一块。

    Args: blocks, zone。
    """
    return next(block for block in blocks if block.zone == zone)


def notes_of(block: ReportBlock) -> list[str]:
    """一块上收进小问号的那几句口径说明。

    Args: block。
    """
    return hints_of(block)


def item_of(block: ReportBlock, name: str) -> dict[str, Any]:
    """按项的那一组数里叫这个名字的一项。

    Args: block, name。
    """
    items: Any = block.payload["items"]
    return next(item for item in items if item["name"] == name)


def params_of(block: ReportBlock, key: str) -> dict[str, Any]:
    """逐列表里某一列那一行的参数。

    Args: block, key。
    """
    by_column: Any = block.payload["by_column"]
    return next(item for item in by_column if item["key"] == key)["params"]


def wide_columns(rows: int) -> dict[str, list[float]]:
    """60 列，最后一列是前面几列的线性组合。

    Args: rows。
    """
    made: dict[str, list[float]] = {
        f"列{seat}": [float((row * (seat + 1)) % 97) for row in range(rows)]
        for seat in range(WIDE_COLUMNS - 1)
    }
    made[TARGET] = [float(row % 31) for row in range(rows)]
    return made


def test_the_least_squares_report_recovers_the_two_slopes() -> None:
    """严格线性的数据上，系数就是造数时的那两个斜率。"""
    blocks = blocks_of("linear_regression", frame_of(linear_columns()))
    assert params_of(zoned(blocks, "formula"), WARM)["coef"] == pytest.approx(
        SLOPE_WARM
    )
    assert params_of(zoned(blocks, "formula"), LOAD)["coef"] == pytest.approx(
        SLOPE_LOAD
    )


def test_the_least_squares_report_measures_sigma_on_the_training_rows() -> None:
    """σ 按总体口径、只在训练行上算：拿整帧算的话用户核对不上。"""
    blocks = blocks_of("linear_regression", frame_of(linear_columns()))
    expected = statistics.pstdev([warm_of(seat) for seat in range(TRAIN_ROWS)])
    assert params_of(zoned(blocks, "formula"), WARM)["sigma"] == pytest.approx(
        expected
    )


def test_the_least_squares_report_scales_each_coefficient_by_sigma() -> None:
    """可比贡献是 |β·σ|：负荷的量纲大一个量级，贡献也跟着大。"""
    blocks = blocks_of("linear_regression", frame_of(linear_columns()))
    warm = params_of(zoned(blocks, "formula"), WARM)
    load = params_of(zoned(blocks, "formula"), LOAD)
    assert warm["contribution"] == pytest.approx(
        abs(warm["coef"]) * warm["sigma"]
    )
    assert load["contribution"] > warm["contribution"]


def test_the_least_squares_report_counts_both_sides_of_the_split() -> None:
    """训练行数与总行数分开记：两个数一样才是漏了测试那一半。"""
    payload = zoned(
        blocks_of("linear_regression", frame_of(linear_columns())), "formula"
    ).payload
    assert payload["method"] == "none"
    assert payload["train_rows"] == TRAIN_ROWS
    assert payload["total_rows"] == ROWS


def test_the_least_squares_report_scores_both_sides() -> None:
    """严格线性的数据上两侧 R² 都是 1，两侧各摆一张卡。

    ⚠ 两个数都要落在 `value` 上：指标卡只读这一个键，摆进别的键里等于没摆。
    """
    blocks = blocks_of("linear_regression", frame_of(linear_columns()))
    stats = zoned(blocks, "stats")
    assert [item["name"] for item in stats.payload["items"]] == [
        "训练 R²",
        "测试 R²",
        "训练 RMSE",
        "测试 RMSE",
    ]
    for name in ("训练 R²", "测试 R²"):
        assert item_of(stats, name)["value"] == pytest.approx(1.0)
        assert item_of(stats, name)["score_kind"] == "r2"


def test_the_least_squares_report_scores_the_two_sides_separately() -> None:
    """测试段整体抬高 50：训练 RMSE 是 0、测试 RMSE 正好是 50。

    ⚠ 两个数必须各算各的：同一份预测算两遍的话，过拟合在屏幕上就消失了。
    """
    columns = linear_columns()
    columns[TARGET] = [
        value + (0.0 if seat < TRAIN_ROWS else SHIFT)
        for seat, value in enumerate(columns[TARGET])
    ]
    blocks = blocks_of("linear_regression", frame_of(columns))
    stats = zoned(blocks, "stats")
    assert item_of(stats, "训练 RMSE")["value"] == pytest.approx(0.0, abs=1e-9)
    assert item_of(stats, "测试 RMSE")["value"] == pytest.approx(SHIFT)
    assert (
        item_of(stats, "训练 R²")["value"] > item_of(stats, "测试 R²")["value"]
    )


def test_the_least_squares_report_carries_the_target_unit_on_rmse() -> None:
    """RMSE 跟着目标列的量纲走，R² 无量纲：两者不能共用一档染色口径。"""
    blocks = blocks_of("linear_regression", frame_of(linear_columns()))
    assert item_of(zoned(blocks, "stats"), "测试 RMSE")["unit"] == "千瓦时"
    assert item_of(zoned(blocks, "stats"), "训练 RMSE")["unit"] == "千瓦时"
    assert item_of(zoned(blocks, "stats"), "测试 R²")["unit"] == ""


def test_the_least_squares_report_gives_none_when_r2_is_undefined() -> None:
    """目标列一点不变时 R² 给 None，而 RMSE 照样是一个真的数（0）。"""
    columns = linear_columns()
    columns[TARGET] = [7.0] * ROWS
    blocks = blocks_of("linear_regression", frame_of(columns))
    stats = zoned(blocks, "stats")
    assert item_of(stats, "训练 R²")["value"] is None
    assert item_of(stats, "测试 R²")["value"] is None
    assert item_of(stats, "测试 RMSE")["value"] == pytest.approx(0.0, abs=1e-9)


def test_the_least_squares_report_counts_the_intercept_as_a_column() -> None:
    """两个特征加一列截距是三列，互不相关时满秩，不出告警。"""
    blocks = blocks_of("linear_regression", frame_of(linear_columns()))
    assert item_of(zoned(blocks, "step"), "设计矩阵的秩")["value"] == 3
    assert item_of(zoned(blocks, "step"), "训练行数")["value"] == TRAIN_ROWS
    assert not [
        note for note in notes_of(zoned(blocks, "step")) if "不满秩" in note
    ]


def test_the_least_squares_report_flags_a_rank_deficient_design() -> None:
    """一列是另一列的复制品：秩比列数少一，并明说系数会摇摆。"""
    columns = linear_columns()
    columns[TWIN] = list(columns[LOAD])
    blocks = blocks_of("linear_regression", frame_of(columns))
    assert item_of(zoned(blocks, "step"), "特征列数")["value"] == 3
    assert item_of(zoned(blocks, "step"), "设计矩阵的秩")["value"] == 3
    assert item_of(zoned(blocks, "step"), "条件数")["value"] is None
    assert [
        note for note in notes_of(zoned(blocks, "step")) if "不满秩" in note
    ]


def test_the_least_squares_report_warns_about_mismatched_scales() -> None:
    """各列量纲差过十倍就提醒按 |β·σ| 比，差得不多时不提。"""
    blocks = blocks_of("linear_regression", frame_of(linear_columns()))
    assert [
        note for note in notes_of(zoned(blocks, "step")) if "量纲差得远" in note
    ]
    even = linear_columns()
    even[LOAD] = [warm_of(seat) + 1.0 for seat in range(ROWS)]
    even[TARGET] = [
        SLOPE_WARM * one + SLOPE_LOAD * other + INTERCEPT
        for one, other in zip(even[WARM], even[LOAD], strict=True)
    ]
    assert not [
        note
        for note in notes_of(
            zoned(blocks_of("linear_regression", frame_of(even)), "step")
        )
        if "量纲差得远" in note
    ]


def test_the_least_squares_report_warns_about_a_nearly_singular_design() -> (
    None
):
    """两列几乎重合：秩还是满的，而条件数已经大到系数站不住。"""
    columns = linear_columns()
    columns[TWIN] = [
        value + 1e-4 * (seat % 3) for seat, value in enumerate(columns[LOAD])
    ]
    columns[TARGET] = [
        SLOPE_WARM * one + SLOPE_LOAD * other + INTERCEPT
        for one, other in zip(columns[WARM], columns[LOAD], strict=True)
    ]
    blocks = blocks_of("linear_regression", frame_of(columns))
    assert item_of(zoned(blocks, "step"), "条件数")["value"] > 1e6
    assert not [
        note for note in notes_of(zoned(blocks, "step")) if "不满秩" in note
    ]
    assert [
        note for note in notes_of(zoned(blocks, "step")) if "条件数" in note
    ]


def test_the_least_squares_report_names_a_column_that_never_moves() -> None:
    """训练行上没有变化的列，系数与别的列不可比，那一行要说清楚。"""
    columns = linear_columns()
    columns[LOAD] = [400.0] * ROWS
    columns[TARGET] = [SLOPE_WARM * one + INTERCEPT for one in columns[WARM]]
    blocks = blocks_of("linear_regression", frame_of(columns))
    by_column: Any = zoned(blocks, "formula").payload["by_column"]
    flat = next(item for item in by_column if item["key"] == LOAD)
    assert flat["params"]["sigma"] == 0.0
    assert flat["params"]["contribution"] == 0.0
    assert flat["skipped_reason"]


def test_the_worst_least_squares_load_still_fits_the_report_budget() -> None:
    """60 列宽帧 × 366 天逐时：讲解装得下，一块都不用降档丢掉。"""
    blocks = blocks_of("linear_regression", frame_of(wide_columns(YEAR_ROWS)))
    report = report_budget.fit_report(blocks)
    assert report is not None
    assert report["dropped"] == []
    assert report_budget.size_of(report) < REPORT_MAX_BYTES
    assert (
        len(zoned(blocks, "formula").payload["by_column"]) == WIDE_COLUMNS - 1
    )


def test_the_least_squares_report_is_empty_before_it_has_run() -> None:
    """没跑过就没有话讲。"""
    operator, _ = registry.build("linear_regression", {})
    assert operator.report() == ()


def logit_columns(positives: int = ROWS // 2) -> dict[str, list[float]]:
    """两类目标列：靠前的那几行是正类。

    Args: positives。
    """
    return {
        WARM: [warm_of(seat) for seat in range(ROWS)],
        LOAD: [load_of(seat) for seat in range(ROWS)],
        TARGET: [1.0 if seat < positives else 0.0 for seat in range(ROWS)],
    }


def test_the_logit_report_turns_each_coefficient_into_an_odds_ratio() -> None:
    """几率比就是 exp(β)——这是逻辑回归唯一能讲给业务听的读法。"""
    blocks = blocks_of("logistic_regression", frame_of(logit_columns()))
    params = params_of(zoned(blocks, "formula"), WARM)
    assert params["odds_ratio"] == pytest.approx(math.exp(params["coef"]))
    assert zoned(blocks, "formula").payload["method"] == "l2"


def test_the_logit_report_counts_the_training_classes() -> None:
    """训练集上每一类各多少行，类目印成整数。"""
    blocks = blocks_of("logistic_regression", frame_of(logit_columns()))
    items: Any = zoned(blocks, "charts").payload["items"]
    assert [item["name"] for item in items] == ["0", "1"]
    assert [item["value"] for item in items] == [4, TRAIN_ROWS - 4]
    assert zoned(blocks, "charts").payload["is_primary"] is True


@pytest.mark.parametrize("threshold", [0.5, 0.7])
def test_the_logit_report_spells_out_the_threshold_it_really_used(
    threshold: float,
) -> None:
    """四条读法提醒一条都不能少，且报的是这一次真用的那个阈值。

    ⚠ 阈值升成超参之后还照着「固定 0.5」讲的话，界面会与它自己的参数面板
    互相打脸，而没有任何一处会报错（§13.2）。
    """
    notes = notes_of(
        zoned(
            blocks_of(
                "logistic_regression",
                frame_of(logit_columns()),
                positive_threshold=threshold,
            ),
            "step",
        )
    )
    assert [note for note in notes if f"阈值 {threshold:g} 比大小" in note]
    assert [
        note
        for note in notes
        if note.startswith(f"判正类的阈值是 {threshold:g}")
    ]
    assert DEFAULTS_NOTE in notes
    assert PROBABILITY_NOTE in notes
    assert not [note for note in notes if "固定" in note]


def test_the_logit_report_shows_the_rounds_it_actually_took() -> None:
    """迭代轮数与上限并排：没撞上上限就不出那条告警。"""
    blocks = blocks_of("logistic_regression", frame_of(logit_columns()))
    rounds = item_of(zoned(blocks, "step"), "迭代轮数")["value"]
    assert isinstance(rounds, int)
    assert 0 < rounds < MAX_ROUNDS
    assert item_of(zoned(blocks, "step"), "迭代上限")["value"] == MAX_ROUNDS
    assert not [
        note
        for note in notes_of(zoned(blocks, "step"))
        if "迭代撞上了上限" in note
    ]


def test_the_logit_report_names_the_positive_class() -> None:
    """正类是两个类目里靠后那个：不说清楚的话权重条的方向就是反的。"""
    blocks = blocks_of("logistic_regression", frame_of(logit_columns()))
    assert "正类是「1」" in zoned(blocks, "step").payload["label"]


def test_the_logit_report_warns_when_one_class_barely_shows_up() -> None:
    """少数类只占一小撮：模型很可能全押多数类，告警里带着当次的阈值。"""
    notes = notes_of(
        zoned(
            blocks_of(
                "logistic_regression",
                frame_of(logit_columns(1)),
                positive_threshold=0.7,
            ),
            "step",
        )
    )
    assert [note for note in notes if note.startswith("少数类只占")]
    assert [note for note in notes if "而阈值是 0.7" in note]


def test_the_logit_report_says_when_the_fit_never_converged() -> None:
    """迭代撞上上限 = 这组系数还没收敛，结果不可信。"""
    parts = split_of(frame_of(logit_columns()))
    seen = LogitTrained(
        fit=Trained(
            train=parts["train"],
            test=parts["test"],
            keys=(WARM, LOAD),
            target=TARGET,
            predicted=[],
            coef={WARM: 0.5, LOAD: -0.25},
            intercept=0.0,
            use_intercept=True,
            method="l2",
        ),
        classes=[0.0, 1.0],
        n_iter=MAX_ROUNDS,
        max_iter=MAX_ROUNDS,
        threshold=0.5,
    )
    blocks = logit_blocks(seen)
    assert [
        note
        for note in notes_of(zoned(blocks, "step"))
        if note.startswith("迭代撞上了上限")
    ]


def test_the_logit_report_stays_quiet_about_a_positive_class_it_lacks() -> None:
    """类目没传全时不硬编一个正类出来，那句口径照旧摆着。"""
    parts = split_of(frame_of(logit_columns()))
    seen = LogitTrained(
        fit=Trained(
            train=parts["train"],
            test=parts["test"],
            keys=(WARM, LOAD),
            target=TARGET,
            predicted=[],
            coef={WARM: 0.5, LOAD: -0.25},
            intercept=0.0,
            use_intercept=True,
            method="l2",
        ),
        classes=[],
        n_iter=3,
        max_iter=MAX_ROUNDS,
        threshold=0.5,
    )
    blocks = logit_blocks(seen)
    assert "正类是" not in zoned(blocks, "step").payload["label"]
    assert zoned(blocks, "charts").payload["items"] == []
    assert not [
        note
        for note in notes_of(zoned(blocks, "step"))
        if note.startswith("少数类")
    ]


def test_the_worst_logit_load_still_fits_the_report_budget() -> None:
    """60 列宽帧 × 366 天逐时：讲解装得下，一块都不用降档丢掉。"""
    columns = wide_columns(YEAR_ROWS)
    columns[TARGET] = [float(row % 2) for row in range(YEAR_ROWS)]
    blocks = blocks_of("logistic_regression", frame_of(columns))
    report = report_budget.fit_report(blocks)
    assert report is not None
    assert report["dropped"] == []
    assert report_budget.size_of(report) < REPORT_MAX_BYTES
