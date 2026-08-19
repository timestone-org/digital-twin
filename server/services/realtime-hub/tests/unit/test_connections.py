"""连接注册表的不变式。

⚠ 这一层守的是两件在生产上才显形的事：反向索引不能留下已死的连接（否则
每次扇出都往它上面发一次），以及空主题的键要删掉（否则索引随主题生灭无限
长大，大屏一开几天就是纯泄漏）。
"""

import json
import uuid
from datetime import timedelta

from realtime_hub.apps.channel.services import (
    AnonymousQuota,
    Connection,
    ConnectionRegistry,
    GrantedTopic,
)

from lib.utils.timeutils import utcnow


def _connection() -> tuple[Connection, list[dict[str, object]]]:
    sent: list[dict[str, object]] = []

    async def send(message: dict[str, object]) -> None:
        sent.append(message)

    async def send_frame(frame: str) -> None:
        sent.append(json.loads(frame))

    now = utcnow()
    return (
        Connection(
            id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            codes=frozenset({"opcua:view"}),
            expires_at=now + timedelta(minutes=15),
            checked_at=now,
            send=send,
            send_frame=send_frame,
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


def _anonymous(ticket_hash: str) -> Connection:
    async def send(_message: dict[str, object]) -> None:
        return None

    async def send_frame(_frame: str) -> None:
        return None

    now = utcnow()
    return Connection(
        id=uuid.uuid4(),
        user_id=None,
        codes=frozenset(),
        expires_at=now + timedelta(minutes=15),
        checked_at=now,
        send=send,
        send_frame=send_frame,
        grant=GrantedTopic(
            ticket_hash=ticket_hash,
            alias=f"public:{ticket_hash}",
            topic="dashboard:d1",
        ),
    )


async def test_one_ticket_cannot_take_more_than_its_share() -> None:
    registry = ConnectionRegistry()
    quota = AnonymousQuota(max_total=9, max_per_ticket=2)
    for _ in range(2):
        assert await registry.add(_anonymous("aa"), quota=quota)

    assert not await registry.add(_anonymous("aa"), quota=quota)
    # 别的票据不受它连累
    assert await registry.add(_anonymous("bb"), quota=quota)


async def test_the_replica_wide_cap_stops_a_flood_of_tickets() -> None:
    registry = ConnectionRegistry()
    quota = AnonymousQuota(max_total=2, max_per_ticket=9)
    for name in ("aa", "bb"):
        assert await registry.add(_anonymous(name), quota=quota)

    assert not await registry.add(_anonymous("cc"), quota=quota)


async def test_logged_in_connections_ignore_the_anonymous_quota() -> None:
    registry = ConnectionRegistry()
    quota = AnonymousQuota(max_total=1, max_per_ticket=1)
    await registry.add(_anonymous("aa"), quota=quota)
    connection, _sent = _connection()

    # ⚠ 名额只约束匿名连接：拿它去挡登录用户，一条泄露的公开链接就能把整站
    # 的实时通道关掉
    assert await registry.add(connection, quota=quota)


async def test_unbinding_forgets_the_alias_too() -> None:
    registry = ConnectionRegistry()
    connection = _anonymous("aa")
    await registry.add(connection)
    await registry.bind(connection.id, "dashboard:d1", alias="public:aa")
    await registry.unbind(connection.id, "dashboard:d1")

    assert connection.outgoing_topic("dashboard:d1") == "dashboard:d1"
