"""消息表加一列引用（这一轮答案真正用到的那几条）。

纯扩展步：加一列**可空**、不回填。旧代码不认识这一列，读到的行为与改造前
一致——`NULL` 就是「这一条没有引用」。

⚠ 为什么要落库：引用此前只作为一帧流出去，回放会话时整块凭空消失，而依据里
挂着的正是文档解析出来的那几张图。表现是「问的时候看得见图，重开这条对话图
就没了」，且不报任何错。

⚠ 落的是**摊好的那一份**（连 `document_id`、页码与图 id），不是几个 chunk id：
角标账本是回合作用域的，回合一结束就没了，事后按 id 反查也补不回「模型当时
引的是哪一段文字」。

⚠ 不建索引：没有任何一条查询按引用筛消息，索引在这里只是一份写放大。

Revision ID: a7e1b4c96d38
Revises: f6c8d3b25e17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a7e1b4c96d38"
down_revision: str | None = "f6c8d3b25e17"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "knowledge"
TABLE = "kb_chat_messages"
COLUMN = "citations_json"


def upgrade() -> None:
    """加一列引用。"""
    op.execute("SET lock_timeout = '5s'")
    op.add_column(
        TABLE,
        # 可空是关键：存量行天然是 NULL，也就是「这一条没有引用」
        sa.Column(COLUMN, postgresql.JSONB, nullable=True),
        schema=SCHEMA,
    )


def downgrade() -> None:
    """删列。引用只存在这一列上，删了就是回到「回放不出依据」。"""
    op.execute("SET lock_timeout = '5s'")
    op.drop_column(TABLE, COLUMN, schema=SCHEMA)
