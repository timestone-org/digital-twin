"""分类评估的概率侧：ROC / PR / 校准三条曲线与阈值网格。

⚠ 曲线由后端算：前端手上只有截断过的散点，拿它现算的曲线与同一屏的指标卡对不上
账（docs/MODELING_RESULT_VIEW_DESIGN.md §13.3）。
⚠ 退化情形一律是「说清楚算不出来」而不是「画一条乱线」：缺一整类、全同概率、
只有一行、一行都没有，四种各有各的行为，这里逐条钉住。
"""

from typing import Any

import pytest

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    OperatorBase,
    registry,
)
from platform_server.apps.modeling.operators.evalcurves import (
    GRID_POINTS,
    MULTICLASS_NOTE,
    NO_PROBABILITY_NOTE,
    ONE_SIDED_NOTE,
    Curves,
    ThresholdCount,
    calibration_items,
    curves_of,
    grid_items,
    pr_items,
    roc_items,
)
from platform_server.apps.modeling.operators.frame import ROLE_TARGET
from platform_server.apps.modeling.operators.reporting import ReportBlock
from platform_server.apps.modeling.services import report_budget
from platform_server.apps.modeling.services.preview import REPORT_MAX_BYTES

# 一行打分：真实类目、预测类目、正类概率
type Row = tuple[float, float, float]

HOUR_MS = 3_600_000
# 最坏负载：366 天逐时，每行一个各不相同的概率
YEAR_ROWS = 366 * 24
# 手算得出答案的四行：概率 [0.9, 0.8, 0.4, 0.1]、真实 [1, 0, 1, 0]
HAND: tuple[Row, ...] = (
    (1.0, 1.0, 0.9),
    (0.0, 1.0, 0.8),
    (1.0, 0.0, 0.4),
    (0.0, 0.0, 0.1),
)
# 上面那四行的 AUC 与 AP：AUC = 3/4 对正负配对，AP = 1×0.5 + 2/3×0.5
HAND_AUC = 0.75
HAND_AP = 5 / 6
# 正负各半的夹具上「读真实正类占比」与「写死 0.5」同值，基线写错也全绿；正类
# 占比刻意偏成 0.3，且 1 − 0.3 也不等于 0.3，把正负两个分子也分辨开
SKEWED: tuple[Row, ...] = tuple(
    (
        1.0 if seat in {5, 7, 9} else 0.0,
        1.0 if seat >= 5 else 0.0,
        seat / 10.0 + 0.05,
    )
    for seat in range(10)
)
SKEWED_POSITIVE_RATE = 0.3


def scored(
    rows: tuple[Row, ...], *, has_proba: bool = True, dtype: str = "number"
) -> Frame:
    """一份打分帧：真实类目、预测类目，以及可缺的正类概率列。

    Args: rows, has_proba, dtype（概率列的类型，用来试非数值列）。
    """
    columns = [
        FrameColumn(key="y_true", name="真实值", dtype="number"),
        FrameColumn(key="y_pred", name="预测值", dtype="number"),
    ]
    if has_proba:
        columns.append(FrameColumn(key="y_proba", name="正类概率", dtype=dtype))
    width = 3 if has_proba else 2
    return Frame(
        columns=tuple(columns),
        rows=tuple(row[:width] for row in rows),
        index=tuple(seat * HOUR_MS for seat in range(len(rows))),
    )


def ran(frame: Frame, **config: Any) -> OperatorBase:
    """跑一遍分类评估，回它自己（`report()` 要问它）。

    Args: frame, config。
    """
    operator, _ = registry.build("classification_metrics", config)
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


def titles_of(blocks: tuple[ReportBlock, ...]) -> list[str]:
    """一份讲解里都有哪几块。

    Args: blocks。
    """
    return [block.title for block in blocks]


def items_of(blocks: tuple[ReportBlock, ...], title: str) -> list[Any]:
    """一块按项的数里的那几项。

    Args: blocks, title。
    """
    payload: list[Any] = block_of(blocks, title).payload["items"]
    return payload


def notes_of(blocks: tuple[ReportBlock, ...], title: str) -> list[str]:
    """一块上挂着的那几句话。

    Args: blocks, title。
    """
    notes: list[dict[str, Any]] = (
        block_of(blocks, title).payload.get("notes") or []
    )
    return [str(note["text"]) for note in notes]


