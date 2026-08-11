"""边缘注入的身份头 → 调用者身份。

⚠ 这几个头由 edge-gateway 在调过 auth-server 的 `/verify` 之后注入，而客户端
可以伪造同名头，因此**必须验签**：签名覆盖「用户 id + 角色 + 权限集 + 过期
时刻」的拼接，改任一项签名即失效。任何一步不过一律返回 None（fail-closed），
不做部分信任——「解不出权限就当空集放行」正是这类实现最常见的破法。
"""

import uuid
from collections.abc import Mapping
from datetime import datetime

from lib.auth import (
    CallerContext,
    SignedContext,
    decode_identity,
    decode_permissions,
    verify_context,
)

HEADER_USER_ID = "X-Auth-User-Id"
HEADER_USERNAME = "X-Auth-Username"
HEADER_ROLE = "X-Auth-Role"
HEADER_PERMISSIONS = "X-Auth-Permissions"
HEADER_TRUNCATED = "X-Auth-Permissions-Truncated"
HEADER_EXPIRES = "X-Auth-Exp"
HEADER_SIGNATURE = "X-Auth-Sig"


def caller_from_headers(
    headers: Mapping[str, str],
    *,
    signing_secret: str,
    now: datetime,
) -> CallerContext | None:
    """验签并解出调用者。不可信一律 None。

    Args: headers（大小写不敏感的请求头映射）, signing_secret, now。
    """
    # ⚠ 权限集超长时边缘只发降级标记，签名覆盖的却是完整权限串，此时无法验签。
    # 正解是回查 auth-server 的 /internal 权限端点；在那之前一律判不可信。
    if headers.get(HEADER_TRUNCATED):
        return None
    signed = _signed_context(headers)
    if signed is None:
        return None
    if not verify_context(
        signing_secret,
        signed,
        signature=headers.get(HEADER_SIGNATURE, ""),
        now=int(now.timestamp()),
    ):
        return None
    return _caller(headers, signed)


def _signed_context(headers: Mapping[str, str]) -> SignedContext | None:
    """按边缘下发的原样取被签名的四个字段。

    ⚠ 取的必须是头里的**原始字符串**：把 user_id 解析成 UUID 再转回字符串会
    做一次归一化，与签名时的输入不再逐字相同，验签会莫名其妙地失败。
    Args: headers。
    """
    user_id = headers.get(HEADER_USER_ID, "")
    expires_at = _as_int(headers.get(HEADER_EXPIRES))
    if not user_id or expires_at is None:
        return None
    return SignedContext(
        user_id=user_id,
        role=headers.get(HEADER_ROLE, ""),
        permissions_b64=headers.get(HEADER_PERMISSIONS, ""),
        expires_at=expires_at,
    )


def _caller(
    headers: Mapping[str, str], signed: SignedContext
) -> CallerContext | None:
    user_id = _as_uuid(signed.user_id)
    if user_id is None:
        return None
    return CallerContext(
        user_id=user_id,
        username=decode_identity(headers.get(HEADER_USERNAME)),
        role=decode_identity(signed.role),
        permissions=decode_permissions(signed.permissions_b64),
    )


def _as_int(raw: str | None) -> int | None:
    if raw is None:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def _as_uuid(raw: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(raw)
    except ValueError:
        return None
