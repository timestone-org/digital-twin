"""回归评估与分类评估的结果面：抽样口径、指标条目、残差分布、类别分布。

⚠ 散点那一组必须是**等距抽样**：头切在时序数据上等于只看测试段最早的那一截，
而同屏的残差直方是在全量残差上算的，两张图的口径就此对不上。
⚠ 正类既可能不在这份测试集里，也与配置里那个浮点数不同型——两处都由后端归一。
"""

from typing import Any

import pytest

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    MetricsPayload,
    OperatorBase,
    OperatorError,
    registry,
)
from platform_server.apps.modeling.operators.evalstats import even_sample
from platform_server.apps.modeling.operators.reporting import ReportBlock
from platform_server.apps.modeling.services import report_budget
from platform_server.apps.modeling.services.preview import REPORT_MAX_BYTES

HOUR_MS = 3_600_000
# 最坏负载：366 天逐时的测试集，散点与桶数都开到参数上限
YEAR_ROWS = 366 * 24
MAX_SCATTER = 5000
MAX_BINS = 100


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


def ran(code: str, frame: Frame, **config: Any) -> OperatorBase:
    """跑一遍某个评估算子，回它自己（`report()` 要问它）。

    Args: code, frame, config。
    """
    operator, _ = registry.build(code, config)
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    operator.run({"scored": frame})
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


def stages_of(blocks: tuple[ReportBlock, ...], title: str) -> dict[str, Any]:
    """一块行数账上的漏斗，按级名建键。

    Args: blocks, title。
    """
    stages: list[dict[str, Any]] = block_of(blocks, title).payload["funnel"]
    return {stage["name"]: stage for stage in stages}


def straight(count: int) -> tuple[tuple[float, float], ...]:
    """预测每行都低一个单位：残差恒为 1，五个指标都算得出来。

    Args: count。
    """
    return tuple((float(seat + 1), float(seat)) for seat in range(1, count + 1))


def test_a_step_that_never_ran_says_nothing() -> None:
    """没跑过就一块都不讲——空壳会让界面摆出一片空白的分区。"""
    operator, _ = registry.build("regression_metrics", {})
    assert operator.report() == ()


def test_the_five_metric_blocks_land_in_four_zones() -> None:
    """五块各就各位：口径在第一区、指标在第二区、图在第三区、明细在第五区。"""
    blocks = ran("regression_metrics", scored(straight(20))).report()
    assert [(block.kind, block.zone) for block in blocks] == [
        ("rows", "step"),
        ("breakdown", "stats"),
        ("bins", "charts"),
        ("breakdown", "table"),
        ("breakdown", "table"),
    ]


def test_the_scatter_scope_counts_the_points_it_gave_back() -> None:
    """三十行取十个点：口径块上写的是十，不是三十。"""
    blocks = ran(
        "regression_metrics", scored(straight(30)), max_scatter_points=50
    ).report()
    counts = block_of(blocks, "散点抽样口径").payload
    assert counts["before"] == 30
    assert counts["after"] == 30
    assert counts["ratio_actual"] == 1.0
    assert stages_of(blocks, "散点抽样口径")["散点上限"]["value"] == 50


def test_the_scatter_keeps_the_last_row_instead_of_the_first_few() -> None:
    """⚠ 等距抽样不是头切：抽回来的最后一个点就是测试段最后一行。

    头切在时序上等于只看最早那一段，而残差直方是在全量上算的。
    """
    frame = scored(straight(200))
    payload = ran("regression_metrics", frame, max_scatter_points=50).run(
        {"scored": frame}
    )["metrics"]
    assert isinstance(payload, MetricsPayload)
    assert len(payload.pairs) == 50
    assert payload.pairs[0] == (2.0, 1.0)
    assert payload.pairs[-1] == (201.0, 200.0)
    assert payload.pairs[1] == (6.0, 5.0)
    assert payload.is_truncated is True


