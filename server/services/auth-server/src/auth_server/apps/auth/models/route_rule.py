"""路由规则表 —— 权限判定的闸 1。

匹配语义：按 `priority` 降序逐条 `fnmatch`，**首条命中即终局**
（命中但权限不足不会继续找更宽松的规则）。`*` 跨斜杠匹配，
「前缀兜底 + 差异规则」两层结构依赖这一点。

⚠ `permission_codes` 是码字面量数组而非外键：闸 1 在每个受保护请求
都要跑，join 不划算。目录一致性由种子自检与契约测试锁，
见 tests/contract。
"""

from sqlalchemy import (
    ARRAY,
    Boolean,
    CheckConstraint,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from auth_server.apps.auth.models.base import Base
from lib.db import TimestampMixin, UuidPrimaryKeyMixin

MATCH_MODES = ("all", "any")
HTTP_METHODS = (
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "HEAD",
    "OPTIONS",
    "*",
)


class RouteRule(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一条「路径 × 方法 → 权限码」的判定规则。"""

    __tablename__ = "auth_route_rules"

    path_pattern: Mapped[str] = mapped_column(Text, nullable=False)
    http_method: Mapped[str] = mapped_column(Text, nullable=False)
    # 空数组 = 任意已登录用户放行（不是匿名放行）
    permission_codes: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=text("'{}'::text[]")
    )
    match_mode: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'all'")
    )
    priority: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    is_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    is_builtin: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "path_pattern",
            "http_method",
            name="uq_auth_route_rules_path_pattern_http_method",
        ),
        CheckConstraint(
            "match_mode IN ('all', 'any')", name="match_mode_valid"
        ),
        CheckConstraint(
            "http_method IN ('GET','POST','PUT','PATCH','DELETE',"
            "'HEAD','OPTIONS','*')",
            name="http_method_valid",
        ),
        CheckConstraint(
            "length(path_pattern) > 0", name="path_pattern_nonempty"
        ),
        Index(
            "ix_auth_route_rules_priority",
            text("priority DESC"),
            postgresql_where=text("is_enabled"),
        ),
    )
