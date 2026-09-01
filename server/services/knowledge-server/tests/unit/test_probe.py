"""启动探测：探不到就按「没装」处理，且绝不让服务起不来。"""

from typing import Any, Self

import pytest

from knowledge_server.container import Container, IndexProbe
from knowledge_server.probe import probe_indexes


class _Result:
    def __init__(self, rows: list[str], first: object) -> None:
        self._rows = rows
        self._first = first

    def scalars(self) -> list[str]:
        return self._rows

    def first(self) -> object:
        return self._first


class _Session:
    def __init__(self, extensions: list[str], has_table: bool) -> None:
        self._extensions = extensions
        self._has_table = has_table
        self._calls = 0

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *_: object) -> None:
        return None

    async def execute(self, _statement: object, *_args: object) -> _Result:
        self._calls += 1
        if self._calls == 1:
            return _Result(self._extensions, None)
        return _Result([], 1 if self._has_table else None)


class _Database:
    def __init__(self, session: _Session | None) -> None:
        self._session = session

    def session(self) -> Any:
        if self._session is None:
            raise RuntimeError("库还没起来")
        return self._session


def _container(database: object) -> Container:
    # pyright: ignore 的理由 —— 这里只喂探测用得到的那一格，
    # 造一份完整容器要连库、连 Redis、连对象存储，而它们与本用例无关
    return Container(  # pyright: ignore[reportArgumentType]
        settings=None,
        database=database,
        cache=None,
        idempotency=None,
        objectstore=None,
        stream=None,
        sources=(),
        index=IndexProbe(),
    )


async def test_probe_records_what_is_installed() -> None:
    container = _container(_Database(_Session(["vector", "pg_trgm"], True)))
    await probe_indexes(container)
    assert container.index.is_probed is True
    assert container.index.has_pgvector is True
    assert container.index.has_trgm is True
    assert container.index.has_vector_table is True


async def test_probe_records_what_is_missing() -> None:
    container = _container(_Database(_Session(["pg_trgm"], False)))
    await probe_indexes(container)
    assert container.index.is_probed is True
    assert container.index.has_pgvector is False
    assert container.index.has_vector_table is False
    assert container.index.has_trgm is True


async def test_probe_failure_leaves_it_unprobed() -> None:
    """⚠ 探测失败不抛：让服务因为一次探测失败起不来，代价远大于收益。
    而「我们没探到」与「我们探到它没装」要分开报——两者该说的话不一样。"""
    container = _container(_Database(None))
    await probe_indexes(container)
    assert container.index.is_probed is False
    assert container.index.has_pgvector is False


@pytest.mark.parametrize("has_table", [True, False])
async def test_probe_is_idempotent(has_table: bool) -> None:
    container = _container(_Database(_Session(["vector"], has_table)))
    await probe_indexes(container)
    first = container.index.has_vector_table
    container2 = _container(_Database(_Session(["vector"], has_table)))
    await probe_indexes(container2)
    assert container2.index.has_vector_table == first
