"""扩展单文档向量暂存及代次切换审计。"""

from collections.abc import Sequence

from alembic import op

revision: str = "a71fc2d9e036"
down_revision: str | None = "e31570ab0e64"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """新增可空审计字段和隔离的单文档暂存表。"""
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.execute(
        "ALTER TABLE knowledge.kb_reembeddings ADD COLUMN requested_ip text"
    )
    op.execute(
        "ALTER TABLE knowledge.kb_reembedding_audits ADD COLUMN source_ip text,"
        " ADD COLUMN prior_space_id varchar(64),"
        " ADD COLUMN prior_generation_id uuid"
    )
    op.execute("""
        DO $$
        DECLARE dims integer;
        BEGIN
          SELECT atttypmod INTO STRICT dims FROM pg_attribute
            WHERE attrelid = 'knowledge.kb_chunk_embeddings'::regclass
              AND attname = 'embedding' AND NOT attisdropped;
          IF dims < 1 THEN RAISE EXCEPTION 'invalid vector dimension'; END IF;
          EXECUTE format($ddl$
            CREATE TABLE knowledge.kb_ingest_vectors (
              document_id uuid NOT NULL
                CONSTRAINT fk_kb_ingest_vectors_document REFERENCES
                knowledge.kb_documents(id) ON DELETE CASCADE,
              attempt uuid NOT NULL, ordinal integer NOT NULL,
              embedding knowledge.vector(%s) NOT NULL,
              created_at timestamptz NOT NULL DEFAULT now(),
              CONSTRAINT pk_kb_ingest_vectors
                PRIMARY KEY (document_id, attempt, ordinal)
            ) $ddl$, dims);
        END;
        $$""")


def downgrade() -> None:
    """移除单文档暂存与本次增加的审计字段。"""
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_table("kb_ingest_vectors", schema="knowledge")
    op.drop_column("kb_reembeddings", "requested_ip", schema="knowledge")
    for column in ("source_ip", "prior_space_id", "prior_generation_id"):
        op.drop_column("kb_reembedding_audits", column, schema="knowledge")
