"""训练管线与工件护栏的用例 —— 用可学的零膨胀合成数据把整条链走通。

合成口径照真实分布造：带内开机即瞬时达标（时长 0，约占四成），带外时长
≈ 8 × 温度超限量。两段混合要同时学会「哪些是 0」与「非零的多久」。
⚠ 这批合成读数**不带湿度**，而 `UNITS` 配了湿度范围——于是每一条在
`curation` 眼里都不是「开机即达标」，本模块因此只考拟合，不考甄别。
"""

from datetime import UTC, datetime, timedelta

import pytest

from platform_server.apps.hvac.modeling.artifact import (
    FORMAT_VERSION,
    ArtifactRejected,
    load,
    predict_mixture,
    predict_quantiles,
)
from platform_server.apps.hvac.modeling.estimators import DurationForest
from platform_server.apps.hvac.modeling.features import (
    EpisodeSample,
    StartConditions,
    build_row,
)
from platform_server.apps.hvac.modeling.training import (
    MIN_SAMPLES,
    InsufficientSamples,
    TrainedModel,
    _zero_anchors,
    train,
)
from unit.test_ac_model_features import TZ, UNITS

BASE = datetime(2026, 1, 5, 0, 0, tzinfo=UTC)
# 合成数据里最短的那条热行：超限量 1 → 8 分钟
SHORTEST_HOT_MINUTES = 8.0


def sample(index: int) -> EpisodeSample:
    """第 index 条合成事件：五条里两条带内瞬时达标，其余时长随超限量走。

    Args: index。
    """
    is_instant = index % 5 < 2
    over = 0.0 if is_instant else 1.0 + (index % 6)
    running = ("K11",) if index % 3 else ("K11", "K12")
    duration = 0 if is_instant else int(8 * over)
    return EpisodeSample(
        conditions=StartConditions(
            started_at=BASE + timedelta(days=index, minutes=index),
            running_set=running,
            idle_minutes=390,
            readings={
                "K11": {
                    "workshop_temp_avg": (24.0 if is_instant else 26.0) + over
                },
                "K12": {"workshop_temp_avg": 25.0},
            },
        ),
        duration_minutes=duration,
    )


@pytest.fixture(scope="module")
def trained() -> TrainedModel:
    """80 条合成事件训一次，整个模块的用例共用。"""
    return train(
        [sample(index) for index in range(80)],
        units=UNITS,
        timezone=TZ,
        half_life_days=180.0,
        serving_sets=[["K11"], ["K11", "K12"]],
    )


def test_every_sample_gets_exactly_one_oof_prediction(
    trained: TrainedModel,
) -> None:
    """每条样本恰好有一次「模型没见过它」的预测。"""
    assert trained.sample_count == 80
    assert trained.contradictory_count == 0
    assert len(trained.oof) == 80
    assert len({row.started_at for row in trained.oof}) == 80


def test_the_model_learns_the_synthetic_physics(
    trained: TrainedModel,
) -> None:
    """折外 MAE 明显好于「报全局均值」的瞎猜基线。"""
    actuals = [row.actual_minutes for row in trained.oof]
    mean = sum(actuals) / len(actuals)
    baseline = sum(abs(value - mean) for value in actuals) / len(actuals)
    mae = sum(abs(row.p50 - row.actual_minutes) for row in trained.oof) / len(
        trained.oof
    )
    assert mae < baseline * 0.6


def test_instant_and_delayed_starts_are_told_apart(
    trained: TrainedModel,
) -> None:
    """⚠ 零膨胀的正解：带内开机预测归零，带外开机不许被 0 稀释。"""
    instants = [row for row in trained.oof if row.actual_minutes == 0]
    delayed = [row for row in trained.oof if row.actual_minutes >= 16]
    zero_hit = sum(1 for row in instants if row.p50 < 1.0) / len(instants)
    delayed_hit = sum(1 for row in delayed if row.p50 >= 5.0) / len(delayed)
    assert zero_hit > 0.8
    assert delayed_hit > 0.8


