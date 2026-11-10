"""某个用户此刻持有的权限码，向 auth-server 取。

⚠ 权限码**不在访问令牌里**：auth-server 签的 token 只带主体与到期，权限由
它在 `/verify` 那一步现查、以签名头下发给边缘。而 WS 的 token 走子协议、
根本不经边缘的 `auth_request`（CONTEXT.md §6），所以这条链路必须自己回查。
把码塞进 token 是另一条路，但那样降权要等到票过期才生效，与 §6「按 TTL
重新取用户的权限码」的口径相反。

⚠ 取不到时**拒绝握手**（fail-closed），不是按空码放行：空码在授权那一步长
得跟「你没权限」一模一样，客户端会据此不再重连。
"""

import uuid

import httpx
from pydantic import BaseModel, ValidationError

from lib.logging import get_logger
from realtime_hub.apps.channel.errors import UserCodesUnavailable

_logger = get_logger("realtime.usercodes")

# auth-server 的内部端点。⚠ 服务级密钥走 X-Service-Key，与权限码目录用的是
# 同一枚——集群内的服务级密钥全系统一份。
USER_CODES_PATH = "/internal/v1/users/{user_id}/permissions"
# 「用户确实不存在」的标记头与取值，与 auth-server 的 HEADER_USER_LOOKUP 逐字
# 一致。⚠ 服务之间不许互相 import，故抄一份；裸 404 不算这件事
HEADER_USER_LOOKUP = "X-Auth-User-Lookup"
USER_LOOKUP_MISS = "miss"
# 用户不存在
HTTP_NOT_FOUND = 404


class AccountUnusable(Exception):
    """auth-server 明确答复：令牌对应的账号已删除或已停用。

    ⚠ 与 `UserCodesUnavailable` 分开：那是「查不到、过会儿再来」，这是「查到了、
    不许连」。合成一个的话，停用的账号会被当成依赖抖动，客户端永远退避重连。
    """


class _UserData(BaseModel):
    """信封里的 data 段，只取这一条连接判权要用的那个字段。

    ⚠ `permissions` 是**合并后**的有效码（角色 + 直授），不是 role_permissions：
    只看角色那一份会漏掉直接授给某个人的码。
    ⚠ `is_active` 必填：缺了要响亮失败（fail-closed），不许默认成「在用」。
    """

    permissions: list[str]
    is_active: bool


class _UserEnvelope(BaseModel):
    """auth-server 的统一信封，本地只取 data。

    ⚠ 用模型收口而不是逐层下标：信封变形时要在这里响亮失败，而不是让一个
    空集合流下去——空集合会让这个用户的**所有**订阅都被判成没权限。
    """

    data: _UserData


class UserCodeSource:
    """auth-server 用户权限的客户端。"""

    def __init__(
        self, *, base_url: str, service_key: str, timeout_s: float
    ) -> None:
        """按 auth-server 的地址与服务级密钥初始化，构造时不做 IO。

        Args: base_url, service_key, timeout_s。
        """
        self._base_url = base_url.rstrip("/")
        self._service_key = service_key
        self._timeout_s = timeout_s
        # 传输层留成可替换的：用例要验的是解析与失败处置，不是 httpx 本身。
        # ⚠ 生产路径上它恒为 None，走 httpx 自己的默认传输。
        self._transport: httpx.AsyncBaseTransport | None = None
        self._http: httpx.AsyncClient | None = None

    async def codes_of(self, user_id: uuid.UUID) -> frozenset[str]:
        """取一个用户此刻的有效权限码。

        ⚠ 不缓存：这条调用挂在握手与换票上，都是低频动作，而缓存会让「刚
        改完权限还不生效」变成一个要等 TTL 的谜题。
        ⚠ 超时必须有且必须短：它挂在握手的同步路径上，拖住它等于让页面一直
        转圈（runtime-resilience.md 的下游之和 < 上游）。
        ⚠ 重试**这一层不做**：一条链路只有一层负责重试，重试归客户端重连。
        账号已删除或已停用时抛 `AccountUnusable`。

        Args: user_id。
        """
        user = await self._fetch(user_id)
        if user is None:
            _logger.warning(
                "user_codes_account_missing",
                "令牌对应的账号已不存在，握手将被拒绝",
                user_id=str(user_id),
            )
            raise AccountUnusable("令牌对应的账号不存在")
        if not user.is_active:
            _logger.warning(
                "user_codes_account_disabled",
                "令牌对应的账号已停用，握手将被拒绝",
                user_id=str(user_id),
            )
            raise AccountUnusable("账号已停用")
        return frozenset(user.permissions)

    async def _fetch(self, user_id: uuid.UUID) -> _UserData | None:
        """回查一个用户；auth-server 明确说「没有这个人」时返回 None。

        ⚠ 其余任何坏答案（含不带标记头的 404）都按不可达处理，fail-closed。

        Args: user_id。
        """
        try:
            client = self._client()
            response = await client.get(
                USER_CODES_PATH.format(user_id=user_id),
                headers={"X-Service-Key": self._service_key},
            )
            if (
                response.status_code == HTTP_NOT_FOUND
                and response.headers.get(HEADER_USER_LOOKUP) == USER_LOOKUP_MISS
            ):
                return None
            response.raise_for_status()
            return _UserEnvelope.model_validate(response.json()).data
        except (httpx.HTTPError, ValidationError, ValueError) as error:
            # ⚠ 不记异常里的响应体：它可能带着别的服务的内部信息
            _logger.error(
                "user_codes_unreachable",
                "取用户权限码失败，握手将被拒绝",
                base_url=self._base_url,
                error_type=type(error).__name__,
            )
            raise UserCodesUnavailable("无法确认权限，请稍后重连") from error

    def _client(self) -> httpx.AsyncClient:
        """取那份长活的客户端；第一次要用时才建。

        ⚠ **一个进程一份，不是一次调用一份**：`httpx.AsyncClient` 自带连接池，
        每次调用现造一个再关掉，等于每次调用都重新握一次 TCP 手——而本客户端
        挂在**每一次 WS 握手与每一次换票**上，一面大屏墙重连就是一串握手。
        ⚠ 懒建而不是在 `__init__` 里建：装配跑在事件循环之外，而且传输层是
        构造之后才被替换的（用例注入假件那一步）。
        """
        if self._http is None:
            self._http = httpx.AsyncClient(
                base_url=self._base_url,
                timeout=self._timeout_s,
                transport=self._transport,
            )
        return self._http

    async def close(self) -> None:
        """关掉连接池。关停钩子里调，关完再用会现建一份新的。"""
        http, self._http = self._http, None
        if http is not None:
            await http.aclose()