def stat_of(blocks: tuple[ReportBlock, ...], key: str) -> float | None:
    """概率评估那一块里某个关键数字。

    Args: blocks, key。
    """
    for item in items_of(blocks, "概率评估"):
        if item["key"] == key:
            value: float | None = item["value"]
            return value
    raise AssertionError(f"概率评估里没有「{key}」")


def binary(count: int) -> tuple[Row, ...]:
    """逐行各不相同的概率，真实类目逐行交替。

    Args: count。
    """
    return tuple(
        (
            float(seat % 2),
            1.0 if (seat + 0.5) / count >= 0.5 else 0.0,
            (seat + 0.5) / count,
        )
        for seat in range(count)
    )


def test_the_probability_side_adds_five_blocks_on_top_of_the_three() -> None:
    """二分类带概率列时，三块之外还有关键数字、三条曲线与阈值网格。"""
    assert titles_of(ran(scored(HAND)).report()) == [
        "评估口径",
        "分类指标",
        "类别分布",
        "概率评估",
        "ROC 曲线",
        "PR 曲线",
        "校准曲线",
        "阈值网格",
    ]


def test_the_curves_all_land_in_the_chart_zone_and_say_their_rank() -> None:
    """四张新图都在图区，且各自显式标了主次——漏标的辅图会挤掉主体图。"""
    blocks = ran(scored(HAND)).report()
    for title in ("ROC 曲线", "PR 曲线", "校准曲线", "阈值网格"):
        block = block_of(blocks, title)
        assert block.zone == "charts"
        assert isinstance(block.payload["is_primary"], bool)
    assert block_of(blocks, "概率评估").zone == "stats"


def test_the_area_under_the_roc_is_the_hand_computed_three_quarters() -> None:
    """四行手算：正负两两配对四对，正类排在前面的三对，AUC = 0.75。"""
    assert stat_of(ran(scored(HAND)).report(), "auc") == pytest.approx(HAND_AUC)


def test_the_average_precision_is_the_hand_computed_five_sixths() -> None:
    """AP = Σ（召回增量 × 该点精确率）= 0.5×1 + 0.5×(2/3)，不是梯形面积。"""
    made = stat_of(ran(scored(HAND)).report(), "average_precision")
    assert made == pytest.approx(HAND_AP)


def test_the_positive_share_is_the_pr_baseline() -> None:
    """正类占比同时是关键数字与 PR 曲线的基线：两处必须是同一个数。

    ⚠ 夹具的正类占比不是 0.5：正负各半时「读真实正类占比」「写死 0.5」「读负类
    占比」三种写法同值，基线画错了照样全绿。
    """
    blocks = ran(scored(SKEWED)).report()
    share = stat_of(blocks, "positive_rate")
    baseline = block_of(blocks, "PR 曲线").payload["baseline"]
    assert share == pytest.approx(SKEWED_POSITIVE_RATE)
    assert baseline == pytest.approx(SKEWED_POSITIVE_RATE)
    assert baseline != pytest.approx(0.5)
    assert baseline != pytest.approx(1 - SKEWED_POSITIVE_RATE)


def test_the_three_key_numbers_are_never_colour_banded() -> None:
    """⚠ AUC 的随机线在 0.5、AP 的在正类占比，套准确率那套档位会印成绿的。"""
    for item in items_of(ran(scored(HAND)).report(), "概率评估"):
        assert item["score_kind"] == ""


def test_the_roc_curve_runs_from_the_origin_to_the_far_corner() -> None:
    """ROC 起于 (0,0) 止于 (1,1)：少了任一端，曲线下面积就不是面积。"""
    points = items_of(ran(scored(HAND)).report(), "ROC 曲线")
    assert (points[0]["fpr"], points[0]["tpr"]) == (0.0, 0.0)
    assert points[0]["threshold"] is None
    assert (points[-1]["fpr"], points[-1]["tpr"]) == (1.0, 1.0)


def test_every_roc_point_is_the_rate_pair_at_that_threshold() -> None:
    """逐点核对：阈值 0.8 上判对一个正类、错判一个负类，故 (0.5, 0.5)。"""
    points = items_of(ran(scored(HAND)).report(), "ROC 曲线")
    found = {point["name"]: point for point in points}
    assert found["0.900"]["fpr"] == pytest.approx(0.0)
    assert found["0.900"]["tpr"] == pytest.approx(0.5)
    assert found["0.800"]["fpr"] == pytest.approx(0.5)
    assert found["0.400"]["tpr"] == pytest.approx(1.0)


