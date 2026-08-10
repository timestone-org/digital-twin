"""边缘鉴权端点的集成用例。

⚠ 本文件守的是全系统最危险的一条口径：**先认证、再查规则**。
「查不到权限码」绝不等于「匿名放行」——空 `permission_codes` 只表示
「任意已登录用户放行」，而匿名请求必须在认证那一步就被挡住。
"""

import httpx
import pytest

from auth_server.settings import API_PREFIX, INTERNAL_PREFIX

pytestmark = pytest.mark.requires_postgres

VERIFY = f"{INTERNAL_PREFIX}/verify"
SEED_PASSWORD = "Admin123456"


async def admin_token(client: httpx.AsyncClient) -> str:
    response = await client.post(
        f"{API_PREFIX}/sessions",
        json={"username": "admin", "password": SEED_PASSWORD},
    )
    return response.json()["data"]["token"]["access_token"]


def probe(uri: str, method: str = "GET") -> dict[str, str]:
    return {"X-Original-URI": uri, "X-Original-Method": method}


async def test_anonymous_request_is_rejected_before_any_rule_lookup(
    app_client: httpx.AsyncClient,
) -> None:
    # 目标路径的规则是空权限码；若判定顺序反了，这里会变成 200
    response = await app_client.get(
        VERIFY, headers=probe(f"{API_PREFIX}/users/me")
    )
    assert response.status_code == 401
    assert "x-auth-user-id" not in response.headers


async def test_authenticated_request_gets_signed_identity_headers(
    app_client: httpx.AsyncClient,
) -> None:
    token = await admin_token(app_client)
    response = await app_client.get(
        VERIFY,
        headers={
            "Authorization": f"Bearer {token}",
            **probe(f"{API_PREFIX}/users"),
        },
    )
    assert response.status_code == 200
    for header in (
        "x-auth-user-id",
        "x-auth-username",
        "x-auth-role",
        "x-auth-permissions",
        "x-auth-exp",
        "x-auth-sig",
    ):
        assert header in response.headers


async def test_permission_header_is_never_empty_even_for_an_empty_set(
    app_client: httpx.AsyncClient,
) -> None:
    token = await admin_token(app_client)
    response = await app_client.get(
        VERIFY,
        headers={
            "Authorization": f"Bearer {token}",
            **probe(f"{API_PREFIX}/users"),
        },
    )
    assert response.headers["x-auth-permissions"]


async def test_unmanaged_path_is_denied_rather_than_allowed(
    app_client: httpx.AsyncClient,
) -> None:
    token = await admin_token(app_client)
    response = await app_client.get(
        VERIFY,
        headers={
            "Authorization": f"Bearer {token}",
            **probe("/api/v1/platform/whatever"),
        },
    )
    assert response.status_code == 403


async def test_forged_token_is_rejected(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(
        VERIFY,
        headers={
            "Authorization": "Bearer not.a.real.token",
            **probe(f"{API_PREFIX}/users"),
        },
    )
    assert response.status_code == 401


async def test_internal_endpoint_requires_the_service_key(
    app_client: httpx.AsyncClient,
) -> None:
    token = await admin_token(app_client)
    headers = {
        "Authorization": f"Bearer {token}",
        **probe(f"{API_PREFIX}/users"),
    }
    without_key = await app_client.get(
        VERIFY, headers={**headers, "X-Service-Key": ""}
    )
    wrong_key = await app_client.get(
        VERIFY, headers={**headers, "X-Service-Key": "wrong"}
    )
    assert without_key.status_code == 401
    assert wrong_key.status_code == 401


async def test_permission_lookup_reports_a_missing_user_explicitly(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(
        f"{INTERNAL_PREFIX}/users/"
        "3fa85f64-5717-4562-b3fc-2c963f66afa6/permissions"
    )
    assert response.status_code == 404
    assert response.headers.get("X-Auth-User-Lookup") == "miss"
