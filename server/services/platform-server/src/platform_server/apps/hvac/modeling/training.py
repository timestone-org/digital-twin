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
from platform_server.apps.hvac.modeling.curation import curate
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
from platform_server.apps.hvac.rooms import RoomUnit

# 可用样本少于这个数直接拒训；一个组合攒到这个数才配得上专属子模型。
# 训一个看起来能用的坏模型比不训危险
MIN_SAMPLES = 30

# 折外评估的折数
FOLD_COUNT = 5

# 借进阶段 B 的零样本条数上限，按非零样本条数的这个比例算。
# ⚠ 阶段 B 答的是「不瞬时达标的话要多久」，零样本一多它就改口在答另一个问题，
# 分位整体被拽向 0——而漏报（热行被判成 0）本就是这个模型最贵的那类错。只借
# 一小撮当低端锚点，让边界附近的叶子知道「再好一点就是 0 分钟」。
ZERO_ANCHOR_SHARE = 0.25

# 借进来的零样本再乘这个权重折扣：它们是锚点，不是这一段要回答的样本。
ZERO_ANCHOR_WEIGHT = 0.25


class InsufficientSamples(Exception):
    """样本不够，拒绝训练。异常信息就是给人看的原因。"""

    def __init__(self, got: int) -> None:
        super().__init__(
            f"可用事件只有 {got} 条，少于下限 {MIN_SAMPLES} 条，不训练"
        )
        self.got = got

    def __reduce__(self) -> tuple[type["InsufficientSamples"], tuple[int]]:
        """跨进程搬运时按条数重建，而不是拿整句话再当条数走一遍 `__init__`。

        ⚠ 拟合跑在进程池里，异常回到父进程要过一次 pickle：默认口径是拿
        `args`（这里是那句已经拼好的话）重新调 `__init__`，于是操作员看到的
        原因是「可用事件只有 可用事件只有 21 条…… 条……」，`got` 也从条数
        变成了一句话。
        """
        return (InsufficientSamples, (self.got,))


@dataclass(frozen=True)
class _Prepared:
    """排好序的训练数据：样本、特征矩阵、目标与权重。"""

    ordered: Sequence[EpisodeSample]
    matrix: list[list[float]]
    targets: list[float]
    weights: list[float]


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


def train(
    samples: Sequence[EpisodeSample],
    *,
    units: Sequence[RoomUnit],
    timezone: str,
    half_life_days: float,
    serving_sets: Sequence[Sequence[str]] = (),
) -> TrainedModel:
    """训练一个房间的达标时长模型。

    入口先过一遍 `curate`：标签与当前达标范围自相矛盾的事件在这里就被剔掉，
    样本数下限也按剩下的那些算——先按毛数放行、再拟合一个学了过期物理的模型，
    比直接拒训危险。
    每个攒够 `MIN_SAMPLES` 条的服务组合各训一套**专属子模型**（只用该组合
    的数据），其余组合由**共用模型**（全部可用事件、组合进特征）兜底；
    折外评估各归各——专属子模型的指标只由它自己的折外预测算出。
    Args: samples（可用事件）, units（serial 升序）, timezone,
    half_life_days, serving_sets（要出专属子模型的组合）。
    """
    curated = curate(samples, units=units)
    if len(curated.kept) < MIN_SAMPLES:
        raise InsufficientSamples(len(curated.kept))
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
    """阶段 B：全部非零样本，加一小撮降权的零样本当低端锚点。

    ⚠ 一条非零时长都没有就没有阶段 B：条件时长无从谈起，混合分布退化成恒 0，
    这时再拿零样本去拟合只会训出一个「永远答 0」却看着很自信的森林。
    Args: inputs, answers, picked。
    """
    positive = [at for at, minutes in enumerate(answers) if minutes > 0]
    if not positive:
        return None
    anchors = _zero_anchors(
        answers, wanted=int(len(positive) * ZERO_ANCHOR_SHARE)
    )
    chosen = [*positive, *anchors]
    forest = DurationForest()
    forest.fit(
        [inputs[at] for at in chosen],
        [answers[at] for at in chosen],
        sample_weight=[
            *(picked[at] for at in positive),
            *(picked[at] * ZERO_ANCHOR_WEIGHT for at in anchors),
        ],
    )
    return forest


def _zero_anchors(answers: Sequence[float], *, wanted: int) -> list[int]:
    """从零样本里等距挑 `wanted` 条当锚点，行号按入参顺序。

    ⚠ 等距挑而不是取头尾或随机：行序即时序，等距才让锚点摊在整段历史上，
    既不把某个季节的零样本整块灌进来，同一份数据也永远挑出同一批行。
    Args: answers, wanted。
    """
    zeros = [at for at, minutes in enumerate(answers) if minutes == 0]
    if wanted <= 0 or not zeros:
        return []
    if wanted >= len(zeros):
        return zeros
    step = len(zeros) / wanted
    return [zeros[int(index * step)] for index in range(wanted)]


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