def test_an_even_sample_spans_the_whole_row_range() -> None:
    """抽样点覆盖首尾：只要够抽，第一行与最后一行一定在里面。"""
    assert even_sample(tuple(range(10)), 3) == (0, 4, 9)
    assert even_sample(tuple(range(3)), 10) == (0, 1, 2)


def test_the_metric_items_carry_the_chinese_name_and_the_band_key() -> None:
    """指标条目自带中文名与分档口径；没有公认好坏线的那几个是空串。"""
    blocks = ran("regression_metrics", scored(straight(20))).report()
    items = {item["key"]: item for item in items_of(blocks, "回归指标")}
    assert items["r2"]["score_kind"] == "r2"
    assert items["mape"]["unit"] == "%"
    assert items["rmse"]["score_kind"] == ""
    assert items["mae"]["value"] == pytest.approx(1.0)


def test_the_residual_mean_and_spread_ride_along_with_the_metrics() -> None:
    """偏均值与离散度一并算：残差直方上那条正态参考曲线要这两个数。"""
    frame = scored(straight(20))
    payload = ran("regression_metrics", frame).run({"scored": frame})["metrics"]
    assert isinstance(payload, MetricsPayload)
    assert payload.metrics["residual_mean"] == pytest.approx(1.0)
    assert payload.metrics["residual_std"] == pytest.approx(0.0)


def test_the_residual_bins_carry_the_zero_line_and_the_bias_line() -> None:
    """零误差与偏均值两条线都画；σ=0 时不再画那两条会叠在一起的 ±1σ。"""
    blocks = ran("regression_metrics", scored(straight(20))).report()
    column = block_of(blocks, "残差分布").payload["by_column"][0]
    assert [mark["label"] for mark in column["marks"]] == ["零误差", "偏均值"]
    assert column["marks"][1]["at"] == pytest.approx(1.0)


def test_the_quantiles_come_from_the_interpolation_we_wrote_down() -> None:
    """分位数按线性插值算，且最大绝对误差单列一项。"""
    rows = tuple((float(seat), 0.0) for seat in range(11))
    items = items_of(
        ran("regression_metrics", scored(rows)).report(), "残差分位数"
    )
    found = {item["name"]: item["value"] for item in items}
    assert found["中位数"] == pytest.approx(5.0)
    assert found["下四分位"] == pytest.approx(2.5)
    assert found["最大绝对误差"] == pytest.approx(10.0)


def test_the_worst_rows_come_first_and_carry_their_moment() -> None:
    """误差最大的排最前，且带上那一行的时刻——不然用户查不到是哪一段。"""
    rows = ((1.0, 1.0), (2.0, 2.0), (3.0, 30.0), (4.0, 4.5))
    items = items_of(
        ran("regression_metrics", scored(rows, has_index=True)).report(),
        "误差最大的那几行",
    )
    assert items[0]["value"] == pytest.approx(-27.0)
    assert items[0]["row"] == 2
    assert items[0]["name"] == "1970-01-01T02:00:00+00:00"
    assert items[1]["value"] == pytest.approx(-0.5)


def test_a_scored_frame_without_moments_falls_back_to_row_numbers() -> None:
    """没有时刻就用行序称呼，不编一个时刻出来。"""
    items = items_of(
        ran("regression_metrics", scored(((1.0, 5.0), (2.0, 2.0)))).report(),
        "误差最大的那几行",
    )
    assert items[0]["name"] == "第 1 行"


def test_the_scored_worst_load_still_fits_the_report_budget() -> None:
    """366 天逐时 × 五千散点 × 一百个桶：讲解装得下，一块都不用降档丢掉。"""
    frame = scored(straight(YEAR_ROWS), has_index=True)
    operator = ran(
        "regression_metrics",
        frame,
        max_scatter_points=MAX_SCATTER,
        residual_bins=MAX_BINS,
    )
    report = report_budget.fit_report(operator.report())
    assert report is not None
    assert report["dropped"] == []
    assert report_budget.size_of(report) < REPORT_MAX_BYTES


