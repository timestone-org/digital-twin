"""加速档：`vector` 列 + HNSW 索引。

⚠ 它**不替代** bytea 那一路，是叠在它上面（ADR-0034 决策二）：写的时候两边
都写，查的时候只查加速表。双份存储是有意付的代价——换来的是**重建索引不必
重新调一遍嵌入 API**，那是真金白银，而且重建索引这件事一定会发生。

⚠ 加速表**不由 alembic 建**：目标库装不上扩展时迁移会当场失败，而迁移是
compose 的前置作业——那意味着整栈起不来。它由一步显式的运维动作建
（`python -m knowledge_server.index --enable`），服务启动时探测。

⚠ 表名与探测那一处逐字一致（`probe.VECTOR_TABLE`）：两处漂开的表现是
「建好了但一直报没建」。
"""

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge.services.indexing.bruteforce import (
    BruteForceIndex,
)
from knowledge_server.apps.knowledge.services.indexing.ports import (
    Scored,
    VectorQuery,
    VectorRows,
    ranked,
)
from knowledge_server.settings import DB_SCHEMA

PGVECTOR = "pgvector"

# ⚠ 与 `knowledge_server.probe.VECTOR_TABLE` 同值
VECTOR_TABLE = "kb_chunk_vectors_pgv"

_UPSERT = text(
    # 理由：拼进这段 SQL 的只有本模块与 settings 的常量（schema 名与表名），
    # 全部外部输入一律走绑定参数
    f"INSERT INTO {DB_SCHEMA}.{VECTOR_TABLE} "  # noqa: S608
    "(chunk_id, base_id, embedding) "
    "VALUES (:chunk_id, :base_id, :embedding) "
    "ON CONFLICT (chunk_id) DO UPDATE SET embedding = EXCLUDED.embedding, "
    "base_id = EXCLUDED.base_id"
)

# ⚠ `<=>` 是余弦距离（0 最近），而调用方要的是相似度（1 最近）——所以这里
# 用 `1 - 距离` 换算。忘了换算的表现是「排序整个反过来」，而两端都不报错
_SEARCH = text(
    # 理由：同上——schema 名与表名是常量，探测向量与库 id 走绑定参数
    "SELECT chunk_id, "  # noqa: S608
    "1 - (embedding <=> CAST(:probe AS vector)) AS score "
    f"FROM {DB_SCHEMA}.{VECTOR_TABLE} "
    "WHERE base_id = :base_id "
    "ORDER BY embedding <=> CAST(:probe AS vector) "
    "LIMIT :limit"
)


def literal(vector: list[float]) -> str:
    """一条向量摊成 pgvector 认的字面量。

    ⚠ 不用参数绑定直接传列表：asyncpg 不认识 `vector` 这个类型，绑过去是一条
    「could not determine data type」。摊成字符串再 CAST 是官方的走法。

    Args: vector。
    """
    return f"[{','.join(repr(float(one)) for one in vector)}]"


@dataclass(frozen=True)
class PgVectorIndex:
    """加速档。写两边、查加速表。"""

    fallback: BruteForceIndex
    name: str = PGVECTOR

    async def upsert(self, session: AsyncSession, rows: VectorRows) -> None:
        """两边都写：bytea 那份是真相，`vector` 那份是加速物化。

        ⚠ 只写加速表的话，一次「重建索引」就要把整库重新嵌入一遍——
        而那是按 token 计费的。

        Args: session, rows。
        """
        await self.fallback.upsert(session, rows)
        if not rows.rows:
            return
        await session.execute(
            _UPSERT,
            [
                {
                    "chunk_id": chunk_id,
                    "base_id": rows.base_id,
                    "embedding": literal(vector),
                }
                for chunk_id, vector in rows.rows
            ],
        )

    async def search(
        self, session: AsyncSession, query: VectorQuery
    ) -> list[Scored]:
        """走 HNSW 索引取最近的几条。

        Args: session, query。
        """
        found = await session.execute(
            _SEARCH,
            {
                "probe": literal(query.vector),
                "base_id": query.base_id,
                "limit": query.limit,
            },
        )
        scored = [
            Scored(
                chunk_id=chunk_id,
                score=float(score),
                why=f"向量近邻 {float(score):.3f}",
            )
            for chunk_id, score in found.all()
        ]
        return ranked(scored, query.limit)
