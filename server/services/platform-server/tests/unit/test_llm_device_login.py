"""设备码登录的两步编排。

守三条只有出事才看得见的规矩：交给浏览器的是**句柄**不是 `device_auth_id`、
轮询要把上游给的句柄与用户码一起带上（少一格就是 422）、
换到令牌之后立刻作废这次登录（留着的话同一个码能被再换一次）。
"""

import uuid
from typing import Any

import httpx
import pytest

from lib.testing import InMemoryCache
from platform_server.apps.llm_providers.errors import LlmLoginSessionExpired
from platform_server.apps.llm_providers.services.device_login import DeviceLogin
from platform_server.apps.llm_providers.services.oauth_client import OAuthClient
from platform_server.apps.llm_providers.services.tokens import TokenBundle

ACTOR = str(uuid.uuid4())
PROVIDER = uuid.uuid4()

START_BODY = {
    "device_auth_id": "deviceauth_secret",
    "user_code": "ABCD-1234",
    "interval": "5",
    "expires_at": "2099-01-01T00:00:00+00:00",
}
GRANT_BODY = {
    "authorization_code": "code-1",
    "code_verifier": "ver-from-server",
}
TOKEN_BODY = {
    "access_token": "at-1",
    "refresh_token": "rt-1",
    "expires_in": 3600,
}


class _Saved:
    """收下存进来的那一份，用例据它断言。"""

    def __init__(self) -> None:
        self.bundles: list[TokenBundle] = []
        self.providers: list[uuid.UUID] = []
        self.actors: list[str | None] = []

    async def save(
        self,
        provider_id: uuid.UUID,
        bundle: TokenBundle,
        *,
        auth_mode: str,
        actor: str | None,
    ) -> None:
        assert auth_mode == "chatgpt"
        self.bundles.append(bundle)
        self.providers.append(provider_id)
        self.actors.append(actor)


def _login(*bodies: tuple[int, dict[str, Any]]) -> tuple[DeviceLogin, _Saved]:
    calls = iter(bodies)

    def handle(_request: httpx.Request) -> httpx.Response:
        status, body = next(calls)
        return httpx.Response(status, json=body)

    saved = _Saved()
    return (
        DeviceLogin(
            oauth=OAuthClient(
                httpx.AsyncClient(transport=httpx.MockTransport(handle))
            ),
            cache=InMemoryCache(),
            store=saved,
        ),
        saved,
    )


async def test_the_browser_gets_a_handle_not_the_device_auth_id() -> None:
    login, _ = _login((200, START_BODY))
    started = await login.start(PROVIDER)
    # device_auth_id 是密钥态，一个字都不许下发
    assert started.ref != START_BODY["device_auth_id"]
    assert started.user_code == "ABCD-1234"


async def test_an_unknown_handle_reads_as_expired() -> None:
    login, _ = _login()
    with pytest.raises(LlmLoginSessionExpired):
        await login.poll("没这个句柄", actor=ACTOR)


async def test_a_pending_poll_keeps_waiting() -> None:
    # 上游用 403 表示等待；当成失败的话，人还没点完登录页就红了
    login, saved = _login(
        (200, START_BODY),
        (403, {}),
        (403, {}),
    )
    started = await login.start(PROVIDER)
    first = await login.poll(started.ref, actor=ACTOR)
    assert first.is_done is False
    second = await login.poll(started.ref, actor=ACTOR)
    assert second.is_done is False
    assert saved.bundles == []


async def test_a_finished_poll_saves_the_bundle_and_burns_the_handle() -> None:
    login, saved = _login(
        (200, START_BODY),
        (200, GRANT_BODY),
        (200, TOKEN_BODY),
    )
    started = await login.start(PROVIDER)
    done = await login.poll(started.ref, actor=ACTOR)
    assert done.is_done is True
    assert saved.bundles[0].access_token == "at-1"
    assert saved.actors == [ACTOR]
    # ⚠ 存到哪一路上要跟着开头那一次：一次登录里两处各读一次 provider 的话，
    # 令牌会落在另一路上，而界面上两路都显示「登录成功」
    assert saved.providers == [PROVIDER]
    # 句柄留着的话，同一个码能被再换一次
    with pytest.raises(LlmLoginSessionExpired):
        await login.poll(started.ref, actor=ACTOR)


async def test_a_handle_that_lost_its_provider_reads_as_expired() -> None:
    """⚠ Redis 里那一格是自由形状的 JSON：id 不成形时当这次登录没发生过，
    而不是拿一个空 provider 去存一行永远没人读的登录态。"""
    cache = InMemoryCache()
    await cache.set_json(
        "platform:llm-device-login:ref-1",
        {"provider_id": "不是 uuid", "device_auth_id": "d", "user_code": "u"},
        ttl_s=60,
    )
    made = DeviceLogin(
        oauth=OAuthClient(httpx.AsyncClient()), cache=cache, store=_Saved()
    )
    with pytest.raises(LlmLoginSessionExpired):
        await made.poll("ref-1", actor=ACTOR)
