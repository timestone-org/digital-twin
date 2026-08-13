"""工件的封存与加载 —— 三道护栏后面才有反序列化。

⚠ 摘要防的是存储损坏与手改库，不防拿到 DB 写权限的攻击者；工件只有应用
自己写入（写面全在 ac:manage 后面）。护栏拒载一律给人话原因，不静默降级。
"""

import hashlib
import pickle
from dataclasses import dataclass

from platform_server.apps.hvac.modeling.estimators import (
    DurationForest,
    ZeroClassifier,
    sklearn_version,
)
from platform_server.apps.hvac.services.ac_startup_frames import RoomUnit

# 工件的序列化格式版本。改 ModelBundle 的形状就 +1，老工件拒载并提示重训。
# v2：两段混合（瞬时达标分类器 + 非零时长森林）× 每组合专属子模型
FORMAT_VERSION = 2

# 对外报的三个分位水平，顺序固定
QUANTILE_LEVELS = (0.1, 0.5, 0.9)


@dataclass(frozen=True)
class StagePair:
    """一套两段混合模型：瞬时达标分类器 + 非零时长森林。

    ⚠ `duration_forest` 可为 None：训练集里一条非零时长都没有时，条件时长
    无从谈起，混合分布退化成「恒 0」。
    """

    zero_classifier: ZeroClassifier
    duration_forest: DurationForest | None


class ArtifactRejected(Exception):
    """工件没过护栏。异常信息就是给人看的原因。"""


@dataclass(frozen=True)
class ModelBundle:
    """一次训练的全部产物：共用模型 + 每组合子模型 + 复原特征行所需的一切。

    ⚠ `units` 是**训练时**的机组清单（含达标范围），试算永远按它拼特征行：
    按房间当前清单拼的话，机组一变动列数就对不上，预测当场炸——训练/服务
    偏差要在结构上堵死，不靠调用方自觉。
    `by_set` 是「组合键 → 只用该组合数据训出的专属子模型」；样本不足的组合
    没有子模型，由 `pooled`（全部可用事件、组合进特征）兜底。
    """

    feature_version: int
    feature_names: tuple[str, ...]
    units: tuple[RoomUnit, ...]
    timezone: str
    half_life_days: float
    pooled: StagePair
    by_set: dict[str, StagePair]

    @property
    def serials(self) -> tuple[str, ...]:
        """训练时的机组 serial，升序。"""
        return tuple(unit.serial for unit in self.units)

    def pair_for(self, set_key: str) -> tuple[StagePair, bool]:
        """这个组合该用哪套模型；第二项 = 是不是专属子模型。

        Args: set_key（serial 升序加号相连）。
        """
        found = self.by_set.get(set_key)
        if found is not None:
            return found, True
        return self.pooled, False


@dataclass(frozen=True)
class SealedArtifact:
    """可以直接落库的封存形态。"""

    payload: bytes
    digest: str
    format_version: int
    sklearn_version: str


def seal(bundle: ModelBundle) -> SealedArtifact:
    """封存：序列化并盖上摘要与版本。

    Args: bundle。
    """
    payload = pickle.dumps(bundle, protocol=5)
    return SealedArtifact(
        payload=payload,
        digest=hashlib.sha256(payload).hexdigest(),
        format_version=FORMAT_VERSION,
        sklearn_version=sklearn_version(),
    )


def load(
    payload: bytes,
    *,
    digest: str,
    format_version: int,
    trained_sklearn_version: str,
) -> ModelBundle:
    """过完三道护栏再反序列化，任何一道不过都拒载并说明原因。

    Args: payload, digest, format_version, trained_sklearn_version。
    """
    if hashlib.sha256(payload).hexdigest() != digest:
        raise ArtifactRejected("工件与摘要不符（存储损坏或被改动），需重训")
    if format_version != FORMAT_VERSION:
        raise ArtifactRejected(
            f"工件格式 v{format_version} 不被当前代码（v{FORMAT_VERSION}）"
            "支持，需重训"
        )
    if _minor(trained_sklearn_version) != _minor(sklearn_version()):
        raise ArtifactRejected(
            f"工件由 sklearn {trained_sklearn_version} 训练，当前是 "
            f"{sklearn_version()}，跨版本反序列化不可信，需重训"
        )
    bundle = pickle.loads(payload)  # noqa: S301 - 只反序列化过了护栏的自产工件
    if not isinstance(bundle, ModelBundle):
        raise ArtifactRejected("工件反序列化出的不是模型，需重训")
    return bundle


def predict_quantiles(
    pair: StagePair, row: list[float]
) -> tuple[float, float, float]:
    """一行特征 → 混合分布的 (p10, p50, p90)。

    时长分布是「概率 p₀ 的 0 + 概率 (1−p₀) 的连续时长」的混合
    （实测近半开机一开机就已达标，直接回归会把非零场景全稀释成 0）。
    混合分布在水平 q 上的分位：q ≤ p₀ 时是 0，否则是条件分布在
    (q − p₀)/(1 − p₀) 水平上的分位。
    Args: pair, row。
    """
    p_zero = pair.zero_classifier.proba_zero(row)
    positive = [
        (level, (level - p_zero) / (1.0 - p_zero))
        for level in QUANTILE_LEVELS
        if level > p_zero and p_zero < 1.0
    ]
    found = dict.fromkeys(QUANTILE_LEVELS, 0.0)
    if positive and pair.duration_forest is not None:
        raw = pair.duration_forest.quantiles_at(
            row, [adjusted for _, adjusted in positive]
        )
        for (level, _), minutes in zip(positive, raw, strict=True):
            found[level] = max(0.0, minutes)
    ordered = sorted(found[level] for level in QUANTILE_LEVELS)
    return (ordered[0], ordered[1], ordered[2])


def _minor(version: str) -> str:
    """版本号的主次两段；补丁位的差异不拒载。

    Args: version。
    """
    return ".".join(version.split(".")[:2])
