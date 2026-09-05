"""残差分析、特征重要性、交叉验证三步的结果面。

⚠ 三处「算了就丢」在这里买回来：残差随时间的漂移、每一列打乱几遍之间的波动、
以及被折成四个标量之前的逐折分数与折布局。
⚠ 按列名建的键一律走块不走 `metrics` 字典：某列恰好叫 `mape` 时，无量纲的 ΔR²
会被印上百分号（docs/MODELING_RESULT_VIEW_DESIGN.md R-34）。
"""

from typing import Any

import pytest

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    MetricsPayload,
    OperatorBase,
    registry,
)
from platform_server.apps.modeling.operators.evalstats import fold_score_items
from platform_server.apps.modeling.operators.frame import (
    ROLE_FEATURE,
    ROLE_TARGET,
)
from platform_server.apps.modeling.operators.payloads import ModelPayload
from platform_server.apps.modeling.operators.reporting import ReportBlock
from platform_server.apps.modeling.services import report_budget
from platform_server.apps.modeling.services.preview import REPORT_MAX_BYTES

HOUR_MS = 3_600_000
# 最坏负载：366 天逐时、六十列特征、二十折
YEAR_ROWS = 366 * 24
WIDE_COLUMNS = 60
MAX_FOLDS = 20
TARGET = "能耗"
# 四折前向链在这么多行上恰好切出三折，每折十行
FOLD_ROWS = 40
# 第二折抬一点、末折抬一大截：三折的分因此互不相同
MID_SHIFT = 2.0
LATE_SHIFT = 40.0


def scored(
    rows: tuple[tuple[float, float], ...], *, has_index: bool = False
) -> Frame:
    """造一份打分帧：真实值一列、预测值一列，可带时刻。

    Args: rows, has_index。
    """
    return Frame(
        columns=(
            FrameColumn(key="y_true", name="真实值", dtype="number"),
            FrameColumn(key="y_pred", name="预测值", dtype="number"),
        ),
        rows=rows,
        index=(
            tuple(seat * HOUR_MS for seat in range(len(rows)))
            if has_index
            else None
        ),
    )


def training(columns: int = 2, rows: int = 40, driver: int = 0) -> Frame:
    """目标由某一列线性决定，其余列与它无关。

    Args: columns, rows, driver（哪一列驱动目标）。
    """
    return Frame(
        columns=(
            *(
                FrameColumn(
                    key=f"第{seat}列",
                    name=f"第{seat}列",
                    dtype="number",
                    role=ROLE_FEATURE,
                )
                for seat in range(columns)
            ),
            FrameColumn(
                key=TARGET, name=TARGET, dtype="number", role=ROLE_TARGET
            ),
        ),
        rows=tuple(
            (
                *(
                    (
                        float(row)
                        if seat == driver
                        else float((row * 7 * (seat + 1)) % 5)
                    )
                    for seat in range(columns)
                ),
                float(row) * 3.0 + 10.0,
            )
            for row in range(rows)
        ),
    )


def model_of(frame: Frame) -> ModelPayload:
    """在给定帧上训一个线性回归，回它的模型描述。

    Args: frame。
    """
    operator, _ = registry.build("linear_regression", {})
    operator.bind_runtime(tz_offset_minutes=0, split_plan=None)
    payload = operator.run({"train": frame, "test": frame})["model"]
    assert isinstance(payload, ModelPayload)
    return payload


def ran(code: str, inputs: dict[str, Any], **config: Any) -> OperatorBase:
    """跑一遍某个诊断算子，回它自己（`report()` 要问它）。

    Args: code, inputs, config。
    """
    operator, _ = registry.build(code, config)
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    operator.run(inputs)
    return operator


def block_of(blocks: tuple[ReportBlock, ...], title: str) -> ReportBlock:
    """按标题取一块；取不到就当场说清是哪一块没了。

    Args: blocks, title。
    """
    for block in blocks:
        if block.title == title:
            return block
    raise AssertionError(f"讲解里没有「{title}」这一块")


def items_of(blocks: tuple[ReportBlock, ...], title: str) -> list[Any]:
    """一块按项的数里的那几项。

    Args: blocks, title。
    """
    payload: list[Any] = block_of(blocks, title).payload["items"]
    return payload


def titles_of(blocks: tuple[ReportBlock, ...]) -> list[str]:
    """讲了哪几块。

    Args: blocks。
    """
    return [block.title for block in blocks]


