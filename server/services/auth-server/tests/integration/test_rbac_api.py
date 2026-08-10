"""闸 2 与授权不变式的集成用例：越权、提权、自锁。

这一组守的是「admin 不含 X」从种子默认值变成真正的安全属性。
"""

import httpx
import pytest

from auth_server.settings import API_PREFIX

pytestmark = pytest.mark.requires_postgres

SEED_PASSWORD = "Admin123456"
VIEWER_PASSWORD = "Viewer123456"


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


async def make_viewer(
    client: httpx.AsyncClient, username: str
) -> dict[str, str]:
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
    token = (
        await client.post(
            f"{API_PREFIX}/sessions",
            json={"username": username, "password": VIEWER_PASSWORD},
        )
    ).json()["data"]["token"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


async def test_request_without_a_token_is_401(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(f"{API_PREFIX}/users")
    assert response.status_code == 401


async def test_viewer_can_read_users_but_not_create_them(
    app_client: httpx.AsyncClient,
) -> None:
    headers = await make_viewer(app_client, "viewer-read")
    assert (
        await app_client.get(f"{API_PREFIX}/users", headers=headers)
    ).status_code == 200
    denied = await app_client.post(
        f"{API_PREFIX}/users",
        headers=headers,
        json={
            "username": "sneaky",
            "email": "s@example.com",
            "password": "Passw0rd12",
            "role_id": await role_id(app_client, "admin"),
        },
    )
    assert denied.status_code == 403
    assert denied.json()["code"] == 40106


async def test_viewer_reaches_own_profile_without_any_permission_code(
    app_client: httpx.AsyncClient,
) -> None:
    headers = await make_viewer(app_client, "viewer-self")
    response = await app_client.get(f"{API_PREFIX}/users/me", headers=headers)
    assert response.status_code == 200
    assert response.json()["data"]["username"] == "viewer-self"


async def test_viewer_cannot_assign_roles(
    app_client: httpx.AsyncClient,
) -> None:
    headers = await make_viewer(app_client, "viewer-grant")
    me = (
        await app_client.get(f"{API_PREFIX}/users/me", headers=headers)
    ).json()["data"]
    response = await app_client.post(
        f"{API_PREFIX}/users/{me['id']}:assign-role",
        headers=headers,
        json={"role_id": await role_id(app_client, "admin")},
    )
    assert response.status_code == 403


async def test_builtin_role_permissions_cannot_be_rewritten(
    app_client: httpx.AsyncClient,
) -> None:
    headers = await admin_headers(app_client)
    response = await app_client.put(
        f"{API_PREFIX}/roles/{await role_id(app_client, 'viewer')}"
        "/permissions",
        headers=headers,
        json={"codes": []},
    )
    assert response.status_code == 400
    assert response.json()["code"] == 40110


async def test_builtin_role_cannot_be_renamed_or_deleted(
    app_client: httpx.AsyncClient,
) -> None:
    headers = await admin_headers(app_client)
    target = await role_id(app_client, "viewer")
    renamed = await app_client.patch(
        f"{API_PREFIX}/roles/{target}",
        headers=headers,
        json={"name": "viewer2"},
    )
    deleted = await app_client.delete(
        f"{API_PREFIX}/roles/{target}", headers=headers
    )
    assert renamed.status_code == 400
    assert deleted.status_code == 400


async def test_builtin_role_description_stays_editable(
    app_client: httpx.AsyncClient,
) -> None:
    headers = await admin_headers(app_client)
    response = await app_client.patch(
        f"{API_PREFIX}/roles/{await role_id(app_client, 'viewer')}",
        headers=headers,
        json={"description": "只读账号"},
    )
    assert response.status_code == 200


async def test_role_cannot_be_granted_codes_the_operator_lacks(
    app_client: httpx.AsyncClient,
) -> None:
    headers = await make_viewer(app_client, "viewer-escalate")
    response = await app_client.post(
        f"{API_PREFIX}/roles",
        headers=headers,
        json={"name": "sneaky_role", "codes": ["user:grant"]},
    )
    assert response.status_code == 403


async def test_unknown_permission_code_is_rejected(
    app_client: httpx.AsyncClient,
) -> None:
    headers = await admin_headers(app_client)
    response = await app_client.post(
        f"{API_PREFIX}/roles",
        headers=headers,
        json={"name": "bogus_role", "codes": ["not:a:code"]},
    )
    assert response.status_code == 400
    assert response.json()["details"][0]["code"] == "unknown_permission_code"


async def test_admin_cannot_delete_itself(
    app_client: httpx.AsyncClient,
) -> None:
    headers = await admin_headers(app_client)
    me = (
        await app_client.get(f"{API_PREFIX}/users/me", headers=headers)
    ).json()["data"]
    response = await app_client.delete(
        f"{API_PREFIX}/users/{me['id']}", headers=headers
    )
    assert response.status_code == 400
    assert response.json()["code"] == 40109


async def test_missing_user_is_404_not_500(
    app_client: httpx.AsyncClient,
) -> None:
    headers = await admin_headers(app_client)
    response = await app_client.get(
        f"{API_PREFIX}/users/3fa85f64-5717-4562-b3fc-2c963f66afa6",
        headers=headers,
    )
    assert response.status_code == 404


async def test_permission_catalog_is_readable_and_grouped(
    app_client: httpx.AsyncClient,
) -> None:
    headers = await admin_headers(app_client)
    body = (
        await app_client.get(f"{API_PREFIX}/permissions", headers=headers)
    ).json()["data"]
    assert {group["code"] for group in body["groups"]} == {"user", "system"}
    assert all(item["kind"] for item in body["items"])