def test_the_pr_curve_starts_at_the_low_recall_end() -> None:
    """PR 的左端是召回最小的那一头，不是阈值最小的那一头。"""
    points = items_of(ran(scored(HAND)).report(), "PR 曲线")
    assert points[0]["recall"] == pytest.approx(0.5)
    assert points[0]["precision"] == pytest.approx(1.0)
    assert points[-1]["recall"] == pytest.approx(1.0)
    assert points[-1]["precision"] == pytest.approx(0.5)


def test_the_threshold_grid_counts_add_up_to_the_row_count() -> None:
    """⚠ 四格之和在**每一个**阈值上都等于测试行数：少一格就是漏了一类行。"""
    rows = binary(200)
    grid = items_of(ran(scored(rows)).report(), "阈值网格")
    assert grid != []
    for point in grid:
        four = point["tp"] + point["fp"] + point["tn"] + point["fn"]
        assert four == len(rows)


def test_the_grid_counts_are_the_hand_computed_four_cells() -> None:
    """阈值 0.4 上：判对两个正类、错判一个负类、漏判零个。"""
    grid = {
        point["name"]: point
        for point in items_of(ran(scored(HAND)).report(), "阈值网格")
    }
    assert (grid["0.400"]["tp"], grid["0.400"]["fp"]) == (2, 1)
    assert (grid["0.400"]["tn"], grid["0.400"]["fn"]) == (1, 0)
    assert grid["0.400"]["value"] == pytest.approx(0.8)


def test_a_row_sitting_exactly_on_the_threshold_counts_as_positive() -> None:
    """⚠ 判据是 `>=`，与建模算子折硬标签的那一处同向：反向则两处数不一样。"""
    grid = {
        point["threshold"]: point
        for point in items_of(ran(scored(HAND)).report(), "阈值网格")
    }
    assert grid[0.9]["tp"] + grid[0.9]["fp"] == 1


def test_the_grid_marks_the_threshold_the_scoring_actually_stood_on() -> None:
    """竖线画在判成正类的最低概率上（这四行是 0.8），不写死 0.5。"""
    blocks = ran(scored(HAND)).report()
    assert block_of(blocks, "阈值网格").payload["baseline"] == pytest.approx(
        0.8
    )


def test_the_area_is_computed_on_every_distinct_probability() -> None:
    """⚠ AUC 用全部一百档算、图只画抽出来的那几十档：抽样过的面积会偏。"""
    rows = tuple((float(seat % 2), 1.0, seat / 200.0) for seat in range(100))
    blocks = ran(scored(rows)).report()
    assert stat_of(blocks, "auc") == pytest.approx(0.51)
    assert len(items_of(blocks, "阈值网格")) == GRID_POINTS


def test_the_roc_point_list_still_fits_the_item_cap() -> None:
    """⚠ ROC 比网格多一个锚点：多出来的那一个会被上限静默截掉 (1,1)。"""
    points = items_of(ran(scored(binary(500))).report(), "ROC 曲线")
    assert len(points) == GRID_POINTS + 1
    assert (points[-1]["fpr"], points[-1]["tpr"]) == (1.0, 1.0)


def thick() -> tuple[Row, ...]:
    """两个厚箱加一个薄箱：0.05 十行、0.85 十行、0.35 五行。"""
    low = tuple((1.0 if seat == 0 else 0.0, 0.0, 0.05) for seat in range(10))
    high = tuple((0.0 if seat == 0 else 1.0, 1.0, 0.85) for seat in range(10))
    thin = tuple((1.0, 0.0, 0.35) for _ in range(5))
    return low + high + thin


def test_the_calibration_bins_pair_the_mean_guess_with_the_real_rate() -> None:
    """0.05 那十行里真有一个正类：预测 0.05、实际 0.1，两个数并排摆。"""
    bins = {
        item["name"]: item
        for item in items_of(ran(scored(thick())).report(), "校准曲线")
    }
    assert bins["0.0–0.1"]["predicted"] == pytest.approx(0.05)
    assert bins["0.0–0.1"]["actual"] == pytest.approx(0.1)
    assert bins["0.8–0.9"]["predicted"] == pytest.approx(0.85)
    assert bins["0.8–0.9"]["actual"] == pytest.approx(0.9)


