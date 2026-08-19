"""WS 会话语义的单元用例。

⚠ 这一层能存在，正是因为 `SessionService` 不认识 WebSocket：动作字典进、
信封字典出，传输由调用方注入。真实连接那条路径另有契约用例守。
"""

import uuid
from datetime import timedelta

import pytest
from realtime_hub.apps.channel.errors import (
    SubscriptionDenied,
    UserCodesUnavailable,
)
from realtime_hub.apps.channel.services import (
    AnonymousQuota,
    AuthenticationRejected,
    Connection,
    ConnectionRegistry,
    PublicAccess,
    SessionDeps,
    SessionService,
    is_expired,
    needs_reauth,
    ticket_fingerprint,
)
from realtime_hub.apps.channel.services.session import (
    REAUTH_LEAD_S,
    TYPE_ACK,
    TYPE_ERROR,
    TYPE_SYSTEM,
)

from lib.auth import JwtCodec
from lib.utils.timeutils import utcnow

SECRET = "unit-test-secret-0123456789abcdef"
USER = "3fa85f64-5717-4562-b3fc-2c963f66afa6"


class FakeJournal:
    """只记在内存里的订阅账——单元层不碰库。"""

    def __init__(self) -> None:
        self.recorded: list[tuple[str, str]] = []
        self.users: list[str] = []

    async def record(self, *, connection_id, user_id, topic) -> None:
        self.recorded.append((str(connection_id), topic))
        self.users.append(str(user_id))

    async def forget(self, *, connection_id, topic) -> None:
        self.recorded = [
            item
            for item in self.recorded
            if item != (str(connection_id), topic)
        ]

    async def forget_all(self, connection_id) -> None:
        self.recorded = [
            item for item in self.recorded if item[0] != str(connection_id)
        ]


class FakeRegistry:
    """只认一个主题、只认一个码的假主题表。"""

    def __init__(self, *, topic: str = "opcua:1", code: str = "opcua:view"):
        self.topic = topic
        self.code = code

    async def authorize(self, *, topic: str, codes: frozenset[str]) -> str:
        if topic != self.topic:
            raise SubscriptionDenied("未登记")
        if self.code not in codes:
            raise SubscriptionDenied("码不够")
        return self.code


class FakeGrants:
    """按票据回主题的假授权表。`resolve` 认不出就是「没有授权」。"""

    def __init__(self, granted: dict[str, str] | None = None) -> None:
        self.granted = granted or {}

    async def resolve(self, ticket: str) -> str | None:
        return self.granted.get(ticket)

    async def alive(self, ticket_hashes: frozenset[str]) -> dict[str, str]:
        return {
            ticket_fingerprint(ticket): topic
            for ticket, topic in self.granted.items()
            if ticket_fingerprint(ticket) in ticket_hashes
        }


def _codec() -> JwtCodec:
    return JwtCodec(
        signing_key=SECRET, verification_keys=(SECRET,), issuer="auth-server"
    )


# 「auth-server 说某个用户持有哪些码」。⚠ 由 `_token` 在签票时写入：真实链路
# 里码不在令牌载荷里，假件跟着从票里读的话，这条授权路径就只有测试自己验证自己
_GRANTED: dict[str, frozenset[str]] = {}


class FakeUserCodes:
    """按用户回权限码的假件。`error` 一设就模拟 auth-server 不可达。"""

    def __init__(self) -> None:
        self.error: Exception | None = None

    async def codes_of(self, user_id: object) -> frozenset[str]:
        if self.error is not None:
            raise self.error
        return _GRANTED.get(str(user_id), frozenset())


