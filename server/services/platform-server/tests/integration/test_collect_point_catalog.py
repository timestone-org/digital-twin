"""点位台账的真实现：大屏绑定的存在性问的就是这张表。

守的是 ADR-0012 决策四——绑一个不存在的点位必须当场失败，不是静默放行一条
永远产不出数据的绑定。
"""

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.collect.models import CollectPoint, CollectSource
from platform_server.apps.collect.services import DatabasePointCatalog
from timeseries import compose_node_key

pytestmark = pytest.mark.requires_postgres


@dataclass(frozen=True)
class OneSessionSource:
    """把用例那条回滚事务里的会话当成会话来源。

    ⚠ 真实现自己开短事务，而用例的数据在外层未提交事务里——另开一条连接看不见
    它们。这里换掉的只是「从哪里拿会话」，查询本身还是真的。
    """

    session_handle: AsyncSession

    @asynccontextmanager
    async def session(self) -> AsyncIterator[AsyncSession]:
        yield self.session_handle


async def seed_point(session: AsyncSession, code: str) -> str:
    """种一个数据源加一个点位，回它的 node_key。

    Args: session, code。
    """
    source = CollectSource(
        name="一号线",
        code=f"src-{code}",
        protocol="opcua",
        endpoint="opc.tcp://10.0.0.9:4840",
        credential_enc=None,
        options_json={},
        read_mode="subscribe",
        poll_interval_ms=1000,
        is_enabled=True,
    )
    session.add(source)
    await session.flush()
    session.add(
        CollectPoint(
            source_id=source.id,
            code=code,
            name=code,
            address=f"ns=2;s={code}",
            data_type="float",
            unit=None,
            sampling_interval_ms=1000,
            deadband=0.0,
            archive_enabled=True,
            archive_max_interval_ms=60000,
            archive_retention_days=None,
        )
    )
    await session.flush()
    return compose_node_key(source.id, code)


async def test_a_seeded_point_is_known(db_session: AsyncSession) -> None:
    node_key = await seed_point(db_session, "outlet_temp")
    catalog = DatabasePointCatalog(sessions=OneSessionSource(db_session))
    assert await catalog.known_node_keys(frozenset({node_key})) == frozenset(
        {node_key}
    )


async def test_a_point_nobody_configured_is_unknown(
    db_session: AsyncSession,
) -> None:
    await seed_point(db_session, "outlet_temp")
    missing = compose_node_key(uuid.uuid4(), "nowhere")
    catalog = DatabasePointCatalog(sessions=OneSessionSource(db_session))
    assert await catalog.known_node_keys(frozenset({missing})) == frozenset()


async def test_a_code_under_the_wrong_source_is_unknown(
    db_session: AsyncSession,
) -> None:
    node_key = await seed_point(db_session, "outlet_temp")
    _, code = node_key.split(":", maxsplit=1)
    stranger = compose_node_key(uuid.uuid4(), code)
    catalog = DatabasePointCatalog(sessions=OneSessionSource(db_session))
    assert await catalog.known_node_keys(frozenset({stranger})) == frozenset()


async def test_a_malformed_key_is_simply_unknown(
    db_session: AsyncSession,
) -> None:
    catalog = DatabasePointCatalog(sessions=OneSessionSource(db_session))
    assert await catalog.known_node_keys(frozenset({"没有冒号"})) == frozenset()


async def test_asking_about_nothing_costs_no_query(
    db_session: AsyncSession,
) -> None:
    catalog = DatabasePointCatalog(sessions=OneSessionSource(db_session))
    assert await catalog.known_node_keys(frozenset()) == frozenset()


async def test_a_mixed_batch_returns_only_the_known_ones(
    db_session: AsyncSession,
) -> None:
    known = await seed_point(db_session, "outlet_temp")
    missing = compose_node_key(uuid.uuid4(), "nowhere")
    catalog = DatabasePointCatalog(sessions=OneSessionSource(db_session))
    found = await catalog.known_node_keys(frozenset({known, missing}))
    assert found == frozenset({known})