def test_stage_b_can_answer_below_the_shortest_hot_row(
    trained: TrainedModel,
) -> None:
    """⚠ 只喂非零样本的阶段 B 在带内条件上也只能答一个 ≥ 最短热行的数：
    掺进来的那一小撮零样本锚点就是为了让它答得下去（`ZERO_ANCHOR_SHARE`）。"""
    bundle = load(
        trained.artifact.payload,
        digest=trained.artifact.digest,
        format_version=trained.artifact.format_version,
        trained_sklearn_version=trained.artifact.sklearn_version,
    )
    pair, _ = bundle.pair_for("K11")
    assert pair.duration_forest is not None
    instant = build_row(sample(0).conditions, units=UNITS, timezone=TZ)
    (median,) = pair.duration_forest.quantiles_at(instant, [0.5])
    assert median < SHORTEST_HOT_MINUTES


def test_the_anchors_do_not_swamp_the_hot_rows(
    trained: TrainedModel,
) -> None:
    """⚠ 锚点只是锚点：借得太多、太重，阶段 B 就改口在答另一个问题，
    热行整段被拽向 0——漏报是这个模型最贵的那类错。"""
    delayed = [row for row in trained.oof if row.actual_minutes >= 16]
    assert sum(1 for row in delayed if row.p50 >= 5.0) / len(delayed) > 0.8


def test_quantiles_are_ordered_and_non_negative(
    trained: TrainedModel,
) -> None:
    """⚠ 三条分位独立拟合会交叉：出口必须已排序且非负。"""
    for row in trained.oof:
        assert 0 <= row.p10 <= row.p50 <= row.p90


def test_a_room_that_always_complies_instantly_has_no_stage_b() -> None:
    """⚠ 一条非零时长都没有：阶段 B 缺席，混合退化成恒 0——不许拿零样本硬训
    出一个「永远答 0」却看着很自信的森林。"""
    rows = [
        EpisodeSample(conditions=sample(index).conditions, duration_minutes=0)
        for index in range(MIN_SAMPLES)
    ]
    trained = train(rows, units=UNITS, timezone=TZ, half_life_days=180.0)
    bundle = load(
        trained.artifact.payload,
        digest=trained.artifact.digest,
        format_version=trained.artifact.format_version,
        trained_sklearn_version=trained.artifact.sklearn_version,
    )
    assert bundle.pooled.duration_forest is None


def test_zero_anchors_are_spread_out_capped_and_repeatable() -> None:
    """锚点的三条约定：等距摊开、要得比有的多就全给、同一份数据挑同一批行。"""
    answers = [0.0 if at % 2 else 5.0 for at in range(20)]
    picked = _zero_anchors(answers, wanted=5)
    assert picked == _zero_anchors(answers, wanted=5)
    assert len(picked) == 5
    assert all(answers[at] == 0.0 for at in picked)
    assert picked == sorted(picked)
    # 要 99 条而只有 10 条零样本：全给，不报错也不重复
    assert len(_zero_anchors(answers, wanted=99)) == 10
    assert _zero_anchors(answers, wanted=0) == []
    assert _zero_anchors([1.0, 2.0], wanted=3) == []


def test_training_is_deterministic() -> None:
    """同一份数据训两次得到同一个工件——排查问题时结果必须可复现。"""
    samples = [sample(index) for index in range(40)]
    first = train(samples, units=UNITS, timezone=TZ, half_life_days=180.0)
    second = train(samples, units=UNITS, timezone=TZ, half_life_days=180.0)
    assert first.artifact.digest == second.artifact.digest


def test_too_few_samples_refuse_to_train() -> None:
    """样本不够直接拒训，异常信息说清缺多少。"""
    with pytest.raises(InsufficientSamples, match=str(MIN_SAMPLES)):
        train(
            [sample(index) for index in range(MIN_SAMPLES - 1)],
            units=UNITS,
            timezone=TZ,
            half_life_days=180.0,
        )