def drifting(count: int) -> tuple[tuple[float, float], ...]:
    """前半段偏正、后半段偏负：直方图上会摊平成一个胖尾。

    Args: count。
    """
    return tuple(
        (float(seat), float(seat) + (-2.0 if seat * 2 < count else 2.0))
        for seat in range(count)
    )


def test_a_step_that_never_ran_says_nothing() -> None:
    """没跑过就一块都不讲——空壳会让界面摆出一片空白的分区。"""
    for code in ("residual_analysis", "feature_importance", "cross_validate"):
        operator, _ = registry.build(code, {})
        assert operator.report() == ()


def test_the_residual_report_draws_qq_and_drift_when_it_can() -> None:
    """五块：口径、五个统计量、分布，加上画得出来的 QQ 与随时间。"""
    blocks = ran(
        "residual_analysis", {"scored": scored(drifting(48), has_index=True)}
    ).report()
    assert titles_of(blocks) == [
        "评估口径",
        "残差统计量",
        "残差分布",
        "正态 QQ",
        "残差随时间",
    ]


def test_the_residual_stats_carry_the_chinese_names() -> None:
    """五个键补上中文名：界面上今天印的是裸 snake_case。"""
    blocks = ran(
        "residual_analysis", {"scored": scored(((3.0, 1.0), (5.0, 1.0)))}
    ).report()
    found = {
        item["name"]: item["value"] for item in items_of(blocks, "残差统计量")
    }
    assert found["偏均值"] == pytest.approx(3.0)
    assert found["离散度"] == pytest.approx(1.0)
    assert found["最大绝对误差"] == pytest.approx(4.0)


def test_the_residual_scatter_finally_gets_its_pairs() -> None:
    """⚠ 这一步从前不产 `pairs`，残差散点整张画不出来。"""
    frame = scored(drifting(48))
    payload = ran("residual_analysis", {"scored": frame}).run(
        {"scored": frame}
    )["metrics"]
    assert isinstance(payload, MetricsPayload)
    assert len(payload.pairs) == 48
    assert payload.pairs[0] == (0.0, -2.0)
    assert payload.is_truncated is False


def test_the_drift_line_averages_each_slot_instead_of_sampling_it() -> None:
    """⚠ 按格取均值：抽样会把工况切换造成的整段偏移抽没了。

    前半段残差恒为 +2、后半段恒为 −2，两头的格子必须是这两个数。
    """
    blocks = ran(
        "residual_analysis", {"scored": scored(drifting(240), has_index=True)}
    ).report()
    items = items_of(blocks, "残差随时间")
    assert len(items) == 60
    assert items[0]["count"] == 4
    assert items[0]["value"] == pytest.approx(2.0)
    assert items[-1]["value"] == pytest.approx(-2.0)
    assert items[0]["name"] == "1970-01-01T00:00:00+00:00"


def test_a_scored_frame_without_moments_draws_no_drift_line() -> None:
    """没有时刻就不画那条线：拿行序冒充时间轴会把断档画成连续的。"""
    blocks = ran("residual_analysis", {"scored": scored(drifting(48))}).report()
    assert "残差随时间" not in titles_of(blocks)


def test_a_flat_residual_draws_no_qq_line() -> None:
    """残差没有离散度时不画 QQ：那条线退化成一个点，画出来读成「正态」。"""
    blocks = ran(
        "residual_analysis",
        {"scored": scored(((1.0, 0.0), (2.0, 1.0), (3.0, 2.0)))},
    ).report()
    assert "正态 QQ" not in titles_of(blocks)


def test_the_qq_line_pairs_the_measured_quantile_with_the_normal_one() -> None:
    """QQ 上每一项都是「实测分位 + 同均值同方差的正态分位」两个数。"""
    blocks = ran(
        "residual_analysis", {"scored": scored(drifting(48), has_index=True)}
    ).report()
    items = items_of(blocks, "正态 QQ")
    assert len(items) == 51
    assert items[0]["expected"] < items[-1]["expected"]
    assert items[25]["ratio"] == pytest.approx(0.5)


def test_the_residual_worst_load_still_fits_the_report_budget() -> None:
    """366 天逐时 × 一百个桶：讲解装得下，一块都不用降档丢掉。"""
    operator = ran(
        "residual_analysis",
        {"scored": scored(drifting(YEAR_ROWS), has_index=True)},
        bins=100,
    )
    report = report_budget.fit_report(operator.report())
    assert report is not None
    assert report["dropped"] == []
    assert report_budget.size_of(report) < REPORT_MAX_BYTES


def importance_of(frame: Frame, **config: Any) -> OperatorBase:
    """跑一遍特征重要性。

    Args: frame, config。
    """
    return ran(
        "feature_importance",
        {"model": model_of(frame), "test": frame},
        **config,
    )


