"""报告接口的基础类型与序列化口径。"""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    PlainSerializer,
    StringConstraints,
    WithJsonSchema,
)

from lib.utils.timeutils import format_rfc3339

Utc = Annotated[
    datetime,
    PlainSerializer(format_rfc3339, return_type=str),
    WithJsonSchema({"type": "string", "format": "date-time"}),
]
Label = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)
]
Code = Annotated[
    str, StringConstraints(pattern=r"^[A-Za-z_][A-Za-z0-9_]*$", max_length=64)
]
Granularity = Literal["day", "month", "quarter", "year"]
Aggregation = Literal[
    "avg", "min", "max", "last", "first", "sum", "count", "delta"
]


class InputModel(BaseModel):
    """拒绝拼错的输入字段。"""

    model_config = ConfigDict(extra="forbid")


class OutputModel(BaseModel):
    """可演进的响应模型。"""

    model_config = ConfigDict(from_attributes=True)
