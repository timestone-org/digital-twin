"""流水线表：一张分析图的身份与图本体（docs/MODELING_DESIGN.md §4.1）。

⚠ `code` 建后不可改：导出件按它对齐，改一次等于让导入方认不出这是同一条
流水线（D4 与 D10）。
"""

from typing import Any

from sqlalchemy import CheckConstraint, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from platform_server.apps.modeling.models.base import Base


class ModelingPipeline(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一条流水线。`code` 全局唯一，导出导入按它对齐。"""

    __tablename__ = "modeling_pipelines"

    code: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 图本体 `{format_version, nodes, edges}`，形状见 §4.6。
    # ⚠ 边带端口（`from_port` / `to_port`）：不带的话，上游有两个节点都产出
    # 同名端口时，用户在画布上根本无从表达要连哪一路（D4）
    graph_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    # 冗余的台账 code 清单，供「改这张台账会影响谁」反查。
    # ⚠ 只许保存路径写它：别处补写就会有两份口径，而反查漏一条不报错
    source_table_codes: Mapped[list[Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        server_default=text("'[]'::jsonb"),
    )
    created_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    # ⚠ 冗余存一份用户名是刻意的：账号可能被删，而这一行要一直答得出「谁建的」
    created_by_name: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("code"),
        CheckConstraint("length(code) BETWEEN 1 AND 64", name="code_sized"),
        CheckConstraint("length(name) > 0", name="name_nonempty"),
        # 图必须是对象：存成数组或标量时，读侧只会看见一张空图
        CheckConstraint(
            "jsonb_typeof(graph_json) = 'object'", name="graph_is_an_object"
        ),
        # 台账清单必须是数组，否则反查静默少一批流水线
        CheckConstraint(
            "jsonb_typeof(source_table_codes) = 'array'",
            name="source_table_codes_are_an_array",
        ),
    )
