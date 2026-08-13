"""训练管线：每组合专属子模型 + 房间共用兜底，折外评估各归各。

CPU 密集，调用方必须放进进程池跑（docs/AC_MODEL_DESIGN.md §4）；
本模块只保证「喂纯数据、吐纯数据」，两头都可 pickle。
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass

from platform_server.apps.hvac.modeling.artifact import (
    ModelBundle,
    SealedArtifact,
    StagePair,
    predict_quantiles,
    seal,
)
from platform_server.apps.hvac.modeling.estimators import (
    DurationForest,
    ZeroClassifier,
)
from platform_server.apps.hvac.modeling.evaluation import (
    OofPrediction,
    set_key,
)
from platform_server.apps.hvac.modeling.features import (
    FEATURE_VERSION,
    EpisodeSample,
    build_matrix,
    feature_names,
)
from platform_server.apps.hvac.modeling.folds import time_fold_ids
from platform_server.apps.hvac.modeling.weights import decay_weights
from platform_server.apps.hvac.services.ac_startup_frames import RoomUnit

# 可用样本少于这个数直接拒训；一个组合攒到这个数才配得上专属子模型。
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
class _Prepared:
    """排好序的训练数据：样本、特征矩阵、目标与权重。"""

    ordered: Sequence[EpisodeSample]
    matrix: list[list[float]]
    targets: list[float]
    weights: list[float]


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
    serving_sets: Sequence[Sequence[str]] = (),
) -> TrainedModel:
    """训练一个房间的达标时长模型。

    每个攒够 `MIN_SAMPLES` 条的服务组合各训一套**专属子模型**（只用该组合
    的数据），其余组合由**共用模型**（全部可用事件、组合进特征）兜底；
    折外评估各归各——专属子模型的指标只由它自己的折外预测算出。
    Args: samples（可用事件）, units（serial 升序）, timezone,
    half_life_days, serving_sets（要出专属子模型的组合）。
    """
    if len(samples) < MIN_SAMPLES:
        raise InsufficientSamples(len(samples))
    ordered = sorted(samples, key=lambda sample: sample.conditions.started_at)
    prepared = _Prepared(
        ordered=ordered,
        matrix=build_matrix(ordered, units=units, timezone=timezone),
        targets=[float(sample.duration_minutes) for sample in ordered],
        weights=decay_weights(
            [sample.conditions.started_at for sample in ordered],
            half_life_days=half_life_days,
        ),
    )
    rows_by_set = _rows_by_set(ordered, serving_sets)
    oof = _out_of_fold(prepared, rows_by_set)
    bundle = ModelBundle(
        feature_version=FEATURE_VERSION,
        feature_names=feature_names(units),
        units=tuple(units),
        timezone=timezone,
        half_life_days=half_life_days,
        pooled=_fit_pair(prepared, range(len(ordered))),
        by_set={
            key: _fit_pair(prepared, rows) for key, rows in rows_by_set.items()
        },
    )
    return TrainedModel(
        artifact=seal(bundle),
        oof=tuple(oof),
        sample_count=len(ordered),
    )


def _rows_by_set(
    ordered: Sequence[EpisodeSample],
    serving_sets: Sequence[Sequence[str]],
) -> dict[str, list[int]]:
    """每个服务组合各自的样本行号；攒不够 `MIN_SAMPLES` 的组合不出子模型。

    Args: ordered, serving_sets。
    """
    wanted = {set_key(serving) for serving in serving_sets}
    found: dict[str, list[int]] = {key: [] for key in wanted}
    for at, sample in enumerate(ordered):
        key = set_key(sample.conditions.running_set)
        if key in found:
            found[key].append(at)
    return {
        key: rows for key, rows in found.items() if len(rows) >= MIN_SAMPLES
    }


def _fit_pair(prepared: "_Prepared", rows: Sequence[int]) -> StagePair:
    """在指定行上拟合两段：瞬时达标分类器 + 非零时长森林。

    ⚠ 实测近半开机「一开机就已达标」（时长 0）：直接回归会把非零场景全
    稀释成 0，页面上试算永远给 0 分钟——两段混合是零膨胀目标的正解。
    Args: prepared, rows。
    """
    inputs = _neutralize_blind_columns(
        [list(prepared.matrix[row]) for row in rows]
    )
    answers = [prepared.targets[row] for row in rows]
    picked = [prepared.weights[row] for row in rows]
    classifier = ZeroClassifier()
    classifier.fit(
        inputs, [minutes == 0 for minutes in answers], sample_weight=picked
    )
    positive = [at for at, minutes in enumerate(answers) if minutes > 0]
    forest: DurationForest | None = None
    if positive:
        forest = DurationForest()
        forest.fit(
            [inputs[at] for at in positive],
            [answers[at] for at in positive],
            sample_weight=[picked[at] for at in positive],
        )
    return StagePair(zero_classifier=classifier, duration_forest=forest)


def _neutralize_blind_columns(
    rows: list[list[float]],
) -> list[list[float]]:
    """整列全 NaN 的特征改成常量 0——没有信息的列怎么改都不影响拟合。

    ⚠ sklearn 在全 NaN 列上的行为不可依赖（直方分箱直接抛错），而「没有
    一台机组绑某个测点」在真实房间里完全可能。只在拟合入口中和；预测路径
    的 NaN 由森林原生路由，不用管。
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
    prepared: "_Prepared", rows_by_set: dict[str, list[int]]
) -> list[OofPrediction]:
    """折外预测，路由与服务一致：有子模型的组合用子模型的折，其余用共用折。

    ⚠ 各归各不能混：专属子模型的评估混进共用模型的预测，页面上那份
    「按组合」指标就不再是「这个组合的模型有多准」。
    Args: prepared, rows_by_set。
    """
    dedicated_rows = {row for rows in rows_by_set.values() for row in rows}
    total = len(prepared.ordered)
    found = _fold_predictions(
        prepared,
        candidates=list(range(total)),
        report={row for row in range(total) if row not in dedicated_rows},
    )
    for rows in rows_by_set.values():
        found.extend(
            _fold_predictions(prepared, candidates=rows, report=set(rows))
        )
    return found


def _fold_predictions(
    prepared: "_Prepared",
    *,
    candidates: list[int],
    report: set[int],
) -> list[OofPrediction]:
    """在一组行号上做时序分块折外，只报出 `report` 里的行。

    Args: prepared, candidates, report。
    """
    ids = time_fold_ids(len(candidates), FOLD_COUNT)
    found: list[OofPrediction] = []
    for fold in sorted(set(ids)):
        held = [candidates[at] for at, id_ in enumerate(ids) if id_ == fold]
        used = [candidates[at] for at, id_ in enumerate(ids) if id_ != fold]
        pair = _fit_pair(prepared, used)
        for row in held:
            if row not in report:
                continue
            p10, p50, p90 = predict_quantiles(pair, prepared.matrix[row])
            found.append(
                OofPrediction(
                    started_at=prepared.ordered[row].conditions.started_at,
                    running_set=prepared.ordered[row].conditions.running_set,
                    actual_minutes=int(prepared.targets[row]),
                    p10=p10,
                    p50=p50,
                    p90=p90,
                    fold=fold,
                )
            )
    return found
