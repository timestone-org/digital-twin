"""闸 2 的三件依赖：身份、权限码、服务级密钥。

⚠ 这是绕过边缘直连端口时**唯一**还生效的一道。它放宽一点点，那个端口就是一个
无需口令的超管接口。
"""

import uuid

import pytest
from starlette.requests import Request

from lib.auth import (
    CallerContext,
    SignedContext,
    encode_permissions,
    sign_context,
)
from lib.errors import PermissionDenied, Unauthenticated
from lib.utils.timeutils import utcnow
from lib.web.authdeps import (
    MODE_ANY,
    REQUIRED_CODES_ATTR,
    REQUIRED_MODE_ATTR,
    build_auth_deps,
)

SECRET = "unit-test-edge-signing-secret-0123456789"
SERVICE_KEY = "unit-test-service-key-0123456789abcdef"
CODES = ("ac:view", "ac:manage")

AUTH = build_auth_deps(
    signing_secret_of=lambda _request: SECRET,
    service_key_of=lambda _request: SERVICE_KEY,
)


def request_of(headers: dict[str, str]) -> Request:
    """一条只带请求头的最小请求。

    Args: headers。
    """
    raw = [
        (name.lower().encode("ascii"), value.encode("utf-8"))
        for name, value in headers.items()
    ]
    return Request({"type": "http", "method": "GET", "headers": raw})


def signed_headers(codes: tuple[str, ...] = CODES) -> dict[str, str]:
    """一组完全合法的签名身份头。

    Args: codes。
    """
    user_id = str(uuid.uuid4())
    permissions = encode_permissions(codes)
    expires_at = int(utcnow().timestamp()) + 60
    context = SignedContext(
        user_id=user_id,
        role="admin",
        permissions_b64=permissions,
        expires_at=expires_at,
    )
    return {
        "X-Auth-User-Id": user_id,
        "X-Auth-Role": "admin",
        "X-Auth-Permissions": permissions,
        "X-Auth-Exp": str(expires_at),
        "X-Auth-Sig": sign_context(SECRET, context),
    }


async def caller_of(codes: tuple[str, ...] = CODES) -> CallerContext:
    """走一遍身份依赖，拿到调用者。

    Args: codes。
    """
    return await AUTH.caller(request_of(signed_headers(codes)))


async def test_signed_headers_yield_the_caller() -> None:
    caller = await caller_of()
    assert caller.permissions == frozenset(CODES)


async def test_headers_without_a_signature_are_401() -> None:
    with pytest.raises(Unauthenticated):
        await AUTH.caller(request_of({}))


async def test_a_message_mapper_can_say_which_step_failed() -> None:
    """默认只给一句话；调用方可以按原因换成更具体的说明。"""
    auth = build_auth_deps(
        signing_secret_of=lambda _request: SECRET,
        service_key_of=lambda _request: SERVICE_KEY,
        message_of=lambda reason: f"卡在：{reason}",
    )
    with pytest.raises(Unauthenticated, match="卡在：missing_headers"):
        await auth.caller(request_of({}))


async def test_holding_every_code_passes() -> None:
    dependency = AUTH.require(*CODES)
    caller = await caller_of()
    assert await dependency(caller) is caller


async def test_missing_one_code_is_403() -> None:
    dependency = AUTH.require(*CODES)
    with pytest.raises(PermissionDenied):
        await dependency(await caller_of(codes=("ac:view",)))


async def test_any_mode_needs_only_one_code() -> None:
    dependency = AUTH.require(*CODES, mode=MODE_ANY)
    caller = await caller_of(codes=("ac:view",))
    assert await dependency(caller) is caller


async def test_any_mode_still_refuses_a_caller_with_none_of_them() -> None:
    dependency = AUTH.require(*CODES, mode=MODE_ANY)
    with pytest.raises(PermissionDenied):
        await dependency(await caller_of(codes=("other:code",)))


async def test_the_dependency_declares_the_codes_it_wants() -> None:
    """⚠ 契约测试遍历路由时读这两个标记，比对闸 1 与闸 2 的权限码。"""
    dependency = AUTH.require(*CODES, mode=MODE_ANY)
    assert getattr(dependency, REQUIRED_CODES_ATTR) == frozenset(CODES)
    assert getattr(dependency, REQUIRED_MODE_ATTR) == MODE_ANY


async def test_a_missing_service_key_is_refused() -> None:
    """⚠ 未配置或没带一律拒绝，不是放行——fail-closed。"""
    with pytest.raises(Unauthenticated):
        await AUTH.service_key(request_of({}))


async def test_a_wrong_service_key_is_refused() -> None:
    with pytest.raises(Unauthenticated):
        await AUTH.service_key(request_of({"X-Service-Key": "nope"}))


async def test_an_unconfigured_service_key_refuses_everyone() -> None:
    """⚠ 空配置不许变成「谁都放行」。"""
    auth = build_auth_deps(
        signing_secret_of=lambda _request: SECRET,
        service_key_of=lambda _request: "",
    )
    with pytest.raises(Unauthenticated):
        await auth.service_key(request_of({"X-Service-Key": ""}))


async def test_the_exact_service_key_passes() -> None:
    """它只做校验，不产出身份，故返回 None。"""
    request = request_of({"X-Service-Key": SERVICE_KEY})
    assert await AUTH.service_key(request) is None
