"""模型版本的二进制产物表（docs/MODELING_PLATFORM_DESIGN.md D9）。

纯扩展步：一张新表，无回填。旧代码不认识它。

⚠ 字节**不进这张表**，只留对象键与摘要：版本列表页要全量读版本表，而一片森林
的产物可以到几十 MB，进库会连着把备份与 WAL 一起撑大。

⚠ 一个版本至多一份产物（`model_version_id` 唯一），版本没了产物记录跟着没
（CASCADE）；对象本身由保留期清理延后删——退役错了还有个撤回的窗口。

Revision ID: e7c2b95a3f81
Revises: d1b7e40c95a2
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e7c2b95a3f81"
down_revision: str | None = "d1b7e40c95a2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA = "platform"
_TABLE = "modeling_model_artifacts"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.create_table(
        _TABLE,
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "model_version_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("object_key", sa.Text(), nullable=False),
        sa.Column("digest", sa.Text(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("format_version", sa.Integer(), nullable=False),
        sa.Column("runtime_json", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["model_version_id"],
            [f"{_SCHEMA}.modeling_model_versions.id"],
            name="fk_modeling_model_artifacts_version_id",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "model_version_id", name="uq_modeling_model_artifacts_version"
        ),
        sa.CheckConstraint(
            "length(object_key) > 0", name="object_key_nonempty"
        ),
        sa.CheckConstraint("length(digest) = 64", name="digest_is_sha256"),
        sa.CheckConstraint("size_bytes > 0", name="size_positive"),
        sa.CheckConstraint("format_version >= 1", name="format_version_valid"),
        sa.CheckConstraint(
            "jsonb_typeof(runtime_json) = 'object'",
            name="runtime_is_an_object",
        ),
        schema=_SCHEMA,
    )


def downgrade() -> None:
    """⚠ 撤回只删记录，对象存储里那些字节留着——那不是这一步该做的事，
    也不该在一次迁移里去连外部存储。"""
    op.execute("SET lock_timeout = '3s'")
    op.drop_table(_TABLE, schema=_SCHEMA)
