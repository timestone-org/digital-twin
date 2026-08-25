"""把边缘注入的身份头原样收起来，以便代表用户去调 platform。

⚠ **必须逐字原样转发**。签名覆盖的是 `user_id|role|permissions_b64|expires_at`
的拼接，把主体解析成 UUID 再转回字符串会做一次归一化，与签名时的输入不再逐字
相同——验签会莫名其妙地失败，而两端的代码单看都对
（lib/auth/edge_headers.py 的文件头记着这一条）。

⚠ 签名里**没有 path、没有 method、没有目标服务**，所以这组头原样转给 platform
就能过它那一侧的验签，且 platform 按**用户自己的**权限码判定。助手因此不是绕过
权限的通道：它读不到用户本来读不到的东西。

⚠ `X-Auth-Exp` 会过期。一次回合里的调用都在同一个请求周期内，够用；将来若有
后台任务重放这组头，会拿到 401——那时的正解是回查权限而不是延长过期时间。
"""

from collections.abc import Mapping

from lib.auth.edge_headers import (
    HEADER_EXPIRES,
    HEADER_PERMISSIONS,
    HEADER_ROLE,
    HEADER_SIGNATURE,
    HEADER_TRUNCATED,
    HEADER_USER_ID,
    HEADER_USERNAME,
)

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
