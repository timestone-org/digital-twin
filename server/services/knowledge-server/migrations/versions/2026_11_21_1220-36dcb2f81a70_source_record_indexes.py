"""并发建立来源记录当前及待处理文档的索引，验证文档状态约束。"""

import sqlalchemy as sa
from alembic import op

revision: str = "36dcb2f81a70"
down_revision: str | None = "ccb91e3a75d2"
branch_labels = None
depends_on = None

_COLUMNS = ("current_document_id", "pending_document_id")
_VALID = sa.text(
    "SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass(:name)"
)


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    with op.get_context().autocommit_block():
        for column in _COLUMNS:
            name = "ix_kb_source_records_" + column.removesuffix("_id")
            full_name = "knowledge." + name
            if op.get_bind().scalar(_VALID, {"name": full_name}) is False:
                op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {full_name}")
            op.execute(
                f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {name} "
                f"ON knowledge.kb_source_records ({column})"
            )
    op.execute(
        "ALTER TABLE knowledge.kb_documents VALIDATE CONSTRAINT "
        "ck_kb_documents_source_revision_state"
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    with op.get_context().autocommit_block():
        for column in _COLUMNS:
            name = "ix_kb_source_records_" + column.removesuffix("_id")
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS knowledge.{name}")
