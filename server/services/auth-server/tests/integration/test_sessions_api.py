"""会话面的集成用例：登录、刷新轮换、登出、注册开关。

打真实 Postgres，每条用例包在回滚事务里。
"""

from datetime import timedelta

import httpx
import pytest

from auth_server.apps.auth.services import api_key_service
from auth_server.settings import API_PREFIX, INTERNAL_PREFIX

pytestmark = pytest.mark.requires_postgres

SEED_USERNAME = "admin"
SEED_PASSWORD = "Admin123456"
API_KEYS = f"{API_PREFIX}/api-keys"
EMBED_SESSION = f"{API_PREFIX}/sessions:from-api-key"
VERIFY = f"{INTERNAL_PREFIX}/verify"


async def login(
    client: httpx.AsyncClient, *, username: str, password: str
) -> httpx.Response:
    return await client.post(
        f"{API_PREFIX}/sessions",
        json={"username": username, "password": password},
    )


async def issue_admin_api_key(
    client: httpx.AsyncClient,
    *,
    expires_in_days: int | None = 30,
    user_id: str | None = None,
) -> tuple[dict[str, object], dict[str, str]]:
    """用种子管理员签一枚测试密钥，同时返回管理令牌头。"""
    logged_in = (
        await login(client, username=SEED_USERNAME, password=SEED_PASSWORD)
    ).json()["data"]
    headers = {
        "Authorization": (f"Bearer {logged_in['token']['access_token']}")
    }
    response = await client.post(
        API_KEYS,
        headers=headers,
        json={
            "user_id": user_id or logged_in["user"]["id"],
            "name": "嵌入测试",
            "expires_in_days": expires_in_days,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["data"], headers


async def exchange_api_key(
    client: httpx.AsyncClient, secret: object
) -> httpx.Response:
    return await client.post(
        EMBED_SESSION, headers={"Authorization": f"Bearer {secret}"}
    )


async def test_login_returns_201_with_tokens_and_permissions(
    app_client: httpx.AsyncClient,
) -> None:
    response = await login(
        app_client, username=SEED_USERNAME, password=SEED_PASSWORD
    )
    body = response.json()
    assert response.status_code == 201
    assert body["code"] == 0
    assert body["data"]["token"]["token_type"] == "bearer"
    assert "user:view" in body["data"]["user"]["permissions"]


async def test_login_never_returns_the_password_hash(
    app_client: httpx.AsyncClient,
) -> None:
    response = await login(
        app_client, username=SEED_USERNAME, password=SEED_PASSWORD
    )
    assert "hashed_password" not in response.text


async def test_api_key_exchange_returns_short_access_without_refresh(
    app_client: httpx.AsyncClient,
) -> None:
    issued, _ = await issue_admin_api_key(app_client)
    response = await exchange_api_key(app_client, issued["secret"])
    body = response.json()["data"]
    token = body["token"]
    assert response.status_code == 200
    assert set(token) == {"access_token", "token_type", "expires_in_s"}
    assert token["expires_in_s"] == 300
    assert body["user"]["id"] == issued["api_key"]["user_id"]

    verified = await app_client.get(
        VERIFY,
        headers={
            "Authorization": f"Bearer {token['access_token']}",
            "X-Original-URI": "/api/v1/platform/dashboards",
            "X-Original-Method": "GET",
        },
    )
    assert verified.status_code == 200


async def test_api_key_exchange_rejects_missing_malformed_and_jwt_credentials(
    app_client: httpx.AsyncClient,
) -> None:
    admin = await login(
        app_client, username=SEED_USERNAME, password=SEED_PASSWORD
    )
    jwt_token = admin.json()["data"]["token"]["access_token"]
    missing = await app_client.post(EMBED_SESSION)
    malformed = await exchange_api_key(app_client, "dtk_bad")
    jwt = await exchange_api_key(app_client, jwt_token)
    assert [missing.status_code, malformed.status_code, jwt.status_code] == [
        401,
        401,
        401,
    ]


async def test_api_key_exchange_ignores_query_and_body_credentials(
    app_client: httpx.AsyncClient,
) -> None:
    issued, _ = await issue_admin_api_key(app_client)
    secret = issued["secret"]
    query = await app_client.post(EMBED_SESSION, params={"token": secret})
    body = await app_client.post(EMBED_SESSION, json={"api_key": secret})
    assert query.status_code == 401
    assert body.status_code == 401


async def test_revoked_api_key_cannot_create_an_embed_session(
    app_client: httpx.AsyncClient,
) -> None:
    issued, admin_headers = await issue_admin_api_key(app_client)
    key = issued["api_key"]
    assert isinstance(key, dict)
    revoked = await app_client.post(
        f"{API_KEYS}/{key['id']}:revoke", headers=admin_headers
    )
    response = await exchange_api_key(app_client, issued["secret"])
    assert revoked.status_code == 200
    assert response.status_code == 401


async def test_expired_api_key_cannot_create_an_embed_session(
    app_client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        api_key_service,
        "_expiry",
        lambda now, _days: now - timedelta(seconds=1),
    )
    issued, _ = await issue_admin_api_key(app_client, expires_in_days=1)
    response = await exchange_api_key(app_client, issued["secret"])
    assert response.status_code == 401


async def test_permanent_api_key_can_create_an_embed_session(
    app_client: httpx.AsyncClient,
) -> None:
    issued, _ = await issue_admin_api_key(app_client, expires_in_days=None)
    response = await exchange_api_key(app_client, issued["secret"])
    token = response.json()["data"]["token"]
    assert response.status_code == 200
    assert token["expires_in_s"] == 300
    assert "refresh_token" not in token


async def test_disabled_api_key_owner_cannot_create_an_embed_session(
    app_client: httpx.AsyncClient,
) -> None:
    _, admin_headers = await issue_admin_api_key(app_client)
    roles = await app_client.get(
        f"{API_PREFIX}/roles?q=viewer", headers=admin_headers
    )
    viewer_role = next(
        item
        for item in roles.json()["data"]["items"]
        if item["name"] == "viewer"
    )
    created = await app_client.post(
        f"{API_PREFIX}/users",
        headers=admin_headers,
        json={
            "username": "embed-disabled",
            "email": "embed-disabled@example.com",
            "password": "Viewer123456",
            "role_id": viewer_role["id"],
        },
    )
    user_id = created.json()["data"]["id"]
    issued, _ = await issue_admin_api_key(app_client, user_id=user_id)
    disabled = await app_client.post(
        f"{API_PREFIX}/users/{user_id}:deactivate", headers=admin_headers
    )
    response = await exchange_api_key(app_client, issued["secret"])
    assert disabled.status_code == 200
    assert response.status_code == 401


async def test_embed_access_is_rejected_by_both_auth_management_gates(
    app_client: httpx.AsyncClient,
) -> None:
    issued, _ = await issue_admin_api_key(app_client)
    exchanged = await exchange_api_key(app_client, issued["secret"])
    access_token = exchanged.json()["data"]["token"]["access_token"]
    authorization = {"Authorization": f"Bearer {access_token}"}

    direct = await app_client.get(f"{API_PREFIX}/users", headers=authorization)
    edge = await app_client.get(
        VERIFY,
        headers={
            **authorization,
            "X-Original-URI": f"{API_PREFIX}/users",
            "X-Original-Method": "GET",
        },
    )
    assert direct.status_code == 401
    assert edge.status_code == 401


async def test_wrong_password_is_401_without_revealing_which_part_failed(
    app_client: httpx.AsyncClient,
) -> None:
    wrong = await login(
        app_client, username=SEED_USERNAME, password="Wrongpass123"
    )
    unknown = await login(
        app_client, username="nobody-here", password="Wrongpass123"
    )
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json()["message"] == unknown.json()["message"]


async def test_login_accepts_the_email_as_well(
    app_client: httpx.AsyncClient,
) -> None:
    response = await login(
        app_client, username="admin@example.com", password=SEED_PASSWORD
    )
    assert response.status_code == 201


async def test_refresh_rotates_both_tokens(
    app_client: httpx.AsyncClient,
) -> None:
    first = (
        await login(app_client, username=SEED_USERNAME, password=SEED_PASSWORD)
    ).json()["data"]["token"]
    response = await app_client.post(
        f"{API_PREFIX}/sessions:refresh",
        json={"refresh_token": first["refresh_token"]},
    )
    second = response.json()["data"]["token"]
    assert response.status_code == 200
    assert second["refresh_token"] != first["refresh_token"]


async def test_reusing_a_rotated_refresh_token_is_rejected(
    app_client: httpx.AsyncClient,
) -> None:
    token = (
        await login(app_client, username=SEED_USERNAME, password=SEED_PASSWORD)
    ).json()["data"]["token"]["refresh_token"]
    await app_client.post(
        f"{API_PREFIX}/sessions:refresh", json={"refresh_token": token}
    )
    replay = await app_client.post(
        f"{API_PREFIX}/sessions:refresh", json={"refresh_token": token}
    )
    assert replay.status_code == 401
    assert replay.json()["code"] == 40103


async def test_logout_invalidates_the_refresh_token(
    app_client: httpx.AsyncClient,
) -> None:
    token = (
        await login(app_client, username=SEED_USERNAME, password=SEED_PASSWORD)
    ).json()["data"]["token"]["refresh_token"]
    revoked = await app_client.post(
        f"{API_PREFIX}/sessions:revoke", json={"refresh_token": token}
    )
    assert revoked.status_code == 204
    assert not revoked.content
    after = await app_client.post(
        f"{API_PREFIX}/sessions:refresh", json={"refresh_token": token}
    )
    assert after.status_code == 401


async def test_access_token_is_not_accepted_as_a_refresh_token(
    app_client: httpx.AsyncClient,
) -> None:
    token = (
        await login(app_client, username=SEED_USERNAME, password=SEED_PASSWORD)
    ).json()["data"]["token"]["access_token"]
    response = await app_client.post(
        f"{API_PREFIX}/sessions:refresh", json={"refresh_token": token}
    )
    assert response.status_code == 401


async def test_self_registration_is_refused_while_disabled(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.post(
        f"{API_PREFIX}/registrations",
        json={
            "username": "newbie",
            "email": "newbie@example.com",
            "password": "Passw0rd12",
        },
    )
    assert response.status_code == 403
    assert response.json()["code"] == 40112


async def test_repeated_failures_eventually_hit_the_rate_limit(
    app_client: httpx.AsyncClient,
) -> None:
    codes = set()
    for _ in range(12):
        response = await login(
            app_client, username="brute-target", password="Wrongpass123"
        )
        codes.add(response.status_code)
    assert 429 in codes
