"""用户权限回查客户端：打的是哪条路、怎么解、以及**取不到时拒绝**。

⚠ 这条回查是 WS 授权的唯一码源。权限**不在访问令牌里**——auth-server 只签
主体与到期，权限由它在 `/verify` 那一步现查后以签名头下发给边缘，而 WS 的
token 走子协议、根本不经边缘（CONTEXT.md §6）。改回从令牌载荷里读的话，每条
连接都会拿着空码集合，表现是每一次订阅都被拒 42005 而 HTTP 面完全正常。
"""

import uuid

import httpx
import pytest
from realtime_hub.apps.channel.errors import UserCodesUnavailable
from realtime_hub.apps.channel.services import UserCodeSource
from realtime_hub.apps.channel.services.user_codes import AccountUnusable

BASE = "http://auth-test"
USER = uuid.UUID("3fa85f64-5717-4562-b3fc-2c963f66afa6")


def _source(handler: object) -> UserCodeSource:
    source = UserCodeSource(base_url=BASE, service_key="k" * 32, timeout_s=1.0)
    # 换掉传输层而不是打网络：要验的是解析与失败处置，不是 httpx 本身
    source._transport = httpx.MockTransport(handler)  # type: ignore[attr-defined]  # 测试注入
    return source


async def test_asks_the_internal_endpoint_with_the_service_key() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == f"/internal/v1/users/{USER}/permissions"
        assert request.headers["X-Service-Key"] == "k" * 32
        return httpx.Response(
            200, json={"data": {"permissions": ["a:b"], "is_active": True}}
        )

    assert await _source(handler).codes_of(USER) == frozenset({"a:b"})


async def test_takes_the_merged_codes_not_just_the_role_ones() -> None:
    # ⚠ 只看 role_permissions 会漏掉直接授给某个人的码
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "data": {
                    "permissions": ["a:b", "c:d"],
                    "is_active": True,
                    "role_permissions": ["a:b"],
                    "direct_permissions": ["c:d"],
                }
            },
        )

    assert await _source(handler).codes_of(USER) == frozenset({"a:b", "c:d"})


async def test_a_user_with_no_codes_is_an_empty_set_not_an_error() -> None:
    # 「查到了，他就是没有码」与「查不到」是两回事：前者该正常握手然后订不了
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"data": {"permissions": [], "is_active": True}}
        )

    assert await _source(handler).codes_of(USER) == frozenset()


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(404, json={"data": {"permissions": []}}),
        httpx.Response(500, json={"data": {"permissions": []}}),
        httpx.Response(200, json={"nope": 1}),
        httpx.Response(200, json={"data": {"permissions": "not a list"}}),
        httpx.Response(200, text="not json"),
    ],
)
async def test_any_unusable_answer_fails_closed(
    response: httpx.Response,
) -> None:
    # ⚠ 五种坏答案都必须抛，不能退化成空集：空集在授权那一步长得跟「你没权限」
    # 一模一样，客户端会据此不再重连，auth 恢复了通道也不会自己回来
    with pytest.raises(UserCodesUnavailable):
        await _source(lambda _request: response).codes_of(USER)


async def test_a_dead_auth_server_fails_closed() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    with pytest.raises(UserCodesUnavailable):
        await _source(handler).codes_of(USER)


async def test_a_deactivated_account_is_refused_not_retried() -> None:
    # ⚠ HTTP 面对停用账号立刻 401，WS 不能靠一枚未到期的令牌继续收推送
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"data": {"permissions": ["a:b"], "is_active": False}}
        )

    with pytest.raises(AccountUnusable):
        await _source(handler).codes_of(USER)


async def test_a_deleted_account_is_refused_not_retried() -> None:
    # ⚠ auth-server 认出「没有这个人」时带标记头；归成 503 会让客户端永远重连
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, headers={"X-Auth-User-Lookup": "miss"})

    with pytest.raises(AccountUnusable):
        await _source(handler).codes_of(USER)


async def test_a_bare_route_404_still_fails_closed() -> None:
    # ⚠ 版本错位或路径写错的 404 不能变成永久拒绝，客户端得能自己回来
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    with pytest.raises(UserCodesUnavailable):
        await _source(handler).codes_of(USER)
