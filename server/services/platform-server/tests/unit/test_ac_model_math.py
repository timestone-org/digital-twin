"""切折、权重、评估与门控的用例 —— 建模核心里不碰 sklearn 的那半边。"""

import math
from datetime import UTC, datetime, timedelta

import pytest

from platform_server.apps.hvac.modeling.evaluation import (
    OofPrediction,
    set_key,
    summarize,
)
from platform_server.apps.hvac.modeling.folds import time_fold_ids
from platform_server.apps.hvac.modeling.gating import (
    RELIABILITY_INDICATIVE,
    RELIABILITY_RELIABLE,
    RELIABILITY_WEAK,
    reliability,
)
from platform_server.apps.hvac.modeling.weights import decay_weights

BASE = datetime(2026, 6, 1, tzinfo=UTC)


def test_folds_are_contiguous_time_blocks() -> None:
    """折是连续时间块：折号单调不减，才不会把未来泄给过去。"""
    ids = time_fold_ids(11, 5)
    assert len(ids) == 11
    assert ids == sorted(ids)
    assert set(ids) == {0, 1, 2, 3, 4}


def test_fold_sizes_differ_by_at_most_one() -> None:
    """块尽量等长，余数摊给靠前的块。"""
    ids = time_fold_ids(13, 5)
    sizes = [ids.count(fold) for fold in range(5)]
    assert sizes == [3, 3, 3, 2, 2]


def test_folds_shrink_when_samples_are_few() -> None:
    """样本比折数还少时收缩折数，每折至少一条，不造空折。"""
    assert time_fold_ids(3, 5) == [0, 1, 2]


def test_folds_reject_degenerate_inputs() -> None:
    """样本或折数少到切不动时直接拒绝。"""
    with pytest.raises(ValueError, match="至少"):
        time_fold_ids(1, 5)
    with pytest.raises(ValueError, match="至少"):
        time_fold_ids(10, 1)


def test_weights_halve_every_half_life() -> None:
    """半衰期语义：老一个半衰期权重减半，最新样本恒为 1。"""
    moments = [BASE - timedelta(days=180), BASE - timedelta(days=90), BASE]
    found = decay_weights(moments, half_life_days=180.0)
    assert found[2] == 1.0
    assert found[0] == pytest.approx(0.5)
    assert found[1] == pytest.approx(math.sqrt(0.5))


def test_weights_depend_on_data_not_on_when_training_runs() -> None:
    """基准取样本里最新的时刻：同一份数据什么时候训权重都一样。"""
    moments = [BASE - timedelta(days=30), BASE]
    assert decay_weights(moments, half_life_days=30.0) == [0.5, 1.0]


def oof(
    *,
    minute: int,
    actual: int,
    p50: float,
    running: tuple[str, ...] = ("K11",),
) -> OofPrediction:
    """一条折外预测，区间固定 ±10 分钟。

    Args: minute, actual, p50, running。
    """
    return OofPrediction(
        started_at=BASE + timedelta(minutes=minute),
        running_set=running,
        actual_minutes=actual,
        p10=p50 - 10,
        p50=p50,
        p90=p50 + 10,
        fold=0,
    )


def test_summary_reports_error_and_interval_quality() -> None:
    """总体块：MAE/MedAE/RMSE、区间覆盖率与平均宽度。"""
    rows = [
        oof(minute=0, actual=30, p50=33.0),
        oof(minute=1, actual=40, p50=39.0),
        oof(minute=2, actual=50, p50=30.0),
    ]
    metrics = summarize(rows, serving_sets=[["K11"]])
    assert metrics.overall.count == 3
    assert metrics.overall.mae == pytest.approx((3 + 1 + 20) / 3)
    assert metrics.overall.medae == 3.0
    assert metrics.overall.coverage == pytest.approx(2 / 3)
    assert metrics.overall.mean_width == pytest.approx(20.0)


def test_by_set_groups_only_the_serving_sets() -> None:
    """按组合分组只算服务组合；别的组合的事件进总体、不单列。"""
    rows = [
        oof(minute=0, actual=30, p50=30.0),
        oof(minute=1, actual=40, p50=44.0, running=("K11", "K12")),
    ]
    metrics = summarize(rows, serving_sets=[["K12", "K11"]])
    assert metrics.overall.count == 2
    block = metrics.by_set["K11+K12"]
    assert block is not None
    assert block.count == 1
    assert block.mae == 4.0


def test_a_serving_set_with_no_samples_is_none_not_zero() -> None:
    """⚠ 没样本的组合是 None：0 会被读成「误差为零的完美模型」。"""
    metrics = summarize(
        [oof(minute=0, actual=30, p50=30.0)], serving_sets=[["K16"]]
    )
    assert metrics.by_set["K16"] is None


def test_set_key_is_order_insensitive() -> None:
    """组合键按 serial 升序拼，入参顺序不影响。"""
    assert set_key(["K12", "K11"]) == set_key(("K11", "K12")) == "K11+K12"


