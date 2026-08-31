"""建 knowledge_chunks：助手记住的长期口径（ADR-0030）。

纯扩展步：新建一张表、**不回填**。旧代码不认识这张表，也不会去读它，
所以「新结构 + 旧代码」天然可用。

⚠ 索引**不用 `CONCURRENTLY`**：那是给有活写入的存量表用的，而这张表是这一次
新建的、建索引时还是空的。硬加的话 `autocommit_block()` 在本仓的 alembic 配置下
直接 assert 失败（迁移压根跑不起来），而 `check_migrations` 也早已把同一次迁移里
新建的表排除在那条要求之外。

Revision ID: b3e7a1c92d48
Revises: f7b4c8d2e916
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b3e7a1c92d48"
down_revision: str | None = "f7b4c8d2e916"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "assistant"
TABLE = "knowledge_chunks"
INDEX = "ix_knowledge_chunks_owner"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.create_table(
        TABLE,
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("scope", sa.String(length=16), nullable=False),
        sa.Column("owner_id", sa.String(length=128), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        # float32 紧凑编码。⚠ 不用 numeric[] 也不用 JSON：一条 1536 维向量存成
        # JSON 是两万多字符，取回一千条就是两千万字符的解析，而它只表现为
        # 「检索有点慢」，没有任何一处会报错
        sa.Column("embedding", sa.LargeBinary(), nullable=True),
        sa.Column("embedding_model", sa.String(length=128), nullable=True),
        sa.Column("dimensions", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("scope IN ('user', 'project')", name="scope_known"),
        sa.CheckConstraint("length(title) <= 200", name="title_sized"),
        sa.CheckConstraint("length(owner_id) > 0", name="owner_present"),
        schema=SCHEMA,
    )
    op.create_index(
        INDEX,
        TABLE,
        ["scope", "owner_id"],
        unique=False,
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_index(INDEX, table_name=TABLE, schema=SCHEMA)
    op.drop_table(TABLE, schema=SCHEMA)
