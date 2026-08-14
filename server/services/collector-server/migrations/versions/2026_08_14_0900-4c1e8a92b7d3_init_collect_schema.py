"""建 collect schema 的采集运行态表。

schema 由 env.py 在迁移前 CREATE IF NOT EXISTS。

⚠ 归档超表 `collect.point_history` 不在这一版：它要 TimescaleDB 扩展与
压缩策略，列契约在 `domain/timeseries`，见 docs/COLLECT_DESIGN.md §6。

Revision ID: 4c1e8a92b7d3
Revises:
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "4c1e8a92b7d3"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.create_table(
        "collect_source_states",
        # 自然主键：一个数据源一行运行态，靠它 ON CONFLICT 幂等覆盖。
        # 无外键指向 platform.collect_sources——禁跨 schema 外键（ADR-0003）
        sa.Column("source_id", sa.UUID(), nullable=False),
        sa.Column(
            "state",
            sa.Text(),
            server_default=sa.text("'offline'"),
            nullable=False,
        ),
        sa.Column(
            "point_count",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("error_category", sa.Text(), nullable=True),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column("leader_instance", sa.Text(), nullable=False),
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
        sa.CheckConstraint(
            "state IN ('connecting', 'online', 'offline')",
            name=op.f("ck_collect_source_states_state_valid"),
        ),
        sa.CheckConstraint(
            "error_category IS NULL OR error_category IN "
            "('transient', 'config', 'auth')",
            name=op.f("ck_collect_source_states_error_category_valid"),
        ),
        sa.CheckConstraint(
            "point_count >= 0",
            name=op.f("ck_collect_source_states_point_count_not_negative"),
        ),
        sa.PrimaryKeyConstraint(
            "source_id", name=op.f("pk_collect_source_states")
        ),
        schema="collect",
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_table("collect_source_states", schema="collect")
