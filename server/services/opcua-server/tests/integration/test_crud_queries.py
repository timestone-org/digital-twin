"""打真库验列表查询的构造：关键字过滤、按种类过滤、计数与按端口寻址。

`build_query` 只产语句不执行，但它拼出来的过滤条件必须在真库上真的匹配到行——
在内存里断言语句形状会漏掉大小写与 LIKE 转义这类只在数据库里才成立的语义。
"""

from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from lib.config import load_settings
from lib.db import Database
from opcua_server.apps.instance.crud import (
    instance_crud,
    node_crud,
    trusted_certificate_crud,
    type_definition_crud,
)
from opcua_server.apps.instance.models import (
    Instance,
    Node,
    TrustedCertificate,
    TypeDefinition,
)
from opcua_server.settings import Settings

pytestmark = pytest.mark.requires_postgres

PAGE_LIMIT = 50


def _instance(*, name: str, port: int) -> Instance:
    return Instance(
        name=name,
        port=port,
        namespace_uri=f"urn:digitaltwin:{name}",
        security_policies=["NoSecurity"],
    )


@pytest.fixture(scope="module")
def settings() -> Settings:
    """本服务的配置。环境不全时直接失败——能力由 CI 的服务容器保证。"""
    return load_settings(Settings)


@pytest.fixture
async def session(settings: Settings) -> AsyncIterator[AsyncSession]:
    """每条用例包在一个回滚事务里，互不残留。"""
    database = Database(
        dsn=settings.dsn(), search_path=settings.postgres_schema
    )
    connection = await database.engine.connect()
    transaction = await connection.begin()
    maker = async_sessionmaker(
        bind=connection,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )
    async with maker() as opened:
        yield opened
    await transaction.rollback()
    await connection.close()
    await database.dispose()


async def test_get_by_port_finds_the_instance_holding_it(
    session: AsyncSession,
) -> None:
    """端口是对外可见的寻址方式，运维报「4841 连不上」要能反查到实例。"""
    instance_crud.add(session, _instance(name="alpha", port=4840))
    instance_crud.add(session, _instance(name="beta", port=4841))
    await session.flush()
    found = await instance_crud.get_by_port(session, 4841)
    assert found is not None
    assert found.name == "beta"


async def test_get_by_port_returns_nothing_for_a_free_port(
    session: AsyncSession,
) -> None:
    """池里没被占的端口应当查不到实例，否则分配逻辑会误判。"""
    instance_crud.add(session, _instance(name="alpha", port=4840))
    await session.flush()
    assert await instance_crud.get_by_port(session, 4859) is None


async def test_count_all_tracks_the_instance_total(
    session: AsyncSession,
) -> None:
    """单进程实例数上限靠这个计数判定。"""
    before = await instance_crud.count_all(session)
    instance_crud.add(session, _instance(name="alpha", port=4840))
    await session.flush()
    assert await instance_crud.count_all(session) == before + 1


async def test_instance_keyword_filter_ignores_letter_case(
    session: AsyncSession,
) -> None:
    """页面上的搜索框不该要求用户记住大小写。"""
    instance_crud.add(session, _instance(name="Alpha", port=4840))
    instance_crud.add(session, _instance(name="beta", port=4841))
    await session.flush()
    statement = instance_crud.build_query(keyword="ALP")
    rows, total = await instance_crud.list_page(
        session, statement=statement, offset=0, limit=PAGE_LIMIT
    )
    assert total == 1
    assert rows[0].name == "Alpha"


async def test_instance_query_without_keyword_returns_everything(
    session: AsyncSession,
) -> None:
    """空关键字是「不过滤」，不是「匹配空串」。"""
    instance_crud.add(session, _instance(name="alpha", port=4840))
    instance_crud.add(session, _instance(name="beta", port=4841))
    await session.flush()
    statement = instance_crud.build_query(keyword=None)
    _, total = await instance_crud.list_page(
        session, statement=statement, offset=0, limit=PAGE_LIMIT
    )
    assert total >= 2


async def test_node_query_is_scoped_to_one_instance(
    session: AsyncSession,
) -> None:
    """节点列表必须按实例圈定，否则会把别台服务器的地址空间列出来。"""
    first = instance_crud.add(session, _instance(name="alpha", port=4840))
    second = instance_crud.add(session, _instance(name="beta", port=4841))
    await session.flush()
    node_crud.add(
        session,
        Node(
            instance_id=first.id,
            browse_name="Temperature",
            node_class="variable",
            identifier="Temperature",
            data_type="double",
        ),
    )
    node_crud.add(
        session,
        Node(
            instance_id=second.id,
            browse_name="Temperature",
            node_class="variable",
            identifier="Temperature",
            data_type="double",
        ),
    )
    await session.flush()
    statement = node_crud.build_query(instance_id=first.id, keyword=None)
    _, total = await node_crud.list_page(
        session, statement=statement, offset=0, limit=PAGE_LIMIT
    )
    assert total == 1


