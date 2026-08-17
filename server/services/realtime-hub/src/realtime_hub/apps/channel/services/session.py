"""一条 WS 连接的会话语义：握手鉴权、动作分派、到期与权限复核。

⚠ 这一层**不认识 WebSocket**：收到的是已经解好的动作字典，发出去的是信封
字典，传输由 api 层注入的 `send` 承担。这样会话逻辑能被单元测试直接驱动，
不必起真实连接——而真实连接的那条路径另有集成用例守。
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from lib.auth import JwtCodec, TokenError
from lib.errors import AppError
from lib.logging import get_logger
from lib.utils.timeutils import utcnow
from realtime_hub.apps.channel.services.connections import (
    Connection,
    ConnectionRegistry,
    SendFn,
)
from realtime_hub.apps.channel.services.journal import SubscriptionJournal
from realtime_hub.apps.channel.services.registry import TopicRegistry
from realtime_hub.apps.channel.services.user_codes import UserCodeSource

_logger = get_logger("realtime.session")

# auth-server 签的访问令牌类型，与它的 ACCESS_TYPE 逐字一致
ACCESS_TYPE = "access"

# 客户端 → 服务端的动作
ACTION_SUBSCRIBE = "subscribe"
ACTION_UNSUBSCRIBE = "unsubscribe"
ACTION_REAUTH = "reauth"

# 服务端 → 客户端的消息类型（api-contract §10 的字符串枚举）
TYPE_ACK = "ack"
TYPE_ERROR = "error"
TYPE_SYSTEM = "system"

# ⚠ 令牌过期关连接用 4001：4000-4999 是应用自定义段，1008（policy violation）
# 会与代理层的关闭混在一起，客户端分不出「该重新登录」还是「网络断了」
CLOSE_TOKEN_EXPIRED = 4001

# 到期前多久要求客户端换票。⚠ 不能等到 exp 那一刻才要：换票本身要一个往返，
# 卡点要就等于每次都断一下
REAUTH_LEAD_S = 60


@dataclass(frozen=True)
class Handshake:
    """握手结果：这条连接是谁、持有哪些码、什么时候到期。"""

    user_id: uuid.UUID
    codes: frozenset[str]
    expires_at: datetime


class SessionService:
    """WS 连接的会话逻辑。一条连接一份状态，状态存在注册表里。"""

    def __init__(
        self,
        *,
        codec: JwtCodec,
        codes: UserCodeSource,
        registry: TopicRegistry,
        connections: ConnectionRegistry,
        journal: SubscriptionJournal,
    ) -> None:
        self._codec = codec
        self._codes = codes
        self._registry = registry
        self._connections = connections
        self._journal = journal

    async def authenticate(self, token: str) -> Handshake:
        """验一枚访问令牌，解出身份，再向 auth-server 取该用户此刻的权限码。

        ⚠ 这条路径与 HTTP 完全不同：token 在**子协议**里，`Authorization`
        头上的鉴权中间件对它不生效，必须单独实现、单独测试
        （testing-standard-python.md §7.1）。

        ⚠ 权限码只能现查，不能从令牌载荷里读：auth-server 签的 token 只带主体
        与到期，权限是它在 `/verify` 那一步现查后以签名头下发的，载荷里没有。
        读载荷的话每条连接都拿着空码集合，而空码在授权那一步的表现是**每一次
        订阅都被拒**（42005）、HTTP 面却一切正常——最难往这上面想的一种故障。

        ⚠ 解不出来一律拒绝握手，不许「先连上再说」：连上之后才发现没身份，
        错误要经 WS 帧回给客户端，而那时它已经在等数据了。

        Args: token。
        """
        try:
            claims = self._codec.decode(token, expected_type=ACCESS_TYPE)
        except TokenError as error:
            raise AuthenticationRejected(str(error)) from error
        user_id = _as_uuid(claims.subject)
        return Handshake(
            user_id=user_id,
            codes=await self._codes.codes_of(user_id),
            expires_at=claims.expires_at,
        )

    async def open(self, handshake: Handshake, *, send: SendFn) -> Connection:
        """登记一条已鉴权的连接。

        Args: handshake, send。
        """
        now = utcnow()
        connection = Connection(
            id=uuid.uuid4(),
            user_id=handshake.user_id,
            codes=handshake.codes,
            expires_at=handshake.expires_at,
            checked_at=now,
            send=send,
        )
        await self._connections.add(connection)
        await send(
            {
                "type": TYPE_SYSTEM,
                "event": "connected",
                "connection_id": str(connection.id),
                # ⚠ 明确告知何时该换票，客户端不必自己解 token 猜
                "reauth_before": handshake.expires_at.isoformat(),
            }
        )
        return connection

    async def close(self, connection_id: uuid.UUID) -> None:
        """连接关闭时摘掉它的全部占位——内存索引与库里的订阅行都要清。

        ⚠ 两处都清且顺序无所谓：内存那份决定还发不发，库里那份只供对账。
        漏清库里的，对账会看到「有人在订」而实际上一条连接都没有。

        Args: connection_id。
        """
        await self._connections.remove(connection_id)
        await self._journal.forget_all(connection_id)

    async def dispatch(
        self, connection: Connection, message: dict[str, Any]
    ) -> None:
        """处理一条客户端消息。

        ⚠ 任何一条动作失败都只回一帧 `error`，**不关连接**：一次订阅拼错
        主题名不该把用户正在看的其它主题一起断掉。

        Args: connection, message。
        """
        action = message.get("action")
        req_id = message.get("req_id")
        topic = message.get("topic")
        try:
            await self._apply(connection, action, topic, message)
        except AppError as error:
            await connection.send(
                {
                    "type": TYPE_ERROR,
                    "req_id": req_id,
                    "code": error.code,
                    "message": str(error),
                }
            )
            return
        await connection.send(
            {"type": TYPE_ACK, "req_id": req_id, "action": action}
        )

    async def _apply(
        self,
        connection: Connection,
        action: object,
        topic: object,
        message: dict[str, Any],
    ) -> None:
        """按动作分派。未知动作与缺参数都当成客户端错误。

        Args: connection, action, topic, message。
        """
        if action == ACTION_REAUTH:
            await self._reauth(connection, message.get("token"))
            return
        if not isinstance(topic, str) or not topic:
            raise BadRequest("缺少 topic")
        if action == ACTION_SUBSCRIBE:
            await self._registry.authorize(topic=topic, codes=connection.codes)
            await self._connections.bind(connection.id, topic)
            await self._journal.record(
                connection_id=connection.id,
                user_id=connection.user_id,
                topic=topic,
            )
            return
        if action == ACTION_UNSUBSCRIBE:
            await self._connections.unbind(connection.id, topic)
            await self._journal.forget(connection_id=connection.id, topic=topic)
            return
        raise BadRequest(f"不认识的动作：{action!r}")

    async def _reauth(self, connection: Connection, token: object) -> None:
        """换一枚新令牌，刷新权限与到期时刻。

        ⚠ 换票后要**立刻按新权限重判已订阅的主题**：降权的用户不该靠着一条
        老连接继续收数据。不满足的只退订那个主题，不断整条连接。

        Args: connection, token。
        """
        if not isinstance(token, str) or not token:
            raise BadRequest("reauth 缺少 token")
        handshake = await self.authenticate(token)
        if handshake.user_id != connection.user_id:
            # ⚠ 不许换成别人的票：那等于在一条已建立的连接上换了主体，
            # 而订阅关系还挂在原来那个人身上
            raise AuthenticationRejected("reauth 的令牌不属于本连接的用户")
        connection.codes = handshake.codes
        connection.expires_at = handshake.expires_at
        connection.checked_at = utcnow()
        await self.revoke_unauthorized(connection)

    async def revoke_unauthorized(self, connection: Connection) -> int:
        """按当前权限重判该连接的全部订阅，退掉不再满足的，返回退了几个。

        Args: connection。
        """
        revoked = 0
        for topic in tuple(connection.topics):
            try:
                await self._registry.authorize(
                    topic=topic, codes=connection.codes
                )
            except AppError:
                await self._connections.unbind(connection.id, topic)
                await self._journal.forget(
                    connection_id=connection.id, topic=topic
                )
                await connection.send(
                    {
                        "type": TYPE_SYSTEM,
                        "event": "unsubscribed",
                        "topic": topic,
                        "reason": "permission_revoked",
                    }
                )
                revoked += 1
        if revoked:
            _logger.info(
                "subscriptions_revoked",
                "权限复核后退订了部分主题",
                connection_id=str(connection.id),
                revoked=revoked,
            )
        return revoked

    @staticmethod
    def needs_reauth(connection: Connection, *, now: datetime) -> bool:
        """是否该催客户端换票了。

        Args: connection, now。
        """
        return now >= connection.expires_at - timedelta(seconds=REAUTH_LEAD_S)

    @staticmethod
    def is_expired(connection: Connection, *, now: datetime) -> bool:
        """令牌是否已经过期——过期即关连接（4001）。

        Args: connection, now。
        """
        return now >= connection.expires_at


class AuthenticationRejected(AppError):
    """WS 握手或换票时令牌不可用。"""

    code = 42006
    http_status = 401


class BadRequest(AppError):
    """客户端消息缺参数或动作不认识。"""

    code = 42007
    http_status = 400


def _as_uuid(raw: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except ValueError as error:
        raise AuthenticationRejected("令牌主体不是合法标识") from error