def test_a_thin_calibration_bin_is_marked_so_it_can_be_drawn_hollow() -> None:
    """⚠ 五行上的实际正类率抖得读不出校准，那个点要画空心。"""
    bins = {
        item["name"]: item
        for item in items_of(ran(scored(thick())).report(), "校准曲线")
    }
    assert bins["0.3–0.4"]["count"] == 5
    assert bins["0.3–0.4"]["is_sparse"] is True
    assert bins["0.0–0.1"]["count"] == 10
    assert bins["0.0–0.1"]["is_sparse"] is False


def test_the_empty_calibration_bins_are_left_out() -> None:
    """空箱不列：补一个 0 会画出一段一行数据都没有的假塌陷。"""
    names = [item["name"] for item in calibration_items((0.05,), (True,))]
    assert names == ["0.0–0.1"]


def test_the_f1_on_an_all_negative_threshold_is_undefined() -> None:
    """⚠ 一行都没判成正类、也一个真正类都没有时 F1 给 `None` 不给 0——印成 0
    会被读成「这个阈值上模型全判错了」，而实际是这个数没有定义。"""
    made = grid_items(
        Curves(
            grid=(ThresholdCount(0.9, 0, 0, 5, 0),),
            positives=0,
            negatives=5,
            auc=None,
            average_precision=None,
            positive_rate=0.0,
        )
    )
    assert made[0]["value"] is None
    assert made[0]["tn"] == 5


def test_a_single_class_test_set_refuses_to_draw_the_two_curves() -> None:
    """只有正类时 AUC 与 AP 都无定义，ROC 与 PR 一个点都不给。"""
    rows = tuple((1.0, 1.0, 0.2 + seat * 0.1) for seat in range(5))
    blocks = ran(scored(rows)).report()
    assert stat_of(blocks, "auc") is None
    assert stat_of(blocks, "average_precision") is None
    assert "ROC 曲线" not in titles_of(blocks)
    assert "PR 曲线" not in titles_of(blocks)
    assert ONE_SIDED_NOTE in notes_of(blocks, "概率评估")


def test_a_single_class_test_set_still_keeps_the_grid_and_calibration() -> None:
    """⚠ 网格与校准在单类上照样有意义：能算的那两样不跟着不能算的一起消失。"""
    rows = tuple((1.0, 1.0, 0.2 + seat * 0.1) for seat in range(5))
    titles = titles_of(ran(scored(rows)).report())
    assert "阈值网格" in titles
    assert "校准曲线" in titles


def test_a_curve_with_no_negatives_is_not_drawn_as_a_perfect_line() -> None:
    """⚠ 没有负类时精确率恒为 1，画出来是贴着顶边的直线，读成「一个没判错」。"""
    curves = curves_of((0.2, 0.6, 0.9), (True, True, True))
    assert pr_items(curves) == []
    assert roc_items(curves) == []
    assert grid_items(curves) != []


def test_all_the_same_probability_lands_exactly_on_the_random_line() -> None:
    """全同概率 = 一个阈值：ROC 从 (0,0) 直连 (1,1)，AUC 恰好 0.5。"""
    rows = tuple((float(seat % 2), 1.0, 0.5) for seat in range(4))
    blocks = ran(scored(rows)).report()
    assert stat_of(blocks, "auc") == pytest.approx(0.5)
    assert len(items_of(blocks, "ROC 曲线")) == 2
    assert len(items_of(blocks, "阈值网格")) == 1


def test_a_one_row_test_set_says_the_two_numbers_are_undefined() -> None:
    """一行也算得出网格，但一行只有一类，AUC 与 AP 双双无定义。"""
    blocks = ran(scored(((1.0, 1.0, 0.7),))).report()
    assert stat_of(blocks, "auc") is None
    grid = items_of(blocks, "阈值网格")
    assert len(grid) == 1
    assert grid[0]["tp"] + grid[0]["fp"] + grid[0]["tn"] + grid[0]["fn"] == 1


def test_no_rows_at_all_produce_no_points_and_no_numbers() -> None:
    """一行都没有：三条曲线与网格全空，占比也给 None 而不是 0。"""
    curves = curves_of((), ())
    assert curves.grid == ()
    assert curves.auc is None
    assert curves.average_precision is None
    assert curves.positive_rate is None
    assert (roc_items(curves), pr_items(curves), grid_items(curves)) == (
        [],
        [],
        [],
    )
    assert calibration_items((), ()) == []


def multiclass() -> tuple[Row, ...]:
    """三类五行，且带一列概率——多分类下它没有意义，不许被拿去画曲线。"""
    return (
        (0.0, 0.0, 0.1),
        (0.0, 1.0, 0.6),
        (1.0, 1.0, 0.7),
        (1.0, 1.0, 0.8),
        (2.0, 2.0, 0.9),
    )