def test_the_importance_keys_leave_the_flat_metrics_dictionary() -> None:
    """⚠ 列名不再当指标键：某列叫 `mape` 时那个数会被印上百分号。"""
    frame = training()
    payload = importance_of(frame).run(
        {"model": model_of(frame), "test": frame}
    )["metrics"]
    assert isinstance(payload, MetricsPayload)
    assert payload.metrics == {}


def test_the_importance_report_ranks_the_columns_and_shows_the_baseline() -> (
    None
):
    """三块：口径、基线分、按重要性降序的排行。"""
    blocks = importance_of(training()).report()
    assert titles_of(blocks) == ["评估口径", "打乱前的基线分", "特征重要性"]
    items = items_of(blocks, "特征重要性")
    assert [item["name"] for item in items] == ["第0列", "第1列"]
    assert items[0]["value"] > items[1]["value"]


def test_the_ranking_puts_the_important_column_first_whatever_its_slot() -> (
    None
):
    """⚠ 按重要性降序，不按 `feature_keys` 原序。

    原序在图上读不出任何东西：驱动列排在第二栏时，一排既不排序也不可比的条会
    让读者以为第一栏那列最重要。
    """
    items = items_of(importance_of(training(driver=1)).report(), "特征重要性")
    assert [item["name"] for item in items] == ["第1列", "第0列"]
    assert items[0]["value"] > items[1]["value"]


def test_the_baseline_score_says_which_kind_of_score_it_is() -> None:
    """⚠ 没有基线分读不出重要性的量级：0.12 在 R²=0.9 与 0.2 上不是一回事。"""
    blocks = importance_of(training()).report()
    baseline = block_of(blocks, "打乱前的基线分").payload
    assert baseline["score_kind"] == "r2"
    assert baseline["baseline"] == pytest.approx(1.0)
    assert baseline["items"][0]["name"] == "R²"


def test_each_column_reports_how_much_its_repeats_wobbled() -> None:
    """打乱多遍之间的波动跟着每一列走；只打乱一遍时留 None，不给 0。"""
    once = items_of(importance_of(training(), repeats=1).report(), "特征重要性")
    many = items_of(importance_of(training(), repeats=4).report(), "特征重要性")
    assert once[0]["spread"] is None
    assert many[0]["spread"] is not None
    assert many[0]["spread"] >= 0.0


def test_the_importance_scope_counts_the_columns_and_the_repeats() -> None:
    """口径块上写清在几行上、打乱了几列、每列打乱几遍。"""
    stages = {
        stage["name"]: stage["value"]
        for stage in block_of(
            importance_of(training(), repeats=3).report(), "评估口径"
        ).payload["funnel"]
    }
    assert stages["测试行数"] == 40
    assert stages["特征列数"] == 2
    assert stages["每列打乱"] == 3


def test_the_importance_worst_load_still_fits_the_report_budget() -> None:
    """六十列特征：讲解装得下，一块都不用降档丢掉。"""
    operator = importance_of(training(columns=WIDE_COLUMNS, rows=120))
    report = report_budget.fit_report(operator.report())
    assert report is not None
    assert report["dropped"] == []
    assert report_budget.size_of(report) < REPORT_MAX_BYTES


def validated(frame: Frame, **config: Any) -> OperatorBase:
    """跑一遍交叉验证。

    Args: frame, config。
    """
    return ran(
        "cross_validate", {"model": model_of(frame), "frame": frame}, **config
    )


def test_the_fold_report_lays_out_the_scope_the_scores_and_the_layout() -> None:
    """三块：配置对实得、逐折分数、折布局。"""
    blocks = validated(training(), folds=4).report()
    assert [(block.kind, block.title) for block in blocks] == [
        ("rows", "折的配置与实得"),
        ("breakdown", "逐折分数"),
        ("axis", "折布局"),
    ]


def test_the_forward_chain_says_why_it_got_one_fold_less() -> None:
    """⚠ 配置 4 折、实得 3 折：界面今天对这个差一个字都没解释。"""
    stages = {
        stage["name"]: stage
        for stage in block_of(
            validated(training(), folds=4).report(), "折的配置与实得"
        ).payload["funnel"]
    }
    assert stages["配置折数"]["value"] == 4
    assert stages["实得折数"]["value"] == 3
    assert "第一折没有可训的行" in stages["实得折数"]["note"]
    assert stages["每折测试行"]["value"] == 10


