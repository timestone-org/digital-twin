"""保存外部记录的稳定身份、当前版本和等待摄取的版本。"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "ccb91e3a75d2"
down_revision: str | None = "b62a1d73f8e0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.add_column(
        "kb_documents",
        sa.Column("source_revision_state", sa.String(16), nullable=True),
        schema="knowledge",
    )
    op.execute(
        "ALTER TABLE knowledge.kb_documents ADD CONSTRAINT "
        "ck_kb_documents_source_revision_state CHECK "
        "(source_revision_state IN ('current','pending','historical')) "
        "NOT VALID"
    )
    _create_source_records()


def _create_source_records() -> None:
    identity = postgresql.UUID(as_uuid=True)
    op.create_table(
        "kb_source_records",
        sa.Column("id", identity, nullable=False),
        sa.Column("source_id", identity, nullable=False),
        sa.Column("record_key_hash", sa.String(64), nullable=False),
        sa.Column("record_key", sa.Text(), nullable=False),
        sa.Column("current_document_id", identity, nullable=True),
        sa.Column("pending_document_id", identity, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "length(record_key_hash) = 64 AND length(record_key) > 0",
            name="ck_kb_source_records_record_key",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_kb_source_records"),
        sa.UniqueConstraint(
            "source_id", "record_key_hash", name="uq_kb_source_records_identity"
        ),
        sa.ForeignKeyConstraint(
            ["source_id"],
            ["knowledge.kb_sources.id"],
            name="fk_kb_source_records_source",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["current_document_id"],
            ["knowledge.kb_documents.id"],
            name="fk_kb_source_records_current",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["pending_document_id"],
            ["knowledge.kb_documents.id"],
            name="fk_kb_source_records_pending",
            ondelete="SET NULL",
        ),
        schema="knowledge",
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_table("kb_source_records", schema="knowledge")
    op.drop_column("kb_documents", "source_revision_state", schema="knowledge")
