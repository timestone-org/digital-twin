"""素材库的全部 ORM 模型。

alembic 的 `env.py` 通过本文件收集元数据，故须维护 `__all__`：漏一个即迁移漏表。
"""

from platform_server.apps.assets.models.asset import Asset
from platform_server.apps.assets.models.asset_variant import (
    VARIANT_STATUSES,
    AssetModelVariant,
)
from platform_server.apps.assets.models.base import Base

__all__ = ["VARIANT_STATUSES", "Asset", "AssetModelVariant", "Base"]
