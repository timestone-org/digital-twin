"""按编码导入点位的部分字段与结果。"""

import uuid
from typing import cast

from pydantic import Field, model_validator

from platform_server.apps.collect.schemas.common import InputModel, PointCode
from platform_server.apps.collect.schemas.point import (
    MAX_BATCH,
    PointBatchOut,
    PointUpdateIn,
)


class PointImportItemIn(PointUpdateIn):
    """编码必填；导入中的空白或 null 均保留原值。"""

    code: PointCode

    @model_validator(mode="before")
    @classmethod
    def omit_blank_fields(cls, value: object) -> object:
        """在字段类型校验前剔除已知字段的空值。Args: value。"""
        if not isinstance(value, dict):
            return value
        # Pydantic 的原始输入在此边界收窄；未知字段仍交给 extra 校验。
        fields = cast(dict[str, object], value)
        return {
            key: item
            for key, item in fields.items()
            if key == "code"
            or key not in cls.model_fields
            or (
                item is not None
                and not (isinstance(item, str) and not item.strip())
            )
        }


class PointImportIn(InputModel):
    """同一数据源的一批点位；已有编码可选择跳过。"""

    source_id: uuid.UUID
    items: list[PointImportItemIn] = Field(min_length=1, max_length=MAX_BATCH)
    is_skipping_existing: bool = False


class PointImportOut(PointBatchOut):
    """导入后点位与新增、实际更新、未改动数量。"""

    created_count: int
    updated_count: int
    unchanged_count: int
