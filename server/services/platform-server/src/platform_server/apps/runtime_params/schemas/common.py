"""对外模型的共用基类与字段类型。

时间一律 RFC3339 UTC 毫秒带 Z；入参一律 `extra="forbid"`——多带一个字段就拒绝，
免得客户端以为某个拼错的字段生效了。
"""

from datetime import datetime
from typing import Annotated

from pydantic import (
    BaseModel,
    ConfigDict,
    PlainSerializer,
    WithJsonSchema,
)

from lib.utils.timeutils import format_rfc3339

# ⚠ `WithJsonSchema` 不能省：PlainSerializer 会把 openapi 里的类型压成裸
# `string`，前端由它生成的类型于是丢掉时间语义，而两侧都不会报错。
Utc = Annotated[
    datetime,
    PlainSerializer(format_rfc3339, return_type=str),
    WithJsonSchema({"type": "string", "format": "date-time"}),
]


class InputModel(BaseModel):
    """全部请求体的基类。"""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class OutputModel(BaseModel):
    """全部响应体的基类。"""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)
