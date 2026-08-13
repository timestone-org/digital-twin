"""工件的封存与加载 —— 三道护栏后面才有反序列化。

⚠ 摘要防的是存储损坏与手改库，不防拿到 DB 写权限的攻击者；工件只有应用
自己写入（写面全在 ac:manage 后面）。护栏拒载一律给人话原因，不静默降级。
"""

import hashlib
import pickle
from dataclasses import dataclass

from platform_server.apps.hvac.modeling.estimators import (
    Estimator,
    sklearn_version,
)
from platform_server.apps.hvac.services.ac_startup_frames import RoomUnit

# 工件的序列化格式版本。改 ModelBundle 的形状就 +1，老工件拒载并提示重训
FORMAT_VERSION = 1


class ArtifactRejected(Exception):
    """工件没过护栏。异常信息就是给人看的原因。"""


@dataclass(frozen=True)
class ModelBundle:
    """一次训练的全部产物：三条分位的估计器 + 复原特征行所需的一切。

    ⚠ `units` 是**训练时**的机组清单（含达标范围），试算永远按它拼特征行：
    按房间当前清单拼的话，机组一变动列数就对不上，预测当场炸——训练/服务
    偏差要在结构上堵死，不靠调用方自觉。
    """

    feature_version: int
    feature_names: tuple[str, ...]
    units: tuple[RoomUnit, ...]
    timezone: str
    half_life_days: float
    # p10 / p50 / p90 各一个，顺序固定
    estimators: tuple[Estimator, Estimator, Estimator]

    @property
    def serials(self) -> tuple[str, ...]:
        """训练时的机组 serial，升序。"""
        return tuple(unit.serial for unit in self.units)


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
    bundle: ModelBundle, row: list[float]
) -> tuple[float, float, float]:
    """一行特征 → (p10, p50, p90)。

    ⚠ 三条分位各自独立拟合，小样本处可能交叉；出口处排序并压到非负，
    否则页面上会出现 p10 > p50 或负分钟这种没法解释的数。
    Args: bundle, row。
    """
    found = sorted(
        max(0.0, float(estimator.predict([row])[0]))
        for estimator in bundle.estimators
    )
    return (found[0], found[1], found[2])


def _minor(version: str) -> str:
    """版本号的主次两段；补丁位的差异不拒载。

    Args: version。
    """
    return ".".join(version.split(".")[:2])
