"""建模面对外模型的共用基类与字段类型。

时间一律 RFC3339 UTC 带 Z；入参一律 `extra="forbid"`——多带一个字段就拒绝，
免得客户端以为某个拼错的字段生效了。
"""

from datetime import datetime
from typing import Annotated

from pydantic import (
    BaseModel,
    ConfigDict,
    PlainSerializer,
    StringConstraints,
    WithJsonSchema,
)

from lib.utils.timeutils import format_rfc3339

# ⚠ `WithJsonSchema` 不能省：PlainSerializer 会把 openapi 里的类型压成裸
# `string`，前端由它生成的类型于是丢掉时间语义，而两侧都不会报错
Utc = Annotated[
    datetime,
    PlainSerializer(format_rfc3339, return_type=str),
    WithJsonSchema({"type": "string", "format": "date-time"}),
]

# 流水线编码：导出 / 导入按它对齐，建后不可改
PipelineCode = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=64,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$",
    ),
]
# 显示名可能是中文，故只限长度不限字符集
Label = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)
]
Note = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=512)
]


class InputModel(BaseModel):
    """全部请求体的基类。"""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class OutputModel(BaseModel):
    """全部响应体的基类。"""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)