def test_multiclass_says_the_curves_need_two_classes() -> None:
    """⚠ 多分类哪怕带着概率列也不出四样，并在第一区说清为什么。"""
    blocks = ran(scored(multiclass())).report()
    assert titles_of(blocks) == ["评估口径", "分类指标", "类别分布"]
    assert notes_of(blocks, "评估口径") == [MULTICLASS_NOTE]


def test_a_scored_frame_without_the_column_says_so_in_its_own_words() -> None:
    """⚠ 「多分类」与「没有概率列」两句分开：两者要用户做的事不同。"""
    blocks = ran(scored(HAND, has_proba=False)).report()
    assert titles_of(blocks) == ["评估口径", "分类指标", "类别分布"]
    assert notes_of(blocks, "评估口径") == [NO_PROBABILITY_NOTE]
    assert MULTICLASS_NOTE != NO_PROBABILITY_NOTE


def test_a_probability_column_with_a_hole_is_treated_as_missing() -> None:
    """概率列里有空值时不抛：四个指标照旧算得出来，只是画不了曲线。"""
    frame = scored(HAND)
    holed = Frame(
        columns=frame.columns,
        rows=((1.0, 1.0, None), *frame.rows[1:]),
        index=frame.index,
    )
    blocks = ran(holed).report()
    assert notes_of(blocks, "评估口径") == [NO_PROBABILITY_NOTE]
    assert items_of(blocks, "分类指标") != []


def test_a_non_numeric_probability_column_does_not_kill_the_step() -> None:
    """⚠ 概率列不是数值列时也不抛：一个加项不该让整份评估失败。"""
    blocks = ran(scored(HAND, dtype="string")).report()
    assert notes_of(blocks, "评估口径") == [NO_PROBABILITY_NOTE]


def test_a_binary_run_with_curves_says_nothing_about_missing_ones() -> None:
    """画得出来时第一区一句多余的话都不说。"""
    assert notes_of(ran(scored(HAND)).report(), "评估口径") == []


def test_the_worst_probability_load_still_fits_the_report_budget() -> None:
    """366 天逐时、每行一个不同的概率：讲解装得下，一块都不用降档丢掉。"""
    operator = ran(scored(binary(YEAR_ROWS)))
    report = report_budget.fit_report(operator.report())
    assert report is not None
    assert report["dropped"] == []
    assert report_budget.size_of(report) < REPORT_MAX_BYTES


def trained() -> Frame:
    """一份线性可分的两类数据，逻辑回归拿它训、也拿它打分。"""
    return Frame(
        columns=(
            FrameColumn(key="温度", name="温度", dtype="number"),
            FrameColumn(
                key="是否超标",
                name="是否超标",
                dtype="number",
                role=ROLE_TARGET,
            ),
        ),
        rows=tuple(
            (20.0 + seat * 0.5, 1.0 if seat * 0.5 > 10.0 else 0.0)
            for seat in range(48)
        ),
        index=tuple(seat * HOUR_MS for seat in range(48)),
    )


def marked_at(threshold: float) -> tuple[ReportBlock, ...]:
    """整条链路走一遍：逻辑回归按给定阈值打分，分类评估照它讲。

    Args: threshold。
    """
    model, _ = registry.build(
        "logistic_regression", {"positive_threshold": threshold}
    )
    model.bind_runtime(tz_offset_minutes=480, split_plan=None)
    frame = trained()
    made = model.run({"train": frame, "test": frame})["scored"]
    assert isinstance(made, Frame)
    return ran(made).report()


def test_the_curves_come_out_of_a_real_logistic_run() -> None:
    """⚠ 只喂手搭的帧的话，建模算子与评估算子之间列名漂了两边照样全绿。"""
    blocks = marked_at(0.5)
    assert "ROC 曲线" in titles_of(blocks)
    assert stat_of(blocks, "auc") == pytest.approx(1.0)
    assert notes_of(blocks, "评估口径") == []


def test_the_grid_marker_follows_the_threshold_the_model_used() -> None:
    """竖线站在模型真用的那个阈值上，不站在写死的 0.5 上。"""
    low = block_of(marked_at(0.3), "阈值网格").payload["baseline"]
    high = block_of(marked_at(0.7), "阈值网格").payload["baseline"]
    assert low >= 0.3
    assert high >= 0.7
    assert low <= high
