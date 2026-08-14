"""闸 2 在真实请求链路上的表现：无身份头 401、只读身份写操作 403。

⚠ 闸 1 在边缘，绕过边缘直连 8005 时它完全不生效。这几条锁的是「直连也拦得住」。
"""

from collections.abc import Callable

import httpx

from platform_server.apps.hvac.catalog import AC_VIEW

PREFIX = "/api/v1/platform"

# conftest 的 `sign` fixture 形状。⚠ 不从 tests.conftest 导入：`tests` 这个包名
# 在 workspace 里被每个服务各占一份，跨服务解析到谁全看 sys.path 顺序。
SignHeaders = Callable[..., dict[str, str]]


async def test_a_request_without_identity_headers_is_401(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(
        f"{PREFIX}/workshops", headers={"X-Auth-Sig": ""}
    )
    assert response.status_code == 401
    assert response.json()["code"] == 40100


async def test_forged_identity_headers_are_401(
    app_client: httpx.AsyncClient,
) -> None:
    # 直接编一组头：没有签名就没有身份，权限码写成什么都不作数
    forged = {
        "X-Auth-User-Id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        "X-Auth-Role": "admin",
        "X-Auth-Permissions": "W10",
        "X-Auth-Exp": "99999999999",
        "X-Auth-Sig": "0" * 64,
    }
    response = await app_client.post(
        f"{PREFIX}/workshops", json={"name": "伪造车间"}, headers=forged
    )
    assert response.status_code == 401
    assert response.json()["code"] == 40100


async def test_a_read_only_caller_can_list_but_not_write(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    viewer = sign([AC_VIEW])
    listing = await app_client.get(f"{PREFIX}/workshops", headers=viewer)
    assert listing.status_code == 200
    blocked = await app_client.post(
        f"{PREFIX}/workshops", json={"name": "只读也想建"}, headers=viewer
    )
    assert blocked.status_code == 403
    assert blocked.json()["code"] == 40106


async def test_a_caller_without_any_code_cannot_even_read(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    # 空权限码集合不是「放行」——受管前缀上查不到权限就是拒绝
    response = await app_client.get(f"{PREFIX}/workshops", headers=sign([]))
    assert response.status_code == 403
    assert response.json()["code"] == 40106


async def test_expired_identity_headers_are_401(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    response = await app_client.get(
        f"{PREFIX}/workshops", headers=sign(lifetime_s=-1)
    )
    assert response.status_code == 401


async def test_liveness_needs_no_identity(
    app_client: httpx.AsyncClient,
) -> None:
    # 探针不吃身份头：边缘的免认证 location 打的就是它
    response = await app_client.get(
        f"{PREFIX}/health", headers={"X-Auth-Sig": ""}
    )
    assert response.status_code == 200
    assert response.json()["status"] == "alive"
