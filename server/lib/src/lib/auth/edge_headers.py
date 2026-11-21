"""从边缘签名头核验权限与操作者。旧格式用已核验的 UUID 表示账号。"""

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
    verify_named_context,
)

HEADER_USER_ID = "X-Auth-User-Id"
HEADER_USERNAME = "X-Auth-Username"
HEADER_ROLE = "X-Auth-Role"
HEADER_PERMISSIONS = "X-Auth-Permissions"
HEADER_TRUNCATED = "X-Auth-Permissions-Truncated"
HEADER_EXPIRES = "X-Auth-Exp"
HEADER_SIGNATURE = "X-Auth-Sig"
HEADER_NAMED_SIGNATURE = "X-Auth-Sig-V2"

IDENTITY_HEADERS = (
    HEADER_USER_ID,
    HEADER_USERNAME,
    HEADER_ROLE,
    HEADER_PERMISSIONS,
    HEADER_TRUNCATED,
    HEADER_EXPIRES,
    HEADER_SIGNATURE,
    HEADER_NAMED_SIGNATURE,
)

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
    return _verified_caller(headers, signed, signing_secret)


def _verified_caller(
    headers: Mapping[str, str], signed: SignedContext, secret: str
) -> IdentityOutcome:
    """从已验证的基础声明解出操作者。Args: headers, signed, secret。"""
    subject = _as_uuid(signed.user_id)
    if subject is None:
        return IdentityOutcome(None, REASON_BAD_SUBJECT)
    username = _account_name(headers, signed, secret, subject)
    if username is None:
        return IdentityOutcome(None, REASON_BAD_SIGNATURE)
    return IdentityOutcome(
        CallerContext(
            user_id=subject,
            username=username,
            role=decode_identity(signed.role),
            permissions=decode_permissions(signed.permissions_b64),
        ),
        "",
    )


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


def _account_name(
    headers: Mapping[str, str],
    signed: SignedContext,
    secret: str,
    subject: uuid.UUID,
) -> str | None:
    """核验名字或使用已认证的账号 UUID。

    Args: headers, signed, secret, subject。
    """
    signature = headers.get(HEADER_NAMED_SIGNATURE)
    if signature is None:
        return str(subject)
    encoded = headers.get(HEADER_USERNAME, "")
    if not verify_named_context(secret, signed, encoded, signature):
        return None
    return decode_identity(encoded) or None


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
