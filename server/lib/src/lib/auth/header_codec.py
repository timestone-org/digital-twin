"""签名头编解码：把身份与权限集从边缘安全地带给上游服务。

三条实现约束（下游服务会整文件复用同一套语义）：只依赖标准库、
全部为纯函数、任何非法输入都走 fail-closed 路径（返回空集 / False），
绝不把异常抛到鉴权链路上。

⚠ 空值不能靠「头缺失」表达：反向代理在变量为空时**整条头不发送**，
于是「权限为空集」与「上游没发头」在下游不可区分。base64url 把空集
编成恒非空的 `W10`。
⚠ HTTP 头按 latin-1 编码，用户名/角色名可能含中文——身份值必须
百分号编码后再下发。
"""

import base64
import hmac
import json
from collections.abc import Iterable
from hashlib import sha256
from typing import cast
from urllib.parse import quote, unquote

MAX_PERMISSION_HEADER_BYTES = 3072


def encode_permissions(codes: Iterable[str]) -> str:
    """权限集 → base64url(JSON 数组)，去掉 `=` 填充。

    Args: codes。
    """
    payload = json.dumps(
        sorted(set(codes)), ensure_ascii=False, separators=(",", ":")
    )
    raw = base64.urlsafe_b64encode(payload.encode("utf-8"))
    return raw.decode("ascii").rstrip("=")


def decode_permissions(raw: str | None) -> frozenset[str]:
    """base64url → 权限集。任何非法输入返回空集（fail-closed）。

    Args: raw。
    """
    if not raw:
        return frozenset()
    padded = raw + "=" * (-len(raw) % 4)
    try:
        decoded = base64.urlsafe_b64decode(padded.encode("ascii"))
        parsed: object = json.loads(decoded.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return frozenset()
    if not isinstance(parsed, list):
        return frozenset()
    items = cast(list[object], parsed)
    return frozenset(item for item in items if isinstance(item, str))


def encode_identity(value: str) -> str:
    """身份值 → 百分号编码。纯 ASCII 输入是恒等变换。

    Args: value。
    """
    return quote(value, safe="")


def decode_identity(raw: str | None) -> str:
    """百分号编码 → 原值。非法输入返回空串。

    Args: raw。
    """
    if not raw:
        return ""
    try:
        return unquote(raw, errors="strict")
    except UnicodeDecodeError:
        return ""


def sign_context(
    secret: str,
    *,
    user_id: str,
    role: str,
    permissions_b64: str,
    expires_at: int,
) -> str:
    """对身份+权限+过期时刻算 HMAC-SHA256，十六进制。

    Args: secret, user_id, role（**编码后的值**）, permissions_b64,
        expires_at（Unix 秒）。
    """
    message = f"{user_id}|{role}|{permissions_b64}|{expires_at}"
    return hmac.new(
        secret.encode("utf-8"), message.encode("utf-8"), sha256
    ).hexdigest()


def verify_context(
    secret: str,
    *,
    user_id: str,
    role: str,
    permissions_b64: str,
    expires_at: int,
    signature: str,
    now: int,
) -> bool:
    """验签并检查是否过期。密钥为空、签名不符或已过期一律 False。

    Args: secret, user_id, role, permissions_b64, expires_at, signature, now。
    """
    if not secret or not signature:
        return False
    if expires_at <= now:
        return False
    expected = sign_context(
        secret,
        user_id=user_id,
        role=role,
        permissions_b64=permissions_b64,
        expires_at=expires_at,
    )
    return hmac.compare_digest(expected, signature)
