"""供应商表：一路模型来源的接入形态 + 它上面登记的几个模型。

⚠ 端点与密钥**只有 `openai_compat` 那一形态有**，故两列可空：靠登录的那些
形态（Codex 订阅）在这里没有密钥，令牌在消费方那一侧。可空而不是存空串，
是因为 `base_url` 上那条 CHECK 要求它像个地址。

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
from platform_server.apps.llm_providers.enums import (
    PROVIDER_KIND_CODES,
    PROVIDER_KIND_OPENAI_COMPAT,
    sql_values,
)
from platform_server.apps.llm_providers.models.base import Base

# 密钥尾巴留几位。⚠ 只够认出「是哪一把」，不够猜
API_KEY_HINT_CHARS = 4
API_KEY_HINT_MAX_LENGTH = 16


class LlmProvider(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一路供应商。名字全局唯一。"""

    __tablename__ = "llm_providers"

    name: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    # 接入形态。⚠ 建了就不许改：改形态等于换一路接法，而密钥、登录态与模型
    # 清单全部作废——那是「删了重建」，不是「改一格」
    kind: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=PROVIDER_KIND_OPENAI_COMPAT
    )
    base_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    api_key_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
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
    # 这一形态自己的那几格配置（推理档位一类）。⚠ 形状按形态校验：形态之间
    # 的键不通用，混着存等于让一个形态读到另一个形态的取值
    options_json: Mapped[dict[str, Any] | None] = mapped_column(
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
        CheckConstraint(
            f"kind IN ({sql_values(PROVIDER_KIND_CODES)})", name="kind_known"
        ),
        # ⚠ NULL 时这条判 NULL 而不是假，于是照常放行：没有端点的那些形态
        # 本来就该没有地址
        CheckConstraint("base_url ~ '^https?://'", name="base_url_is_http"),
        CheckConstraint(
            "jsonb_typeof(models_json) = 'array'", name="models_are_an_array"
        ),
        CheckConstraint(
            "extra_body_json IS NULL OR jsonb_typeof(extra_body_json) = "
            "'object'",
            name="extra_body_is_an_object",
        ),
        CheckConstraint(
            "options_json IS NULL OR jsonb_typeof(options_json) = 'object'",
            name="options_are_an_object",
        ),
    )
