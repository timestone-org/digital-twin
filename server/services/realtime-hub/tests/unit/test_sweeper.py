"""匿名连接的授权复核。

⚠ 守的是「撤回必须是真的」：一条已经连上的匿名连接手里握着握手那一刻解出来
的授权，此后没有任何一处会重判它——公开大屏一开就是几天，少了这一支，撤回
对已连上的人从未发生（ADR-0014 §二 / ADR-0021）。
"""

import asyncio
import uuid
from datetime import timedelta

from realtime_hub.apps.channel.services import (
    Connection,
    ConnectionRegistry,
    GrantedTopic,
    PublicConnectionSweeper,
    public_alias,
    ticket_fingerprint,
)
from realtime_hub.apps.channel.services.session import (
    CLOSE_PUBLIC_GRANT_REVOKED,
    CLOSE_TOKEN_EXPIRED,
)

from lib.utils.timeutils import utcnow

TICKET = "public-ticket-1"
TOPIC = "dashboard:2b0f0e0e-0000-4000-8000-000000000001"


class FakeGrants:
    """只回「这些指纹还活着」的假授权表。"""

    def __init__(self, granted: dict[str, str]) -> None:
        self.granted = granted

    async def alive(self, ticket_hashes: frozenset[str]) -> dict[str, str]:
        return {
            item: topic
            for item, topic in self.granted.items()
            if item in ticket_hashes
        }


def _anonymous(
    *, ttl_s: int = 3600, ticket: str = TICKET
) -> tuple[Connection, list[int]]:
    """造一条匿名连接，连同「它被用什么码关过」的记录一起回。

    Args: ttl_s, ticket。
    """
    closed: list[int] = []

    async def send(_message: dict[str, object]) -> None:
        return None

    async def close(code: int) -> None:
        closed.append(code)

    now = utcnow()
    connection = Connection(
        id=uuid.uuid4(),
        user_id=None,
        codes=frozenset(),
        expires_at=now + timedelta(seconds=ttl_s),
        checked_at=now,
        send=send,
        grant=GrantedTopic(
            ticket_hash=ticket_fingerprint(ticket),
            alias=public_alias(ticket),
            topic=TOPIC,
        ),
        close=close,
    )
    return connection, closed


def _logged_in() -> Connection:
    async def send(_message: dict[str, object]) -> None:
        return None

    async def close(_code: int) -> None:
        raise AssertionError("登录态连接不该被授权复核关掉")

    now = utcnow()
    return Connection(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        codes=frozenset({"dashboard:view"}),
        # 已经过期也不关：登录态的到期由收发循环与换票那条路负责
        expires_at=now - timedelta(seconds=1),
        checked_at=now,
        send=send,
        close=close,
    )


def _sweeper(
    connections: ConnectionRegistry, granted: dict[str, str]
) -> PublicConnectionSweeper:
    return PublicConnectionSweeper(
        connections=connections,
        grants=FakeGrants(granted),  # type: ignore[arg-type]  # 结构相同的假件
        interval_s=60.0,
    )


async def test_a_live_grant_keeps_the_connection() -> None:
    connections = ConnectionRegistry()
    connection, closed = _anonymous()
    await connections.add(connection)
    sweeper = _sweeper(connections, {ticket_fingerprint(TICKET): TOPIC})

    assert await sweeper.sweep_once() == 0
    assert closed == []


async def test_a_revoked_grant_closes_the_connection() -> None:
    connections = ConnectionRegistry()
    connection, closed = _anonymous()
    await connections.add(connection)
    sweeper = _sweeper(connections, {})

    assert await sweeper.sweep_once() == 1
    # ⚠ 用可重试的那一档而不是 1008：撤回与「推送方还没对账到这枚新票据」在
    # 客户端看来一样，后者只要等一轮对账
    assert closed == [CLOSE_PUBLIC_GRANT_REVOKED]


async def test_a_grant_pointing_elsewhere_closes_the_connection() -> None:
    connections = ConnectionRegistry()
    connection, closed = _anonymous()
    await connections.add(connection)
    sweeper = _sweeper(connections, {ticket_fingerprint(TICKET): "别的主题"})

    assert await sweeper.sweep_once() == 1
    # 同一枚票据改指另一张屏，说明推送方那边换了口径，而这条连接还订在旧主题上
    assert closed == [CLOSE_PUBLIC_GRANT_REVOKED]


async def test_an_expired_connection_is_closed_with_the_reauth_code() -> None:
    connections = ConnectionRegistry()
    connection, closed = _anonymous(ttl_s=-1)
    await connections.add(connection)
    sweeper = _sweeper(connections, {ticket_fingerprint(TICKET): TOPIC})

    assert await sweeper.sweep_once() == 1
    # 4001 的语义是「换票重连」，客户端拿同一枚票据重连即可
    assert closed == [CLOSE_TOKEN_EXPIRED]


