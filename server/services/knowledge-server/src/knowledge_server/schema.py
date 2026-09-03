"""启动时问一次库：向量那一列到底是多少维（ADR-0045）。

⚠ 问库而不是信配置：`vector(N)` 的 N 建表时定死，而配置是**下一次**建表会用的
那个数。两者漂开的场合是真实存在的——迁移作业少给一格环境变量、或者有人改了
配置还没重建表。信配置的话，维数守卫比的是两个都不是真相的数，而写入撞的是
Postgres 那条不提模型名也不提环境变量名的「expected N dimensions」。

⚠ 读不到就退回配置值，不让服务起不来：这一格只是让报错说得准一点，
而读不到的原因（库还没起来）与知识库能不能用无关。
"""

from dataclasses import dataclass

from sqlalchemy import text

from knowledge_server.apps.knowledge.services.indexing import VECTOR_TABLE
from knowledge_server.settings import DB_SCHEMA
from lib.db import Database
from lib.logging import get_logger

_logger = get_logger("knowledge.schema")

# ⚠ pgvector 把维数直接存在 `atttypmod` 里（没有 varchar 那种 -4 的偏移）
_DIMENSIONS = text(
    "SELECT a.atttypmod FROM pg_attribute a "
    "JOIN pg_class c ON c.oid = a.attrelid "
    "JOIN pg_namespace n ON n.oid = c.relnamespace "
    "WHERE n.nspname = :schema AND c.relname = :table "
    "AND a.attname = 'embedding'"
)


@dataclass
class SchemaFacts:
    """库上那几件「装配之后才知道」的事。

    ⚠ 可变，故不带 frozen：容器是启动时装好的，而这一格要等第一次连上库
    才填得出来。
    """

    # 向量列的维数；还没问到时是 0
    vector_dimensions: int = 0

    def dimensions_or(self, configured: int) -> int:
        """问到了就用库上的，没问到用配置的。

        Args: configured。
        """
        return self.vector_dimensions or configured


async def read_schema_facts(database: Database, facts: SchemaFacts) -> None:
    """问一次库，把向量列的维数填进这份事实。

    Args: database, facts。
    """
    try:
        async with database.session() as session:
            found = await session.execute(
                _DIMENSIONS, {"schema": DB_SCHEMA, "table": VECTOR_TABLE}
            )
            row = found.first()
    except Exception as error:
        # ⚠ 宽捕获是刻意的：读不到的原因有几十种（库还没起、权限、网络抖动），
        # 而它们要做的事完全一样——退回配置值并说一句
        _logger.warning(
            "schema_facts_unread",
            "读不到向量列的维数，暂按配置值算",
            error=error,
        )
        return
    if row is None:
        _logger.warning(
            "schema_facts_missing",
            "库里没有向量表，迁移可能没跑完",
            table=VECTOR_TABLE,
        )
        return
    facts.vector_dimensions = int(row[0])
    _logger.info(
        "schema_facts_read",
        "向量列的维数已读到",
        dimensions=facts.vector_dimensions,
    )
