"""匿名（公开链接）连接的会话语义。

⚠ 这一层守的是「公开链接只能看它自己那一张屏」：主题名对匿名连接是**别名**，
真主题一个字都不出门；别名比对只要放松成前缀匹配，一枚票据就能去订别人的。
"""

import uuid
from datetime import timedelta

import pytest
from realtime_hub.apps.channel.errors import SubscriptionDenied
from realtime_hub.apps.channel.services import (
    AnonymousQuota,
    AnonymousQuotaExceeded,
    AuthenticationRejected,
    Connection,
    ConnectionRegistry,
    Handshake,
    PublicAccess,
    PublicGrantRejected,
    SessionDeps,
    SessionService,
    public_alias,
    ticket_fingerprint,
)
from realtime_hub.apps.channel.services.session import TYPE_ACK, TYPE_ERROR

from lib.auth import JwtCodec
from lib.utils.timeutils import utcnow

SECRET = "unit-test-secret-0123456789abcdef"
TICKET = "public-ticket-1"
TOPIC = "dashboard:2b0f0e0e-0000-4000-8000-000000000001"


class FakeJournal:
    """只记在内存里的订阅账——单元层不碰库。"""

    def __init__(self) -> None:
        self.records: list[tuple[str, uuid.UUID | None]] = []
        self.connections: list[uuid.UUID] = []

    async def record(self, *, connection_id, user_id, topic) -> None:
        self.connections.append(connection_id)
        self.records.append((topic, user_id))

    async def forget(self, *, connection_id, topic) -> None:
        self.connections = [
            item for item in self.connections if item != connection_id
        ]
        self.records = [item for item in self.records if item[0] != topic]

    async def forget_all(self, connection_id) -> None:
        self.connections = [
            item for item in self.connections if item != connection_id
        ]
        self.records = []


class FakeGrants:
    """按票据回主题的假授权表。认不出就是「没有授权」。"""

    def __init__(self, granted: dict[str, str]) -> None:
        self.granted = granted

    async def resolve(self, ticket: str) -> str | None:
        return self.granted.get(ticket)

    async def alive(self, ticket_hashes: frozenset[str]) -> dict[str, str]:
        return {
            ticket_fingerprint(ticket): topic
            for ticket, topic in self.granted.items()
            if ticket_fingerprint(ticket) in ticket_hashes
        }


class FakeRegistry:
    """登录态那条路上的主题表。匿名用例不该走到它。"""

    async def authorize(self, *, topic: str, codes: frozenset[str]) -> str:
        raise AssertionError(f"匿名连接不该走按码授权那条路：{topic} {codes}")


class FakeUserCodes:
    """登录态那条路上的权限回查。匿名用例不该走到它。"""

    async def codes_of(self, user_id: object) -> frozenset[str]:
        raise AssertionError(f"匿名握手不该去查权限码：{user_id}")


def _service(
    *,
    granted: dict[str, str] | None = None,
    quota: AnonymousQuota | None = None,
) -> tuple[SessionService, ConnectionRegistry, FakeJournal, FakeGrants]:
    connections = ConnectionRegistry()
    journal = FakeJournal()
    grants = FakeGrants(granted or {TICKET: TOPIC})
    service = SessionService(
        SessionDeps(
            codec=JwtCodec(
                signing_key=SECRET,
                verification_keys=(SECRET,),
                issuer="auth-server",
            ),
            codes=FakeUserCodes(),  # type: ignore[arg-type]  # 结构相同的假件
            registry=FakeRegistry(),  # type: ignore[arg-type]  # 同上
            connections=connections,
            journal=journal,  # type: ignore[arg-type]  # 同上
            public=PublicAccess(
                grants=grants,  # type: ignore[arg-type]  # 同上
                quota=quota or AnonymousQuota(max_total=100, max_per_ticket=10),
                ttl_s=3600,
            ),
        )
    )
    return service, connections, journal, grants


async def _open(
    service: SessionService, ticket: str = TICKET
) -> tuple[Connection, list[dict[str, object]]]:
    sent: list[dict[str, object]] = []

    async def send(message: dict[str, object]) -> None:
        sent.append(message)

    handshake = await service.authenticate_public(ticket)
    return await service.open(handshake, send=send), sent


async def _act(
    service: SessionService, connection: Connection, **message: object
) -> None:
    await service.dispatch(connection, {"req_id": "r1", **message})


async def test_an_unknown_ticket_is_rejected() -> None:
    service, _connections, _journal, _grants = _service()
    with pytest.raises(PublicGrantRejected):
        await service.authenticate_public("撤回过的票据")


async def test_a_granted_ticket_yields_an_alias_and_no_user() -> None:
    service, _connections, _journal, _grants = _service()
    handshake = await service.authenticate_public(TICKET)
    assert handshake.user_id is None
    assert handshake.codes == frozenset()
    assert handshake.grant is not None
    # ⚠ 别名由票据派生，真主题只留在服务端
    assert handshake.grant.alias == public_alias(TICKET)
    assert handshake.grant.topic == TOPIC
    assert handshake.grant.ticket_hash == ticket_fingerprint(TICKET)


