"""对象键的形状。全部由 `(kind, asset_id)` 推导，键里不含任何调用方输入。

⚠ 浏览器取回地址与对象键必须逐字对齐：边缘把 `/oss/<键>` 直接反代到桶里，
两侧对不上时表现为 404，而两边的代码单看都对。对齐由
`tests/contract/test_asset_keys.py` 钉住。

⚠ 直传落 `staging/`，验完再搬到正式前缀。少了这一步，未验证的字节就直接躺在
匿名可读的前缀下——任何人都能上传任意内容并拿到一个本站域名的链接。
"""

import uuid

from platform_server.apps.assets import variants

# 匿名可读的前缀白名单。⚠ `staging/` 刻意不在列
PUBLIC_PREFIXES = ("models/", "images/", "icons/")

STAGING_PREFIX = "staging/"


def staging_key(kind: str, asset_id: uuid.UUID) -> str:
    """直传落点。

    kind 编进键里之后，「凭证是按哪个 kind 签的」被 policy 的 key 条件签死，
    finalize 只能从键里读回来——请求体里不可能再出现第二个、对不上的 kind。

    Args: kind, asset_id。
    """
    return f"{STAGING_PREFIX}{kind}/{asset_id}"


def model_prefix(asset_id: uuid.UUID) -> str:
    """模型的一切都在此前缀下；删素材 = 删整前缀 + 删行。"""
    return f"models/{asset_id}/"


def model_key(asset_id: uuid.UUID) -> str:
    """模型原件。"""
    return f"{model_prefix(asset_id)}{variants.ORIGINAL}"


def model_variant_key(asset_id: uuid.UUID, variant: str) -> str:
    """某一档模型的键。`original` 就是原件那个键。

    ⚠ 派生档与原件同住 `models/{id}/` 前缀：删素材删的是整前缀，派生件因此跟着
    一起走，不会留下没有任何一行指向、也再没人清理的孤儿对象。
    Args: asset_id, variant。
    """
    if variant == variants.ORIGINAL:
        return model_key(asset_id)
    return f"{model_prefix(asset_id)}{variant}"


def image_key(asset_id: uuid.UUID) -> str:
    return f"images/{asset_id}"


def icon_key(asset_id: uuid.UUID) -> str:
    return f"icons/{asset_id}"


def object_key(kind: str, asset_id: uuid.UUID) -> str:
    """某一类素材的正式键。

    ⚠ 逐类铺满而不是拼字符串：拼出来的键在新增类型时会静默地指到一个
    不存在的前缀，而这里少一类会当场 KeyError。
    Args: kind, asset_id。
    """
    builders = {
        "model": model_key,
        "image": image_key,
        "icon": icon_key,
    }
    return builders[kind](asset_id)


def owned_prefix(kind: str, asset_id: uuid.UUID) -> str:
    """删素材时要清掉的整个前缀。

    模型将来会有派生件（缩略图、分片清单）落在同一前缀下，故删的是前缀而不是
    单个键；图片与图标只有一个对象，前缀即键本身。
    Args: kind, asset_id。
    """
    return (
        model_prefix(asset_id)
        if kind == "model"
        else object_key(kind, asset_id)
    )


def is_public(key: str) -> bool:
    """这个键是否落在匿名可读的前缀里。

    Args: key。
    """
    return key.startswith(PUBLIC_PREFIXES)
