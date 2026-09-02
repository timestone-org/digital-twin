"""供应商表：一路 OpenAI 兼容端点 + 它上面登记的几个模型。

⚠ 密钥**只以密文入库**（`api_key_enc`），明文一个字都不落；旁边留一段尾巴
（`api_key_hint`）给界面回答「填的是不是那一把」。

⚠ 模型清单存 `jsonb`：形状会演进（将来可能多一格上下文长度、单价），且不按
其中字段过滤——按名字找模型是在一路供应商的几条里线性找。
"""

from typing import Any

from sqlalchemy import Boolean, CheckConstraint, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from platform_server.apps.llm_providers.models.base import Base

# 密钥尾巴留几位。⚠ 只够认出「是哪一把」，不够猜
API_KEY_HINT_CHARS = 4
API_KEY_HINT_MAX_LENGTH = 16


class LlmProvider(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一路供应商。名字全局唯一。"""

    __tablename__ = "llm_providers"

    name: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    base_url: Mapped[str] = mapped_column(Text, nullable=False)
    api_key_enc: Mapped[str] = mapped_column(Text, nullable=False)
    api_key_hint: Mapped[str] = mapped_column(
        String(API_KEY_HINT_MAX_LENGTH), nullable=False, server_default=""
    )
    is_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    # 端点方言里的额外请求体（思考开关一类）。各家键不同而代码里不认厂商名，
    # 于是它只能是一格透传的取值
    # ⚠ `none_as_null`：不带它时 Python 的 None 会存成 JSON 的 `null` 值而不是
    # SQL NULL，`jsonb_typeof` 于是回 'null'，下面那条 CHECK 当场拒——只有真库
    # 逮得到
    extra_body_json: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True
    )
    # `[{name, kind, has_vision, dimensions}]`，形状由 schemas 校验
    models_json: Mapped[list[Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        server_default=text("'[]'::jsonb"),
    )
    notes: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    # 最近改它的人。⚠ 存字符串不存 UUID：不建外键指向 auth 的用户表，跨 schema
    # 外键是三条禁令之一
    updated_by: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        CheckConstraint("length(name) > 0", name="name_nonempty"),
        CheckConstraint("base_url ~ '^https?://'", name="base_url_is_http"),
        CheckConstraint(
            "jsonb_typeof(models_json) = 'array'", name="models_are_an_array"
        ),
        CheckConstraint(
            "extra_body_json IS NULL OR jsonb_typeof(extra_body_json) = "
            "'object'",
            name="extra_body_is_an_object",
        ),
    )
