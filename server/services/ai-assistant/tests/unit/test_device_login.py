"""设备码登录的两步编排。

守三条只有出事才看得见的规矩：交给浏览器的是**句柄**不是 `device_auth_id`、
轮询要把上游给的句柄与用户码一起带上（少一格就是 422）、
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


async def test_the_browser_gets_a_handle_not_the_device_auth_id() -> None:
    login, _ = _login((200, START_BODY))
    started = await login.start("codex")
    # device_auth_id 是密钥态，一个字都不许下发
    assert started.ref != START_BODY["device_auth_id"]
    assert started.user_code == "ABCD-1234"


async def test_an_unknown_handle_reads_as_expired() -> None:
    login, _ = _login()
    with pytest.raises(LoginSessionExpired):
        await login.poll("没这个句柄", actor_id=ACTOR)


async def test_a_pending_poll_keeps_waiting() -> None:
    # 上游用 403 表示等待；当成失败的话，人还没点完登录页就红了
    login, saved = _login(
        (200, START_BODY),
        (403, {}),
        (403, {}),
    )
    started = await login.start("codex")
    first = await login.poll(started.ref, actor_id=ACTOR)
    assert first.is_done is False
    second = await login.poll(started.ref, actor_id=ACTOR)
    assert second.is_done is False
    assert saved.bundles == []


async def test_a_finished_poll_saves_the_bundle_and_burns_the_handle() -> None:
    login, saved = _login(
        (200, START_BODY),
        (200, GRANT_BODY),
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
