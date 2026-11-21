"""为已登记、尚未被 worker 认领的来源版本建立在线恢复索引。"""

import sqlalchemy as sa
from alembic import op

revision: str = "ae628bb5f3b7"
down_revision: str | None = "36dcb2f81a70"
branch_labels = None
depends_on = None

_INDEX = "ix_kb_documents_source_recovery"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    with op.get_context().autocommit_block():
        existing = op.get_bind().scalar(
            sa.text(
                "SELECT indisvalid FROM pg_index "
                "WHERE indexrelid=to_regclass(:key)"
            ),
            {"key": "knowledge." + _INDEX},
        )
        if existing is False:
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS knowledge.{_INDEX}")
        op.execute(
            f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {_INDEX} "
            "ON knowledge.kb_documents (updated_at,id) "
            "WHERE status='pending' "
            "AND source_revision_state IN ('pending','current')"
        )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    with op.get_context().autocommit_block():
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS knowledge.{_INDEX}")
