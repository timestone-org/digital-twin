"""启动时问一次库：加速件装了没有（ADR-0034 决策四）。

⚠ 探测放在启动而不是每次检索：每次检索问一遍是一次多余的往返，而扩展装没装
这件事在进程活着的这段时间里不会变。

⚠ 探测失败**不让服务起不来**：这一档只是加速，正确性不依赖它。探不到就按
「没装」处理，并把「我们没探到」与「我们探到它没装」分开报——两者该说的话不一样。
"""

from dataclasses import dataclass

from sqlalchemy import text

from knowledge_server.settings import DB_SCHEMA
from lib.db import Database
from lib.logging import get_logger

_logger = get_logger("knowledge.probe")


@dataclass
class IndexProbe:
    """库里到底装了哪几样加速件——启动时问一次，之后不再问。

    ⚠ 这几格**不是配置**，是探测结果。配置说的是「想用哪一档」，这里说的是
    「此刻真能用哪一档」，两者不一致时以这里为准，并如实上 `/capabilities`
    （ADR-0034 决策四、决策五）。

    ⚠ 探测放在启动而不是每次检索：每次检索问一遍是一次多余的往返，
    而扩展装没装这件事在进程活着的这段时间里不会变。
    """

    # `vector` 扩展在不在，以及加速表建没建
    has_pgvector: bool = False
    has_vector_table: bool = False
    # `pg_trgm` 在不在
    has_trgm: bool = False
    # 探测本身失败了吗。⚠ 与「探测到没装」分开：前者是我们不知道，
    # 后者是我们知道它没装，而两者该说的话不一样
    is_probed: bool = False


# 加速表的名字。⚠ 与 `python -m knowledge_server.index` 建的那张逐字一致：
# 两处漂开的表现是「建好了但一直报没建」
VECTOR_TABLE = "kb_chunk_vectors_pgv"

_EXTENSIONS = text(
    "SELECT extname FROM pg_extension WHERE extname IN ('vector', 'pg_trgm')"
)
_VECTOR_TABLE = text(
    "SELECT 1 FROM information_schema.tables "
    "WHERE table_schema = :schema AND table_name = :table"
)


async def probe_indexes(database: Database, probe: IndexProbe) -> None:
    """问一次库，把结果填进这份探测。

    Args: database, probe。
    """
    try:
        async with database.session() as session:
            rows = await session.execute(_EXTENSIONS)
            installed = {str(one) for one in rows.scalars()}
            found = await session.execute(
                _VECTOR_TABLE,
                {"schema": DB_SCHEMA, "table": VECTOR_TABLE},
            )
            has_table = found.first() is not None
    except Exception as error:
        # ⚠ 宽捕获是刻意的：探测失败的原因有几十种（库还没起、权限不够、
        # 网络抖动），而它们要做的事完全一样——按「没装」处理并如实说明。
        # 让服务因为一次探测失败起不来，代价远大于收益
        _logger.warning(
            "index_probe_failed", "加速件探测失败，按未启用处理", error=error
        )
        return
    probe.has_pgvector = "vector" in installed
    probe.has_trgm = "pg_trgm" in installed
    probe.has_vector_table = has_table
    probe.is_probed = True
    _logger.info(
        "index_probe_done",
        "加速件探测完成",
        has_pgvector=probe.has_pgvector,
        has_trgm=probe.has_trgm,
        has_vector_table=has_table,
    )
