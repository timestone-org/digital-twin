"""PATCH 入参 → 可直接赋值的变更集。"""

from typing import Any

from pydantic import BaseModel


def given_changes(payload: BaseModel) -> dict[str, Any]:
    """取本次真正给了值的字段，**保留显式的 `null`**。

    ⚠ 本模块有可空列（`unit` / `archive_retention_days` / `credential`），
    `null` 在它们上面是「清空」这个明确语义。非空列上的 `null` 由 `UpdateModel`
    在入参层就拒了，不会走到这里。
    Args: payload。
    """
    return payload.model_dump(exclude_unset=True)
