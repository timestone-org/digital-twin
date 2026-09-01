"""知识库表：一组共享同一嵌入档与检索策略的知识。

⚠ `embedding_model` 与 `dimensions` 钉在**库**上，不钉在块上。一个库里混两种
维数的向量算不出有意义的余弦，而表现只是「召回忽然变差了」——没有任何一处会
报错。换嵌入档因此等于整库重嵌，界面上要明说这件事（ADR-0034 决策六）。
"""

from sqlalchemy import CheckConstraint, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from knowledge_server.apps.knowledge.models.base import Base
from lib.db import TimestampMixin, UuidPrimaryKeyMixin

NAME_MAX_LENGTH = 120
DESCRIPTION_MAX_LENGTH = 1_000
EMBEDDING_MODEL_MAX_LENGTH = 128
STRATEGY_MAX_LENGTH = 32

# 与 `services/retrieval/registry.py` 的注册名逐字对齐。⚠ 两处各写一份是因为
# 一处是数据库约束、一处是注册表，而契约测试守着它们不漂
STRATEGIES = ("naive", "hybrid", "agentic")


class KnowledgeBase(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一个知识库。"""

    __tablename__ = "kb_bases"

    name: Mapped[str] = mapped_column(String(NAME_MAX_LENGTH), nullable=False)
    description: Mapped[str] = mapped_column(
        String(DESCRIPTION_MAX_LENGTH), nullable=False, server_default=""
    )
    # 算这个库全部向量的那一路来源与维数。⚠ 建库时定下、之后不改：
    # 改它等于让整库既有向量作废，而那件事没有任何运行期迹象
    embedding_model: Mapped[str | None] = mapped_column(
        String(EMBEDDING_MODEL_MAX_LENGTH), nullable=True
    )
    dimensions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 这个库默认走哪个检索策略
    retrieval_strategy: Mapped[str] = mapped_column(
        String(STRATEGY_MAX_LENGTH), nullable=False, server_default="hybrid"
    )
    # 建库的人。⚠ 存字符串不存 UUID：不同归属面指向的标识形态可以不同，
    # 收成 UUID 就把将来挡死在类型上
    owner_id: Mapped[str] = mapped_column(String(128), nullable=False)
    # 给人看的一段说明，进不了检索
    notes: Mapped[str] = mapped_column(Text, nullable=False, server_default="")

    __table_args__ = (
        CheckConstraint("length(name) > 0", name="name_present"),
        CheckConstraint("length(owner_id) > 0", name="owner_present"),
        CheckConstraint(
            "retrieval_strategy IN ('naive', 'hybrid', 'agentic')",
            name="strategy_known",
        ),
        CheckConstraint(
            "dimensions IS NULL OR dimensions > 0", name="dimensions_positive"
        ),
    )
