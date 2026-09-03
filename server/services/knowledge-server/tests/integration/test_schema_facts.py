"""向量列的维数从库上读，读不到就退回配置（ADR-0045）。

⚠ 打真库：这一条问的是 `pg_attribute` 里那个 `atttypmod`，假件只能证明
「我写的 SQL 长什么样」。
"""

import pytest

from knowledge_server.schema import SchemaFacts, read_schema_facts
from knowledge_server.settings import Settings
from lib.db import Database, PoolProfile

pytestmark = pytest.mark.requires_postgres

CONFIGURED = 4


class _DeadDatabase:
    """连不上的库。"""

    def session(self) -> object:
        raise ConnectionRefusedError("库此刻连不上")


async def test_the_real_column_width_is_read(
    db_settings: Settings, db_dimensions: int
) -> None:
    """迁移建出来的那一列是多少维，这里就要读到多少。

    Args: db_settings, db_dimensions。
    """
    database = Database(
        dsn=db_settings.dsn(),
        profile=PoolProfile(pool_size=1, max_overflow=0),
        search_path=db_settings.postgres_schema,
    )
    facts = SchemaFacts()
    try:
        await read_schema_facts(database, facts)
    finally:
        await database.dispose()
    assert facts.vector_dimensions == db_dimensions


async def test_an_unreachable_database_falls_back_to_the_configured_value() -> (
    None
):
    """⚠ 读不到不让服务起不来：这一格只是让报错说得准一点，而读不到的原因
    （库还没起来）与知识库能不能用无关。"""
    facts = SchemaFacts()
    await read_schema_facts(
        _DeadDatabase(),  # pyright: ignore[reportArgumentType]
        facts,
    )
    assert facts.vector_dimensions == 0
    assert facts.dimensions_or(CONFIGURED) == CONFIGURED


def test_a_read_value_wins_over_the_configured_one() -> None:
    """⚠ 库上那一列才是写入要比的那个数：配置说的是下一次建表会用哪个。"""
    assert SchemaFacts(vector_dimensions=1024).dimensions_or(1536) == 1024
