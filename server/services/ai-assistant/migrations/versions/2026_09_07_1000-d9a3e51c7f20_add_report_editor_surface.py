"""chat_sessions 的工作面闭合集合加入 report-editor。

Revision ID: d9a3e51c7f20
Revises: a4d6e18b3f72
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d9a3e51c7f20"
down_revision: str | None = "a4d6e18b3f72"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "assistant"
TABLE = "chat_sessions"
CONSTRAINT = "ck_chat_sessions_surface_kind_known"
NARROW = (
    "'dashboard-editor', 'twin-editor', 'twin2d-editor', 'dataset-table', "
    "'collect-source', 'dashboard-view'"
)
WIDE = (
    "'dashboard-editor', 'twin-editor', 'twin2d-editor', 'dataset-table', "
    "'report-editor', 'collect-source', 'dashboard-view'"
)


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    _swap(WIDE)


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    _swap(NARROW)


def _swap(kinds: str) -> None:
    """用低锁表方式替换闭合集合。Args: kinds。"""
    _drop_existing()
    op.execute(
        f"ALTER TABLE {SCHEMA}.{TABLE} ADD CONSTRAINT {CONSTRAINT} "
        f"CHECK (surface_kind IN ({kinds})) NOT VALID"
    )
    op.execute(f"ALTER TABLE {SCHEMA}.{TABLE} VALIDATE CONSTRAINT {CONSTRAINT}")


def _drop_existing() -> None:
    """按定义找到并删除现存的工作面 CHECK。"""
    names = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT conname FROM pg_constraint "
                "WHERE conrelid = CAST(:table AS regclass) "
                "AND contype = 'c' "
                "AND pg_get_constraintdef(oid) ILIKE :pattern"
            ),
            {"table": f"{SCHEMA}.{TABLE}", "pattern": "%surface_kind%"},
        )
        .scalars()
        .all()
    )
    for name in names:
        op.drop_constraint(str(name), TABLE, type_="check", schema=SCHEMA)
