"""WS 会话语义的单元用例。

⚠ 这一层能存在，正是因为 `SessionService` 不认识 WebSocket：动作字典进、
信封字典出，传输由调用方注入。真实连接那条路径另有契约用例守。
"""

import uuid
from datetime import timedelta

import pytest
from realtime_hub.apps.channel.errors import SubscriptionDenied
from realtime_hub.apps.channel.services import (
    AuthenticationRejected,
    Connection,
    ConnectionRegistry,
    SessionService,
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


def _codec() -> JwtCodec:
    return JwtCodec(
        signing_key=SECRET, verification_keys=(SECRET,), issuer="auth-server"
    )


def _service(
    registry: FakeRegistry | None = None,
) -> tuple[SessionService, ConnectionRegistry]:
    connections = ConnectionRegistry()
    service = SessionService(
        codec=_codec(),
        registry=registry or FakeRegistry(),  # type: ignore[arg-type]  # 结构相同的假件
        connections=connections,
        journal=FakeJournal(),  # type: ignore[arg-type]  # 同上
    )
    return service, connections


def _token(codes: tuple[str, ...] = ("opcua:view",), ttl_s: int = 900) -> str:
    raw, _claims = _codec().issue(
        subject=USER,
        token_type="access",
        ttl_s=ttl_s,
        extra={"permissions": list(codes)},
    )
    return raw


async def _open(
    service: SessionService,
) -> tuple[Connection, list[dict[str, object]]]:
    sent: list[dict[str, object]] = []

    async def send(message: dict[str, object]) -> None:
        sent.append(message)

    handshake = service.authenticate(_token())
    connection = await service.open(handshake, send=send)
    return connection, sent


async def test_handshake_yields_the_subject_and_its_codes() -> None:
    service, _connections = _service()
    handshake = service.authenticate(_token(codes=("opcua:view", "a:b")))
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


async def test_a_token_without_permissions_yields_an_empty_set() -> None:
    # ⚠ 空集意味着什么都订不了——安全的方向；抛的话合法票会连不上
    service, _connections = _service()
    raw, _claims = _codec().issue(subject=USER, token_type="access", ttl_s=900)
    assert service.authenticate(raw).codes == frozenset()


def test_expiry_and_reauth_windows() -> None:
    service, _connections = _service()
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
    assert service.needs_reauth(connection, now=now)
    assert not service.is_expired(connection, now=now)
    assert service.is_expired(connection, now=connection.expires_at)


async def test_a_forged_token_is_rejected() -> None:
    service, _connections = _service()
    forged = JwtCodec(
        signing_key="another-secret-0123456789abcdefgh",
        verification_keys=("another-secret-0123456789abcdefgh",),
        issuer="auth-server",
    )
    raw, _claims = forged.issue(subject=USER, token_type="access", ttl_s=900)
    with pytest.raises(AuthenticationRejected):
        service.authenticate(raw)
