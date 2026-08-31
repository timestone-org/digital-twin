"""知识块表：助手记住的长期口径（ADR-0030）。

⚠ 写入来源**只有两个显式工具**（`memory.remember` / `memory.search`）。不去爬
大屏、台账、点位的描述文本——助手是纯消费方（CONTEXT.md §2），抄一份别人的数据
进自己的库会把「谁是这份数据的属主」搅浑：那边改了名字，这边的副本不会跟着变，
而召回出来的旧名字看着像一条正常记忆。

⚠ 向量存 `bytea`（float32 紧凑编码），**不存 `numeric[]` 也不存 JSON 数组**：
一条 1536 维向量存成 JSON 是两万多字符，取回一千条就是两千万字符的解析——
而它只表现为「检索有点慢」，没有任何一处会报错。
"""

from sqlalchemy import (
    CheckConstraint,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from ai_assistant.apps.chat.models.base import Base
from lib.db import TimestampMixin, UuidPrimaryKeyMixin

SCOPE_MAX_LENGTH = 16
# 归属者的标识。⚠ 存字符串不存 UUID，理由与 `ChatSession.surface_ref` 同源：
# 不同归属面指向的标识形态可以不同，收成 UUID 就把将来挡死在类型上
OWNER_MAX_LENGTH = 128
TITLE_MAX_LENGTH = 200
EMBEDDING_MODEL_MAX_LENGTH = 128

# 与 `services/memory/ports.py` 的 `Scope` 逐字对齐。⚠ 两处各写一份是因为
# 一处是数据库约束、一处是类型，而契约测试守着它们不漂
SCOPES = ("user", "project")


class KnowledgeChunk(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一条记住的东西。"""

    __tablename__ = "knowledge_chunks"

    scope: Mapped[str] = mapped_column(String(SCOPE_MAX_LENGTH), nullable=False)
    # ⚠ 归属者从**会话**取，绝不从模型的入参取：模型自报一个别人的 owner_id
    # 就能读到别人记的东西，而那正是本表唯一的安全条款要防的（ADR-0030 决策四）
    owner_id: Mapped[str] = mapped_column(
        String(OWNER_MAX_LENGTH), nullable=False
    )
    title: Mapped[str] = mapped_column(String(TITLE_MAX_LENGTH), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # float32 紧凑编码的向量。⚠ NULL 不是「没有内容」而是「当时嵌入算不出来」，
    # 由下一次检索惰性补算（`memory/longterm.py`）。丢掉比记不全更坏
    embedding: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    # 算这条向量的那一路来源与维数。⚠ 必须记下来：换了嵌入模型而维数变了的话，
    # 旧条目与新条目算不出有意义的余弦，而表现只是「召回忽然变差了」
    embedding_model: Mapped[str | None] = mapped_column(
        String(EMBEDDING_MODEL_MAX_LENGTH), nullable=True
    )
    dimensions: Mapped[int | None] = mapped_column(Integer, nullable=True)

    __table_args__ = (
        CheckConstraint(
            "scope IN ('user', 'project')",
            name="scope_known",
        ),
        CheckConstraint(
            f"length(title) <= {TITLE_MAX_LENGTH}", name="title_sized"
        ),
        CheckConstraint("length(owner_id) > 0", name="owner_present"),
        # 检索一律先按这两列收窄，再在应用层算余弦
        Index("ix_knowledge_chunks_owner", "scope", "owner_id"),
    )
