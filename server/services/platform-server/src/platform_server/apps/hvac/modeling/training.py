"""训练管线：切折出折外预测、全量拟合出工件。

CPU 密集，调用方必须放进进程池跑（docs/AC_MODEL_DESIGN.md §4）；
本模块只保证「喂纯数据、吐纯数据」，两头都可 pickle。
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass

from platform_server.apps.hvac.modeling.artifact import (
    ModelBundle,
    SealedArtifact,
    predict_quantiles,
    seal,
)
from platform_server.apps.hvac.modeling.estimators import (
    Estimator,
    make_quantile_estimator,
)
from platform_server.apps.hvac.modeling.evaluation import OofPrediction
from platform_server.apps.hvac.modeling.features import (
    FEATURE_VERSION,
    EpisodeSample,
    build_matrix,
    feature_names,
)
from platform_server.apps.hvac.modeling.folds import time_fold_ids
from platform_server.apps.hvac.modeling.weights import decay_weights
from platform_server.apps.hvac.services.ac_startup_frames import RoomUnit

# p10 / p50 / p90，顺序即 ModelBundle.estimators 的顺序
QUANTILES = (0.1, 0.5, 0.9)

# 可用样本少于这个数直接拒训：几条样本拟合三条分位，出来的区间毫无含义，
# 训一个看起来能用的坏模型比不训危险
MIN_SAMPLES = 30

# 折外评估的折数
FOLD_COUNT = 5


class InsufficientSamples(Exception):
    """样本不够，拒绝训练。异常信息就是给人看的原因。"""

    def __init__(self, got: int) -> None:
        super().__init__(
            f"可用事件只有 {got} 条，少于下限 {MIN_SAMPLES} 条，不训练"
        )
        self.got = got


@dataclass(frozen=True)
class TrainedModel:
    """一次训练的产物：封存工件 + 全部折外预测。"""

    artifact: SealedArtifact
    oof: tuple[OofPrediction, ...]
    sample_count: int


def train(
    samples: Sequence[EpisodeSample],
    *,
    units: Sequence[RoomUnit],
    timezone: str,
    half_life_days: float,
) -> TrainedModel:
    """训练一个房间的达标时长模型。

    Args: samples（可用事件）, units（serial 升序）, timezone, half_life_days。
    """
    if len(samples) < MIN_SAMPLES:
        raise InsufficientSamples(len(samples))
    ordered = sorted(samples, key=lambda sample: sample.conditions.started_at)
    matrix = build_matrix(ordered, units=units, timezone=timezone)
    targets = [float(sample.duration_minutes) for sample in ordered]
    weights = decay_weights(
        [sample.conditions.started_at for sample in ordered],
        half_life_days=half_life_days,
    )
    oof = _out_of_fold(ordered, matrix, targets, weights)
    bundle = ModelBundle(
        feature_version=FEATURE_VERSION,
        feature_names=feature_names(units),
        serials=tuple(unit.serial for unit in units),
        timezone=timezone,
        half_life_days=half_life_days,
        estimators=_fit_all(matrix, targets, weights, range(len(ordered))),
    )
    return TrainedModel(
        artifact=seal(bundle),
        oof=tuple(oof),
        sample_count=len(ordered),
    )


def _fit_all(
    matrix: list[list[float]],
    targets: list[float],
    weights: list[float],
    rows: Sequence[int],
) -> tuple[Estimator, Estimator, Estimator]:
    """在指定行上拟合三条分位。

    Args: matrix, targets, weights, rows。
    """
    inputs = _neutralize_blind_columns([list(matrix[row]) for row in rows])
    answers = [targets[row] for row in rows]
    picked = [weights[row] for row in rows]
    found: list[Estimator] = []
    for quantile in QUANTILES:
        estimator = make_quantile_estimator(quantile)
        estimator.fit(inputs, answers, sample_weight=picked)
        found.append(estimator)
    return (found[0], found[1], found[2])


def _neutralize_blind_columns(
    rows: list[list[float]],
) -> list[list[float]]:
    """整列全 NaN 的特征改成常量 0——没有信息的列怎么改都不影响拟合。

    ⚠ sklearn 的直方分箱在全 NaN 列上直接抛错（sliding_window_view 空输入），
    而「没有一台机组绑某个测点」在真实房间里完全可能。只在拟合入口中和：
    预测路径的 NaN 由 HGBR 原生路由，不用管。
    Args: rows（行副本，就地改）。
    """
    if not rows:
        return rows
    for column in range(len(rows[0])):
        if all(math.isnan(row[column]) for row in rows):
            for row in rows:
                row[column] = 0.0
    return rows


def _out_of_fold(
    ordered: Sequence[EpisodeSample],
    matrix: list[list[float]],
    targets: list[float],
    weights: list[float],
) -> list[OofPrediction]:
    """逐折训练、对留出折预测，攒出每条样本的折外预测。

    Args: ordered, matrix, targets, weights。
    """
    ids = time_fold_ids(len(ordered), FOLD_COUNT)
    found: list[OofPrediction] = []
    for fold in sorted(set(ids)):
        held = [row for row, id_ in enumerate(ids) if id_ == fold]
        used = [row for row, id_ in enumerate(ids) if id_ != fold]
        bundle = _fold_bundle(matrix, targets, weights, used)
        for row in held:
            p10, p50, p90 = predict_quantiles(bundle, matrix[row])
            found.append(
                OofPrediction(
                    started_at=ordered[row].conditions.started_at,
                    running_set=ordered[row].conditions.running_set,
                    actual_minutes=int(targets[row]),
                    p10=p10,
                    p50=p50,
                    p90=p90,
                    fold=fold,
                )
            )
    return found


def _fold_bundle(
    matrix: list[list[float]],
    targets: list[float],
    weights: list[float],
    used: Sequence[int],
) -> ModelBundle:
    """一折的临时 bundle，只为复用 `predict_quantiles` 的排序与压非负。

    Args: matrix, targets, weights, used。
    """
    return ModelBundle(
        feature_version=FEATURE_VERSION,
        feature_names=(),
        serials=(),
        timezone="UTC",
        half_life_days=0.0,
        estimators=_fit_all(matrix, targets, weights, used),
    )
