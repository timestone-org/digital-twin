"""打真库验实例与节点的数据访问：唯一约束、级联、端口占用与建树取数。

⚠ 这一层必须打真实 Postgres。CHECK、部分唯一、ARRAY 包含、`ON DELETE CASCADE`
在 SQLite 上要么不存在要么语义不同，在那儿全绿的用例可以在生产直接失败。
"""

import uuid
from collections.abc import AsyncIterator

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from lib.config import load_settings
from lib.db import Database
from opcua_server.apps.instance.crud import instance_crud, node_crud
from opcua_server.apps.instance.models import Instance, Node
from opcua_server.settings import Settings

pytestmark = pytest.mark.requires_postgres


def _instance(*, name: str, port: int) -> Instance:
    return Instance(
        name=name,
        port=port,
        namespace_uri=f"urn:digitaltwin:{name}",
        security_policies=["NoSecurity"],
    )


def _node(
    *, instance_id: uuid.UUID, identifier: str, **overrides: object
) -> Node:
    fields: dict[str, object] = {
        "instance_id": instance_id,
        "browse_name": identifier,
        "node_class": "variable",
        "identifier": identifier,
        "identifier_kind": "string",
        "data_type": "double",
    }
    fields.update(overrides)
    return Node(**fields)


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


async def test_instance_name_is_rejected_when_already_taken(
    session: AsyncSession,
) -> None:
    """重名靠唯一约束挡，不靠先查再插——并发下先查再插必然重复。"""
    instance_crud.add(session, _instance(name="alpha", port=4840))
    await session.flush()
    instance_crud.add(session, _instance(name="alpha", port=4841))
    with pytest.raises(IntegrityError):
        await session.flush()


async def test_instance_port_is_rejected_when_already_taken(
    session: AsyncSession,
) -> None:
    """端口是实例间唯一的硬隔离，重复即两台服务器抢同一个监听。"""
    instance_crud.add(session, _instance(name="alpha", port=4840))
    await session.flush()
    instance_crud.add(session, _instance(name="beta", port=4840))
    with pytest.raises(IntegrityError):
        await session.flush()


async def test_taken_ports_reports_every_allocated_port(
    session: AsyncSession,
) -> None:
    """端口池分配依赖这份已占清单。"""
    instance_crud.add(session, _instance(name="alpha", port=4840))
    instance_crud.add(session, _instance(name="beta", port=4842))
    await session.flush()
    taken = await instance_crud.taken_ports(session)
    assert {4840, 4842} <= taken


async def test_instance_defaults_to_stopped_without_pending_restart(
    session: AsyncSession,
) -> None:
    """新建实例既不自动跑，也没有待生效的改动。"""
    created = instance_crud.add(session, _instance(name="alpha", port=4840))
    await session.flush()
    await session.refresh(created)
    assert created.desired_state == "stopped"
    assert created.has_pending_restart is False
    assert created.is_anonymous_allowed is False


async def test_unknown_security_policy_is_rejected(
    session: AsyncSession,
) -> None:
    """策略名必须落在已知集合里，否则实例启动时才在 asyncua 侧炸。"""
    rejected = _instance(name="alpha", port=4840)
    rejected.security_policies = ["Basic128Rsa15_Sign"]
    instance_crud.add(session, rejected)
    with pytest.raises(IntegrityError):
        await session.flush()


async def test_empty_security_policy_set_is_rejected(
    session: AsyncSession,
) -> None:
    """一个策略都不开的端点谁也连不上，属于配置错误而非有效状态。"""
    rejected = _instance(name="alpha", port=4840)
    rejected.security_policies = []
    instance_crud.add(session, rejected)
    with pytest.raises(IntegrityError):
        await session.flush()


async def test_get_by_name_finds_the_instance(session: AsyncSession) -> None:
    """名称是人在页面上指认实例的方式。"""
    instance_crud.add(session, _instance(name="alpha", port=4840))
    await session.flush()
    found = await instance_crud.get_by_name(session, "alpha")
    assert found is not None
    assert found.port == 4840


async def test_autostart_set_lists_only_flagged_instances(
    session: AsyncSession,
) -> None:
    """进程启动时只拉起标了自启的实例。"""
    flagged = _instance(name="alpha", port=4840)
    flagged.is_autostart = True
    instance_crud.add(session, flagged)
    instance_crud.add(session, _instance(name="beta", port=4841))
    await session.flush()
    names = {item.name for item in await instance_crud.autostart_set(session)}
    assert "alpha" in names
    assert "beta" not in names


