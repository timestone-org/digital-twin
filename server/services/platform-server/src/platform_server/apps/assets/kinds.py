"""素材类型白名单：每一类各自的内容类型与大小闸。

一处供三用：签发直传凭证时把条件写进 policy、落库时校验、前端拿它做文件选择器
的 accept。**没登记的类型既传不上来也存不下去**。

⚠ 大小闸必须签进 policy 由存储端强制。只在这里挡的话，绕过页面直接 POST 就能
上传任意大的文件——而服务端在 finalize 之前根本不知道有这回事。
"""

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType

# 素材类型。⚠ 字面量不是数字：数字枚举跨仓对不上号时没有任何提示
ASSET_KINDS = ("model", "image", "icon")

KIB = 1024
MIB = 1024 * KIB


@dataclass(frozen=True)
class KindSpec:
    """一类素材的登记信息。"""

    kind: str
    #: 可接受的内容类型，逐字比对（不做前缀匹配：`image/*` 会放进 svg+xml）
    content_types: tuple[str, ...]
    max_bytes: int
    label: str

    def accepts(self, content_type: str) -> bool:
        """这个内容类型是否被本类接受。

        Args: content_type。
        """
        return content_type in self.content_types


# ⚠ glTF 的两种封装都要收：.glb 是 model/gltf-binary，.gltf 是 model/gltf+json。
# 只认前者会让用户导出的 .gltf 在选择文件那一步就被浏览器灰掉，且没有任何提示
_MODEL = KindSpec(
    kind="model",
    content_types=(
        "model/gltf-binary",
        "model/gltf+json",
        # ⚠ 兜底：不少系统对 .glb 给不出类型，浏览器于是填 octet-stream。
        # 不收它等于「文件明明选对了却传不上去」
        "application/octet-stream",
    ),
    max_bytes=256 * MIB,
    label="三维模型",
)

_IMAGE = KindSpec(
    kind="image",
    content_types=(
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/svg+xml",
    ),
    max_bytes=16 * MIB,
    label="图片",
)

_ICON = KindSpec(
    kind="icon",
    content_types=("image/svg+xml", "image/png"),
    max_bytes=512 * KIB,
    label="图标",
)

_SPECS: Mapping[str, KindSpec] = MappingProxyType(
    {spec.kind: spec for spec in (_MODEL, _IMAGE, _ICON)}
)

# 上传后最小可接受字节数。0 字节的对象在存储里是合法的，但它一定是一次失败的
# 上传——放过去的话，大屏上表现为「模型加载中」永远转下去
MIN_UPLOAD_BYTES = 1


def spec_of(kind: str) -> KindSpec | None:
    """一类素材的登记信息；没登记给 None。

    Args: kind。
    """
    return _SPECS.get(kind)


def kinds() -> tuple[str, ...]:
    """全部已登记的素材类型，顺序钉死。"""
    return ASSET_KINDS
