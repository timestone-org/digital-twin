"""训练管线与工件护栏的用例 —— 用可学的零膨胀合成数据把整条链走通。

合成口径照真实分布造：带内开机即瞬时达标（时长 0，约占四成），带外时长
≈ 8 × 温度超限量。两段混合要同时学会「哪些是 0」与「非零的多久」。
"""

from datetime import UTC, datetime, timedelta

import pytest

from platform_server.apps.hvac.modeling.artifact import (
    FORMAT_VERSION,
    ArtifactRejected,
    load,
    predict_quantiles,
)
from platform_server.apps.hvac.modeling.features import (
    EpisodeSample,
    StartConditions,
    build_row,
)
from platform_server.apps.hvac.modeling.training import (
    MIN_SAMPLES,
    InsufficientSamples,
    TrainedModel,
    train,
)
from unit.test_ac_model_features import TZ, UNITS

BASE = datetime(2026, 1, 5, 0, 0, tzinfo=UTC)


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


def test_quantiles_are_ordered_and_non_negative(
    trained: TrainedModel,
) -> None:
    """⚠ 三条分位独立拟合会交叉：出口必须已排序且非负。"""
    for row in trained.oof:
        assert 0 <= row.p10 <= row.p50 <= row.p90


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
