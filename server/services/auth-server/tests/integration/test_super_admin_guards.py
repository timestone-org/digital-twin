"""自锁保护的集成用例：系统任何时刻都要留下一个**可用的**全权账号。

⚠ 已停用的全权账号不算数：它登录不了，也没人能再把它启用回来。
"""

import httpx
import pytest

from auth_server.settings import API_PREFIX

pytestmark = pytest.mark.requires_postgres

SEED_PASSWORD = "Admin123456"
NEW_PASSWORD = "Passw0rd12345"
SELF_LOCKOUT = 40109
GUARD_CODES = ["role:manage", "user:grant", "user:view"]


async def login(
    client: httpx.AsyncClient, username: str, password: str
) -> dict[str, str]:
    response = await client.post(
        f"{API_PREFIX}/sessions",
        json={"username": username, "password": password},
    )
    assert response.status_code == 201, response.text[:200]
    token = response.json()["data"]["token"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


async def admin(client: httpx.AsyncClient) -> dict[str, str]:
    return await login(client, "admin", SEED_PASSWORD)


async def role_id(client: httpx.AsyncClient, name: str) -> str:
    body = (
        await client.get(f"{API_PREFIX}/roles", headers=await admin(client))
    ).json()["data"]["items"]
    return next(item["id"] for item in body if item["name"] == name)


async def new_role(
    client: httpx.AsyncClient, name: str, codes: list[str]
) -> str:
    response = await client.post(
        f"{API_PREFIX}/roles",
        headers=await admin(client),
        json={"name": name, "codes": codes},
    )
    assert response.status_code == 201, response.text[:300]
    return response.json()["data"]["id"]


async def new_user(client: httpx.AsyncClient, username: str, role: str) -> str:
    response = await client.post(
        f"{API_PREFIX}/users",
        headers=await admin(client),
        json={
            "username": username,
            "email": f"{username}@example.com",
            "password": NEW_PASSWORD,
            "role_id": role,
        },
    )
    assert response.status_code == 201, response.text[:300]
    return response.json()["data"]["id"]


async def my_id(client: httpx.AsyncClient, headers: dict[str, str]) -> str:
    response = await client.get(f"{API_PREFIX}/users/me", headers=headers)
    return response.json()["data"]["id"]


async def all_codes(client: httpx.AsyncClient) -> list[str]:
    response = await client.get(
        f"{API_PREFIX}/users/me", headers=await admin(client)
    )
    return response.json()["data"]["permissions"]


async def test_a_disabled_super_admin_does_not_count_as_a_spare(
    app_client: httpx.AsyncClient,
) -> None:
    headers = await admin(app_client)
    dormant = await new_user(
        app_client, "sa-dormant", await role_id(app_client, "admin")
    )
    deactivated = await app_client.post(
        f"{API_PREFIX}/users/{dormant}:deactivate", headers=headers
    )
    narrow = await new_role(app_client, "sa_narrow", GUARD_CODES)
    response = await app_client.post(
        f"{API_PREFIX}/users/{await my_id(app_client, headers)}:assign-role",
        headers=headers,
        json={"role_id": narrow},
    )
    assert deactivated.status_code == 200, deactivated.text
    assert response.status_code == 400, response.text[:300]
    assert response.json()["code"] == SELF_LOCKOUT


async def test_a_disabled_super_admin_can_still_be_deleted(
    app_client: httpx.AsyncClient,
) -> None:
    headers = await admin(app_client)
    dormant = await new_user(
        app_client, "sa-retired", await role_id(app_client, "admin")
    )
    await app_client.post(
        f"{API_PREFIX}/users/{dormant}:deactivate", headers=headers
    )
    response = await app_client.delete(
        f"{API_PREFIX}/users/{dormant}", headers=headers
    )
    assert response.status_code == 204, response.text[:300]


async def test_editing_own_role_cannot_drop_the_codes_needed_to_manage(
    app_client: httpx.AsyncClient,
) -> None:
    own = await new_role(app_client, "sa_ops_admin", GUARD_CODES)
    await new_user(app_client, "sa-ops", own)
    headers = await login(app_client, "sa-ops", NEW_PASSWORD)
    response = await app_client.put(
        f"{API_PREFIX}/roles/{own}/permissions",
        headers=headers,
        json={"codes": ["user:view"]},
    )
    assert response.status_code == 400, response.text[:300]
    assert response.json()["code"] == SELF_LOCKOUT


async def test_stripping_the_last_super_admins_custom_role_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    headers = await admin(app_client)
    codes = await all_codes(app_client)
    everything = await new_role(app_client, "sa_everything", codes)
    moved = await app_client.post(
        f"{API_PREFIX}/users/{await my_id(app_client, headers)}:assign-role",
        headers=headers,
        json={"role_id": everything},
    )
    kept = [code for code in codes if code != "dashboard:view"]
    response = await app_client.put(
        f"{API_PREFIX}/roles/{everything}/permissions",
        headers=headers,
        json={"codes": kept},
    )
    assert moved.status_code == 200, moved.text
    assert response.status_code == 400, response.text[:300]
    assert response.json()["code"] == SELF_LOCKOUT
    # ⚠ 拒绝发生在 flush 之后：整笔必须回滚，角色上的码一条都不能少
    stored = await app_client.get(
        f"{API_PREFIX}/roles/{everything}", headers=headers
    )
    assert "dashboard:view" in stored.json()["data"]["permissions"]


async def test_editing_a_role_nobody_privileged_holds_still_works(
    app_client: httpx.AsyncClient,
) -> None:
    role = await new_role(app_client, "sa_plain", ["user:view"])
    await new_user(app_client, "sa-plain-holder", role)
    response = await app_client.put(
        f"{API_PREFIX}/roles/{role}/permissions",
        headers=await admin(app_client),
        json={"codes": ["route_rule:view"]},
    )
    assert response.status_code == 200, response.text[:300]
