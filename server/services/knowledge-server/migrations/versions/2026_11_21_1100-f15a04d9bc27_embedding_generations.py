"""扩展知识库的嵌入空间、后台任务和独立索引代次。"""

from collections.abc import Sequence

from alembic import op

revision: str = "f15a04d9bc27"
down_revision: str | None = "b8f2c6d41e90"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "knowledge"
SOURCE_TABLES = ("kb_documents", "kb_chunks")


def _content_triggers() -> None:
    """同一内容写事务中递增受影响知识库的修订。"""
    op.execute("""
        CREATE FUNCTION knowledge.bump_kb_content_revision()
        RETURNS pg_catalog.trigger
        LANGUAGE plpgsql AS $$
        DECLARE changed uuid; affected text;
        BEGIN
          affected := CASE TG_OP
            WHEN 'INSERT' THEN 'SELECT DISTINCT base_id FROM new_rows'
            WHEN 'DELETE' THEN 'SELECT DISTINCT base_id FROM old_rows'
            ELSE 'SELECT base_id FROM old_rows UNION ' ||
                 'SELECT base_id FROM new_rows'
          END;
          FOR changed IN EXECUTE affected || ' ORDER BY base_id' LOOP
            UPDATE knowledge.kb_bases
              SET content_revision = coalesce(content_revision, 0) + 1
              WHERE id = changed;
          END LOOP;
          RETURN NULL;
        END;
        $$""")
    for table in SOURCE_TABLES:
        for action, tables in (
            ("INSERT", "NEW TABLE AS new_rows"),
            ("DELETE", "OLD TABLE AS old_rows"),
            ("UPDATE", "OLD TABLE AS old_rows NEW TABLE AS new_rows"),
        ):
            op.execute(
                f"CREATE TRIGGER {table}_{action.lower()}_content_revision "
                f"AFTER {action} ON knowledge.{table} REFERENCING {tables} "
                "FOR EACH STATEMENT EXECUTE FUNCTION "
                "knowledge.bump_kb_content_revision()"
            )


def _vectors() -> None:
    """新索引沿用数据库实际向量维度。"""
    op.execute("""
        DO $$
        DECLARE dims integer;
        BEGIN
          SELECT atttypmod INTO STRICT dims FROM pg_attribute
            WHERE attrelid = 'knowledge.kb_chunk_embeddings'::regclass
              AND attname = 'embedding' AND NOT attisdropped;
          IF dims < 1 THEN RAISE EXCEPTION 'invalid vector dimension'; END IF;
          EXECUTE format($ddl$
            CREATE TABLE knowledge.kb_generation_embeddings (
              generation_id uuid NOT NULL
                CONSTRAINT fk_kb_generation_embeddings_generation REFERENCES
                knowledge.kb_reembeddings(id) ON DELETE CASCADE,
              chunk_id uuid NOT NULL
                CONSTRAINT fk_kb_generation_embeddings_chunk REFERENCES
                knowledge.kb_chunks(id) ON DELETE CASCADE,
              embedding knowledge.vector(%s) NOT NULL,
              CONSTRAINT pk_kb_generation_embeddings
                PRIMARY KEY (generation_id, chunk_id)
            ) $ddl$, dims);
        END;
        $$""")


def _jobs() -> None:
    op.execute("""
        CREATE TABLE knowledge.kb_reembeddings (
          id uuid CONSTRAINT pk_kb_reembeddings PRIMARY KEY,
          base_id uuid NOT NULL CONSTRAINT fk_reembeddings_base REFERENCES
            knowledge.kb_bases(id) ON DELETE CASCADE,
          requested_by uuid NOT NULL, request_key_hash varchar(64) NOT NULL,
          target_space_id varchar(64) NOT NULL, target_model text NOT NULL,
          target_dimensions integer NOT NULL, expected_revision bigint NOT
            NULL,
          total_documents integer NOT NULL, total_chunks integer NOT NULL,
          completed_chunks integer NOT NULL DEFAULT 0, status varchar(16)
            NOT NULL,
          traceparent varchar(128) NOT NULL, lease_token uuid,
            lease_expires_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(), finished_at
            timestamptz,
          error_message text,
          CONSTRAINT uq_kb_reembedding_request UNIQUE(base_id, requested_by,
            request_key_hash),
          CONSTRAINT ck_kb_reembedding_status CHECK (status IN ('pending',
            'running', 'succeeded', 'failed', 'cancelled')),
          CONSTRAINT ck_kb_reembedding_progress CHECK (target_dimensions > 0
            AND expected_revision >= 0 AND total_documents >= 0 AND
            completed_chunks >= 0 AND total_chunks >= completed_chunks)
        )""")


def _audits() -> None:
    op.execute("""
        CREATE TABLE knowledge.kb_reembedding_audits (
          id uuid CONSTRAINT pk_kb_reembedding_audits PRIMARY KEY,
          base_id uuid NOT NULL, job_id uuid NOT NULL, actor_id uuid NOT NULL,
          action varchar(16) NOT NULL, trace_id varchar(32) NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT uq_kb_reembedding_audit UNIQUE(job_id,action),
          CONSTRAINT ck_kb_reembedding_audit_action CHECK (action IN
            ('requested', 'cancelled', 'succeeded', 'failed'))
        )""")


def upgrade() -> None:
    """创建独立任务、向量和审计表，存量行保留原值。"""
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.execute(
        "ALTER TABLE knowledge.kb_bases "
        "ADD COLUMN embedding_space_id varchar(64), "
        "ADD COLUMN active_embedding_generation_id uuid, "
        "ADD COLUMN content_revision bigint"
    )
    _jobs()
    op.execute(
        "ALTER TABLE knowledge.kb_bases "
        "ADD CONSTRAINT fk_kb_bases_active_generation "
        "FOREIGN KEY(active_embedding_generation_id) "
        "REFERENCES knowledge.kb_reembeddings(id) "
        "ON DELETE SET NULL NOT VALID"
    )
    _vectors()
    _audits()
    _content_triggers()


def downgrade() -> None:
    """按依赖顺序移除扩展。"""
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    for table in SOURCE_TABLES:
        for action in ("insert", "delete", "update"):
            op.execute(
                f"DROP TRIGGER {table}_{action}_content_revision "
                f"ON knowledge.{table}"
            )
    op.execute("DROP FUNCTION knowledge.bump_kb_content_revision()")
    op.drop_table("kb_reembedding_audits", schema=SCHEMA)
    op.drop_table("kb_generation_embeddings", schema=SCHEMA)
    op.drop_constraint(
        "fk_kb_bases_active_generation",
        "kb_bases",
        schema=SCHEMA,
        type_="foreignkey",
    )
    op.drop_table("kb_reembeddings", schema=SCHEMA)
    for column in (
        "content_revision",
        "active_embedding_generation_id",
        "embedding_space_id",
    ):
        op.drop_column("kb_bases", column, schema=SCHEMA)
