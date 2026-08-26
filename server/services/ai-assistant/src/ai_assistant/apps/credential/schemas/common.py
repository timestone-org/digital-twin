"""本模块出入参的共用字段类型。

⚠ 与 `apps/chat/schemas/common.py` 里那份同源却各写一份：跨功能模块只许走对方的
services 公开面，而这是个纯序列化别名。两份必须同口径——时间格式一旦分叉，
前端会在两个面上拿到两种时间串，而 typecheck 一侧都不会红。
"""

from datetime import datetime
from typing import Annotated

from pydantic import PlainSerializer, WithJsonSchema

from lib.utils.timeutils import format_rfc3339

# ⚠ `WithJsonSchema` 不能省：PlainSerializer 会把 openapi 里的类型压成裸
# `string`，前端由它生成的类型于是丢掉时间语义，而两侧都不会报错。
Utc = Annotated[
    datetime,
    PlainSerializer(format_rfc3339, return_type=str),
    WithJsonSchema({"type": "string", "format": "date-time"}),
]
