"""用户 / 角色 / 路由规则管理面的写路径与错误路径。

覆盖启停、改资料、重置密码、改派角色、覆盖式直权、角色增删改、规则增删改，
以及它们各自的拒绝分支。
"""

import httpx
import pytest

from auth_server.settings import API_PREFIX

pytestmark = pytest.mark.requires_postgres

SEED_PASSWORD = "Admin123456"
NEW_PASSWORD = "Passw0rd12345"


async def admin(client: httpx.AsyncClient) -> dict[str, str]:
    response = await client.post(
        f"{API_PREFIX}/sessions",
        json={"username": "admin", "password": SEED_PASSWORD},
    )
    token = response.json()["data"]["token"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


async def role_id(client: httpx.AsyncClient, name: str) -> str:
    body = (
        await client.get(f"{API_PREFIX}/roles", headers=await admin(client))
    ).json()["data"]["items"]
    return next(item["id"] for item in body if item["name"] == name)


async def new_user(
    client: httpx.AsyncClient, username: str
) -> dict[str, object]:
    response = await client.post(
        f"{API_PREFIX}/users",
        headers=await admin(client),
        json={
            "username": username,
            "email": f"{username}@example.com",
            "password": NEW_PASSWORD,
            "role_id": await role_id(client, "viewer"),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


async def test_created_user_appears_in_the_list_and_detail(
    app_client: httpx.AsyncClient,
) -> None:
    headers = await admin(app_client)
    created = await new_user(app_client, "mgmt-created")
    listed = await app_client.get(
        f"{API_PREFIX}/users?q=mgmt-created", headers=headers
    )
    detail = await app_client.get(
        f"{API_PREFIX}/users/{created['id']}", headers=headers
    )
    assert listed.json()["data"]["total"] == 1
    assert detail.json()["data"]["username"] == "mgmt-created"


async def test_list_item_gives_direct_permission_count_not_the_codes(
    app_client: httpx.AsyncClient,
) -> None:
    """列表项给直权**条数**，不展开码。

    ⚠ 列表与详情的形状差异必须钉死：前端把列表项当详情用、去拿
    `direct_permissions` 的长度时，取到的是 undefined，整页崩在渲染里。
    """
    headers = await admin(app_client)
    created = await new_user(app_client, "mgmt-shape")
    await app_client.put(
        f"{API_PREFIX}/users/{created['id']}/permissions",
        headers=headers,
        json={"codes": ["user:manage"]},
    )
    listed = await app_client.get(
        f"{API_PREFIX}/users?q=mgmt-shape", headers=headers
    )
    item = listed.json()["data"]["items"][0]
    assert item["direct_permission_count"] == 1
    assert "direct_permissions" not in item
    assert "permissions" not in item


async def test_duplicate_username_is_a_conflict(
    app_client: httpx.AsyncClient,
) -> None:
    await new_user(app_client, "mgmt-dup")
    again = await app_client.post(
        f"{API_PREFIX}/users",
        headers=await admin(app_client),
        json={
            "username": "MGMT-DUP",
            "email": "other@example.com",
            "password": NEW_PASSWORD,
            "role_id": await role_id(app_client, "viewer"),
        },
    )
    assert again.status_code == 409


async def test_profile_update_changes_only_the_given_fields(
    app_client: httpx.AsyncClient,
) -> None:
    headers = await admin(app_client)
    created = await new_user(app_client, "mgmt-update")
    response = await app_client.patch(
        f"{API_PREFIX}/users/{created['id']}",
        headers=headers,
        json={"full_name": "张三"},
    )
    body = response.json()["data"]
    assert response.status_code == 200
    assert body["full_name"] == "张三"
    assert body["email"] == created["email"]


async def test_deactivated_account_cannot_log_in_and_reactivation_restores(
    app_client: httpx.AsyncClient,
) -> None:
    headers = await admin(app_client)
    created = await new_user(app_client, "mgmt-toggle")
    await app_client.post(
        f"{API_PREFIX}/users/{created['id']}:deactivate", headers=headers
    )
    blocked = await app_client.post(
        f"{API_PREFIX}/sessions",
        json={"username": "mgmt-toggle", "password": NEW_PASSWORD},
    )
    await app_client.post(
        f"{API_PREFIX}/users/{created['id']}:activate", headers=headers
    )
    restored = await app_client.post(
        f"{API_PREFIX}/sessions",
        json={"username": "mgmt-toggle", "password": NEW_PASSWORD},
    )
    assert blocked.status_code == 401
    assert blocked.json()["code"] == 40104
    assert restored.status_code == 201


async def test_reset_password_invalidates_the_old_one(
    app_client: httpx.AsyncClient,
) -> None:
    headers = await admin(app_client)
    created = await new_user(app_client, "mgmt-reset")
    response = await app_client.post(
        f"{API_PREFIX}/users/{created['id']}:reset-password",
        headers=headers,
        json={"new_password": "Rotated12345"},
    )
    old = await app_client.post(
        f"{API_PREFIX}/sessions",
        json={"username": "mgmt-reset", "password": NEW_PASSWORD},
    )
    fresh = await app_client.post(
        f"{API_PREFIX}/sessions",
        json={"username": "mgmt-reset", "password": "Rotated12345"},
    )
    assert response.status_code == 204
    assert old.status_code == 401
    assert fresh.status_code == 201


async def test_changing_own_password_requires_the_current_one(
    app_client: httpx.AsyncClient,
) -> None:
    await new_user(app_client, "mgmt-selfpass")
    token = (
        await app_client.post(
            f"{API_PREFIX}/sessions",
            json={"username": "mgmt-selfpass", "password": NEW_PASSWORD},
        )
    ).json()["data"]["token"]["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    wrong = await app_client.post(
        f"{API_PREFIX}/users/me:change-password",
        headers=headers,
        json={
            "current_password": "Nope12345678",
            "new_password": "Another12345",
        },
    )
    right = await app_client.post(
        f"{API_PREFIX}/users/me:change-password",
        headers=headers,
        json={
            "current_password": NEW_PASSWORD,
            "new_password": "Another12345",
        },
    )
    assert wrong.status_code == 401
    assert right.status_code == 204


async def test_self_profile_update_persists(
    app_client: httpx.AsyncClient,
) -> None:
    await new_user(app_client, "mgmt-selfprofile")
    token = (
        await app_client.post(
            f"{API_PREFIX}/sessions",
            json={"username": "mgmt-selfprofile", "password": NEW_PASSWORD},
        )
    ).json()["data"]["token"]["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    response = await app_client.patch(
        f"{API_PREFIX}/users/me",
        headers=headers,
        json={"full_name": "自己改的"},
    )
    assert response.json()["data"]["full_name"] == "自己改的"


async def test_deleting_a_user_makes_it_unreachable(
    app_client: httpx.AsyncClient,
) -> None:
    headers = await admin(app_client)
    created = await new_user(app_client, "mgmt-delete")
    removed = await app_client.delete(
        f"{API_PREFIX}/users/{created['id']}", headers=headers
    )
    again = await app_client.delete(
        f"{API_PREFIX}/users/{created['id']}", headers=headers
    )
    assert removed.status_code == 204
    assert again.status_code == 404


async def test_direct_permissions_are_replaced_not_merged(
    app_client: httpx.AsyncClient,
) -> None:
    headers = await admin(app_client)
    created = await new_user(app_client, "mgmt-direct")
    first = await app_client.put(
        f"{API_PREFIX}/users/{created['id']}/permissions",
        headers=headers,
        json={"codes": ["user:manage", "user:delete"]},
    )
    second = await app_client.put(
        f"{API_PREFIX}/users/{created['id']}/permissions",
        headers=headers,
        json={"codes": ["user:manage"]},
    )
    assert first.json()["data"]["direct_permissions"] == [
        "user:delete",
        "user:manage",
    ]
    assert second.json()["data"]["direct_permissions"] == ["user:manage"]


async def test_assigning_a_role_updates_the_effective_permissions(
    app_client: httpx.AsyncClient,
) -> None:
    headers = await admin(app_client)
    created = await new_user(app_client, "mgmt-assign")
    response = await app_client.post(
        f"{API_PREFIX}/users/{created['id']}:assign-role",
        headers=headers,
        json={"role_id": await role_id(app_client, "admin")},
    )
    body = response.json()["data"]
    assert response.status_code == 200
    assert body["role"]["name"] == "admin"
    assert "role:manage" in body["permissions"]


async def test_role_lifecycle_create_update_permissions_delete(
    app_client: httpx.AsyncClient,
) -> None:
    headers = await admin(app_client)
    created = await app_client.post(
        f"{API_PREFIX}/roles",
        headers=headers,
        json={
            "name": "ops_engineer",
            "description": "现场运维",
            "codes": ["user:view"],
        },
    )
    role = created.json()["data"]
    renamed = await app_client.patch(
        f"{API_PREFIX}/roles/{role['id']}",
        headers=headers,
        json={"name": "ops_lead"},
    )
    granted = await app_client.put(
        f"{API_PREFIX}/roles/{role['id']}/permissions",
        headers=headers,
        json={"codes": ["user:view", "route_rule:view"]},
    )
    detail = await app_client.get(
        f"{API_PREFIX}/roles/{role['id']}", headers=headers
    )
    removed = await app_client.delete(
        f"{API_PREFIX}/roles/{role['id']}", headers=headers
    )
    assert created.status_code == 201
    assert role["permissions"] == ["user:view"]
    assert renamed.json()["data"]["name"] == "ops_lead"
    assert granted.json()["data"]["permissions"] == [
        "route_rule:view",
        "user:view",
    ]
    assert detail.status_code == 200
    assert removed.status_code == 204


async def test_role_with_users_cannot_be_deleted(
    app_client: httpx.AsyncClient,
) -> None:
    headers = await admin(app_client)
    created = await app_client.post(
        f"{API_PREFIX}/roles",
        headers=headers,
        json={"name": "temp_role", "codes": []},
    )
    role = created.json()["data"]["id"]
    await app_client.post(
        f"{API_PREFIX}/users",
        headers=headers,
        json={
            "username": "mgmt-inrole",
            "email": "mgmt-inrole@example.com",
            "password": NEW_PASSWORD,
            "role_id": role,
        },
    )
    response = await app_client.delete(
        f"{API_PREFIX}/roles/{role}", headers=headers
    )
    assert response.status_code == 409


async def test_duplicate_role_name_is_a_conflict(
    app_client: httpx.AsyncClient,
) -> None:
    headers = await admin(app_client)
    payload = {"name": "dup_role", "codes": []}
    await app_client.post(f"{API_PREFIX}/roles", headers=headers, json=payload)
    again = await app_client.post(
        f"{API_PREFIX}/roles", headers=headers, json=payload
    )
    assert again.status_code == 409


async def test_missing_role_is_404(app_client: httpx.AsyncClient) -> None:
    response = await app_client.get(
        f"{API_PREFIX}/roles/3fa85f64-5717-4562-b3fc-2c963f66afa6",
        headers=await admin(app_client),
    )
    assert response.status_code == 404


async def test_route_rule_lifecycle_and_uniqueness(
    app_client: httpx.AsyncClient,
) -> None:
    headers = await admin(app_client)
    payload = {
        "path_pattern": "/api/v1/platform/things*",
        "http_method": "GET",
        "permission_codes": ["user:view"],
        "priority": 100,
    }
    created = await app_client.post(
        f"{API_PREFIX}/route-rules", headers=headers, json=payload
    )
    rule = created.json()["data"]
    duplicate = await app_client.post(
        f"{API_PREFIX}/route-rules", headers=headers, json=payload
    )
    updated = await app_client.patch(
        f"{API_PREFIX}/route-rules/{rule['id']}",
        headers=headers,
        json={"priority": 120, "is_enabled": False},
    )
    detail = await app_client.get(
        f"{API_PREFIX}/route-rules/{rule['id']}", headers=headers
    )
    removed = await app_client.delete(
        f"{API_PREFIX}/route-rules/{rule['id']}", headers=headers
    )
    assert created.status_code == 201
    assert duplicate.status_code == 409
    assert updated.json()["data"]["priority"] == 120
    assert detail.json()["data"]["is_enabled"] is False
    assert removed.status_code == 204


async def test_new_rule_takes_effect_on_the_next_verify(
    app_client: httpx.AsyncClient,
) -> None:
    headers = await admin(app_client)
    # ⚠ 建规则前必须先无规则：platform 那一片已被按方法的兜底规则整片覆盖，
    # 拿它当「新路径」会让 before 就是 200，前后对比也就什么都没验证
    probe = {
        "X-Original-URI": "/api/v1/unmanaged/guarded",
        "X-Original-Method": "GET",
    }
    token_headers = {**headers, **probe}
    before = await app_client.get("/internal/v1/verify", headers=token_headers)
    await app_client.post(
        f"{API_PREFIX}/route-rules",
        headers=headers,
        json={
            "path_pattern": "/api/v1/unmanaged/guarded",
            "http_method": "GET",
            "permission_codes": [],
            "priority": 200,
        },
    )
    after = await app_client.get("/internal/v1/verify", headers=token_headers)
    assert before.status_code == 403
    assert after.status_code == 200


async def test_rule_referencing_an_unknown_code_is_rejected(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.post(
        f"{API_PREFIX}/route-rules",
        headers=await admin(app_client),
        json={
            "path_pattern": "/api/v1/platform/x",
            "http_method": "GET",
            "permission_codes": ["nope:code"],
        },
    )
    assert response.status_code == 400


async def test_route_rule_list_supports_filtering(
    app_client: httpx.AsyncClient,
) -> None:
    headers = await admin(app_client)
    response = await app_client.get(
        f"{API_PREFIX}/route-rules?q=sessions&is_enabled=true",
        headers=headers,
    )
    items = response.json()["data"]["items"]
    assert items
    assert all("sessions" in item["path_pattern"] for item in items)
