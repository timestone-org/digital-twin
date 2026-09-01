"""把边缘注入的身份头原样收起来，以便代表用户去调 platform。

⚠ **必须逐字原样转发**。签名覆盖的是 `user_id|role|permissions_b64|expires_at`
的拼接，把主体解析成 UUID 再转回字符串会做一次归一化，与签名时的输入不再逐字
相同——验签会莫名其妙地失败，而两端的代码单看都对
（lib/auth/edge_headers.py 的文件头记着这一条）。

⚠ 签名里**没有 path、没有 method、没有目标服务**，所以这组头原样转给 platform
就能过它那一侧的验签，且 platform 按**用户自己的**权限码判定。助手因此不是绕过
权限的通道：它读不到用户本来读不到的东西。

⚠ `X-Auth-Exp` 只有几十秒，而一个回合能跑上几分钟——「同一个请求周期内够用」
这个假设不成立：模型想一次就可能吃掉整份预算，之后每一次工具调用都撞 401，
现象是「points.search 没跑成」而原因在身份头上。故这组头由 `DelegatedIdentity`
在快到期时**回查权限**换一份新的，见下。
⚠ 换新的而不是延长过期时间：延长会把全站的吊销窗口一起放大，而回查让「刚被
停用的账号」与「刚被收回的权限码」在下一次调用就生效。
"""

import asyncio
from collections.abc import Mapping

from ai_assistant.upstream.auth import AuthClient
from lib.auth.edge_headers import (
    HEADER_EXPIRES,
    HEADER_PERMISSIONS,
    HEADER_ROLE,
    HEADER_SIGNATURE,
    HEADER_TRUNCATED,
    HEADER_USER_ID,
    HEADER_USERNAME,
)
from lib.utils.timeutils import utcnow

# 要转发的那几个。⚠ 少一个就是验签失败，多转无关头没有意义
FORWARDED = (
    HEADER_USER_ID,
    HEADER_USERNAME,
    HEADER_ROLE,
    HEADER_PERMISSIONS,
    HEADER_TRUNCATED,
    HEADER_EXPIRES,
    HEADER_SIGNATURE,
)


def caller_headers(given: Mapping[str, str]) -> dict[str, str]:
    """从入站请求头里挑出要转发的那几个，原样带走。

    ⚠ 缺失的头**不补空串**：补了的话下游收到一组「齐全但内容为空」的头，
    验签失败的原因会从「少了一个头」变成「签名不符」，而后者听起来像被篡改。

    Args: given。
    """
    return {
        name: given[name]
        for name in FORWARDED
        if given.get(name) not in (None, "")
    }


# 还剩这么多秒就去换一份新的。⚠ 必须大于一次 platform 调用的超时：卡在
# 「签的时候还没过期、到达时已经过期」那道缝里的话，失败是零星的、复现不了的
RENEW_WHEN_LEFT_S = 15


class DelegatedIdentity:
    """代表用户说话的那组头，快到期时自动换一份新的。

    ⚠ 缓存按 user_id 分格。合成一格的话，两个用户的调用会互相借用对方的身份。
    """

    def __init__(
        self, auth: AuthClient, *, renew_when_left_s: int = RENEW_WHEN_LEFT_S
    ) -> None:
        """按续签客户端与提前量初始化。

        Args: auth, renew_when_left_s。
        """
        self._auth = auth
        self._renew_when_left_s = renew_when_left_s
        self._minted: dict[str, dict[str, str]] = {}
        # ⚠ 一把锁就够，而且必须有：一批点位是并发解析的，没有锁的话同一个
        # 用户会在同一瞬间去签好几份
        self._lock = asyncio.Lock()

    async def fresh(self, headers: dict[str, str]) -> dict[str, str]:
        """交出一组还没到期的身份头。

        ⚠ 认不出人时**原样交回**，不去签：那时正确的结局是下游按「少了头」
        拒掉，而不是助手替一个说不清是谁的调用方签出一份身份。

        Args: headers（入站时收下的那一组）。
        """
        user_id = headers.get(HEADER_USER_ID)
        if not user_id or self._is_alive(headers):
            return headers
        async with self._lock:
            cached = self._minted.get(user_id)
            if cached is not None and self._is_alive(cached):
                return cached
            minted = await self._auth.reissue_headers(user_id)
            self._forget_expired()
            self._minted[user_id] = minted
            return minted

    def _is_alive(self, headers: Mapping[str, str]) -> bool:
        left = _expires_at(headers)
        if left is None:
            return False
        return left - int(utcnow().timestamp()) > self._renew_when_left_s

    def _forget_expired(self) -> None:
        """扔掉已经过期的那几格，免得缓存随用过的账号数一直长。"""
        now = int(utcnow().timestamp())
        self._minted = {
            user_id: headers
            for user_id, headers in self._minted.items()
            if (_expires_at(headers) or 0) > now
        }


def _expires_at(headers: Mapping[str, str]) -> int | None:
    """读 `X-Auth-Exp`；缺失或不是整数一律给 None（当作已过期）。

    Args: headers。
    """
    raw = headers.get(HEADER_EXPIRES)
    if raw is None:
        return None
    try:
        return int(raw)
    except ValueError:
        return None
