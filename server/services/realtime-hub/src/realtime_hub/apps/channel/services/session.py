"""一条 WS 连接的会话语义：握手鉴权、动作分派、到期与权限复核。

⚠ 这一层**不认识 WebSocket**：收到的是已经解好的动作字典，发出去的是信封
字典，传输由 api 层注入的 `send` 承担。这样会话逻辑能被单元测试直接驱动，
不必起真实连接——而真实连接的那条路径另有集成用例守。

⚠ 两种主体，两条握手路径：登录态验一枚 access token 并现查权限码；匿名态
（公开链接）验一枚票据并只授它那一个主题（ADR-0021）。两条路的差别必须
显式——把匿名当成「权限码为空的用户」，它在授权那一步与「你没权限」长得
一模一样。
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from lib.auth import JwtCodec, TokenError
from lib.errors import AppError
from lib.logging import get_logger
from lib.utils.timeutils import utcnow
from realtime_hub.apps.channel.errors import SubscriptionDenied
from realtime_hub.apps.channel.services.connections import (
    AnonymousQuota,
    Connection,
    ConnectionRegistry,
    GrantedTopic,
    SendFn,
)
from realtime_hub.apps.channel.services.grants import (
    PublicGrantRegistry,
    ticket_fingerprint,
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
# ⚠ 公开票据没有（或不再有）授权时的关闭码，与 1008 分开：1008 的语义是
# 「你不该连」，客户端据它**停止重连**；而这一档要么是撤回、要么是推送方还
# 没把新票据对账过去，后者只要等一轮对账，客户端该退避后再来
CLOSE_PUBLIC_GRANT_REVOKED = 4003
# 匿名名额用尽时的关闭码。同样可重试——它是拥挤，不是拒绝
CLOSE_ANONYMOUS_QUOTA = 4029

# 到期前多久要求客户端换票。⚠ 不能等到 exp 那一刻才要：换票本身要一个往返，
# 卡点要就等于每次都断一下
REAUTH_LEAD_S = 60

# 匿名连接对外说得出口的主题名前缀。⚠ 它由票据派生，真主题一个字都不出门
PUBLIC_ALIAS_PREFIX = "public:"


def public_alias(ticket: str) -> str:
    """一枚票据对应的对外主题名。

    Args: ticket。
    """
    return f"{PUBLIC_ALIAS_PREFIX}{ticket}"


@dataclass(frozen=True)
class PublicAccess:
    """匿名连接这一档要的三样：授权表、名额、连接存活时长。"""

    grants: PublicGrantRegistry
    quota: AnonymousQuota
    ttl_s: int


@dataclass(frozen=True)
class SessionDeps:
    """会话逻辑的协作件。

    ⚠ 收成一个夹子而不是六个形参：这些参数的类型互不冲突，形参一多就会有人
    按位置传，而传错位置不会报错——它只会在某条路径上安静地用错协作件。
    """

    codec: JwtCodec
    codes: UserCodeSource
    registry: TopicRegistry
    connections: ConnectionRegistry
    journal: SubscriptionJournal
    public: PublicAccess


@dataclass(frozen=True)
class Handshake:
    """握手结果：这条连接是谁、持有哪些码、什么时候到期。

    匿名连接没有 `user_id`、没有码，只有一条 `grant`。
    """

    user_id: uuid.UUID | None
    codes: frozenset[str]
    expires_at: datetime
    grant: GrantedTopic | None = None


class SessionService:
    """WS 连接的会话逻辑。一条连接一份状态，状态存在注册表里。"""

    def __init__(self, deps: SessionDeps) -> None:
        """按协作件装配。构造不做 IO。

        Args: deps。
        """
        self._codec = deps.codec
        self._codes = deps.codes
        self._registry = deps.registry
        self._connections = deps.connections
        self._journal = deps.journal
        self._grants = deps.public.grants
        self._quota = deps.public.quota
        self._public_ttl_s = deps.public.ttl_s

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

    async def authenticate_public(self, ticket: str) -> Handshake:
        """验一枚公开票据，换来它唯一能订的那个主题。

        ⚠ 查的是本服务库里那张授权表，不回调业务服务：通道的握手路径挂在业务
        服务的可用性上，就等于业务服务一抖动全站长连接一起握不上（ADR-0007）。

        ⚠ 查不到一律拒绝，且与「票据本来就不存在」用同一个拒绝——分开回会让
        持旧链接的人试出「这张屏确实存在过」（ADR-0014 §三）。

        Args: ticket。
        """
        topic = await self._grants.resolve(ticket)
        if topic is None:
            raise PublicGrantRejected("公开链接无效或已被撤回")
        return Handshake(
            user_id=None,
            codes=frozenset(),
            # ⚠ 匿名连接也有到期：到点由复核任务关掉，客户端重连时重新验票。
            # 不给到期的话，一条已经连上的连接会一直活到进程重启为止
            expires_at=utcnow() + timedelta(seconds=self._public_ttl_s),
            grant=GrantedTopic(
                ticket_hash=ticket_fingerprint(ticket),
                alias=public_alias(ticket),
                topic=topic,
            ),
        )

    async def has_room(self, handshake: Handshake) -> bool:
        """这次握手还有没有名额。登录态恒为真——名额只约束匿名连接。

        Args: handshake。
        """
        return await self._connections.has_room(handshake.grant, self._quota)

    async def open(self, handshake: Handshake, *, send: SendFn) -> Connection:
        """登记一条已鉴权的连接。

        ⚠ 匿名连接要过名额：一枚泄露的票据能开的连接数必须有上限，否则公开
        链接就是一条谁都能用的连接池耗尽通道（ADR-0021）。

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
            grant=handshake.grant,
        )
        is_added = await self._connections.add(connection, quota=self._quota)
        if not is_added:
            raise AnonymousQuotaExceeded("公开链接的并发连接数已达上限")
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
            await self._subscribe(connection, topic)
            return
        if action == ACTION_UNSUBSCRIBE:
            await self._unsubscribe(connection, topic)
            return
        raise BadRequest(f"不认识的动作：{action!r}")

    async def _subscribe(self, connection: Connection, topic: str) -> None:
        """订一个主题。匿名连接只认自己那个别名。

        Args: connection, topic。
        """
        grant = connection.grant
        if grant is None:
            await self._registry.authorize(topic=topic, codes=connection.codes)
            await self._bind(connection, topic, alias=None)
            return
        # ⚠ 逐字比对别名而不是「以 public: 开头就放行」：放行的话，一枚票据
        # 能拿别人的票据名去订，别名这层就成了摆设
        if topic != grant.alias:
            raise SubscriptionDenied("公开链接只能订它自己那一个主题")
        await self._bind(connection, grant.topic, alias=grant.alias)

    async def _bind(
        self, connection: Connection, topic: str, *, alias: str | None
    ) -> None:
        """挂上订阅并记账。

        Args: connection, topic, alias。
        """
        await self._connections.bind(connection.id, topic, alias=alias)
        await self._journal.record(
            connection_id=connection.id,
            user_id=connection.user_id,
            topic=topic,
        )

    async def _unsubscribe(self, connection: Connection, topic: str) -> None:
        """退订一个主题。匿名连接说的是别名，落到真主题上。

        Args: connection, topic。
        """
        grant = connection.grant
        actual = (
            grant.topic if grant is not None and topic == grant.alias else topic
        )
        await self._connections.unbind(connection.id, actual)
        await self._journal.forget(connection_id=connection.id, topic=actual)

    async def _reauth(self, connection: Connection, token: object) -> None:
        """换一枚新令牌，刷新权限与到期时刻。

        ⚠ 换票后要**立刻按新权限重判已订阅的主题**：降权的用户不该靠着一条
        老连接继续收数据。不满足的只退订那个主题，不断整条连接。

        Args: connection, token。
        """
        if not isinstance(token, str) or not token:
            raise BadRequest("reauth 缺少 token")
        if connection.grant is not None:
            await self._reauth_public(connection, token)
            return
        handshake = await self.authenticate(token)
        if handshake.user_id != connection.user_id:
            # ⚠ 不许换成别人的票：那等于在一条已建立的连接上换了主体，
            # 而订阅关系还挂在原来那个人身上
            raise AuthenticationRejected("reauth 的令牌不属于本连接的用户")
        connection.codes = handshake.codes
        connection.expires_at = handshake.expires_at
        connection.checked_at = utcnow()
        await self.revoke_unauthorized(connection)

    async def _reauth_public(self, connection: Connection, ticket: str) -> None:
        """匿名连接续期：重新验票，票还在就把到期往后推。

        ⚠ 只认同一枚票据：换成另一枚等于在一条已建立的连接上换了授权，而它
        已经挂在原来那个主题上了。要换票就重连——重连一次的代价是一个往返。

        Args: connection, ticket。
        """
        grant = connection.grant
        if grant is None or ticket_fingerprint(ticket) != grant.ticket_hash:
            raise AuthenticationRejected("reauth 的票据不属于本连接")
        handshake = await self.authenticate_public(ticket)
        connection.expires_at = handshake.expires_at
        connection.checked_at = utcnow()

    async def revoke_unauthorized(self, connection: Connection) -> int:
        """按当前权限重判该连接的全部订阅，退掉不再满足的，返回退了几个。

        ⚠ 匿名连接不走这里：它一个权限码都没有，按码重判会把它自己那条唯一
        的订阅退掉。它的复核由授权复核任务负责（`services/sweeper.py`）。

        Args: connection。
        """
        if connection.grant is not None:
            return 0
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


def needs_reauth(connection: Connection, *, now: datetime) -> bool:
    """是否该催客户端换票了。

    Args: connection, now。
    """
    return now >= connection.expires_at - timedelta(seconds=REAUTH_LEAD_S)


def is_expired(connection: Connection, *, now: datetime) -> bool:
    """凭据是否已经过期——过期即关连接（4001）。

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


class PublicGrantRejected(AppError):
    """公开票据没有（或已不再有）任何授权。

    ⚠ 与「令牌不可用」分开：它对应的关闭码是可重试的那一档。撤回与「推送方
    还没对账到这枚新票据」在这里长得一样，而后者只要等一轮对账就好——把两者
    合成「别再连了」，新发布的链接会在几秒的窗口里被客户端判成永久失败。
    """

    code = 42008
    http_status = 403


class AnonymousQuotaExceeded(AppError):
    """这枚票据（或本副本）的匿名连接数已达上限。"""

    code = 42009
    http_status = 429


def _as_uuid(raw: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except ValueError as error:
        raise AuthenticationRejected("令牌主体不是合法标识") from error
