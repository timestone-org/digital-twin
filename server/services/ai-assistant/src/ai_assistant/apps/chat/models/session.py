"""会话表：一次对话，属于一个用户，钉在一个工作面上。"""

import uuid
from typing import Any

from sqlalchemy import Boolean, CheckConstraint, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from ai_assistant.apps.chat.enums import SURFACE_KINDS, sql_values
from ai_assistant.apps.chat.models.base import Base
from lib.db import TimestampMixin, UuidPrimaryKeyMixin

TITLE_MAX_LENGTH = 200
SURFACE_KIND_MAX_LENGTH = 32
# 工作面指向的那个东西的 id（大屏 id / 台账 id / 数据源 id）。
# ⚠ 存字符串不存 UUID：不同工作面指向的标识形态不同，收成 UUID 就把
# 「将来会有非 UUID 标识的工作面」这件事挡死在类型上
SURFACE_REF_MAX_LENGTH = 128
PROFILE_MAX_LENGTH = 32
EFFORT_MAX_LENGTH = 16


class ChatSession(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一次对话。归档只是不再列出，历史一条都不删。"""

    __tablename__ = "chat_sessions"

    # ⚠ 不建外键指向 auth 的用户表：跨 schema 外键是三条禁令之一（ADR-0003），
    # 做到这条，assistant schema 才能整体搬到独立实例
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    # 标题由首轮对话摘要出来；摘不出时留空由界面显示时刻
    title: Mapped[str] = mapped_column(
        String(TITLE_MAX_LENGTH), nullable=False, server_default=text("''")
    )
    surface_kind: Mapped[str] = mapped_column(
        String(SURFACE_KIND_MAX_LENGTH), nullable=False
    )
    surface_ref: Mapped[str | None] = mapped_column(
        String(SURFACE_REF_MAX_LENGTH), nullable=True
    )
    is_archived: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    # 乐观锁行版本。改标题与归档都推进它，前端据它判断自己手上那份旧没旧
    row_version: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("1")
    )
    # 最近一次失败的原因，给人看。⚠ 不带上游 URL 与密钥，只带能对外说的那一句
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 当前执行计划（ADR-0024）。落库不落内存——api 角色无状态，续跑可能落到
    # 另一个副本上。没有计划就是 NULL，不填空对象
    plan_json: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, nullable=True
    )
    # 这个会话用哪一路模型、哪一档推理。⚠ 落在会话上而不是每次请求带：
    # 工具回填那几次推进是循环自己发的，那时前端手上没有用户的选择。
    # ⚠ 建行时就盖上此刻的默认，不留 NULL：留着的话推进那一层退按量，
    # 而界面显示的是能力面报的默认，两边不一致时只有账单看得出来
    model_profile: Mapped[str | None] = mapped_column(
        String(PROFILE_MAX_LENGTH), nullable=True
    )
    reasoning_effort: Mapped[str | None] = mapped_column(
        String(EFFORT_MAX_LENGTH), nullable=True
    )

    __table_args__ = (
        CheckConstraint(
            f"surface_kind IN ({sql_values(SURFACE_KINDS)})",
            name="surface_kind_known",
        ),
        CheckConstraint("row_version >= 1", name="row_version_positive"),
        CheckConstraint(
            f"length(title) <= {TITLE_MAX_LENGTH}", name="title_sized"
        ),
    )
