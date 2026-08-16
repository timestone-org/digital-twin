"""身份头验签的口径：伪造、篡改、过期、降级标记一律不可信。

⚠ 这是消费方唯一的认证入口。它放宽一点点，绕过边缘直连的那个端口就是一个
无需口令的超管接口——闸 1 在边缘，绕过边缘时只剩这一层。
"""

import uuid

from lib.auth import (
    SignedContext,
    encode_identity,
    encode_permissions,
    sign_context,
)
from lib.auth.edge_headers import (
    REASON_BAD_EXPIRY,
    REASON_BAD_SIGNATURE,
    REASON_BAD_SUBJECT,
    REASON_MISSING,
    REASON_TRUNCATED,
    decode_caller,
)
from lib.utils.timeutils import utcnow

SECRET = "unit-test-edge-signing-secret-0123456789"
OTHER_SECRET = "unit-test-another-secret-0123456789abc"
CODES = ("ac:view", "ac:manage")


def build_headers(
    *,
    codes: tuple[str, ...] = CODES,
    secret: str = SECRET,
    lifetime_s: int = 60,
    role: str = "管理员",
) -> dict[str, str]:
    """造一组签名身份头。默认是一组完全合法的头。

    Args: codes, secret, lifetime_s, role。
    """
    user_id = str(uuid.uuid4())
    encoded_role = encode_identity(role)
    permissions = encode_permissions(codes)
    expires_at = int(utcnow().timestamp()) + lifetime_s
    context = SignedContext(
        user_id=user_id,
        role=encoded_role,
        permissions_b64=permissions,
        expires_at=expires_at,
    )
    return {
        "X-Auth-User-Id": user_id,
        "X-Auth-Username": encode_identity("测试员"),
        "X-Auth-Role": encoded_role,
        "X-Auth-Permissions": permissions,
        "X-Auth-Exp": str(expires_at),
        "X-Auth-Sig": sign_context(secret, context),
    }


def caller_of(headers: dict[str, str]) -> object:
    """解出调用者；不可信时是 None。

    Args: headers。
    """
    return decode_caller(headers, signing_secret=SECRET, now=utcnow()).caller


def test_valid_headers_yield_the_signed_identity() -> None:
    headers = build_headers()
    caller = caller_of(headers)
    assert caller is not None
    assert str(caller.user_id) == headers["X-Auth-User-Id"]
    assert caller.role == "管理员"
    assert caller.username == "测试员"
    assert caller.permissions == frozenset(CODES)


def test_headers_without_any_signature_are_untrusted() -> None:
    # 客户端可以随手伪造这几个头，没有签名就一律不可信
    forged = {
        "X-Auth-User-Id": str(uuid.uuid4()),
        "X-Auth-Role": "admin",
        "X-Auth-Permissions": encode_permissions(CODES),
        "X-Auth-Exp": str(int(utcnow().timestamp()) + 60),
    }
    assert caller_of(forged) is None


def test_permissions_tampered_after_signing_are_untrusted() -> None:
    headers = build_headers(codes=("ac:view",))
    headers["X-Auth-Permissions"] = encode_permissions(CODES)
    assert caller_of(headers) is None


def test_signature_from_another_secret_is_untrusted() -> None:
    assert caller_of(build_headers(secret=OTHER_SECRET)) is None


def test_expired_headers_are_untrusted() -> None:
    assert caller_of(build_headers(lifetime_s=-1)) is None


def test_truncation_marker_is_untrusted() -> None:
    # 权限串被降级成标记时签名覆盖的是完整串，无法验签，只能判不可信
    headers = build_headers()
    headers.pop("X-Auth-Permissions")
    headers["X-Auth-Permissions-Truncated"] = "1"
    assert caller_of(headers) is None


def test_missing_expiry_is_untrusted() -> None:
    headers = build_headers()
    del headers["X-Auth-Exp"]
    assert caller_of(headers) is None


def test_non_numeric_expiry_is_untrusted() -> None:
    headers = build_headers()
    headers["X-Auth-Exp"] = "很快"
    assert caller_of(headers) is None


def test_user_id_that_is_not_a_uuid_is_untrusted() -> None:
    # 签名对得上但主体不是合法标识：签发方出了问题，同样不放行
    user_id = "not-a-uuid"
    permissions = encode_permissions(CODES)
    expires_at = int(utcnow().timestamp()) + 60
    context = SignedContext(
        user_id=user_id,
        role="admin",
        permissions_b64=permissions,
        expires_at=expires_at,
    )
    headers = {
        "X-Auth-User-Id": user_id,
        "X-Auth-Role": "admin",
        "X-Auth-Permissions": permissions,
        "X-Auth-Exp": str(expires_at),
        "X-Auth-Sig": sign_context(SECRET, context),
    }
    assert caller_of(headers) is None


def test_empty_permission_set_stays_empty_rather_than_falling_back() -> None:
    # ⚠ 「解不出权限就当空集」与「本来就是空集」必须走到同一个结果：不放行任何
    # 需要权限码的端点。这里锁的是后者不会被静默补成全权。
    caller = caller_of(build_headers(codes=()))
    assert caller is not None
    assert caller.permissions == frozenset()


def reason_of(headers: dict[str, str]) -> str:
    """不可信时卡在哪一步。

    Args: headers。
    """
    return decode_caller(headers, signing_secret=SECRET, now=utcnow()).reason


def test_a_trusted_caller_carries_no_reason() -> None:
    assert reason_of(build_headers()) == ""


def test_every_rejection_says_which_step_it_stopped_at() -> None:
    """⚠ 五种情况的处置完全不同（重登录 / 走网关 / 联系管理员）。

    合成一句「身份无效」等于让现场自己猜是哪一种。
    """
    truncated = build_headers()
    truncated["X-Auth-Permissions-Truncated"] = "1"
    missing = build_headers()
    del missing["X-Auth-Sig"]
    bad_expiry = build_headers()
    bad_expiry["X-Auth-Exp"] = "很快"
    assert reason_of(truncated) == REASON_TRUNCATED
    assert reason_of(missing) == REASON_MISSING
    assert reason_of(bad_expiry) == REASON_BAD_EXPIRY
    assert reason_of(build_headers(secret=OTHER_SECRET)) == (
        REASON_BAD_SIGNATURE
    )


def test_a_signed_but_malformed_subject_says_so() -> None:
    user_id = "not-a-uuid"
    permissions = encode_permissions(CODES)
    expires_at = int(utcnow().timestamp()) + 60
    context = SignedContext(
        user_id=user_id,
        role="admin",
        permissions_b64=permissions,
        expires_at=expires_at,
    )
    headers = {
        "X-Auth-User-Id": user_id,
        "X-Auth-Role": "admin",
        "X-Auth-Permissions": permissions,
        "X-Auth-Exp": str(expires_at),
        "X-Auth-Sig": sign_context(SECRET, context),
    }
    assert reason_of(headers) == REASON_BAD_SUBJECT