def test_each_serving_set_gets_its_own_submodel_when_it_can(
    trained: TrainedModel,
) -> None:
    """⚠ 攒够样本的组合有专属子模型；不够的由共用模型兜底且要说明。"""
    bundle = load(
        trained.artifact.payload,
        digest=trained.artifact.digest,
        format_version=trained.artifact.format_version,
        trained_sklearn_version=trained.artifact.sklearn_version,
    )
    # 80 条里 K11 约 53 条（≥30 → 专属）、K11+K12 约 27 条（<30 → 兜底）
    _, solo_dedicated = bundle.pair_for("K11")
    _, pair_dedicated = bundle.pair_for("K11+K12")
    assert solo_dedicated is True
    assert pair_dedicated is False


def test_the_artifact_round_trips_and_predicts(
    trained: TrainedModel,
) -> None:
    """封存 → 加载 → 预测：加载回来的模型给出与训练侧一致的形状。"""
    bundle = load(
        trained.artifact.payload,
        digest=trained.artifact.digest,
        format_version=trained.artifact.format_version,
        trained_sklearn_version=trained.artifact.sklearn_version,
    )
    row = build_row(sample(0).conditions, units=UNITS, timezone=TZ)
    pair, is_dedicated = bundle.pair_for("K11")
    p10, p50, p90 = predict_quantiles(pair, row)
    assert is_dedicated is True
    assert 0 <= p10 <= p50 <= p90


def test_mixture_reports_the_instant_probability(
    trained: TrainedModel,
) -> None:
    """混合预测带出 p₀：带内开机 p₀ 高、带外开机 p₀ 低，且都在 [0,1]。"""
    bundle = load(
        trained.artifact.payload,
        digest=trained.artifact.digest,
        format_version=trained.artifact.format_version,
        trained_sklearn_version=trained.artifact.sklearn_version,
    )
    pair, _ = bundle.pair_for("K11")
    instant = build_row(sample(0).conditions, units=UNITS, timezone=TZ)
    delayed = build_row(sample(14).conditions, units=UNITS, timezone=TZ)
    hot_p0 = predict_mixture(pair, delayed).instant_probability
    cold_p0 = predict_mixture(pair, instant).instant_probability
    assert 0.0 <= hot_p0 <= 1.0
    assert 0.0 <= cold_p0 <= 1.0
    assert cold_p0 > hot_p0


def test_duration_forest_speaks_minutes_despite_log_scale() -> None:
    """⚠ log1p 是森林的内部约定：常量 30 分钟的目标要原样回到 30 分钟。"""
    forest = DurationForest()
    rows = [[float(index % 7), 1.0] for index in range(60)]
    forest.fit(rows, [30.0] * 60, sample_weight=[1.0] * 60)
    found = forest.quantiles_at([3.0, 1.0], [0.1, 0.5, 0.9])
    assert found == pytest.approx([30.0, 30.0, 30.0], rel=1e-6)


def test_a_tampered_payload_is_rejected_with_a_reason(
    trained: TrainedModel,
) -> None:
    """⚠ 摘要不符拒载：反序列化在护栏之后，坏字节根本走不到 pickle。"""
    with pytest.raises(ArtifactRejected, match="摘要不符"):
        load(
            trained.artifact.payload + b"x",
            digest=trained.artifact.digest,
            format_version=FORMAT_VERSION,
            trained_sklearn_version=trained.artifact.sklearn_version,
        )


def test_an_unknown_format_version_is_rejected(
    trained: TrainedModel,
) -> None:
    """格式版本不认识就拒载并提示重训。"""
    with pytest.raises(ArtifactRejected, match="工件格式"):
        load(
            trained.artifact.payload,
            digest=trained.artifact.digest,
            format_version=FORMAT_VERSION + 1,
            trained_sklearn_version=trained.artifact.sklearn_version,
        )


def test_a_cross_version_artifact_is_rejected(
    trained: TrainedModel,
) -> None:
    """⚠ sklearn 主次版本不符拒载：跨版本反序列化可能悄悄给出错的数。"""
    with pytest.raises(ArtifactRejected, match="sklearn"):
        load(
            trained.artifact.payload,
            digest=trained.artifact.digest,
            format_version=FORMAT_VERSION,
            trained_sklearn_version="0.24.9",
        )
