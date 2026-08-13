"""连接注册表的不变式。

⚠ 这一层守的是两件在生产上才显形的事：反向索引不能留下已死的连接（否则
每次扇出都往它上面发一次），以及空主题的键要删掉（否则索引随主题生灭无限
长大，大屏一开几天就是纯泄漏）。
"""

import uuid
from datetime import timedelta

from realtime_hub.apps.channel.services import Connection, ConnectionRegistry

from lib.utils.timeutils import utcnow


def _connection() -> tuple[Connection, list[dict[str, object]]]:
    sent: list[dict[str, object]] = []

    async def send(message: dict[str, object]) -> None:
        sent.append(message)

    now = utcnow()
    return (
        Connection(
            id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            codes=frozenset({"opcua:view"}),
            expires_at=now + timedelta(minutes=15),
            checked_at=now,
            send=send,
        ),
        sent,
    )


async def test_a_bound_connection_is_found_by_its_topic() -> None:
    registry = ConnectionRegistry()
    connection, _sent = _connection()
    await registry.add(connection)
    await registry.bind(connection.id, "opcua:1")
    assert await registry.subscribers("opcua:1") == (connection,)


async def test_binding_twice_is_idempotent() -> None:
    registry = ConnectionRegistry()
    connection, _sent = _connection()
    await registry.add(connection)
    await registry.bind(connection.id, "opcua:1")
    await registry.bind(connection.id, "opcua:1")
    assert len(await registry.subscribers("opcua:1")) == 1


async def test_removing_a_connection_clears_it_from_every_topic() -> None:
    registry = ConnectionRegistry()
    connection, _sent = _connection()
    await registry.add(connection)
    await registry.bind(connection.id, "opcua:1")
    await registry.bind(connection.id, "opcua:2")
    await registry.remove(connection.id)
    assert await registry.subscribers("opcua:1") == ()
    assert await registry.subscribers("opcua:2") == ()


async def test_the_topic_index_does_not_keep_empty_buckets() -> None:
    # ⚠ 这条守的是泄漏：只 discard 不删键，索引会随主题生灭无限长大
    registry = ConnectionRegistry()
    connection, _sent = _connection()
    await registry.add(connection)
    await registry.bind(connection.id, "opcua:1")
    await registry.remove(connection.id)
    assert tuple(registry.topics()) == ()


async def test_unbinding_the_last_holder_drops_the_topic() -> None:
    registry = ConnectionRegistry()
    connection, _sent = _connection()
    await registry.add(connection)
    await registry.bind(connection.id, "opcua:1")
    await registry.unbind(connection.id, "opcua:1")
    assert tuple(registry.topics()) == ()


async def test_binding_an_unknown_connection_does_nothing() -> None:
    # 摘除与订阅可能竞争：连接已经没了还来一条 bind，不该凭空建出索引项
    registry = ConnectionRegistry()
    await registry.bind(uuid.uuid4(), "opcua:1")
    assert tuple(registry.topics()) == ()


async def test_refreshing_codes_replaces_the_held_set() -> None:
    registry = ConnectionRegistry()
    connection, _sent = _connection()
    await registry.add(connection)
    now = utcnow()
    await registry.refresh_codes(
        connection.id, codes=frozenset({"opcua:manage"}), checked_at=now
    )
    refreshed = await registry.get(connection.id)
    assert refreshed is not None
    assert refreshed.codes == frozenset({"opcua:manage"})
    assert refreshed.checked_at == now
