"""建 knowledge schema 的五张表：库、来源、文档、块、块向量。

纯扩展步：全部新建、**不回填**。旧代码不认识这些表，也不会去读它们。

⚠ 索引**不用 `CONCURRENTLY`**：那是给有活写入的存量表用的，而这几张表是这一次
新建的、建索引时还是空的。硬加的话 `autocommit_block()` 在本仓的 alembic 配置下
直接 assert 失败（迁移压根跑不起来），而 `check_migrations` 也早已把同一次迁移里
新建的表排除在那条要求之外。

⚠ 这里**不建** pgvector 的加速表，也不 `CREATE EXTENSION`（ADR-0034 决策三）：
目标库装不上扩展时迁移会当场失败，而迁移是 compose 的前置作业——那意味着整栈
起不来。加速结构由一步显式的运维动作建。

Revision ID: a1c4e7b90d23
Revises:
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a1c4e7b90d23"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "knowledge"

_UUID = postgresql.UUID(as_uuid=True)


def _timestamps() -> tuple[sa.Column[sa.DateTime], sa.Column[sa.DateTime]]:
    """两列时刻。时刻一律 timestamptz 存 UTC。"""
    return (
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
    )


def _create_bases() -> None:
    op.create_table(
        "kb_bases",
        sa.Column("id", _UUID, primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column(
            "description",
            sa.String(length=1000),
            nullable=False,
            server_default="",
        ),
        sa.Column("embedding_model", sa.String(length=128), nullable=True),
        sa.Column("dimensions", sa.Integer(), nullable=True),
        sa.Column(
            "retrieval_strategy",
            sa.String(length=32),
            nullable=False,
            server_default="hybrid",
        ),
        sa.Column("owner_id", sa.String(length=128), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        *_timestamps(),
        sa.CheckConstraint("length(name) > 0", name="name_present"),
        sa.CheckConstraint("length(owner_id) > 0", name="owner_present"),
        sa.CheckConstraint(
            "retrieval_strategy IN ('naive', 'hybrid', 'agentic')",
            name="strategy_known",
        ),
        sa.CheckConstraint(
            "dimensions IS NULL OR dimensions > 0", name="dimensions_positive"
        ),
        schema=SCHEMA,
    )


def _create_sources() -> None:
    op.create_table(
        "kb_sources",
        sa.Column("id", _UUID, primary_key=True, nullable=False),
        sa.Column("base_id", _UUID, nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column(
            "config_json",
            postgresql.JSONB(),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("sync_cursor", sa.String(length=512), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=False, server_default=""),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["base_id"],
            [f"{SCHEMA}.kb_bases.id"],
            name="fk_kb_sources_base_id_kb_bases",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint("kind IN ('upload', 'platform')", name="kind_known"),
        sa.CheckConstraint("length(name) > 0", name="name_present"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_kb_sources_base", "kb_sources", ["base_id"], schema=SCHEMA
    )


def _create_documents() -> None:
    op.create_table(
        "kb_documents",
        sa.Column("id", _UUID, primary_key=True, nullable=False),
        sa.Column("base_id", _UUID, nullable=False),
        sa.Column("source_id", _UUID, nullable=False),
        sa.Column("external_ref", sa.String(length=512), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column(
            "media_type",
            sa.String(length=128),
            nullable=False,
            server_default="",
        ),
        sa.Column(
            "object_key",
            sa.String(length=512),
            nullable=False,
            server_default="",
        ),
        sa.Column(
            "byte_size", sa.BigInteger(), nullable=False, server_default="0"
        ),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "status",
            sa.String(length=16),
            nullable=False,
            server_default="pending",
        ),
        sa.Column(
            "failure_reason", sa.Text(), nullable=False, server_default=""
        ),
        sa.Column(
            "chunk_count", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column("ready_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["base_id"],
            [f"{SCHEMA}.kb_bases.id"],
            name="fk_kb_documents_base_id_kb_bases",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["source_id"],
            [f"{SCHEMA}.kb_sources.id"],
            name="fk_kb_documents_source_id_kb_sources",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'parsing', 'chunking', 'embedding', "
            "'indexing', 'ready', 'failed')",
            name="status_known",
        ),
        sa.CheckConstraint("length(title) > 0", name="title_present"),
        sa.CheckConstraint("length(content_hash) = 64", name="hash_sized"),
        sa.CheckConstraint("byte_size >= 0", name="size_non_negative"),
        sa.UniqueConstraint(
            "base_id", "content_hash", name="uq_kb_documents_hash"
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_kb_documents_base_status",
        "kb_documents",
        ["base_id", "status"],
        schema=SCHEMA,
    )
    op.create_index(
        "ix_kb_documents_source", "kb_documents", ["source_id"], schema=SCHEMA
    )


def _create_chunks() -> None:
    op.create_table(
        "kb_chunks",
        sa.Column("id", _UUID, primary_key=True, nullable=False),
        sa.Column("base_id", _UUID, nullable=False),
        sa.Column("document_id", _UUID, nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column(
            "locator_json",
            postgresql.JSONB(),
            nullable=False,
            server_default="{}",
        ),
        sa.Column(
            "heading_path",
            sa.String(length=500),
            nullable=False,
            server_default="",
        ),
        sa.Column(
            "token_count", sa.Integer(), nullable=False, server_default="0"
        ),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["base_id"],
            [f"{SCHEMA}.kb_bases.id"],
            name="fk_kb_chunks_base_id_kb_bases",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["document_id"],
            [f"{SCHEMA}.kb_documents.id"],
            name="fk_kb_chunks_document_id_kb_documents",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint("ordinal >= 0", name="ordinal_non_negative"),
        sa.CheckConstraint("length(text) > 0", name="text_present"),
        sa.UniqueConstraint(
            "document_id", "ordinal", name="uq_kb_chunks_ordinal"
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_kb_chunks_base", "kb_chunks", ["base_id"], schema=SCHEMA
    )
    op.create_index(
        "ix_kb_chunks_document", "kb_chunks", ["document_id"], schema=SCHEMA
    )


def _create_chunk_vectors() -> None:
    op.create_table(
        "kb_chunk_vectors",
        sa.Column("id", _UUID, primary_key=True, nullable=False),
        sa.Column("base_id", _UUID, nullable=False),
        sa.Column("chunk_id", _UUID, nullable=False),
        sa.Column("embedding", sa.LargeBinary(), nullable=False),
        sa.Column("embedding_model", sa.String(length=128), nullable=False),
        sa.Column("dimensions", sa.Integer(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["base_id"],
            [f"{SCHEMA}.kb_bases.id"],
            name="fk_kb_chunk_vectors_base_id_kb_bases",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["chunk_id"],
            [f"{SCHEMA}.kb_chunks.id"],
            name="fk_kb_chunk_vectors_chunk_id_kb_chunks",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint("dimensions > 0", name="dimensions_positive"),
        sa.CheckConstraint(
            "octet_length(embedding) > 0", name="vector_present"
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "uq_kb_chunk_vectors_chunk",
        "kb_chunk_vectors",
        ["chunk_id"],
        unique=True,
        schema=SCHEMA,
    )
    op.create_index(
        "ix_kb_chunk_vectors_base",
        "kb_chunk_vectors",
        ["base_id"],
        schema=SCHEMA,
    )


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    _create_bases()
    _create_sources()
    _create_documents()
    _create_chunks()
    _create_chunk_vectors()


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_table("kb_chunk_vectors", schema=SCHEMA)
    op.drop_table("kb_chunks", schema=SCHEMA)
    op.drop_table("kb_documents", schema=SCHEMA)
    op.drop_table("kb_sources", schema=SCHEMA)
    op.drop_table("kb_bases", schema=SCHEMA)
