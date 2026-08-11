"""锁住 Database 的事务边界与探针语义：出块提交、异常回滚、ping 不抛。

⚠ 必须打真实 Postgres：`Database` 按 asyncpg 的连接池与 server_settings 装配，
SQLite 连 `pool_size` 都不认——在它上面「全绿」证明不了任何事。
"""

import uuid
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import String, select, text
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import Database, UuidPrimaryKeyMixin, make_declarative_base

SCHEMA = "lib_engine_test"
Base = make_declarative_base(SCHEMA)


class Row(Base, UuidPrimaryKeyMixin):  # type: ignore[misc]  # 声明基类由工厂动态造出，pyright 看不到它是类
    __tablename__ = "rows"

    label: Mapped[str] = mapped_column(String(32), nullable=False)


class Boom(RuntimeError):
    """只用于把异常送进 session() 的出块路径。"""


@pytest.fixture
async def database(postgres_dsn: str) -> AsyncIterator[Database]:
    handle = Database(dsn=postgres_dsn, search_path=SCHEMA)
    async with handle.engine.begin() as connection:
        await connection.execute(
            text(f'CREATE SCHEMA IF NOT EXISTS "{SCHEMA}"')
        )
        await connection.run_sync(Base.metadata.create_all)
    yield handle
    async with handle.engine.begin() as connection:
        await connection.execute(text(f'DROP SCHEMA "{SCHEMA}" CASCADE'))
    await handle.dispose()


async def labels(database: Database) -> list[str]:
    async with database.session() as session:
        rows = (await session.execute(select(Row))).scalars().all()
        return sorted(row.label for row in rows)


async def test_session_commits_on_a_clean_exit(database: Database) -> None:
    async with database.session() as session:
        session.add(Row(label="kept"))
    assert await labels(database) == ["kept"]


async def write_then_fail(database: Database) -> None:
    async with database.session() as session:
        session.add(Row(label="dropped"))
        await session.flush()
        raise Boom


async def test_session_rolls_back_when_the_block_raises(
    database: Database,
) -> None:
    with pytest.raises(Boom):
        await write_then_fail(database)
    assert await labels(database) == []


async def flush_for_id_then_fail(database: Database) -> None:
    async with database.session() as session:
        row = Row(label="tmp")
        session.add(row)
        await session.flush()
        assert isinstance(row.id, uuid.UUID)
        raise Boom


async def test_flush_hands_back_an_id_without_committing(
    database: Database,
) -> None:
    # ⚠ 要 id 用 flush 不用 commit：提前提交会把一次逻辑操作切成两个事务
    with pytest.raises(Boom):
        await flush_for_id_then_fail(database)
    assert await labels(database) == []


async def test_search_path_puts_tables_in_the_owning_schema(
    database: Database,
) -> None:
    async with database.engine.connect() as connection:
        found = await connection.execute(
            text(
                "SELECT table_schema FROM information_schema.tables"
                " WHERE table_name = 'rows'"
            )
        )
        assert SCHEMA in [row[0] for row in found]


async def test_ping_is_true_when_the_database_answers(
    database: Database,
) -> None:
    assert await database.ping() is True


async def test_ping_returns_false_instead_of_raising() -> None:
    # ⚠ 探针不许抛：就绪探针要的是「能不能接流量」的布尔，不是异常
    unreachable = Database(
        dsn="postgresql+asyncpg://nobody:nobody@127.0.0.1:1/none"
    )
    assert await unreachable.ping() is False
    await unreachable.dispose()
