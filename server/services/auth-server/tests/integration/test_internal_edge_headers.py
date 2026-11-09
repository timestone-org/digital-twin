"""重新签发身份头的集成用例。

⚠ 它守的是「长回合的委托不会中途断掉」：边缘签的身份头只有几十秒，而助手推进
一个回合能跑几分钟，到期之后每一次代表用户的调用都是 401。这条端点让被委托方
换一份新的，而不是把过期时刻往后挪——后者会把全站的吊销窗口一起放大。

⚠ 同时守「换来的是当下的权限」：账号一旦停用，续签就必须拒。
"""

import uuid

import httpx
import pytest

from auth_server.settings import API_PREFIX, INTERNAL_PREFIX

pytestmark = pytest.mark.requires_postgres

VERIFY = f"{INTERNAL_PREFIX}/verify"
SEED_PASSWORD = "Admin123456"

SIGNED = (
    "x-auth-user-id",
    "x-auth-username",
    "x-auth-role",
    "x-auth-permissions",
    "x-auth-exp",
    "x-auth-sig",
)


def reissue(user_id: str) -> str:
    return f"{INTERNAL_PREFIX}/users/{user_id}/edge-headers"


async def admin_token(client: httpx.AsyncClient) -> str:
    """登录拿一枚 access token。"""
    response = await client.post(
        f"{API_PREFIX}/sessions",
        json={"username": "admin", "password": SEED_PASSWORD},
    )
    return response.json()["data"]["token"]["access_token"]


async def admin_headers(client: httpx.AsyncClient) -> httpx.Headers:
    """走一遍正常的边缘鉴权，拿到那一组签名头。"""
    token = await admin_token(client)
    response = await client.get(
        VERIFY,
        headers={
            "Authorization": f"Bearer {token}",
            "X-Original-URI": f"{API_PREFIX}/users",
            "X-Original-Method": "GET",
        },
    )
    assert response.status_code == 200
    return response.headers


async def test_reissued_headers_carry_the_same_identity(
    app_client: httpx.AsyncClient,
) -> None:
    first = await admin_headers(app_client)

    response = await app_client.get(reissue(first["x-auth-user-id"]))

    assert response.status_code == 200
    for header in SIGNED:
        assert header in response.headers
    # 换的是过期时刻与签名，人与权限一个字都不该变
    assert response.headers["x-auth-user-id"] == first["x-auth-user-id"]
    assert response.headers["x-auth-permissions"] == first["x-auth-permissions"]


async def test_the_new_expiry_is_pushed_forward(
    app_client: httpx.AsyncClient,
) -> None:
    first = await admin_headers(app_client)

    response = await app_client.get(reissue(first["x-auth-user-id"]))

    # 不往后推的话，续签等于没续——回合后半段照样一路 401
    assert int(response.headers["x-auth-exp"]) >= int(first["x-auth-exp"])
    assert response.headers["x-auth-sig"] != ""


async def test_an_unknown_user_is_a_marked_404(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(reissue(str(uuid.uuid4())))

    assert response.status_code == 404
    # 裸 404（前缀配错、路由不存在）不等于「这个人不存在」，故要有标记头
    assert response.headers.get("X-Auth-User-Lookup") == "miss"
    assert "x-auth-sig" not in response.headers


async def test_the_service_key_is_required(
    app_client: httpx.AsyncClient,
) -> None:
    first = await admin_headers(app_client)

    response = await app_client.get(
        reissue(first["x-auth-user-id"]), headers={"X-Service-Key": "nope"}
    )

    # 这是一个签发面：没有这道门，任何能打到内网的东西都能签出超管身份
    assert response.status_code == 401
    assert "x-auth-sig" not in response.headers


async def test_a_deactivated_account_cannot_renew(
    app_client: httpx.AsyncClient,
) -> None:
    token = await admin_token(app_client)
    auth = {"Authorization": f"Bearer {token}"}
    role_id = (
        await app_client.get(f"{API_PREFIX}/roles", headers=auth)
    ).json()["data"]["items"][0]["id"]
    created = await app_client.post(
        f"{API_PREFIX}/users",
        headers=auth,
        json={
            "username": "renew_probe",
            "email": "renew_probe@example.com",
            "password": "Probe123456",
            "role_id": role_id,
        },
    )
    user_id = created.json()["data"]["id"]
    await app_client.post(
        f"{API_PREFIX}/users/{user_id}:deactivate", headers=auth
    )

    response = await app_client.get(reissue(user_id))

    # 续签读的是**当下**的库；停用之后还能续，等于停用要等一个回合才生效
    assert response.status_code == 401
    assert "x-auth-sig" not in response.headers
