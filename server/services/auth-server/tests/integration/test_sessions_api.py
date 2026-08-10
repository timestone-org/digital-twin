"""会话面的集成用例：登录、刷新轮换、登出、注册开关。

打真实 Postgres，每条用例包在回滚事务里。
"""

import httpx
import pytest

from auth_server.settings import API_PREFIX

pytestmark = pytest.mark.requires_postgres

SEED_USERNAME = "admin"
SEED_PASSWORD = "Admin123456"


async def login(
    client: httpx.AsyncClient, *, username: str, password: str
) -> httpx.Response:
    return await client.post(
        f"{API_PREFIX}/sessions",
        json={"username": username, "password": password},
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
