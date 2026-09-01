"""长回合里的委托身份续签。

⚠ 这一份守的是一个真出过的缺陷：边缘签的身份头只有几十秒，而推进一个回合能跑
几分钟——模型想一次就可能吃掉整份预算。不续签的话，回合后半段每一次工具调用
都撞 platform 的 401，界面上显示成「points.search 没跑成」，而 platform 是好的。
"""

import httpx
import pytest

from ai_assistant.upstream import AuthClient, DelegatedIdentity, PlatformClient
from ai_assistant.upstream.auth import AuthUnavailable
from lib.utils.timeutils import utcnow

USER = "01a03634-71b9-7038-880a-ce129b09b7d1"
OTHER = "01a03634-71b9-7038-880a-ce129b09b7d2"


def _exp(in_s: int) -> str:
    return str(int(utcnow().timestamp()) + in_s)


def _headers(user_id: str, left_s: int, sig: str = "old") -> dict[str, str]:
    return {
        "X-Auth-User-Id": user_id,
        "X-Auth-Permissions": "W10",
        "X-Auth-Exp": _exp(left_s),
        "X-Auth-Sig": sig,
    }


def _auth(minted: dict[str, str], seen: list[str] | None = None) -> AuthClient:
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request.url.path)
        return httpx.Response(200, headers=minted)

    client = AuthClient(
        base_url="http://auth.test", service_key="k" * 32, timeout_s=3
    )
    client.use_transport(httpx.MockTransport(handler))
    return client


def _platform(
    identity: DelegatedIdentity, sent: list[httpx.Headers]
) -> PlatformClient:
    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request.headers)
        return httpx.Response(
            200,
            json={
                "code": 0,
                "message": "ok",
                "trace_id": "t",
                "data": {"items": [], "page": 1, "size": 200, "total": 0},
            },
        )

    client = PlatformClient(
        base_url="http://platform.test", timeout_s=5, identity=identity
    )
    client.use_transport(httpx.MockTransport(handler))
    return client


async def test_headers_with_time_left_go_out_untouched() -> None:
    identity = DelegatedIdentity(_auth(_headers(USER, 60, "new")))
    sent: list[httpx.Headers] = []

    await _platform(identity, sent).list_sources(_headers(USER, 300))

    # 没到续签线就去签，等于每次调用多一趟往返
    assert sent[0]["x-auth-sig"] == "old"


async def test_headers_near_expiry_are_swapped_before_the_call() -> None:
    identity = DelegatedIdentity(_auth(_headers(USER, 60, "new")))
    sent: list[httpx.Headers] = []

    await _platform(identity, sent).list_sources(_headers(USER, 3))

    # 修复前这里发出去的还是那组快过期的头，platform 回 401
    assert sent[0]["x-auth-sig"] == "new"


async def test_an_already_expired_set_is_swapped_too() -> None:
    identity = DelegatedIdentity(_auth(_headers(USER, 60, "new")))
    sent: list[httpx.Headers] = []

    await _platform(identity, sent).list_sources(_headers(USER, -10))

    assert sent[0]["x-auth-sig"] == "new"


async def test_the_new_set_is_reused_across_calls() -> None:
    trips: list[str] = []
    identity = DelegatedIdentity(_auth(_headers(USER, 60, "new"), trips))
    sent: list[httpx.Headers] = []
    platform = _platform(identity, sent)

    stale = _headers(USER, 1)
    for _ in range(3):
        await platform.list_sources(stale)

    # 调用方手里那份永远是旧的，不缓存的话每次调用都要再签一趟
    assert len(trips) == 1
    assert [one["x-auth-sig"] for one in sent] == ["new", "new", "new"]


async def test_two_users_never_share_a_minted_set() -> None:
    identity = DelegatedIdentity(_auth(_headers(USER, 60, "mine")))
    sent: list[httpx.Headers] = []
    platform = _platform(identity, sent)

    await platform.list_sources(_headers(USER, 1))
    await platform.list_sources(_headers(OTHER, 300))

    # 合成一格缓存的话，第二个用户会借到第一个人的身份
    assert sent[1]["x-auth-user-id"] == OTHER
    assert sent[1]["x-auth-sig"] == "old"


async def test_a_caller_without_a_user_id_is_not_signed_for() -> None:
    trips: list[str] = []
    identity = DelegatedIdentity(_auth(_headers(USER, 60, "new"), trips))
    sent: list[httpx.Headers] = []

    await _platform(identity, sent).list_sources({"X-Auth-Sig": "orphan"})

    # 说不清是谁的调用，正确的结局是下游按「少了头」拒掉
    assert trips == []
    assert sent[0]["x-auth-sig"] == "orphan"


async def test_auth_being_down_is_raised_not_swallowed() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    auth = AuthClient(
        base_url="http://auth.test", service_key="k" * 32, timeout_s=3
    )
    auth.use_transport(httpx.MockTransport(handler))
    sent: list[httpx.Headers] = []

    with pytest.raises(AuthUnavailable):
        await _platform(DelegatedIdentity(auth), sent).list_sources(
            _headers(USER, 1)
        )

    # 悄悄用旧头发出去的话，现象会退回成一条说不清的 401
    assert sent == []


async def test_the_service_key_goes_with_every_reissue() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(request.headers)
        return httpx.Response(200, headers=_headers(USER, 60, "new"))

    auth = AuthClient(
        base_url="http://auth.test", service_key="k" * 32, timeout_s=3
    )
    auth.use_transport(httpx.MockTransport(handler))

    await DelegatedIdentity(auth).fresh(_headers(USER, 1))

    # 少了它，签发面对这一跳一律 401，而现象与「身份过期」是同一句话
    assert seen["x-service-key"] == "k" * 32