async def test_logged_in_connections_are_left_alone() -> None:
    connections = ConnectionRegistry()
    await connections.add(_logged_in())
    sweeper = _sweeper(connections, {})

    assert await sweeper.sweep_once() == 0


async def test_no_anonymous_connection_means_no_query() -> None:
    class Exploding:
        async def alive(self, ticket_hashes: frozenset[str]) -> dict[str, str]:
            raise AssertionError(f"没有匿名连接时不该打库：{ticket_hashes}")

    connections = ConnectionRegistry()
    await connections.add(_logged_in())
    sweeper = PublicConnectionSweeper(
        connections=connections,
        grants=Exploding(),  # type: ignore[arg-type]  # 结构相同的假件
        interval_s=60.0,
    )

    assert await sweeper.sweep_once() == 0


async def test_the_loop_sweeps_until_it_is_stopped() -> None:
    connections = ConnectionRegistry()
    connection, closed = _anonymous()
    await connections.add(connection)
    sweeper = PublicConnectionSweeper(
        connections=connections,
        grants=FakeGrants({}),  # type: ignore[arg-type]  # 结构相同的假件
        interval_s=0.01,
    )

    await sweeper.start()
    # 起两次是幂等的：重复起会让同一轮复核跑两遍
    await sweeper.start()
    await asyncio.sleep(0.05)
    await sweeper.stop()

    # ⚠ 只断言「关过」：真实链路里关掉 socket 会让收发循环把连接摘掉，而这里
    # 的假件不摘，于是每一轮都会再关一次——那不是被测的行为
    assert closed[0] == CLOSE_PUBLIC_GRANT_REVOKED


async def test_stopping_a_sweeper_that_never_started_is_safe() -> None:
    connections = ConnectionRegistry()
    sweeper = _sweeper(connections, {})

    # 关停路径不该依赖启动是否发生过
    await sweeper.stop()

    assert await sweeper.sweep_once() == 0


async def test_one_bad_round_does_not_stop_the_loop() -> None:
    class Flaky:
        def __init__(self) -> None:
            self.rounds = 0

        async def alive(self, ticket_hashes: frozenset[str]) -> dict[str, str]:
            self.rounds += 1
            if self.rounds == 1:
                raise RuntimeError("库抖了一下")
            return dict.fromkeys(ticket_hashes, TOPIC)

    connections = ConnectionRegistry()
    connection, closed = _anonymous()
    await connections.add(connection)
    grants = Flaky()
    sweeper = PublicConnectionSweeper(
        connections=connections,
        grants=grants,  # type: ignore[arg-type]  # 结构相同的假件
        interval_s=0.01,
    )

    await sweeper.start()
    await asyncio.sleep(0.06)
    await sweeper.stop()

    # ⚠ 单轮失败只记日志：库抖一下不该让复核这条支线永久停摆，而那种停摆是静默的
    assert grants.rounds > 1
    assert closed == []


async def test_a_connection_that_cannot_be_closed_is_skipped() -> None:
    async def send(_message: dict[str, object]) -> None:
        return None

    async def close(_code: int) -> None:
        raise ConnectionResetError("socket 已死")

    now = utcnow()
    connections = ConnectionRegistry()
    await connections.add(
        Connection(
            id=uuid.uuid4(),
            user_id=None,
            codes=frozenset(),
            expires_at=now + timedelta(seconds=60),
            checked_at=now,
            send=send,
            grant=GrantedTopic(
                ticket_hash=ticket_fingerprint(TICKET),
                alias=public_alias(TICKET),
                topic=TOPIC,
            ),
            close=close,
        )
    )
    sweeper = _sweeper(connections, {})

    # 对端可能已经走了；摘除由收发循环的 finally 负责，这里不该抛
    assert await sweeper.sweep_once() == 0


async def test_a_connection_without_a_close_port_is_skipped() -> None:
    async def send(_message: dict[str, object]) -> None:
        return None

    now = utcnow()
    connections = ConnectionRegistry()
    await connections.add(
        Connection(
            id=uuid.uuid4(),
            user_id=None,
            codes=frozenset(),
            expires_at=now + timedelta(seconds=60),
            checked_at=now,
            send=send,
            grant=GrantedTopic(
                ticket_hash=ticket_fingerprint(TICKET),
                alias=public_alias(TICKET),
                topic=TOPIC,
            ),
        )
    )
    sweeper = _sweeper(connections, {})

    assert await sweeper.sweep_once() == 0
