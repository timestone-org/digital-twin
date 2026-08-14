"""API 密钥的集成用例。

⚠ 本文件守的是「常驻凭据」这件事最容易出错的两头：明文只出现一次，
以及**吊销必须立刻生效**——认证路径上有一层 argon2 结果缓存，
吊销若不主动清它，一枚已经作废的密钥还能再活一个缓存窗口。
"""

import httpx
import pytest

from auth_server.settings import API_PREFIX, INTERNAL_PREFIX

pytestmark = pytest.mark.requires_postgres

KEYS = f"{API_PREFIX}/api-keys"
VERIFY = f"{INTERNAL_PREFIX}/verify"
SEED_PASSWORD = "Admin123456"
VIEWER_PASSWORD = "Viewer123456"


async def admin_headers(client: httpx.AsyncClient) -> dict[str, str]:
    response = await client.post(
        f"{API_PREFIX}/sessions",
        json={"username": "admin", "password": SEED_PASSWORD},
    )
    token = response.json()["data"]["token"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


async def admin_user_id(client: httpx.AsyncClient) -> str:
    response = await client.get(
        f"{API_PREFIX}/users/me", headers=await admin_headers(client)
    )
    return response.json()["data"]["id"]


async def role_id(client: httpx.AsyncClient, name: str) -> str:
    response = await client.get(
        f"{API_PREFIX}/roles?q={name}", headers=await admin_headers(client)
    )
    return next(
        item["id"]
        for item in response.json()["data"]["items"]
        if item["name"] == name
    )


async def make_viewer(client: httpx.AsyncClient, username: str) -> str:
    """建一个 viewer 账号，返回它的 id。"""
    created = await client.post(
        f"{API_PREFIX}/users",
        headers=await admin_headers(client),
        json={
            "username": username,
            "email": f"{username}@example.com",
            "password": VIEWER_PASSWORD,
            "role_id": await role_id(client, "viewer"),
        },
    )
    assert created.status_code == 201, created.text
    return created.json()["data"]["id"]


async def issue_key(
    client: httpx.AsyncClient, *, user_id: str, name: str = "第三方系统"
) -> dict[str, object]:
    response = await client.post(
        KEYS,
        headers=await admin_headers(client),
        json={"user_id": user_id, "name": name, "expires_in_days": None},
    )
    assert response.status_code == 201, response.text
    data = response.json()["data"]
    assert isinstance(data, dict)
    return data


def probe(uri: str, method: str = "GET") -> dict[str, str]:
    return {"X-Original-URI": uri, "X-Original-Method": method}


async def test_an_issued_key_authenticates_at_the_edge(
    app_client: httpx.AsyncClient,
) -> None:
    issued = await issue_key(
        app_client, user_id=await admin_user_id(app_client)
    )
    response = await app_client.get(
        VERIFY,
        headers={
            "Authorization": f"Bearer {issued['secret']}",
            **probe(f"{API_PREFIX}/users"),
        },
    )
    assert response.status_code == 200
    # 下游拿到的身份与用账号令牌时完全一样——密钥不是第二套权限体系
    assert response.headers["x-auth-user-id"] == await admin_user_id(app_client)
    assert response.headers["x-auth-permissions"]


async def test_the_plaintext_is_never_readable_again(
    app_client: httpx.AsyncClient,
) -> None:
    issued = await issue_key(
        app_client, user_id=await admin_user_id(app_client)
    )
    listed = await app_client.get(KEYS, headers=await admin_headers(app_client))
    assert listed.status_code == 200
    body = listed.text
    assert str(issued["secret"]) not in body
    # 前缀仍在，页面上要靠它指认是哪一枚
    api_key = issued["api_key"]
    assert isinstance(api_key, dict)
    assert str(api_key["prefix"]) in body


async def test_revocation_takes_effect_immediately(
    app_client: httpx.AsyncClient,
) -> None:
    issued = await issue_key(
        app_client, user_id=await admin_user_id(app_client)
    )
    api_key = issued["api_key"]
    assert isinstance(api_key, dict)
    headers = {
        "Authorization": f"Bearer {issued['secret']}",
        **probe(f"{API_PREFIX}/users"),
    }
    # 先用一次，把 argon2 的校验结果喂进缓存
    assert (await app_client.get(VERIFY, headers=headers)).status_code == 200

    revoked = await app_client.post(
        f"{KEYS}/{api_key['id']}:revoke",
        headers=await admin_headers(app_client),
    )
    assert revoked.status_code == 200
    assert revoked.json()["data"]["is_active"] is False

    # ⚠ 缓存窗口是 60 秒；这里若变绿又变红，说明吊销没清缓存
    after = await app_client.get(VERIFY, headers=headers)
    assert after.status_code == 401


async def test_revoking_twice_is_harmless(
    app_client: httpx.AsyncClient,
) -> None:
    issued = await issue_key(
        app_client, user_id=await admin_user_id(app_client)
    )
    api_key = issued["api_key"]
    assert isinstance(api_key, dict)
    url = f"{KEYS}/{api_key['id']}:revoke"
    first = await app_client.post(url, headers=await admin_headers(app_client))
    second = await app_client.post(url, headers=await admin_headers(app_client))
    assert first.status_code == 200
    assert second.status_code == 200
    assert (
        first.json()["data"]["revoked_at"]
        == second.json()["data"]["revoked_at"]
    )


async def test_a_wrong_secret_under_a_real_prefix_is_rejected(
    app_client: httpx.AsyncClient,
) -> None:
    issued = await issue_key(
        app_client, user_id=await admin_user_id(app_client)
    )
    api_key = issued["api_key"]
    assert isinstance(api_key, dict)
    forged = f"dtk_{api_key['prefix']}_definitely-not-the-real-secret"
    response = await app_client.get(
        VERIFY,
        headers={
            "Authorization": f"Bearer {forged}",
            **probe(f"{API_PREFIX}/users"),
        },
    )
    assert response.status_code == 401


async def test_a_malformed_key_is_rejected_like_any_other_bad_credential(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(
        VERIFY,
        headers={
            "Authorization": "Bearer dtk_only-two-parts",
            **probe(f"{API_PREFIX}/users"),
        },
    )
    assert response.status_code == 401


async def test_issuing_for_an_account_that_does_not_exist_is_404(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.post(
        KEYS,
        headers=await admin_headers(app_client),
        json={
            "user_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
            "name": "无主",
            "expires_in_days": 30,
        },
    )
    assert response.status_code == 404


async def test_revoking_a_key_that_does_not_exist_is_404(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.post(
        f"{KEYS}/3fa85f64-5717-4562-b3fc-2c963f66afa6:revoke",
        headers=await admin_headers(app_client),
    )
    assert response.status_code == 404


async def test_a_key_cannot_reach_the_account_management_face(
    app_client: httpx.AsyncClient,
) -> None:
    # 闸 1 会放行（账号有 user:view），闸 2 必须自己挡住——否则一枚被盗的密钥
    # 可以给自己再签一枚，吊销永远追不上签发
    issued = await issue_key(
        app_client, user_id=await admin_user_id(app_client)
    )
    response = await app_client.get(
        f"{API_PREFIX}/users",
        headers={"Authorization": f"Bearer {issued['secret']}"},
    )
    assert response.status_code == 401


async def test_a_key_for_a_disabled_account_stops_working(
    app_client: httpx.AsyncClient,
) -> None:
    viewer_id = await make_viewer(app_client, "svc-disabled")
    issued = await issue_key(app_client, user_id=viewer_id)
    headers = {
        "Authorization": f"Bearer {issued['secret']}",
        **probe(f"{API_PREFIX}/users"),
    }
    assert (await app_client.get(VERIFY, headers=headers)).status_code == 200

    disabled = await app_client.post(
        f"{API_PREFIX}/users/{viewer_id}:deactivate",
        headers=await admin_headers(app_client),
    )
    assert disabled.status_code == 200
    assert (await app_client.get(VERIFY, headers=headers)).status_code == 401


async def test_the_key_only_carries_its_owners_permissions(
    app_client: httpx.AsyncClient,
) -> None:
    viewer_id = await make_viewer(app_client, "svc-scoped")
    issued = await issue_key(app_client, user_id=viewer_id)
    headers = {"Authorization": f"Bearer {issued['secret']}"}
    allowed = await app_client.get(
        VERIFY, headers={**headers, **probe(f"{API_PREFIX}/users")}
    )
    denied = await app_client.get(
        VERIFY, headers={**headers, **probe(f"{API_PREFIX}/users", "POST")}
    )
    assert allowed.status_code == 200
    assert denied.status_code == 403


async def test_issuing_for_a_higher_privileged_account_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    # viewer 拿不到 user:manage，这里换一条更贴近的路：用 viewer 的令牌去签发
    viewer_id = await make_viewer(app_client, "svc-climber")
    token = (
        await app_client.post(
            f"{API_PREFIX}/sessions",
            json={"username": "svc-climber", "password": VIEWER_PASSWORD},
        )
    ).json()["data"]["token"]["access_token"]
    response = await app_client.post(
        KEYS,
        headers={"Authorization": f"Bearer {token}"},
        json={
            "user_id": viewer_id,
            "name": "自助",
            "expires_in_days": None,
        },
    )
    assert response.status_code == 403


async def test_listing_hides_revoked_keys_unless_asked(
    app_client: httpx.AsyncClient,
) -> None:
    user_id = await admin_user_id(app_client)
    issued = await issue_key(app_client, user_id=user_id, name="待吊销")
    api_key = issued["api_key"]
    assert isinstance(api_key, dict)
    await app_client.post(
        f"{KEYS}/{api_key['id']}:revoke",
        headers=await admin_headers(app_client),
    )
    headers = await admin_headers(app_client)
    default = await app_client.get(f"{KEYS}?user_id={user_id}", headers=headers)
    included = await app_client.get(
        f"{KEYS}?user_id={user_id}&should_include_revoked=true", headers=headers
    )
    listed = {item["id"] for item in default.json()["data"]["items"]}
    with_revoked = {item["id"] for item in included.json()["data"]["items"]}
    assert api_key["id"] not in listed
    assert api_key["id"] in with_revoked


async def test_an_expiry_must_be_stated_explicitly(
    app_client: httpx.AsyncClient,
) -> None:
    # 漏填 expires_in_days 不能默默变成「永不过期」
    response = await app_client.post(
        KEYS,
        headers=await admin_headers(app_client),
        json={"user_id": await admin_user_id(app_client), "name": "漏填"},
    )
    assert response.status_code == 400
    fields = {item["field"] for item in response.json().get("details") or []}
    assert any("expires_in_days" in field for field in fields)