async def test_node_identifier_is_unique_within_one_instance(
    session: AsyncSession,
) -> None:
    """同一实例内标识重复即寻址歧义，上位机会读到错的节点。"""
    owner = instance_crud.add(session, _instance(name="alpha", port=4840))
    await session.flush()
    node_crud.add(session, _node(instance_id=owner.id, identifier="Temp"))
    await session.flush()
    node_crud.add(session, _node(instance_id=owner.id, identifier="Temp"))
    with pytest.raises(IntegrityError):
        await session.flush()


async def test_same_identifier_is_allowed_in_another_instance(
    session: AsyncSession,
) -> None:
    """标识只在实例内唯一——两台服务器各有一个 Temp 是正常的。"""
    first = instance_crud.add(session, _instance(name="alpha", port=4840))
    second = instance_crud.add(session, _instance(name="beta", port=4841))
    await session.flush()
    node_crud.add(session, _node(instance_id=first.id, identifier="Temp"))
    node_crud.add(session, _node(instance_id=second.id, identifier="Temp"))
    await session.flush()
    assert await node_crud.count_of_instance(session, first.id) == 1


async def test_numeric_identifier_must_be_digits(
    session: AsyncSession,
) -> None:
    """声明成数字标识却填了字母，要在写入时就拦住。"""
    owner = instance_crud.add(session, _instance(name="alpha", port=4840))
    await session.flush()
    node_crud.add(
        session,
        _node(
            instance_id=owner.id,
            identifier="not-a-number",
            identifier_kind="numeric",
        ),
    )
    with pytest.raises(IntegrityError):
        await session.flush()


async def test_unknown_data_type_is_rejected(session: AsyncSession) -> None:
    """数据类型必须落在一期支持的内建类型里。"""
    owner = instance_crud.add(session, _instance(name="alpha", port=4840))
    await session.flush()
    node_crud.add(
        session,
        _node(instance_id=owner.id, identifier="Temp", data_type="decimal128"),
    )
    with pytest.raises(IntegrityError):
        await session.flush()


async def test_deleting_an_instance_takes_its_nodes_with_it(
    session: AsyncSession,
) -> None:
    """实例没了，它的地址空间也不该留在库里变成孤儿。"""
    owner = instance_crud.add(session, _instance(name="alpha", port=4840))
    await session.flush()
    node_crud.add(session, _node(instance_id=owner.id, identifier="Temp"))
    await session.flush()
    await instance_crud.delete(session, owner)
    await session.flush()
    assert await node_crud.count_of_instance(session, owner.id) == 0


async def test_children_of_returns_direct_children_only(
    session: AsyncSession,
) -> None:
    """建树按层取，孙节点不该混进儿子里。"""
    owner = instance_crud.add(session, _instance(name="alpha", port=4840))
    await session.flush()
    root = node_crud.add(
        session,
        _node(instance_id=owner.id, identifier="Root", node_class="object"),
    )
    await session.flush()
    child = node_crud.add(
        session,
        _node(instance_id=owner.id, identifier="Child", parent_id=root.id),
    )
    await session.flush()
    node_crud.add(
        session,
        _node(
            instance_id=owner.id, identifier="Grandchild", parent_id=child.id
        ),
    )
    await session.flush()
    names = {
        item.identifier
        for item in await node_crud.children_of(session, root.id)
    }
    assert names == {"Child"}


async def test_list_of_instance_returns_the_whole_address_space(
    session: AsyncSession,
) -> None:
    """实例启动要一次取全，逐个查父节点是典型的 N+1。"""
    owner = instance_crud.add(session, _instance(name="alpha", port=4840))
    await session.flush()
    for index in range(3):
        node_crud.add(
            session, _node(instance_id=owner.id, identifier=f"Node{index}")
        )
    await session.flush()
    loaded = await node_crud.list_of_instance(session, owner.id)
    assert len(loaded) == 3


async def test_get_by_identifier_scopes_the_lookup_to_one_instance(
    session: AsyncSession,
) -> None:
    """按标识取节点必须带实例，否则会取到另一台服务器的同名节点。"""
    first = instance_crud.add(session, _instance(name="alpha", port=4840))
    second = instance_crud.add(session, _instance(name="beta", port=4841))
    await session.flush()
    node_crud.add(session, _node(instance_id=first.id, identifier="Temp"))
    await session.flush()
    missing = await node_crud.get_by_identifier(
        session, instance_id=second.id, identifier="Temp"
    )
    assert missing is None