def _service(
    registry: FakeRegistry | None = None,
    codes: FakeUserCodes | None = None,
    grants: FakeGrants | None = None,
    quota: AnonymousQuota | None = None,
) -> tuple[SessionService, ConnectionRegistry]:
    connections = ConnectionRegistry()
    service = SessionService(
        SessionDeps(
            codec=_codec(),
            codes=codes or FakeUserCodes(),  # type: ignore[arg-type]  # 结构相同的假件
            registry=registry or FakeRegistry(),  # type: ignore[arg-type]  # 同上
            connections=connections,
            journal=FakeJournal(),  # type: ignore[arg-type]  # 同上
            public=PublicAccess(
                grants=grants or FakeGrants(),  # type: ignore[arg-type]  # 同上
                quota=quota or AnonymousQuota(max_total=100, max_per_ticket=10),
                ttl_s=3600,
            ),
        )
    )
    return service, connections


def _token(
    codes: tuple[str, ...] = ("opcua:view",),
    ttl_s: int = 900,
    subject: str = USER,
) -> str:
    raw, _claims = _codec().issue(
        subject=subject, token_type="access", ttl_s=ttl_s
    )
    _GRANTED[subject] = frozenset(codes)
    return raw


async def _open(
    service: SessionService,
) -> tuple[Connection, list[dict[str, object]]]:
    sent: list[dict[str, object]] = []

    async def send(message: dict[str, object]) -> None:
        sent.append(message)

    handshake = await service.authenticate(_token())
    connection = await service.open(handshake, send=send)
    return connection, sent


async def test_handshake_yields_the_subject_and_its_codes() -> None:
    service, _connections = _service()
    handshake = await service.authenticate(_token(codes=("opcua:view", "a:b")))
    assert str(handshake.user_id) == USER
    assert handshake.codes == frozenset({"opcua:view", "a:b"})


async def test_open_announces_when_the_client_must_reauth() -> None:
    # ⚠ 明确告知，客户端不必自己解 token 猜
    service, _connections = _service()
    _connection, sent = await _open(service)
    assert sent[0]["type"] == TYPE_SYSTEM
    assert sent[0]["event"] == "connected"
    assert "reauth_before" in sent[0]


async def test_subscribe_binds_the_connection_and_acks() -> None:
    service, connections = _service()
    connection, sent = await _open(service)
    await service.dispatch(
        connection, {"action": "subscribe", "topic": "opcua:1", "req_id": "c1"}
    )
    assert sent[-1] == {"type": TYPE_ACK, "req_id": "c1", "action": "subscribe"}
    assert await connections.subscribers("opcua:1") == (connection,)


async def test_a_denied_subscribe_only_returns_an_error_frame() -> None:
    # ⚠ 不关连接：一次订阅失败不该断掉用户正在看的其它主题
    service, connections = _service()
    connection, sent = await _open(service)
    await service.dispatch(
        connection, {"action": "subscribe", "topic": "opcua:404"}
    )
    assert sent[-1]["type"] == TYPE_ERROR
    assert await connections.subscribers("opcua:404") == ()


async def test_an_unknown_action_is_a_client_error_not_a_disconnect() -> None:
    service, _connections = _service()
    connection, sent = await _open(service)
    await service.dispatch(connection, {"action": "explode"})
    assert sent[-1]["type"] == TYPE_ERROR


async def test_subscribe_without_a_topic_is_rejected() -> None:
    service, _connections = _service()
    connection, sent = await _open(service)
    await service.dispatch(connection, {"action": "subscribe"})
    assert sent[-1]["type"] == TYPE_ERROR


async def test_unsubscribe_is_idempotent() -> None:
    service, connections = _service()
    connection, sent = await _open(service)
    await service.dispatch(
        connection, {"action": "unsubscribe", "topic": "opcua:1"}
    )
    assert sent[-1]["type"] == TYPE_ACK
    assert await connections.subscribers("opcua:1") == ()


async def test_reauth_replaces_the_codes_and_the_deadline() -> None:
    service, _connections = _service()
    connection, sent = await _open(service)
    before = connection.expires_at
    await service.dispatch(
        connection,
        {"action": "reauth", "token": _token(codes=("opcua:manage",))},
    )
    assert sent[-1]["type"] == TYPE_ACK
    assert connection.codes == frozenset({"opcua:manage"})
    assert connection.expires_at >= before


