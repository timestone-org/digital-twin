"""三维模型的压缩档目录：每一档压到什么程度、叫什么。

一处供三用：finalize 时按它落 `pending` 行、worker 按它调压缩参数、前端按它
显示档名。**没登记的档既压不出来也存不下去**。

⚠ 排的是**画质**不是压缩率：`high` = 高画质（不减面，只做 Draco 无损几何压缩），
不是「高压缩」。反过来命名每次读都要在脑子里翻译一次，而翻译错的那次没有任何提示。
⚠ 与前端 `@dt/contracts` 的 `MODEL_VARIANTS` 逐字一致，由
`tests/contract/test_asset_url_contract.py` 钉住。
"""

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType

#: 原件：用户传上来的那份字节。永远保留且**永不改写**——它是压缩失败时唯一的
#: 退路，也是重压的输入
ORIGINAL = "original"

#: 全部档位，顺序即界面上的排列顺序（画质从高到低）
MODEL_VARIANTS = (ORIGINAL, "high", "medium", "low")

#: 由本平台压出来的那几档。`original` 不在其中，它不是派生件
DERIVED_VARIANTS = ("high", "medium", "low")


@dataclass(frozen=True)
class VariantSpec:
    """一档压缩的登记信息。"""

    variant: str
    label: str
    #: 简化到原面数的比例；1.0 = 不减面，只做无损几何压缩
    simplify_ratio: float
    #: 给界面的一句话，说清这一档是拿什么换来的
    hint: str


_HIGH = VariantSpec(
    variant="high",
    label="高画质",
    simplify_ratio=1.0,
    hint="不减面，只做无损几何压缩。画质与原件无差别",
)

_MEDIUM = VariantSpec(
    variant="medium",
    label="中等",
    simplify_ratio=0.5,
    hint="面数减半。值班大屏、远景够用",
)

_LOW = VariantSpec(
    variant="low",
    label="轻量",
    simplify_ratio=0.25,
    hint="面数减到四分之一。缩略预览、低配机器、弱网",
)

_SPECS: Mapping[str, VariantSpec] = MappingProxyType(
    {spec.variant: spec for spec in (_HIGH, _MEDIUM, _LOW)}
)


def spec_of(variant: str) -> VariantSpec | None:
    """一档的登记信息；`original` 与没登记的档都给 None。

    Args: variant。
    """
    return _SPECS.get(variant)


def derived() -> tuple[str, ...]:
    """要压出来的那几档，顺序钉死。"""
    return DERIVED_VARIANTS


def is_known(variant: str) -> bool:
    """这个档名在不在目录里（含 `original`）。

    Args: variant。
    """
    return variant in MODEL_VARIANTS
