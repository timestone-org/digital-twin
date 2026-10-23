"""训练管线：组合专属模型与房间共用兜底，使用前向验证评估。

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
from platform_server.apps.hvac.modeling.curation import (
    MAX_NORMAL_DURATION_MINUTES,
    curate,
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
    instant_compliance,
)
from platform_server.apps.hvac.modeling.folds import time_fold_ids
from platform_server.apps.hvac.modeling.weights import decay_weights
from platform_server.apps.hvac.rooms import RoomUnit

# 可用样本少于这个数直接拒训；一个组合攒到这个数才配得上专属子模型。
# 训一个看起来能用的坏模型比不训危险
MIN_SAMPLES = 30

# 折外评估的折数
FOLD_COUNT = 5


class InsufficientSamples(Exception):
    """样本不够，拒绝训练。异常信息就是给人看的原因。"""

    def __init__(self, got: int, overlong_episode_count: int = 0) -> None:
        excluded = (
            f"（已按 {MAX_NORMAL_DURATION_MINUTES} 分钟正常工况上限排除"
            f" {overlong_episode_count} 条长时长事件）"
            if overlong_episode_count
            else ""
        )
        super().__init__(
            f"可用事件只有 {got} 条，少于下限 {MIN_SAMPLES} 条，"
            f"不训练{excluded}"
        )
        self.got = got
        self.overlong_episode_count = overlong_episode_count

    def __reduce__(self) -> tuple[type["InsufficientSamples"], tuple[int, int]]:
        """跨进程搬运时按条数重建，而不是拿整句话再当条数走一遍 `__init__`。

        ⚠ 拟合跑在进程池里，异常回到父进程要过一次 pickle：默认口径是拿
        `args`（这里是那句已经拼好的话）重新调 `__init__`，于是操作员看到的
        原因是「可用事件只有 可用事件只有 21 条…… 条……」，`got` 也从条数
        变成了一句话。
        """
        return (InsufficientSamples, (self.got, self.overlong_episode_count))


@dataclass(frozen=True)
class _Prepared:
    """排好序的训练数据：样本、特征矩阵、目标与权重。"""

    ordered: Sequence[EpisodeSample]
    matrix: list[list[float]]
    targets: list[float]
    weights: list[float]
    compliance: list[float | None]


@dataclass(frozen=True)
class TrainedModel:
    """一次训练的产物：封存工件 + 全部折外预测。

    `sample_count` 是**真正参与拟合**的条数，甄别剔除的不算在内。
    """

    artifact: SealedArtifact
    oof: tuple[OofPrediction, ...]
    sample_count: int
    # 甄别数出来的两个方向，口径见 `modeling/curation.py`
    contradictory_count: int
    unexplained_zero_count: int
    overlong_episode_count: int


def train(
    samples: Sequence[EpisodeSample],
    *,
    units: Sequence[RoomUnit],
    timezone: str,
    half_life_days: float,
    serving_sets: Sequence[Sequence[str]] = (),
) -> TrainedModel:
    """筛选正常工况后训练组合专属模型与共用模型，附前向验证结果。

    Args: samples, units（serial 升序）, timezone, half_life_days,
        serving_sets。
    """
    curated = curate(samples, units=units, timezone=timezone)
    if len(curated.kept) < MIN_SAMPLES:
        raise InsufficientSamples(
            len(curated.kept), curated.overlong_episode_count
        )
    prepared = _prepare(
        curated.kept,
        units=units,
        timezone=timezone,
        half_life_days=half_life_days,
    )
    ordered = prepared.ordered
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
        contradictory_count=curated.contradictory_count,
        unexplained_zero_count=curated.unexplained_zero_count,
        overlong_episode_count=curated.overlong_episode_count,
    )


def _prepare(
    kept: Sequence[EpisodeSample],
    *,
    units: Sequence[RoomUnit],
    timezone: str,
    half_life_days: float,
) -> _Prepared:
    """按时刻升序排好，算出特征矩阵、目标与时间衰减权重。

    Args: kept, units, timezone, half_life_days。
    """
    ordered = sorted(kept, key=lambda sample: sample.conditions.started_at)
    return _Prepared(
        ordered=ordered,
        matrix=build_matrix(ordered, units=units, timezone=timezone),
        targets=[float(sample.duration_minutes) for sample in ordered],
        weights=decay_weights(
            [sample.conditions.started_at for sample in ordered],
            half_life_days=half_life_days,
        ),
        compliance=[
            instant_compliance(
                sample.conditions, units=units, timezone=timezone
            )
            for sample in ordered
        ],
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
    """在指定行上拟合两段：瞬时达标分类器 + 时长森林。

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
    return StagePair(
        zero_classifier=classifier,
        duration_forest=_fit_duration(inputs, answers, picked),
    )


def _fit_duration(
    inputs: list[list[float]],
    answers: list[float],
    picked: list[float],
) -> DurationForest | None:
    """只用正时长拟合条件分布。Args: inputs, answers, picked。"""
    positive = [at for at, minutes in enumerate(answers) if minutes > 0]
    if not positive:
        return None
    forest = DurationForest()
    forest.fit(
        [inputs[at] for at in positive],
        [answers[at] for at in positive],
        sample_weight=[picked[at] for at in positive],
    )
    return forest


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
    """扩展训练窗评估，仅使用验证时刻之前的数据。

    Args: prepared, rows_by_set。
    """
    ids = time_fold_ids(len(prepared.ordered), FOLD_COUNT + 1)
    found: list[OofPrediction] = []
    for fold in sorted(set(ids))[1:]:
        held = [at for at, id_ in enumerate(ids) if id_ == fold]
        used = [at for at, id_ in enumerate(ids) if id_ < fold]
        pooled = _fit_pair(prepared, used)
        pairs = {
            key: _fit_pair(prepared, past)
            for key, rows in rows_by_set.items()
            if len(past := [at for at in rows if at < held[0]]) >= MIN_SAMPLES
        }
        found.extend(_fold_predictions(prepared, held, (pooled, pairs), fold))
    return found


def _fold_predictions(
    prepared: "_Prepared",
    held: Sequence[int],
    models: tuple[StagePair, dict[str, StagePair]],
    fold: int,
) -> list[OofPrediction]:
    """按该折历史样本量选择专属或共用模型。

    Args: prepared, held, models, fold。
    """
    pooled, pairs = models
    found: list[OofPrediction] = []
    for row in held:
        conditions = prepared.ordered[row].conditions
        pair = pairs.get(set_key(conditions.running_set), pooled)
        p10, p50, p90 = predict_quantiles(
            pair,
            prepared.matrix[row],
            known_compliance=prepared.compliance[row],
        )
        found.append(
            OofPrediction(
                started_at=conditions.started_at,
                running_set=conditions.running_set,
                actual_minutes=int(prepared.targets[row]),
                p10=p10,
                p50=p50,
                p90=p90,
                fold=fold,
            )
        )
    return found