async def test_reauth_drops_subscriptions_that_no_longer_qualify() -> None:
    # ⚠ 降权的用户不该靠着一条老连接继续收数据
    service, connections = _service()
    connection, sent = await _open(service)
    await service.dispatch(
        connection, {"action": "subscribe", "topic": "opcua:1"}
    )
    await service.dispatch(
        connection, {"action": "reauth", "token": _token(codes=("other:x",))}
    )
    assert await connections.subscribers("opcua:1") == ()
    revoked = [item for item in sent if item.get("event") == "unsubscribed"]
    assert len(revoked) == 1
    assert revoked[0]["reason"] == "permission_revoked"


async def test_reauth_with_another_users_token_is_rejected() -> None:
    # ⚠ 换主体等于把订阅关系挂在了别人身上
    service, _connections = _service()
    connection, sent = await _open(service)
    other, _claims = _codec().issue(
        subject=str(uuid.uuid4()), token_type="access", ttl_s=900
    )
    await service.dispatch(connection, {"action": "reauth", "token": other})
    assert sent[-1]["type"] == TYPE_ERROR


async def test_reauth_without_a_token_is_rejected() -> None:
    service, _connections = _service()
    connection, sent = await _open(service)
    await service.dispatch(connection, {"action": "reauth"})
    assert sent[-1]["type"] == TYPE_ERROR


async def test_permissions_come_from_auth_not_from_the_token() -> None:
    # ⚠ 码只认 auth-server 的回查，令牌载荷里塞什么都不作数：签发方压根不往
    # 载荷里放权限，读它等于每条连接都拿着空码集合——而空码的表现是每一次订阅
    # 都被拒 42005、HTTP 面却完全正常
    service, _connections = _service()
    raw, _claims = _codec().issue(
        subject=USER,
        token_type="access",
        ttl_s=900,
        extra={"permissions": ["forged:code"]},
    )
    _GRANTED[USER] = frozenset({"opcua:view"})

    handshake = await service.authenticate(raw)

    assert handshake.codes == frozenset({"opcua:view"})


async def test_a_user_auth_grants_nothing_to_gets_an_empty_set() -> None:
    # ⚠ 空集意味着什么都订不了——安全的方向
    service, _connections = _service()
    stranger = "3fa85f64-5717-4562-b3fc-2c963f66af00"
    _GRANTED.pop(stranger, None)
    raw, _claims = _codec().issue(
        subject=stranger, token_type="access", ttl_s=900
    )
    assert (await service.authenticate(raw)).codes == frozenset()


async def test_auth_being_unreachable_fails_the_handshake_closed() -> None:
    # ⚠ 绝不能退化成空码放行：空码在授权那一步长得跟「你没权限」一模一样，
    # 客户端会据此不再重连，于是 auth 恢复了通道也不会自己回来
    codes = FakeUserCodes()
    codes.error = UserCodesUnavailable("auth 不可达")
    service, _connections = _service(codes=codes)

    with pytest.raises(UserCodesUnavailable):
        await service.authenticate(_token())


def test_expiry_and_reauth_windows() -> None:
    _service_unused, _connections = _service()
    now = utcnow()

    async def send(_message: dict[str, object]) -> None:
        return None

    connection = Connection(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        codes=frozenset(),
        expires_at=now + timedelta(seconds=REAUTH_LEAD_S - 1),
        checked_at=now,
        send=send,
    )
    assert needs_reauth(connection, now=now)
    assert not is_expired(connection, now=now)
    assert is_expired(connection, now=connection.expires_at)


async def test_a_forged_token_is_rejected() -> None:
    service, _connections = _service()
    forged = JwtCodec(
        signing_key="another-secret-0123456789abcdefgh",
        verification_keys=("another-secret-0123456789abcdefgh",),
        issuer="auth-server",
    )
    raw, _claims = forged.issue(subject=USER, token_type="access", ttl_s=900)
    with pytest.raises(AuthenticationRejected):
        await service.authenticate(raw)