async def test_node_keyword_filter_matches_browse_name(
    session: AsyncSession,
) -> None:
    """节点搜索按 BrowseName——那是人在客户端里看到的名字。"""
    owner = instance_crud.add(session, _instance(name="alpha", port=4840))
    await session.flush()
    for name in ("Temperature", "Pressure"):
        node_crud.add(
            session,
            Node(
                instance_id=owner.id,
                browse_name=name,
                node_class="variable",
                identifier=name,
                data_type="double",
            ),
        )
    await session.flush()
    statement = node_crud.build_query(instance_id=owner.id, keyword="temp")
    rows, total = await node_crud.list_page(
        session, statement=statement, offset=0, limit=PAGE_LIMIT
    )
    assert total == 1
    assert rows[0].browse_name == "Temperature"


async def test_type_query_filters_by_kind(session: AsyncSession) -> None:
    """三档类型分开列，页面上才能按种类分组。"""
    owner = instance_crud.add(session, _instance(name="alpha", port=4840))
    await session.flush()
    for kind, name in (
        ("object_type", "MotorType"),
        ("variable_type", "SpeedType"),
    ):
        type_definition_crud.add(
            session,
            TypeDefinition(
                instance_id=owner.id,
                kind=kind,
                browse_name=name,
                identifier=name,
            ),
        )
    await session.flush()
    statement = type_definition_crud.build_query(
        instance_id=owner.id, kind="object_type"
    )
    rows, total = await type_definition_crud.list_page(
        session, statement=statement, offset=0, limit=PAGE_LIMIT
    )
    assert total == 1
    assert rows[0].identifier == "MotorType"


async def test_type_query_without_kind_returns_every_kind(
    session: AsyncSession,
) -> None:
    """不指定种类就是全都要。"""
    owner = instance_crud.add(session, _instance(name="alpha", port=4840))
    await session.flush()
    for kind, name in (
        ("object_type", "MotorType"),
        ("data_type", "AlarmCode"),
    ):
        type_definition_crud.add(
            session,
            TypeDefinition(
                instance_id=owner.id,
                kind=kind,
                browse_name=name,
                identifier=name,
            ),
        )
    await session.flush()
    statement = type_definition_crud.build_query(
        instance_id=owner.id, kind=None
    )
    _, total = await type_definition_crud.list_page(
        session, statement=statement, offset=0, limit=PAGE_LIMIT
    )
    assert total == 2


async def test_type_lookup_by_identifier_is_scoped_to_its_instance(
    session: AsyncSession,
) -> None:
    """类型标识只在实例内唯一，跨实例查必须查不到。"""
    first = instance_crud.add(session, _instance(name="alpha", port=4840))
    second = instance_crud.add(session, _instance(name="beta", port=4841))
    await session.flush()
    type_definition_crud.add(
        session,
        TypeDefinition(
            instance_id=first.id,
            kind="object_type",
            browse_name="MotorType",
            identifier="MotorType",
        ),
    )
    await session.flush()
    found = await type_definition_crud.get_by_identifier(
        session, instance_id=first.id, identifier="MotorType"
    )
    missing = await type_definition_crud.get_by_identifier(
        session, instance_id=second.id, identifier="MotorType"
    )
    assert found is not None
    assert missing is None


async def test_trusted_certificates_list_per_instance(
    session: AsyncSession,
) -> None:
    """实例启动要一次取全白名单，逐条查是启动路径上的 N+1。"""
    owner = instance_crud.add(session, _instance(name="alpha", port=4840))
    await session.flush()
    expiry = datetime.now(UTC) + timedelta(days=30)
    for index, subject in enumerate(("CN=scada", "CN=mes")):
        trusted_certificate_crud.add(
            session,
            TrustedCertificate(
                instance_id=owner.id,
                fingerprint=f"{index:02x}" * 32,
                subject=subject,
                expires_at=expiry,
            ),
        )
    await session.flush()
    loaded = await trusted_certificate_crud.list_of_instance(session, owner.id)
    assert [item.subject for item in loaded] == ["CN=mes", "CN=scada"]
