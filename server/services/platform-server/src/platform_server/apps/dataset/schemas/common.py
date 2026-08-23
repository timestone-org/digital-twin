"""对外模型的共用基类与字段类型。

时间一律 RFC3339 UTC 毫秒带 Z；入参一律 `extra="forbid"`——多带一个字段就拒绝，
免得客户端以为某个拼错的字段生效了。
"""

from datetime import datetime
from typing import Annotated, ClassVar, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    PlainSerializer,
    StringConstraints,
    WithJsonSchema,
    model_validator,
)

from lib.utils.timeutils import format_rfc3339
from platform_server.apps.dataset.models import KEY_PATTERN

# ⚠ `WithJsonSchema` 不能省：PlainSerializer 会把 openapi 里的类型压成裸
# `string`，前端由它生成的类型于是丢掉时间语义，而两侧都不会报错。
Utc = Annotated[
    datetime,
    PlainSerializer(format_rfc3339, return_type=str),
    WithJsonSchema({"type": "string", "format": "date-time"}),
]

# 台账名与列名可能是中文，故只限长度不限字符集
Label = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)
]
# 台账编码：它是**身份**，也是大屏绑定键 `ds:{code}:{列key}` 的前半段。
# ⚠ 不许含冒号：绑定键按冒号切分，混进去就切不回这张台账
TableCode = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=64,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$",
    ),
]
# 列 key：公式里写作 `{key}`，也是 JSONB 的字段名。放行中文，禁公式记号
ColumnKey = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=64,
        pattern=KEY_PATTERN,
    ),
]
# 备注类自由文本。空串不收——「清空」用显式 null 表达
Note = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=256)
]
# 计量单位，如 `kWh`
Unit = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=32)
]
# 点位身份 `{source_id}:{point_code}`，形状由 `timeseries.split_node_key` 校验
NodeKey = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=3, max_length=256)
]


class InputModel(BaseModel):
    """全部请求体的基类。"""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class UpdateModel(InputModel):
    """PATCH 入参的基类。

    ⚠ `null` 与「字段缺省」语义不同（api-contract §6）：缺省 = 本次不涉及，
    `null` = 清空。清空只对可空列成立，故非空列上的显式 `null` 一律拒绝——
    不拦的话它会一路走到 NOT NULL 违例，而返回给用户的是一句毫不相干的冲突。
    """

    NON_NULLABLE: ClassVar[frozenset[str]] = frozenset()

    @model_validator(mode="after")
    def check_nulls_target_nullable_fields(self) -> Self:
        """非空列上给了显式 `null` 就拒绝。"""
        offenders = sorted(
            name
            for name in self.model_fields_set & self.NON_NULLABLE
            if getattr(self, name) is None
        )
        if offenders:
            raise ValueError(f"这些字段不接受 null：{'、'.join(offenders)}")
        return self


class OutputModel(BaseModel):
    """全部响应体的基类。"""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)
