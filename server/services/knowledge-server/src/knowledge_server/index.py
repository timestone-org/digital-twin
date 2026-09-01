"""加速索引的一步运维动作：建 / 拆 pgvector 那张表。

```bash
python -m knowledge_server.index --enable
python -m knowledge_server.index --disable
```

⚠ **两路一起开**（向量的 pgvector 与关键词的 pg_trgm）：它们是同一件事的两半，
分成两条命令的话，只跑了一条的部署会一边快一边慢——而 `/capabilities` 上那两格
分开报，没人会去对。

⚠ 它**不在 alembic 里**（ADR-0034 决策三）。迁移是 compose 的前置作业，
目标库装不上扩展时迁移会当场失败——那意味着整栈起不来，而这一档只是加速，
正确性不依赖它。挪出来之后，最坏情况从「服务起不来」降级成「检索慢一点，
且界面上写着为什么」。

⚠ 建表用的维数取自 `KNOWLEDGE_EMBEDDING_DIMENSIONS`。`vector(N)` 的 N 是
建表时定死的：配置改了维数就要拆了重建，否则写入会撞一条「expected N
dimensions」——而那条错不会提到「你改过配置」。

⚠ 建完**不回填**：把 bytea 那份物化过去是一次批处理，由 worker 的补数循环做。
在那之前加速表是空的，检索会照常走它并召回不到东西——所以这条命令跑完要说清
下一步（见 `--enable` 的输出）。
"""

import asyncio
import sys

from sqlalchemy import text

from knowledge_server.settings import DB_SCHEMA, MigrationSettings, Settings
from lib.config import load_settings_or_exit
from lib.db import Database, PoolProfile
from lib.logging import configure_logging, get_logger

_logger = get_logger("knowledge.index")

# ⚠ 与 `probe.VECTOR_TABLE`、`indexing/pgvector.py` 逐字一致：三处漂开的表现是
# 「建好了但一直报没建」
VECTOR_TABLE = "kb_chunk_vectors_pgv"
INDEX_NAME = "ix_kb_chunk_vectors_pgv_hnsw"

_ENABLE = "--enable"
_DISABLE = "--disable"

# ⚠ 建 GIN / HNSW 索引要几十秒到几十分钟（看数据量），而请求路径上的默认语句
# 超时是 2 秒。不放宽的话，这条命令在**有数据的库上必然超时**——而空库上它一次
# 都不会失败，于是这个坑只在现场第一次启用加速档时才炸
_MAINTENANCE_TIMEOUT = "SET statement_timeout = '30min'"
# ⚠ 锁等待反而要短：建索引要 SHARE 锁，等不到就该退出来重来，而不是把
# 后面每一个写入都堵在队列里（database-standard §4）
_LOCK_TIMEOUT = "SET lock_timeout = '5s'"

