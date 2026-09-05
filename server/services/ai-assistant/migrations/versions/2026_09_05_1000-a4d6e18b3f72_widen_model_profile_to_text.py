"""会话行上的档位名放宽成 `text`：它现在存的是供应商 id（ADR-0040）。

档位名原来是 `default` / `codex` 这样的字面量，列宽因此定成 varchar(32)。
「档位即供应商」之后，档位名就是那一路供应商在库里的行 id——36 字符的 uuid，
一个都写不进去：每一条新会话在 INSERT 那一下炸成 22001，而界面上的表现只是
「点了助手没反应」（前端把建会话的失败吞了）。

`varchar(32) → text` 是二进制兼容的加宽：PG 不重写全表，滚动发布期间也没有
坏掉的那一版——旧代码写得进去的短字面量，加宽之后照样写得进去。这是
`database-standard.md` §5.2 里「改类型」那条唯一的例外。

Revision ID: a4d6e18b3f72
Revises: c8f2b41d7e35
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a4d6e18b3f72"
down_revision: str | None = "c8f2b41d7e35"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "assistant"
TABLE = "chat_sessions"
COLUMN = "model_profile"
OLD_LENGTH = 32


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.alter_column(
        TABLE,
        COLUMN,
        type_=sa.Text(),
        existing_type=sa.String(OLD_LENGTH),
        existing_nullable=True,
        schema=SCHEMA,
    )


def downgrade() -> None:
    # ⚠ 这一步是缩窄：库里存着供应商 id 时它会失败，且那是对的。要回滚就得先
    # 把那些行的档位名改回短字面量（或置空），不是把这里做成一句空实现
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.alter_column(
        TABLE,
        COLUMN,
        type_=sa.String(OLD_LENGTH),
        existing_type=sa.Text(),
        existing_nullable=True,
        schema=SCHEMA,
    )
