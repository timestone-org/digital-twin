"""代表用户去打 platform 时要转发的那几个签名头。

⚠ **原样逐字转发**。签名覆盖的是 `user_id|role|permissions_b64|expires_at` 的
拼接，不含 path 也不含目标服务，所以转过去就验得过；而 platform 按**用户自己
的**权限码判定——知识库因此不是绕过权限的通道，它读不到用户本来读不到的东西。

⚠ 解析成 UUID 再转回会归一化，验签当场失败。别碰它们，原样带走。
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
