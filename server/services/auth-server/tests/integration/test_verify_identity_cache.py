"""身份缓存下的吊销时效。

⚠ 本文件守的是把「每请求回源」换成缓存之后**唯一**变坏的那件事：降权与停用
还看不看得见。写路径在同一副本内是即时失效的，所以这里全部断言「立刻」，
不是「等一个 TTL」——写成等 TTL 就等于把缺陷写进了用例。
"""

import httpx
import pytest

from auth_server.settings import API_PREFIX, INTERNAL_PREFIX

pytestmark = pytest.mark.requires_postgres

VERIFY = f"{INTERNAL_PREFIX}/verify"
SEED_PASSWORD = "Admin123456"
VIEWER_PASSWORD = "Viewer123456"
# 建号要 user:manage，而 viewer 只有 user:view——够不着的正是这一档。
# ⚠ 别拿 `GET /users` 当探针：viewer 有 user:view，那条本来就放行
GUARDED = f"{API_PREFIX}/users"
GUARDED_METHOD = "POST"


async def admin_headers(client: httpx.AsyncClient) -> dict[str, str]:
    response = await client.post(
        f"{API_PREFIX}/sessions",
        json={"username": "admin", "password": SEED_PASSWORD},
    )
    token = response.json()["data"]["token"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


async def role_id(client: httpx.AsyncClient, name: str) -> str:
    response = await client.get(
        f"{API_PREFIX}/roles?q={name}", headers=await admin_headers(client)
    )
    return next(
        item["id"]
        for item in response.json()["data"]["items"]
        if item["name"] == name
    )


async def make_role(client: httpx.AsyncClient, name: str) -> str:
    """建一个自定义角色，只给 user:view。

    ⚠ 不能拿 `viewer` 做角色改权的用例：内置角色的权限集由种子维护，
    改它一律 400，而那与缓存无关。

    Args: client, name。
    """
    created = await client.post(
        f"{API_PREFIX}/roles",
        headers=await admin_headers(client),
        json={"name": name, "codes": ["user:view"]},
    )
    assert created.status_code == 201, created.text
    return created.json()["data"]["id"]


async def make_user(
    client: httpx.AsyncClient, username: str, *, role: str
) -> str:
    created = await client.post(
        f"{API_PREFIX}/users",
        headers=await admin_headers(client),
        json={
            "username": username,
            "email": f"{username}@example.com",
            "password": VIEWER_PASSWORD,
            "role_id": role,
        },
    )
    assert created.status_code == 201, created.text
    return created.json()["data"]["id"]


async def make_viewer(client: httpx.AsyncClient, username: str) -> str:
    return await make_user(
        client, username, role=await role_id(client, "viewer")
    )


async def viewer_headers(
    client: httpx.AsyncClient, username: str
) -> dict[str, str]:
    response = await client.post(
        f"{API_PREFIX}/sessions",
        json={"username": username, "password": VIEWER_PASSWORD},
    )
    token = response.json()["data"]["token"]["access_token"]
    return {
        "Authorization": f"Bearer {token}",
        "X-Original-URI": GUARDED,
        "X-Original-Method": GUARDED_METHOD,
    }


async def test_granting_a_code_is_visible_on_the_next_verify(
    app_client: httpx.AsyncClient,
) -> None:
    """提权不能等一个 TTL 才生效，否则刚配好的权限「时灵时不灵」。

    Args: app_client。
    """
    user_id = await make_viewer(app_client, "cache-granted")
    headers = await viewer_headers(app_client, "cache-granted")
    assert (await app_client.get(VERIFY, headers=headers)).status_code == 403

    granted = await app_client.put(
        f"{API_PREFIX}/users/{user_id}/permissions",
        headers=await admin_headers(app_client),
        json={"codes": ["user:view", "user:manage"]},
    )
    assert granted.status_code == 200, granted.text
    assert (await app_client.get(VERIFY, headers=headers)).status_code == 200


async def test_revoking_a_code_is_visible_on_the_next_verify(
    app_client: httpx.AsyncClient,
) -> None:
    """⚠ 这一条是本次改动的安全底线：降权必须立刻拦住。

    Args: app_client。
    """
    user_id = await make_viewer(app_client, "cache-revoked")
    headers = await viewer_headers(app_client, "cache-revoked")
    await app_client.put(
        f"{API_PREFIX}/users/{user_id}/permissions",
        headers=await admin_headers(app_client),
        json={"codes": ["user:view", "user:manage"]},
    )
    assert (await app_client.get(VERIFY, headers=headers)).status_code == 200

    revoked = await app_client.put(
        f"{API_PREFIX}/users/{user_id}/permissions",
        headers=await admin_headers(app_client),
        json={"codes": []},
    )
    assert revoked.status_code == 200, revoked.text
    assert (await app_client.get(VERIFY, headers=headers)).status_code == 403


async def test_changing_a_role_reaches_everyone_holding_it(
    app_client: httpx.AsyncClient,
) -> None:
    """⚠ 缓存按用户分键，认不出「这批人的角色刚被改了」——只能整体丢。

    改的是角色而不是这个账号，按用户失效在这里是够不着的。

    Args: app_client。
    """
    role = await make_role(app_client, "cache_role")
    await make_user(app_client, "cache-by-role", role=role)
    headers = await viewer_headers(app_client, "cache-by-role")
    assert (await app_client.get(VERIFY, headers=headers)).status_code == 403

    changed = await app_client.put(
        f"{API_PREFIX}/roles/{role}/permissions",
        headers=await admin_headers(app_client),
        json={"codes": ["user:view", "user:manage"]},
    )
    assert changed.status_code == 200, changed.text
    assert (await app_client.get(VERIFY, headers=headers)).status_code == 200