def test_an_even_split_gets_every_fold_it_asked_for() -> None:
    """等分 K 折不丢折，那句解释也就不摆。"""
    stages = {
        stage["name"]: stage
        for stage in block_of(
            validated(training(), folds=4, method="kfold").report(),
            "折的配置与实得",
        ).payload["funnel"]
    }
    assert stages["实得折数"]["value"] == 4
    assert stages["实得折数"]["note"] == ""


def test_the_fold_scores_survive_instead_of_being_folded_into_four() -> None:
    """⚠ 逐折分数从前被折成四个标量就扔了，逐折波动画不出来。"""
    blocks = validated(training(), folds=4).report()
    scores = items_of(blocks, "逐折分数")
    assert [item["name"] for item in scores] == [
        "第 1 折",
        "第 2 折",
        "第 3 折",
    ]
    payload = block_of(blocks, "逐折分数").payload
    assert payload["score_kind"] == "r2"
    assert payload["baseline"] == pytest.approx(
        sum(item["value"] for item in scores) / 3
    )


def drifting_folds() -> Frame:
    """第一折严格线性、第二折抬一点、末折抬一大截：三折的分必然互不相同。

    ⚠ 「互不相同」是这份数据的全部用意：三折同分时，把逐折分换成全折均值照样
    一片绿，而那正是这条图要防的事。
    """
    return Frame(
        columns=(
            FrameColumn(key="甲", name="甲", dtype="number", role=ROLE_FEATURE),
            FrameColumn(
                key=TARGET, name=TARGET, dtype="number", role=ROLE_TARGET
            ),
        ),
        rows=tuple(
            (float(seat % 10), 3.0 * float(seat % 10) + 10.0 + _shift(seat))
            for seat in range(FOLD_ROWS)
        ),
    )


def _shift(seat: int) -> float:
    """这一行的目标列被抬高多少。第一折不动、第二折抬一点、末折抬一大截。

    Args: seat。
    """
    if seat >= FOLD_ROWS - 10:
        return LATE_SHIFT
    return MID_SHIFT if seat >= FOLD_ROWS - 20 else 0.0


def test_each_fold_keeps_its_own_score_instead_of_the_average() -> None:
    """⚠ 逐折的分逐折给：抹成全折均值的话，「第 3 折特别差」在图上就没了。"""
    items = fold_score_items((0.9, 0.2, 0.95))
    assert [item["value"] for item in items] == [0.9, 0.2, 0.95]
    assert [item["name"] for item in items] == ["第 1 折", "第 2 折", "第 3 折"]


def test_the_fold_that_drifted_shows_up_as_its_own_low_bar() -> None:
    """末折上关系整体漂了：它的分是很负的一个数，前两折仍贴着 1。

    三个数互不相同，且没有一个等于那条均值基准线——抹平之后三根柱一样高。
    """
    blocks = validated(drifting_folds(), folds=4).report()
    scores = [item["value"] for item in items_of(blocks, "逐折分数")]
    assert scores[0] == pytest.approx(1.0)
    assert scores[1] == pytest.approx(0.9461, abs=1e-4)
    assert scores[2] == pytest.approx(-19.8365, abs=1e-4)
    baseline = block_of(blocks, "逐折分数").payload["baseline"]
    assert baseline == pytest.approx(sum(scores) / 3)
    assert [value for value in scores if value == baseline] == []


def test_the_fold_layout_puts_the_train_and_test_spans_on_the_row_axis() -> (
    None
):
    """每折的训练段与测试段按行区间给：前向链是「拿之前的行训这一折」。"""
    segments = block_of(
        validated(training(), folds=4).report(), "折布局"
    ).payload["segments"]
    assert segments[0] == {
        "name": "第 1 折",
        "since": 0,
        "until": 10,
        "test_since": 10,
        "test_until": 20,
        "train_rows": 10,
        "test_rows": 10,
    }
    assert segments[-1]["test_until"] == 40


def test_the_fold_layout_is_the_auxiliary_chart() -> None:
    """折布局是辅图：超预算时它比逐折分数那张主体图先走。"""
    blocks = validated(training(), folds=4).report()
    assert block_of(blocks, "折布局").payload["is_primary"] is False
    assert block_of(blocks, "逐折分数").payload["is_primary"] is True


def test_the_fold_worst_load_still_fits_the_report_budget() -> None:
    """二十折：讲解装得下，一块都不用降档丢掉。"""
    operator = validated(training(rows=400), folds=MAX_FOLDS, method="kfold")
    report = report_budget.fit_report(operator.report())
    assert report is not None
    assert report["dropped"] == []
    assert report_budget.size_of(report) < REPORT_MAX_BYTES