_CREATE_VECTOR = "CREATE EXTENSION IF NOT EXISTS vector"
# ⚠ 关键词那一路要它：Postgres 内建分词不切中文，`to_tsvector` 给出的是整串
# 一个词，任何一次部分匹配都命不中
_CREATE_TRGM = "CREATE EXTENSION IF NOT EXISTS pg_trgm"
# ⚠ GIN + `gin_trgm_ops`：没有它 `text %% :q` 就是全表扫描，而那时
# 「装了 pg_trgm」与「没装」在速度上没有区别
_CREATE_TRGM_INDEX = (
    f'CREATE INDEX IF NOT EXISTS "ix_kb_chunks_text_trgm" '
    f'ON "{DB_SCHEMA}".kb_chunks USING gin (text gin_trgm_ops)'
)
_DROP_TRGM_INDEX = (
    f'DROP INDEX IF EXISTS "{DB_SCHEMA}"."ix_kb_chunks_text_trgm"'
)
_CREATE_TABLE = (
    f'CREATE TABLE IF NOT EXISTS "{DB_SCHEMA}"."{VECTOR_TABLE}" ('
    "chunk_id uuid PRIMARY KEY "
    f'REFERENCES "{DB_SCHEMA}".kb_chunks(id) ON DELETE CASCADE, '
    f'base_id uuid NOT NULL REFERENCES "{DB_SCHEMA}".kb_bases(id) '
    "ON DELETE CASCADE, "
    "embedding vector({dimensions}) NOT NULL)"
)
# ⚠ 库过滤那一列单独一个 b-tree：HNSW 索引本身不吃 `WHERE base_id = ?`，
# 少了它每次检索都要在整库的近邻结果上再筛一遍
_CREATE_BASE_INDEX = (
    f'CREATE INDEX IF NOT EXISTS "ix_{VECTOR_TABLE}_base" '
    f'ON "{DB_SCHEMA}"."{VECTOR_TABLE}" (base_id)'
)
# ⚠ 用 `vector_cosine_ops`：检索那一侧用的是 `<=>`（余弦距离）。建成 L2 的话
# 索引压根不会被用上，而表现只是「检索还是慢」
_CREATE_HNSW = (
    f'CREATE INDEX IF NOT EXISTS "{INDEX_NAME}" '
    f'ON "{DB_SCHEMA}"."{VECTOR_TABLE}" '
    "USING hnsw (embedding vector_cosine_ops)"
)
_DROP_TABLE = f'DROP TABLE IF EXISTS "{DB_SCHEMA}"."{VECTOR_TABLE}"'


def _database(settings: MigrationSettings) -> Database:
    return Database(
        dsn=settings.dsn(),
        profile=PoolProfile(pool_size=1, max_overflow=0),
        search_path=settings.postgres_schema,
    )


async def enable(dimensions: int) -> None:
    """两路加速档一起开：装扩展、建加速表、建三个索引。

    Args: dimensions。
    """
    database = _database(load_settings_or_exit(MigrationSettings))
    try:
        async with database.session() as session:
            await session.execute(text(_MAINTENANCE_TIMEOUT))
            await session.execute(text(_LOCK_TIMEOUT))
            await session.execute(text(_CREATE_VECTOR))
            await session.execute(text(_CREATE_TRGM))
            await session.execute(
                text(_CREATE_TABLE.format(dimensions=dimensions))
            )
            await session.execute(text(_CREATE_BASE_INDEX))
            await session.execute(text(_CREATE_HNSW))
            await session.execute(text(_CREATE_TRGM_INDEX))
    finally:
        await database.dispose()
    _logger.info(
        "index_enabled",
        "加速索引已建好；向量表还是空的，重启服务后新写入的向量会两边都落",
        dimensions=dimensions,
    )


async def disable() -> None:
    """拆掉加速表与 trigram 索引。

    ⚠ **不拆扩展**：它们是库级对象，别的 schema 可能也在用。拆表拆索引就够了。
    bytea 那份真相不动，检索退回应用层余弦与 `ILIKE`。
    """
    database = _database(load_settings_or_exit(MigrationSettings))
    try:
        async with database.session() as session:
            await session.execute(text(_MAINTENANCE_TIMEOUT))
            await session.execute(text(_LOCK_TIMEOUT))
            await session.execute(text(_DROP_TRGM_INDEX))
            await session.execute(text(_DROP_TABLE))
    finally:
        await database.dispose()
    _logger.info("index_disabled", "加速索引已拆；检索退回回退档，数据没丢")


def main() -> None:
    """按参数开或关加速索引。"""
    settings = load_settings_or_exit(Settings)
    configure_logging(
        service=settings.app_name,
        role="index",
        instance=settings.app_instance,
        level=settings.app_log_level,
        log_format=settings.app_log_format,
    )
    if _ENABLE in sys.argv:
        asyncio.run(enable(settings.embedding_dimensions))
        return
    if _DISABLE in sys.argv:
        asyncio.run(disable())
        return
    sys.stderr.write(f"用法：python -m knowledge_server.index {_ENABLE}\n")
    raise SystemExit(2)


if __name__ == "__main__":
    main()