def test_hot_rows_get_their_own_stats() -> None:
    """⚠ 热行（实际>0）单独一份统计：整体 MAE 被零行灌水，不能拿来评模型。"""
    rows = [
        oof(minute=0, actual=0, p50=0.0),
        oof(minute=1, actual=0, p50=0.0),
        oof(minute=2, actual=30, p50=40.0),
        oof(minute=3, actual=60, p50=0.0),
    ]
    metrics = summarize(rows, serving_sets=[["K11"]])
    overall = metrics.overall
    assert overall.hot is not None
    assert overall.hot.count == 2
    assert overall.hot.mae == pytest.approx((10 + 60) / 2)
    assert overall.zero_count == 2
    # 两条零行都判成了 0；两条热行只有一条被判出非零
    assert overall.zero_hit_rate == pytest.approx(1.0)
    assert overall.hot_hit_rate == pytest.approx(0.5)


def test_all_zero_rows_leave_hot_stats_as_none() -> None:
    """只有零行时热行统计是 None 不是零——没有可评的对象。"""
    rows = [oof(minute=0, actual=0, p50=0.0)]
    metrics = summarize(rows, serving_sets=[["K11"]])
    assert metrics.overall.hot is None
    assert metrics.overall.hot_hit_rate is None
    assert metrics.overall.zero_hit_rate == pytest.approx(1.0)


def test_all_hot_rows_leave_zero_rate_as_none() -> None:
    """只有热行时判零率是 None——分母不存在。"""
    rows = [oof(minute=0, actual=30, p50=25.0)]
    metrics = summarize(rows, serving_sets=[["K11"]])
    assert metrics.overall.zero_count == 0
    assert metrics.overall.zero_hit_rate is None
    assert metrics.overall.hot_hit_rate == pytest.approx(1.0)


def test_r_squared_reports_how_much_variance_the_model_explains() -> None:
    """R² = 1 − 残差平方和 / 实际的总平方和，残差按 p50 算。"""
    rows = [
        oof(minute=0, actual=10, p50=12.0),
        oof(minute=1, actual=20, p50=19.0),
        oof(minute=2, actual=30, p50=32.0),
    ]
    metrics = summarize(rows, serving_sets=[["K11"]])
    # 总平方和 = 100+0+100，残差平方和 = 4+1+4
    assert metrics.overall.r2 == pytest.approx(1 - 9 / 200)


def test_r_squared_is_one_when_every_prediction_is_exact() -> None:
    """完美预测的 R² 恰好是 1。"""
    rows = [
        oof(minute=0, actual=10, p50=10.0),
        oof(minute=1, actual=30, p50=30.0),
    ]
    metrics = summarize(rows, serving_sets=[["K11"]])
    assert metrics.overall.r2 == pytest.approx(1.0)


def test_r_squared_can_go_negative_when_the_model_beats_nothing() -> None:
    """比「一律报均值」还差时 R² 为负——这是真实成绩，不许夹到 0。"""
    rows = [
        oof(minute=0, actual=10, p50=40.0),
        oof(minute=1, actual=30, p50=0.0),
    ]
    metrics = summarize(rows, serving_sets=[["K11"]])
    assert metrics.overall.r2 is not None
    assert metrics.overall.r2 < 0


def test_r_squared_is_none_when_the_actuals_have_no_spread() -> None:
    """⚠ 实际值全都一样时 R² 无定义：给 None，不给 0 也不给 1。"""
    rows = [
        oof(minute=0, actual=20, p50=20.0),
        oof(minute=1, actual=20, p50=25.0),
    ]
    metrics = summarize(rows, serving_sets=[["K11"]])
    assert metrics.overall.r2 is None


def test_r_squared_is_none_for_a_single_sample() -> None:
    """一条样本没有方差可解释，同样是无定义。"""
    metrics = summarize(
        [oof(minute=0, actual=20, p50=25.0)], serving_sets=[["K11"]]
    )
    assert metrics.overall.r2 is None


def test_hot_rows_get_their_own_r_squared() -> None:
    """热行块的 R² 只看热行：零行把总平方和撑大，两个数不该相同。"""
    rows = [
        oof(minute=0, actual=0, p50=0.0),
        oof(minute=1, actual=0, p50=0.0),
        oof(minute=2, actual=30, p50=40.0),
        oof(minute=3, actual=60, p50=50.0),
    ]
    metrics = summarize(rows, serving_sets=[["K11"]])
    hot = metrics.overall.hot
    assert hot is not None
    assert metrics.overall.r2 == pytest.approx(1 - 200 / 2475)
    assert hot.r2 == pytest.approx(1 - 200 / 450)


@pytest.mark.parametrize(
    ("width", "expected"),
    [
        (30.0, RELIABILITY_RELIABLE),
        (30.1, RELIABILITY_INDICATIVE),
        (60.0, RELIABILITY_INDICATIVE),
        (60.1, RELIABILITY_WEAK),
    ],
)
def test_reliability_tiers_follow_the_interval_width(
    width: float, expected: str
) -> None:
    """可靠性分档只看区间宽度，不看样本数。"""
    assert reliability(width) == expected
