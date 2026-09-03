"""向量索引成为硬依赖：装扩展、建向量表（ADR-0045）。

扩展步：装 `vector` 与 `pg_trgm`、建 `kb_chunk_embeddings`、建三个索引。
**不回填、不删旧表**——bytea 那张 `kb_chunk_vectors` 与运维脚本建的
`kb_chunk_vectors_pgv` 由下一次发布的收缩步删，因为滚动发布期间旧代码还在写
它们。存量向量不搬：它是某一路嵌入档算出来的一堆数，换到新表要重算维数与口径，
而这套部署里那张表是空的。有量的部署按「重新解析」重算。

⚠ 扩展装进**本服务的 schema** 而不是 `public`：应用连库时 `search_path` 恰好
只有本服务的 schema（`lib.db` 按 `postgres_schema` 设的），装在 public 的话
`vector` 这个类型在运行期根本解析不出来，而报出来的是「type vector does not
exist」——与「装没装扩展」这件事看起来毫无关系。

⚠ `vector(N)` 的 N 建表时定死，取自 `KNOWLEDGE_EMBEDDING_DIMENSIONS`。它必须
与模型目录里那一路嵌入模型的维数一致：对不上时写入撞的是一条「expected N
dimensions」，而那条错不会提到你配的是哪个模型。换模型换维数 = 一次新迁移。

⚠ 中文那一路只能靠 trigram：Postgres 内建分词不切中文，`to_tsvector('simple',
'热水出口温度')` 给出的是整串一个词，任何一次部分匹配都命不中。

⚠ 存量表 `kb_chunks` 上那个 GIN 索引**不是** `CONCURRENTLY` 建的，用的也不是
`op.create_index`：本仓的 alembic 一次迁移一个事务（见 `migrations/env.py`），
`autocommit_block()` 在这个配置下直接 assert 失败，`CONCURRENTLY` 因此建不出来。
放心非并发建的理由是编排：compose 里迁移是一次性作业，服务等它跑完才起——
建索引这段时间里没有任何写入者会被堵住。

Revision ID: d4a9c6b3f018
Revises: c3f8a1d5e207
"""

from collections.abc import Sequence

from alembic import op

from knowledge_server.settings import DB_SCHEMA, MigrationSettings
from lib.config import load_settings_or_exit

revision: str = "d4a9c6b3f018"
down_revision: str | None = "c3f8a1d5e207"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = DB_SCHEMA
TABLE = "kb_chunk_embeddings"
HNSW_INDEX = "ix_kb_chunk_embeddings_hnsw"
BASE_INDEX = "ix_kb_chunk_embeddings_base"
TRGM_INDEX = "ix_kb_chunks_text_trgm"

EMBEDDING_MODEL_MAX_LENGTH = 128


def _dimensions() -> int:
    """建表要用的向量维数。

    ⚠ 从配置读而不是写死：写死的话换一路嵌入模型就要改代码，而维数是部署的
    取值不是代码的行为。
    """
    return load_settings_or_exit(MigrationSettings).embedding_dimensions


def upgrade() -> None:
    """装两个扩展、建向量表与三个索引。"""
    op.execute("SET lock_timeout = '5s'")
    op.execute(f'CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA "{SCHEMA}"')
    op.execute(f'CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA "{SCHEMA}"')
    op.execute(
        f'CREATE TABLE "{SCHEMA}"."{TABLE}" ('
        "chunk_id uuid NOT NULL, "
        "base_id uuid NOT NULL, "
        f'embedding "{SCHEMA}".vector({_dimensions()}) NOT NULL, '
        f"embedding_model varchar({EMBEDDING_MODEL_MAX_LENGTH}) NOT NULL, "
        "created_at timestamptz NOT NULL DEFAULT now(), "
        "updated_at timestamptz NOT NULL DEFAULT now(), "
        # 一个块只有一条向量：留两条的话检索会把同一段话召回两次，
        # 而两条里哪一条是新的从外面看不出来
        f"CONSTRAINT pk_{TABLE} PRIMARY KEY (chunk_id), "
        f"CONSTRAINT fk_{TABLE}_chunk_id_kb_chunks FOREIGN KEY (chunk_id) "
        f'REFERENCES "{SCHEMA}".kb_chunks(id) ON DELETE CASCADE, '
        f"CONSTRAINT fk_{TABLE}_base_id_kb_bases FOREIGN KEY (base_id) "
        f'REFERENCES "{SCHEMA}".kb_bases(id) ON DELETE CASCADE, '
        f"CONSTRAINT ck_{TABLE}_model_nonempty "
        "CHECK (length(embedding_model) > 0))"
    )
    # ⚠ 库过滤那一列单独一个 b-tree：HNSW 索引本身不吃 `WHERE base_id = ?`，
    # 少了它每次检索都要在整库的近邻结果上再筛一遍
    op.execute(f'CREATE INDEX "{BASE_INDEX}" ON "{SCHEMA}"."{TABLE}" (base_id)')
    # ⚠ 用 `vector_cosine_ops`：检索那一侧用的是 `<=>`（余弦距离）。建成 L2 的
    # 话索引压根不会被用上，而表现只是「检索还是慢」
    op.execute(
        f'CREATE INDEX "{HNSW_INDEX}" ON "{SCHEMA}"."{TABLE}" '
        f'USING hnsw (embedding "{SCHEMA}".vector_cosine_ops)'
    )
    # ⚠ GIN + `gin_trgm_ops`：没有它 `text % :q` 就是全表扫描，
    # 而那时「装了 pg_trgm」与「没装」在速度上没有区别。
    # ⚠ 只有这一个索引带 `IF NOT EXISTS`：它与本改造之前那条运维命令
    # （`knowledge_server.index --enable`）建的是**同名同形**的索引，跑过那条
    # 命令的库上它已经在了。不带的话迁移撞一条 DuplicateTable 当场失败，
    # 而整栈起不来——真部署上逮到过一次。新建的那张表与它自己的两个索引
    # 不带：那两个撞名意味着有人手工建过一张同名表，那时该停下来看看
    op.execute(
        f'CREATE INDEX IF NOT EXISTS "{TRGM_INDEX}" ON "{SCHEMA}".kb_chunks '
        f'USING gin (text "{SCHEMA}".gin_trgm_ops)'
    )


def downgrade() -> None:
    """拆表与三个索引。

    ⚠ **不拆扩展**：它们是库级对象，同一个库里别的 schema 可能也在用。
    拆了的话，那些用着它的表在下一次写入时才发现类型没了。
    """
    op.execute("SET lock_timeout = '5s'")
    op.execute(f'DROP INDEX IF EXISTS "{SCHEMA}"."{TRGM_INDEX}"')
    op.execute(f'DROP TABLE IF EXISTS "{SCHEMA}"."{TABLE}"')
