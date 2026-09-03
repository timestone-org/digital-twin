"""扩展步：解析出来的图与表截图落两张表（KNOWLEDGE_BASE_DESIGN §3.2）。

`kb_document_figures` 一行一张图，`kb_chunk_figures` 记「这一块的正文里真的
出现了这张图」。

⚠ **块与图靠联结表而不是按页反查。** 一页上可能有五张图，而某一块只讲其中
一张——按页反查会把另外四张也贴进引用，而那正是「依据里堆一堆没用的东西」。

⚠ `(document_id, content_hash)` 唯一：同一份文档里同一张图（比如每页都有的
图框）只留一行。哈希是内容哈希而不是文件名——MinerU 每次解析给的文件名就是
内容哈希，但换一路后端就未必了。

⚠ 两张表都不建 `CONCURRENTLY`：本仓的 alembic 一次迁移一个事务
（`migrations/env.py`），`autocommit_block()` 在这个配置下直接 assert 失败。
放心非并发建的理由是编排：迁移是一次性作业，服务等它跑完才起。

Revision ID: f6c8d3b25e17
Revises: e5b7c2a91d46
"""

from collections.abc import Sequence

from alembic import op

from knowledge_server.settings import DB_SCHEMA

revision: str = "f6c8d3b25e17"
down_revision: str | None = "e5b7c2a91d46"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = DB_SCHEMA
FIGURES = "kb_document_figures"
LINKS = "kb_chunk_figures"

OBJECT_KEY_MAX_LENGTH = 512
MEDIA_TYPE_MAX_LENGTH = 128
CAPTION_MAX_LENGTH = 1000
HASH_LENGTH = 64


def upgrade() -> None:
    """建图表与块—图联结表。"""
    op.execute("SET lock_timeout = '5s'")
    op.execute(
        f'CREATE TABLE "{SCHEMA}"."{FIGURES}" ('
        "id uuid NOT NULL, "
        "base_id uuid NOT NULL, "
        "document_id uuid NOT NULL, "
        "ordinal integer NOT NULL, "
        # ⚠ CHECK 而不是原生 ENUM（database-standard §1）：加一种取值要改类型，
        # 而改类型是禁令
        "kind text NOT NULL, "
        "page integer, "
        # 版面框（归一化 0–1000 的 x0/y0/x1/y1）。⚠ 现在没有消费方：存它是
        # 因为解析时丢了就只能重新解析才拿得回来，而将来「点引用跳到原文那一页
        # 并高亮」要的正是它
        "bbox_json jsonb NOT NULL DEFAULT '{}'::jsonb, "
        f"caption varchar({CAPTION_MAX_LENGTH}) NOT NULL DEFAULT '', "
        f"object_key varchar({OBJECT_KEY_MAX_LENGTH}) NOT NULL, "
        f"media_type varchar({MEDIA_TYPE_MAX_LENGTH}) NOT NULL DEFAULT '', "
        "byte_size bigint NOT NULL DEFAULT 0, "
        f"content_hash char({HASH_LENGTH}) NOT NULL, "
        "created_at timestamptz NOT NULL DEFAULT now(), "
        "updated_at timestamptz NOT NULL DEFAULT now(), "
        f"CONSTRAINT pk_{FIGURES} PRIMARY KEY (id), "
        f"CONSTRAINT fk_{FIGURES}_base_id_kb_bases FOREIGN KEY (base_id) "
        f'REFERENCES "{SCHEMA}".kb_bases(id) ON DELETE CASCADE, '
        f"CONSTRAINT fk_{FIGURES}_document_id_kb_documents "
        f"FOREIGN KEY (document_id) "
        f'REFERENCES "{SCHEMA}".kb_documents(id) ON DELETE CASCADE, '
        f"CONSTRAINT ck_{FIGURES}_kind_known "
        "CHECK (kind IN ('image', 'table')), "
        f"CONSTRAINT ck_{FIGURES}_ordinal_non_negative CHECK (ordinal >= 0), "
        f"CONSTRAINT ck_{FIGURES}_page_positive "
        "CHECK (page IS NULL OR page >= 1), "
        f"CONSTRAINT ck_{FIGURES}_key_present CHECK (length(object_key) > 0), "
        f"CONSTRAINT ck_{FIGURES}_hash_sized "
        f"CHECK (length(content_hash) = {HASH_LENGTH}), "
        f"CONSTRAINT uq_{FIGURES}_ordinal UNIQUE (document_id, ordinal), "
        # ⚠ 同一份文档里同一张图只留一行：每页都有的图框会被解析出很多份，
        # 留重复行的表现是引用里同一张图贴好几遍
        f"CONSTRAINT uq_{FIGURES}_hash UNIQUE (document_id, content_hash))"
    )
    op.execute(
        f'CREATE INDEX "ix_{FIGURES}_document" ON "{SCHEMA}"."{FIGURES}" '
        "(document_id)"
    )
    op.execute(
        f'CREATE TABLE "{SCHEMA}"."{LINKS}" ('
        "chunk_id uuid NOT NULL, "
        "figure_id uuid NOT NULL, "
        "ordinal integer NOT NULL, "
        f"CONSTRAINT pk_{LINKS} PRIMARY KEY (chunk_id, figure_id), "
        f"CONSTRAINT fk_{LINKS}_chunk_id_kb_chunks FOREIGN KEY (chunk_id) "
        f'REFERENCES "{SCHEMA}".kb_chunks(id) ON DELETE CASCADE, '
        f"CONSTRAINT fk_{LINKS}_figure_id_{FIGURES} FOREIGN KEY (figure_id) "
        f'REFERENCES "{SCHEMA}"."{FIGURES}"(id) ON DELETE CASCADE, '
        f"CONSTRAINT ck_{LINKS}_ordinal_non_negative CHECK (ordinal >= 0))"
    )
    # ⚠ 反向那一列也要索引：按 figure_id 反查「哪几块引了这张图」是删图前
    # 的必查，少了它那一查是全表扫描
    op.execute(
        f'CREATE INDEX "ix_{LINKS}_figure" ON "{SCHEMA}"."{LINKS}" (figure_id)'
    )


def downgrade() -> None:
    """拆两张表。⚠ 图的字节留在对象存储里——那不是这条迁移管得着的。"""
    op.execute("SET lock_timeout = '5s'")
    op.execute(f'DROP TABLE IF EXISTS "{SCHEMA}"."{LINKS}"')
    op.execute(f'DROP TABLE IF EXISTS "{SCHEMA}"."{FIGURES}"')
