"""边缘注入的签名身份头 → 调用者身份。

⚠ 这几个头由边缘网关在调过认证服务之后注入，而客户端可以伪造同名头，因此
**必须验签**：签名覆盖「主体 + 角色 + 权限集 + 过期时刻」的拼接，改任一项签名
即失效。任何一步不过一律判不可信（fail-closed），不做部分信任——「解不出权限
就当空集放行」正是这类实现最常见的破法。
"""

import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime

from lib.auth.context import CallerContext
from lib.auth.header_codec import (
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

# 判不可信的原因，稳定字面量。调用方据它决定给用户看哪句话——五种情况的处置
# 完全不同（重登录 / 走网关 / 联系管理员），合成一句话等于让现场自己猜
REASON_TRUNCATED = "permissions_truncated"
REASON_MISSING = "missing_headers"
REASON_BAD_EXPIRY = "expiry_not_an_integer"
REASON_BAD_SIGNATURE = "signature_mismatch"
REASON_BAD_SUBJECT = "subject_not_a_uuid"


@dataclass(frozen=True)
class IdentityOutcome:
    """一次解身份的结论。`caller` 为 None 时 `reason` 说明卡在哪一步。"""

    caller: CallerContext | None
    reason: str


def decode_caller(
    headers: Mapping[str, str], *, signing_secret: str, now: datetime
) -> IdentityOutcome:
    """验签并解出调用者。不可信一律给出 caller=None 与一条原因。

    Args: headers（大小写不敏感的请求头映射）, signing_secret, now。
    """
    # ⚠ 权限集超长时边缘只发降级标记，签名覆盖的却是完整权限串，此时无法验签。
    # 正解是回查认证服务的权限端点；在那之前一律判不可信
    if headers.get(HEADER_TRUNCATED):
        return IdentityOutcome(None, REASON_TRUNCATED)
    expires_at = _as_int(headers.get(HEADER_EXPIRES))
    user_id = headers.get(HEADER_USER_ID)
    if not user_id or not headers.get(HEADER_SIGNATURE):
        return IdentityOutcome(None, REASON_MISSING)
    if expires_at is None:
        return IdentityOutcome(None, REASON_BAD_EXPIRY)
    signed = _signed_context(headers, user_id, expires_at)
    if not verify_context(
        signing_secret,
        signed,
        signature=headers.get(HEADER_SIGNATURE, ""),
        now=int(now.timestamp()),
    ):
        return IdentityOutcome(None, REASON_BAD_SIGNATURE)
    subject = _as_uuid(signed.user_id)
    if subject is None:
        return IdentityOutcome(None, REASON_BAD_SUBJECT)
    return IdentityOutcome(_caller(headers, signed, subject), "")


def _signed_context(
    headers: Mapping[str, str], user_id: str, expires_at: int
) -> SignedContext:
    """按边缘下发的原样取被签名的四个字段。

    ⚠ 取的必须是头里的**原始字符串**：把主体解析成 UUID 再转回字符串会做一次
    归一化，与签名时的输入不再逐字相同，验签会莫名其妙地失败。
    Args: headers, user_id, expires_at。
    """
    return SignedContext(
        user_id=user_id,
        role=headers.get(HEADER_ROLE, ""),
        permissions_b64=headers.get(HEADER_PERMISSIONS, ""),
        expires_at=expires_at,
    )


def _caller(
    headers: Mapping[str, str], signed: SignedContext, subject: uuid.UUID
) -> CallerContext:
    return CallerContext(
        user_id=subject,
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
