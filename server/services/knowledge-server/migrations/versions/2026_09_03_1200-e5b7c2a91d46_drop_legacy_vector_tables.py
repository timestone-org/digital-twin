"""收缩步：删掉 bytea 那张向量表与运维脚本建的加速表（ADR-0045）。

[ADR-0045](../../../../../docs/adr/0045-向量与关键词索引改为硬依赖.md) 的扩展步
（`d4a9c6b3f018`）建了 `kb_chunk_embeddings` 并停止写这两张旧表，但没有删它们
——滚动发布期间旧代码还在写。那一轮已经发出去了，这里是**收缩步**。

⚠ 收缩步只在「新结构 + 旧代码」这套组合确定不再运行之后才做（
engineering-workflow §4）。判据是扩展步那一版已经全量上线：本部署的
`kb_chunk_vectors` 与 `kb_chunk_vectors_pgv` 都是空表（成因见 ADR-0045 背景
第 2 条——探测失败让那一路从来没写进去过）。

⚠ **不可回滚。** `downgrade` 把两张表建回来，但**建回来的是空的**：那些向量是
某一路嵌入档算出来的一堆数，删了就没了。真要回退的话，正确做法是把文档按
「重新解析」重算一遍，而不是指望这条 downgrade。

Revision ID: e5b7c2a91d46
Revises: d4a9c6b3f018
"""

from collections.abc import Sequence

from alembic import op

from knowledge_server.settings import DB_SCHEMA

revision: str = "e5b7c2a91d46"
down_revision: str | None = "d4a9c6b3f018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = DB_SCHEMA
# bytea 那一份「持久真相」，与运维命令 `index --enable` 建的加速表
LEGACY_TABLES = ("kb_chunk_vectors_pgv", "kb_chunk_vectors")


def upgrade() -> None:
    """删掉两张旧向量表。"""
    op.execute("SET lock_timeout = '5s'")
    for name in LEGACY_TABLES:
        op.execute(f'DROP TABLE IF EXISTS "{SCHEMA}"."{name}"')


def downgrade() -> None:
    """把两张表建回来——**空的**。

    ⚠ 建回来只是让「新结构 + 旧代码」在结构上跑得动，数据回不来。旧代码读到
    空表的表现是「这个库检索不到任何东西」，而不是报错——所以真要回退，
    必须连着把文档重新解析一遍。
    """
    op.execute("SET lock_timeout = '5s'")
    op.execute(
        f'CREATE TABLE IF NOT EXISTS "{SCHEMA}".kb_chunk_vectors ('
        "chunk_id uuid NOT NULL, "
        "base_id uuid NOT NULL, "
        "dimensions integer NOT NULL, "
        "embedding_model varchar(128) NOT NULL, "
        "vector bytea NOT NULL, "
        "created_at timestamptz NOT NULL DEFAULT now(), "
        "updated_at timestamptz NOT NULL DEFAULT now(), "
        "CONSTRAINT pk_kb_chunk_vectors PRIMARY KEY (chunk_id), "
        "CONSTRAINT fk_kb_chunk_vectors_chunk_id_kb_chunks "
        f'FOREIGN KEY (chunk_id) REFERENCES "{SCHEMA}".kb_chunks(id) '
        "ON DELETE CASCADE, "
        "CONSTRAINT fk_kb_chunk_vectors_base_id_kb_bases "
        f'FOREIGN KEY (base_id) REFERENCES "{SCHEMA}".kb_bases(id) '
        "ON DELETE CASCADE)"
    )
