"""用户 APIKey 的模型调用权限、吊销与账号停用立即生效。"""

import httpx
import pytest

from integration.test_api_keys_api import (
    API_PREFIX,
    KEYS,
    VERIFY,
    admin_headers,
    issue_key,
    probe,
)

pytestmark = pytest.mark.requires_postgres
OPEN = "/api/v1/platform/open-models/energy"


async def model_caller(client: httpx.AsyncClient) -> tuple[str, str]:
    headers = await admin_headers(client)
    role = await client.post(
        f"{API_PREFIX}/roles",
        headers=headers,
        json={"name": "model_caller", "codes": ["modeling:view"]},
    )
    assert role.status_code == 201
    role_id = str(role.json()["data"]["id"])
    user = await client.post(
        f"{API_PREFIX}/users",
        headers=headers,
        json={
            "username": "model-caller",
            "email": "model-caller@example.com",
            "password": "TestCaller123456",
            "role_id": role_id,
        },
    )
    assert user.status_code == 201
    return str(user.json()["data"]["id"]), role_id


@pytest.mark.parametrize("suffix", ["", ":predict", ":detect", ":calculate"])
async def test_model_calls_follow_current_account_permissions(
    app_client: httpx.AsyncClient, suffix: str
) -> None:
    user_id, role_id = await model_caller(app_client)
    issued = await issue_key(app_client, user_id=user_id)
    headers = {
        "Authorization": f"Bearer {issued['secret']}",
        **probe(f"{OPEN}{suffix}", "POST" if suffix else "GET"),
    }
    allowed = await app_client.get(VERIFY, headers=headers)
    assert allowed.status_code == 200
    assert allowed.headers["x-auth-user-id"] == user_id
    changed = await app_client.put(
        f"{API_PREFIX}/roles/{role_id}/permissions",
        headers=await admin_headers(app_client),
        json={"codes": []},
    )
    assert changed.status_code == 200
    assert (await app_client.get(VERIFY, headers=headers)).status_code == 403


@pytest.mark.parametrize("action", ["revoke", "deactivate"])
async def test_model_credentials_can_be_invalidated_immediately(
    app_client: httpx.AsyncClient, action: str
) -> None:
    user_id, _ = await model_caller(app_client)
    issued = await issue_key(app_client, user_id=user_id)
    headers = {
        "Authorization": f"Bearer {issued['secret']}",
        **probe(f"{OPEN}:predict", "POST"),
    }
    assert (await app_client.get(VERIFY, headers=headers)).status_code == 200
    key = issued["api_key"]
    assert isinstance(key, dict)
    path = (
        f"{KEYS}/{key['id']}:revoke"
        if action == "revoke"
        else f"{API_PREFIX}/users/{user_id}:deactivate"
    )
    changed = await app_client.post(
        path, headers=await admin_headers(app_client)
    )
    assert changed.status_code == 200
    assert (await app_client.get(VERIFY, headers=headers)).status_code == 401
