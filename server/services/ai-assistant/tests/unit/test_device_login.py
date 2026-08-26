"""设备码登录的两步编排。

守三条只有出事才看得见的规矩：交给浏览器的是**句柄**不是 device_code、
抬高后的轮询间隔要写回去（不写回的话 `slow_down` 永远不生效）、
换到令牌之后立刻作废这次登录（留着的话同一个码能被再换一次）。
"""

import uuid
from typing import Any

import httpx
import pytest

from ai_assistant.apps.credential.errors import LoginSessionExpired
from ai_assistant.apps.credential.services.device_login import DeviceLogin
from ai_assistant.apps.credential.services.oauth_client import OAuthClient
from ai_assistant.apps.credential.services.tokens import TokenBundle
from lib.testing import InMemoryCache

ACTOR = uuid.uuid4()

START_BODY = {
    "device_code": "dc-secret",
    "user_code": "ABCD-1234",
    "verification_uri": "https://example.test/activate",
    "interval": 5,
    "expires_in": 900,
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
        self.actors: list[uuid.UUID | None] = []

    async def save(
        self,
        provider: str,
        bundle: TokenBundle,
        *,
        auth_mode: str,
        actor_id: uuid.UUID | None,
    ) -> None:
        assert provider == "codex"
        assert auth_mode == "chatgpt"
        self.bundles.append(bundle)
        self.actors.append(actor_id)


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


async def test_the_browser_gets_a_handle_not_the_device_code() -> None:
    login, _ = _login((200, START_BODY))
    started = await login.start("codex")
    # device_code 与 PKCE verifier 是密钥态，一个字都不许下发
    assert started.ref != START_BODY["device_code"]
    assert started.user_code == "ABCD-1234"


async def test_an_unknown_handle_reads_as_expired() -> None:
    login, _ = _login()
    with pytest.raises(LoginSessionExpired):
        await login.poll("没这个句柄", actor_id=ACTOR)


async def test_a_pending_poll_reports_the_new_interval() -> None:
    login, saved = _login(
        (200, START_BODY),
        (400, {"error": "slow_down"}),
        (400, {"error": "authorization_pending"}),
    )
    started = await login.start("codex")
    first = await login.poll(started.ref, actor_id=ACTOR)
    assert first.is_done is False
    assert first.interval_s > started.interval_s
    # 抬高后的间隔要写回去，否则下一次又按老间隔来
    second = await login.poll(started.ref, actor_id=ACTOR)
    assert second.interval_s == first.interval_s
    assert saved.bundles == []


async def test_a_finished_poll_saves_the_bundle_and_burns_the_handle() -> None:
    login, saved = _login(
        (200, START_BODY),
        (200, {"authorization_code": "code-1"}),
        (200, TOKEN_BODY),
    )
    started = await login.start("codex")
    done = await login.poll(started.ref, actor_id=ACTOR)
    assert done.is_done is True
    assert saved.bundles[0].access_token == "at-1"
    assert saved.actors == [ACTOR]
    # 句柄留着的话，同一个码能被再换一次
    with pytest.raises(LoginSessionExpired):
        await login.poll(started.ref, actor_id=ACTOR)
