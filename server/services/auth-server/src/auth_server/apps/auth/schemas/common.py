"""对外模型的共用基类与字段类型。

时间一律 RFC3339 UTC 毫秒带 Z；入参一律 `extra="forbid"`——多带一个字段就拒绝，
这是「注册接口被塞进 role_id」这类提权的第二道防线。
⚠ 不开全局 `str_strip_whitespace`：口令被静默去空白等于悄悄改了凭据。
"""

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, PlainSerializer, StringConstraints

from lib.utils.timeutils import format_rfc3339

Utc = Annotated[datetime, PlainSerializer(format_rfc3339, return_type=str)]

Trimmed = Annotated[str, StringConstraints(strip_whitespace=True)]


class InputModel(BaseModel):
    """全部请求体的基类。"""

    model_config = ConfigDict(extra="forbid")


class OutputModel(BaseModel):
    """全部响应体的基类。"""

    model_config = ConfigDict(from_attributes=True)
