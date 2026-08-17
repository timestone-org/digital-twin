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


class _UserData(BaseModel):
    """信封里的 data 段，只取这一条连接判权要用的那个字段。

    ⚠ `permissions` 是**合并后**的有效码（角色 + 直授），不是 role_permissions：
    只看角色那一份会漏掉直接授给某个人的码。
    """

    permissions: list[str]


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

    async def codes_of(self, user_id: uuid.UUID) -> frozenset[str]:
        """取一个用户此刻的有效权限码。

        ⚠ 不缓存：这条调用挂在握手与换票上，都是低频动作，而缓存会让「刚
        改完权限还不生效」变成一个要等 TTL 的谜题。
        ⚠ 超时必须有且必须短：它挂在握手的同步路径上，拖住它等于让页面一直
        转圈（runtime-resilience.md 的下游之和 < 上游）。
        ⚠ 重试**这一层不做**：一条链路只有一层负责重试，重试归客户端重连。

        Args: user_id。
        """
        try:
            async with httpx.AsyncClient(
                base_url=self._base_url,
                timeout=self._timeout_s,
                transport=self._transport,
            ) as client:
                response = await client.get(
                    USER_CODES_PATH.format(user_id=user_id),
                    headers={"X-Service-Key": self._service_key},
                )
                response.raise_for_status()
                envelope = _UserEnvelope.model_validate(response.json())
                return frozenset(envelope.data.permissions)
        except (httpx.HTTPError, ValidationError, ValueError) as error:
            # ⚠ 不记异常里的响应体：它可能带着别的服务的内部信息
            _logger.error(
                "user_codes_unreachable",
                "取用户权限码失败，握手将被拒绝",
                base_url=self._base_url,
                error_type=type(error).__name__,
            )
            raise UserCodesUnavailable("无法确认权限，请稍后重连") from error
