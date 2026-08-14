"""PATCH 入参 → 可直接赋值的变更集。"""

from typing import Any

from pydantic import BaseModel


def given_changes(payload: BaseModel) -> dict[str, Any]:
    """取本次真正给了值的字段。

    ⚠ 本模块的列全部 NOT NULL，`null` 不表示「清空」，故显式传 null 与不传
    同义。不丢掉它，一个 `{"workshop_id": null}` 会一路走到 NOT NULL 违例，
    而返回给用户的却是「重名冲突」这种毫不相干的提示。
    Args: payload。
    """
    return {
        key: value
        for key, value in payload.model_dump(exclude_unset=True).items()
        if value is not None
    }