def classified() -> Frame:
    """三类五行：真实 [0,0,1,1,2]，预测 [0,1,1,1,2]。"""
    return scored(((0.0, 0.0), (0.0, 1.0), (1.0, 1.0), (1.0, 1.0), (2.0, 2.0)))


def test_the_classification_report_lays_out_three_blocks() -> None:
    """三块各就各位：判对判错的账、四个指标、类别分布。"""
    blocks = ran("classification_metrics", classified()).report()
    assert [(block.kind, block.zone, block.title) for block in blocks] == [
        ("rows", "step", "评估口径"),
        ("breakdown", "stats", "分类指标"),
        ("breakdown", "charts", "类别分布"),
    ]


def test_the_scope_counts_the_rows_it_got_right_and_wrong() -> None:
    """五行里判对四行、判错一行，三类。"""
    stages = stages_of(
        ran("classification_metrics", classified()).report(), "评估口径"
    )
    assert stages["测试行数"]["value"] == 5
    assert stages["类目数"]["value"] == 3
    assert stages["判对"]["value"] == 4
    assert stages["判错"]["value"] == 1


def test_the_class_shares_put_the_truth_beside_the_prediction() -> None:
    """真实占比与预测占比并排：模型是不是全押多数类，一看就穿帮。"""
    items = items_of(
        ran("classification_metrics", classified()).report(), "类别分布"
    )
    found = {item["name"]: item for item in items}
    assert found["0"]["before"] == pytest.approx(0.4)
    assert found["0"]["after"] == pytest.approx(0.2)
    assert found["1"]["after"] == pytest.approx(0.6)
    assert found["1"]["predicted_rows"] == 3


def test_the_positive_class_is_named_in_the_text_the_labels_use() -> None:
    """⚠ 配置里的正类是浮点数、类目是字符串，归一化只做一次且做在后端。"""
    frame = classified()
    payload = ran("classification_metrics", frame, positive_label=1.0).run(
        {"scored": frame}
    )["metrics"]
    assert isinstance(payload, MetricsPayload)
    assert payload.positive_label_text == "1"
    assert payload.labels == ("0", "1", "2")


def test_a_positive_class_that_never_shows_up_says_so() -> None:
    """⚠ 正类不在这份测试集里时精确率与召回率无定义，那句话要写出来。"""
    blocks = ran(
        "classification_metrics", classified(), positive_label=7.0
    ).report()
    label = block_of(blocks, "分类指标").payload["label"]
    assert "「7」" in label
    assert "一次都没出现过" in label


def test_a_positive_class_that_shows_up_names_itself_instead() -> None:
    """正类在里面时说的是它，不摆那句无定义的话。"""
    blocks = ran(
        "classification_metrics", classified(), positive_label=2.0
    ).report()
    label = block_of(blocks, "分类指标").payload["label"]
    assert "正类「2」" in label
    assert "一次都没出现过" not in label


def test_an_empty_test_set_is_refused_instead_of_drawing_a_blank() -> None:
    """⚠ 空测试集当场说清，不给四个 None 加一张空矩阵。"""
    with pytest.raises(OperatorError, match="一行都没有"):
        ran("classification_metrics", scored(()))


def test_the_classification_worst_load_still_fits_the_report_budget() -> None:
    """二十类 × 366 天逐时：讲解装得下，一块都不用降档丢掉。"""
    rows = tuple(
        (float(seat % 20), float((seat + 1) % 20)) for seat in range(YEAR_ROWS)
    )
    operator = ran("classification_metrics", scored(rows))
    report = report_budget.fit_report(operator.report())
    assert report is not None
    assert report["dropped"] == []
    assert report_budget.size_of(report) < REPORT_MAX_BYTES
