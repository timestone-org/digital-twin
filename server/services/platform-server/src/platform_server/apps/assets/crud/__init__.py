"""素材库的数据访问面。"""

from platform_server.apps.assets.crud.asset import (
    AssetWrite,
    get,
    insert_if_absent,
    list_by_kind,
    name_contains,
    remove,
    rename,
)

__all__ = [
    "AssetWrite",
    "get",
    "insert_if_absent",
    "list_by_kind",
    "name_contains",
    "remove",
    "rename",
]
