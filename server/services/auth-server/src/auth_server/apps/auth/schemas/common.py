"""对外模型的共用基类与字段类型。

时间一律 RFC3339 UTC 毫秒带 Z；入参一律 `extra="forbid"`——多带一个字段就拒绝，
这是「注册接口被塞进 role_id」这类提权的第二道防线。
⚠ 不开全局 `str_strip_whitespace`：口令被静默去空白等于悄悄改了凭据。
"""

from datetime import datetime
from typing import Annotated

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    PlainSerializer,
    StringConstraints,
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

Trimmed = Annotated[str, StringConstraints(strip_whitespace=True)]


def _reject_null(value: object) -> object:
    if value is None:
        raise ValueError("不能为 null；不改这个字段就别传它")
    return value


# 局部更新里「缺省 = 不改」，而显式 null 对非空列没有含义，挂上它就当场 422
NotNull = BeforeValidator(_reject_null)


class InputModel(BaseModel):
    """全部请求体的基类。"""

    model_config = ConfigDict(extra="forbid")


class OutputModel(BaseModel):
    """全部响应体的基类。"""

    model_config = ConfigDict(from_attributes=True)
