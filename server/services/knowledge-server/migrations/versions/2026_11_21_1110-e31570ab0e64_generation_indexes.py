"""为后台任务与代次向量在线建索引。"""

from collections.abc import Sequence

from alembic import op

revision: str = "e31570ab0e64"
down_revision: str | None = "f15a04d9bc27"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_INDEXES = (
    (
        "uq_kb_reembeddings_active",
        "UNIQUE ",
        "kb_reembeddings (base_id) " "WHERE status IN ('pending','running')",
    ),
    (
        "ix_kb_reembeddings_queue",
        "",
        "kb_reembeddings (created_at,id) "
        "WHERE status IN ('pending','running')",
    ),
    (
        "ix_kb_generation_vectors",
        "",
        "kb_generation_embeddings "
        "USING hnsw (embedding knowledge.vector_cosine_ops)",
    ),
    ("ix_kb_generation_chunks", "", "kb_generation_embeddings (chunk_id)"),
)


def upgrade() -> None:
    """建立索引并验证已扩展的外键。"""
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    with op.get_context().autocommit_block():
        for name, unique, target in _INDEXES:
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS knowledge.{name}")
            op.execute(
                f"CREATE {unique}INDEX CONCURRENTLY {name} "
                f"ON knowledge.{target}"
            )
    op.execute(
        "ALTER TABLE knowledge.kb_bases "
        "VALIDATE CONSTRAINT fk_kb_bases_active_generation"
    )


def downgrade() -> None:
    """移除重嵌任务与代次向量的索引。"""
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    with op.get_context().autocommit_block():
        for name, _, _ in _INDEXES:
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS knowledge.{name}")
