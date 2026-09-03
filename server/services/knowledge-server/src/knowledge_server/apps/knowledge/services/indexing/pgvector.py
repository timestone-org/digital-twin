"""向量那一路：`vector` 列 + HNSW 索引（ADR-0045）。

⚠ 这张表**由迁移建**，不由运维脚本建：它是唯一的向量存储，没有回退档。
表与索引的形状见 `migrations/versions/*_require_pgvector.py`。

⚠ 表名与列名与那份迁移逐字一致：两处漂开的表现是「写进去了、查不出来」，
而两边都不报错。
"""

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge.services.indexing.ports import (
    Scored,
    VectorQuery,
    VectorRows,
    ranked,
)
from knowledge_server.settings import DB_SCHEMA

PGVECTOR = "pgvector"

# ⚠ 与迁移里那张表逐字一致
VECTOR_TABLE = "kb_chunk_embeddings"


class VectorDimensionMismatch(RuntimeError):
    """算出来的维数与库上那一列对不上。

    ⚠ 单独一档而不是让 Postgres 抛：它回的是一条「expected N dimensions」，
    里面既没有模型名也没有那个环境变量的名字——而这件事只有一种修法，
    就是把两处对齐。
    """


_UPSERT = text(
    # 理由：拼进这段 SQL 的只有本模块与 settings 的常量（schema 名与表名），
    # 全部外部输入一律走绑定参数
    f'INSERT INTO "{DB_SCHEMA}"."{VECTOR_TABLE}" '  # noqa: S608
    "(chunk_id, base_id, embedding, embedding_model) "
    f'VALUES (:chunk_id, :base_id, CAST(:embedding AS "{DB_SCHEMA}".vector), '
    ":embedding_model) "
    # ⚠ 冲突键是主键：一个块只有一条向量，重复写要覆盖而不是追加。
    # 留两条的话检索会把同一段话召回两次
    "ON CONFLICT (chunk_id) DO UPDATE SET embedding = EXCLUDED.embedding, "
    "base_id = EXCLUDED.base_id, "
    "embedding_model = EXCLUDED.embedding_model, updated_at = now()"
)

# ⚠ `<=>` 是余弦距离（0 最近），而调用方要的是相似度（1 最近）——所以这里
# 用 `1 - 距离` 换算。忘了换算的表现是「排序整个反过来」，而两端都不报错
_SEARCH = text(
    # 理由：同上——schema 名与表名是常量，探测向量与库 id 走绑定参数
    "SELECT chunk_id, "  # noqa: S608
    f'1 - (embedding <=> CAST(:probe AS "{DB_SCHEMA}".vector)) AS score '
    f'FROM "{DB_SCHEMA}"."{VECTOR_TABLE}" '
    "WHERE base_id = :base_id "
    f'ORDER BY embedding <=> CAST(:probe AS "{DB_SCHEMA}".vector) '
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
    """`vector` 列 + HNSW。这一层唯一的向量实现。"""

    # 库上那一列的维数（建表时定死的那个 N）。⚠ 收在这里而不是每次去库里问：
    # 它在进程活着的这段时间里不会变，而每次检索问一遍是一次多余的往返
    dimensions: int
    name: str = PGVECTOR

    async def upsert(self, session: AsyncSession, rows: VectorRows) -> None:
        """把一批向量写进去；维数对不上就当场说清楚是哪两处对不上。

        Args: session, rows。
        """
        if not rows.rows:
            return
        self._checked(rows)
        await session.execute(
            _UPSERT,
            [
                {
                    "chunk_id": chunk_id,
                    "base_id": rows.base_id,
                    "embedding": literal(vector),
                    "embedding_model": rows.model,
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
        if len(query.vector) != self.dimensions:
            raise VectorDimensionMismatch(self._mismatch(len(query.vector)))
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

    def _checked(self, rows: VectorRows) -> None:
        """写之前先比一次维数。

        Args: rows。
        """
        if rows.dimensions == self.dimensions:
            return
        raise VectorDimensionMismatch(self._mismatch(rows.dimensions))

    def _mismatch(self, made: int) -> str:
        """两处维数对不上时说的那句话。

        Args: made（这一路模型算出来的维数）。
        """
        return (
            f"这套部署的向量列是 {self.dimensions} 维，而此刻这一路嵌入模型"
            f"算出来的是 {made} 维。把 KNOWLEDGE_EMBEDDING_DIMENSIONS 改成"
            "模型的维数，再重建向量表并重新解析已有文档"
        )