async def test_an_anonymous_connection_expires_on_its_own() -> None:
    # ⚠ 不给到期的话，一条连上的匿名连接会一直活到进程重启，撤回对它永不生效
    service, _connections, _journal, _grants = _service()
    handshake = await service.authenticate_public(TICKET)
    assert handshake.expires_at > utcnow()


async def test_subscribing_the_alias_binds_the_real_topic() -> None:
    service, connections, journal, _grants = _service()
    connection, sent = await _open(service)
    await _act(
        service, connection, action="subscribe", topic=public_alias(TICKET)
    )
    assert sent[-1]["type"] == TYPE_ACK
    # 扇出按真主题找连接，客户端说的却是别名——两者必须都成立
    assert await connections.subscribers(TOPIC)
    assert not await connections.subscribers(public_alias(TICKET))
    assert connection.outgoing_topic(TOPIC) == public_alias(TICKET)
    # ⚠ 账上记的是真主题：发布方按它算「谁在看这张屏」
    assert journal.records == [(TOPIC, None)]


async def test_another_tickets_alias_is_denied() -> None:
    service, _connections, _journal, _grants = _service()
    connection, sent = await _open(service)
    # ⚠ 逐字比对而不是「以 public: 开头就放行」：放行的话一枚票据能订别人的
    await _act(
        service, connection, action="subscribe", topic=public_alias("别人的")
    )
    assert sent[-1]["type"] == TYPE_ERROR
    assert sent[-1]["code"] == SubscriptionDenied.code


async def test_the_real_topic_itself_is_denied() -> None:
    service, _connections, _journal, _grants = _service()
    connection, sent = await _open(service)
    await _act(service, connection, action="subscribe", topic=TOPIC)
    assert sent[-1]["type"] == TYPE_ERROR


async def test_unsubscribing_the_alias_drops_the_real_binding() -> None:
    service, connections, journal, _grants = _service()
    connection, _sent = await _open(service)
    alias = public_alias(TICKET)
    for action in ("subscribe", "unsubscribe"):
        await _act(service, connection, action=action, topic=alias)
    assert not await connections.subscribers(TOPIC)
    assert journal.records == []


async def test_the_quota_stops_one_ticket_from_eating_the_pool() -> None:
    service, _connections, _journal, _grants = _service(
        quota=AnonymousQuota(max_total=9, max_per_ticket=2)
    )
    await _open(service)
    await _open(service)
    handshake = await service.authenticate_public(TICKET)
    # 名额在 accept 之前就问得出来，握手不必先连上再被踢
    assert not await service.has_room(handshake)
    with pytest.raises(AnonymousQuotaExceeded):
        await _open(service)


async def test_a_logged_in_handshake_never_hits_the_anonymous_quota() -> None:
    service, _connections, _journal, _grants = _service(
        quota=AnonymousQuota(max_total=1, max_per_ticket=1)
    )
    await _open(service)
    logged_in = Handshake(
        user_id=uuid.uuid4(),
        codes=frozenset({"dashboard:view"}),
        expires_at=utcnow() + timedelta(minutes=15),
    )
    assert await service.has_room(logged_in)


async def test_reauth_with_the_same_ticket_pushes_the_expiry_out() -> None:
    service, _connections, _journal, _grants = _service()
    connection, sent = await _open(service)
    connection.expires_at = utcnow() + timedelta(seconds=5)
    await _act(service, connection, action="reauth", token=TICKET)
    assert sent[-1]["type"] == TYPE_ACK
    assert connection.expires_at > utcnow() + timedelta(seconds=60)


async def test_reauth_with_another_ticket_is_refused() -> None:
    # ⚠ 换成另一枚票据等于在一条已建立的连接上换授权，而它已经挂在原主题上
    service, _connections, _journal, _grants = _service(
        granted={TICKET: TOPIC, "另一枚": TOPIC}
    )
    connection, sent = await _open(service)
    await _act(service, connection, action="reauth", token="另一枚")
    assert sent[-1]["type"] == TYPE_ERROR
    assert sent[-1]["code"] == AuthenticationRejected.code


async def test_reauth_after_revocation_is_refused() -> None:
    service, _connections, _journal, grants = _service()
    connection, sent = await _open(service)
    grants.granted.clear()  # 模拟「票据被撤回」
    await _act(service, connection, action="reauth", token=TICKET)
    assert sent[-1]["type"] == TYPE_ERROR
    assert sent[-1]["code"] == PublicGrantRejected.code


async def test_permission_recheck_leaves_anonymous_subscriptions_alone() -> (
    None
):
    service, _connections, _journal, _grants = _service()
    connection, _sent = await _open(service)
    await _act(
        service, connection, action="subscribe", topic=public_alias(TICKET)
    )
    # ⚠ 匿名连接一个权限码都没有，按码重判会把它唯一那条订阅退掉
    assert await service.revoke_unauthorized(connection) == 0
    assert connection.topics == {TOPIC}


def test_the_fingerprint_matches_the_publisher_side_one() -> None:
    # ⚠ 指纹算法两侧各写一份（platform-server 的
    # `apps/dashboard/services/public_grants.ticket_fingerprint`），漂开的表现
    # 是所有公开链接一律订不上，而两边都不报错。钉同一个向量
    assert ticket_fingerprint("dt-public-ticket") == (
        "2c00fdc19fd6fb060a890ab340b565395c6c8b18d4a1ddfb7761373d23f7dffb"
    )
