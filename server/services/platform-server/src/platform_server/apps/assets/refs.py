"""素材引用 `asset:<uuid>` 的构造与解析。

⚠ 这是素材在业务配置里**唯一合法的落库形态**。存 URL 的话，部署地址一换、
构建产物一换 hash，存量配置里那条链接就 404 了，而没有任何一处会报错——
表现只是「这张大屏的模型不见了」。
"""

import uuid

ASSET_REF_PREFIX = "asset:"


def asset_ref(asset_id: uuid.UUID) -> str:
    """素材 id → 引用串。

    Args: asset_id。
    """
    return f"{ASSET_REF_PREFIX}{asset_id}"


def parse_asset_ref(ref: str) -> uuid.UUID | None:
    """引用串 → 素材 id；形状不对给 None。

    Args: ref。
    """
    text = ref.strip()
    if not text.startswith(ASSET_REF_PREFIX):
        return None
    try:
        return uuid.UUID(text[len(ASSET_REF_PREFIX) :])
    except ValueError:
        return None
