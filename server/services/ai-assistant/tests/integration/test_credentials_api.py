"""凭据面打真库。

守的是这一族最要紧的三件事：令牌**只以密文落库**、状态面一个令牌字都不回、
以及这四条端点要的是 `assistant:manage` 而不是 `assistant:use`——后者是每个
能用助手的人都有的，拿它就能换掉整套部署的模型账号。
"""

from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ai_assistant.apps.chat.catalog import ASSISTANT_USE
from ai_assistant.apps.credential.catalog import ASSISTANT_MANAGE
from ai_assistant.apps.credential.errors import (
    CredentialNotFound,
    LoginRejected,
)
from ai_assistant.apps.credential.services import (
    CredentialStore,
    DeviceLogin,
    OAuthClient,
    TokenBundle,
)
from ai_assistant.llm import ModelRegistry
from ai_assistant.settings import API_PREFIX, Settings
from integration.conftest import DbStack, HeaderFactory
from lib.crypto import SecretCipher
from lib.testing import InMemoryCache

pytestmark = pytest.mark.requires_postgres

CREDENTIALS = f"{API_PREFIX}/credentials/codex"
SECRET = "credential-secret-0123456789abcdef"

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
    "access_token": "at-super-secret",
    "refresh_token": "rt-super-secret",
    "expires_in": 3600,
}

SessionMaker = async_sessionmaker[AsyncSession]


def _factory(maker: SessionMaker) -> Callable[[], Any]:
    """把用例那条回滚连接包成 `Database.session()` 那样的工厂（出块提交）。"""

    @asynccontextmanager
    async def opened() -> AsyncIterator[AsyncSession]:
        async with maker() as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise
            else:
                await session.commit()

    return opened


def _transport(*bodies: tuple[int, dict[str, Any]]) -> httpx.MockTransport:
    calls = iter(bodies)

    def handle(_request: httpx.Request) -> httpx.Response:
        status, body = next(calls)
        return httpx.Response(status, json=body)

    return httpx.MockTransport(handle)


def _wire_codex(
    stack: DbStack, *bodies: tuple[int, dict[str, Any]]
) -> InMemoryCache:
    """把凭据那两件换成：用例的连接 + 假上游 + 进程内缓存。

    把缓存交出去，是为了让用例能预先占住刷新锁（那是「别人正在换」那条路）。
    """
    oauth = OAuthClient(httpx.AsyncClient(transport=_transport(*bodies)))
    cache = InMemoryCache()
    store = CredentialStore(
        sessions=_factory(stack.sessions),
        cipher=SecretCipher(SECRET, label="test"),
        oauth=oauth,
        cache=cache,
    )
    settings = replace_settings(stack.app.state.container.settings)
    stack.app.state.container = replace(
        stack.app.state.container,
        settings=settings,
        credentials=store,
        device_login=DeviceLogin(oauth=oauth, cache=cache, store=store),
        # 能力面按注册表铺清单，不换的话这套部署里根本没有订阅账号那一路
        models=ModelRegistry(settings, tokens=store),
    )
    return cache


def replace_settings(settings: Settings) -> Settings:
    """把配置改成「接了订阅账号那一路」。"""
    return settings.model_copy(
        update={
            "codex_enabled": True,
            "codex_model": "some-codex",
            "credential_secret": SecretStr(SECRET),
        }
    )


@pytest.fixture
def manage_headers(sign: HeaderFactory) -> dict[str, str]:
    """带 `assistant:manage` 的一组身份头。"""
    return sign((ASSISTANT_USE, ASSISTANT_MANAGE))


async def test_a_fresh_deployment_reports_not_connected(
    db_stack: DbStack, manage_headers: dict[str, str]
) -> None:
    _wire_codex(db_stack)
    body = (
        await db_stack.client.get(CREDENTIALS, headers=manage_headers)
    ).json()
    assert body["data"]["is_connected"] is False
    assert body["data"]["account_label"] is None


async def test_use_alone_cannot_touch_the_credentials(
    db_stack: DbStack, sign: HeaderFactory
) -> None:
    # 拿 assistant:use 就能换掉整套部署的模型账号，那这道门等于没有
    _wire_codex(db_stack)
    response = await db_stack.client.get(
        CREDENTIALS, headers=sign((ASSISTANT_USE,))
    )
    assert response.status_code == 403


async def test_a_device_login_lands_a_ciphered_row(
    db_stack: DbStack, manage_headers: dict[str, str]
) -> None:
    _wire_codex(
        db_stack,
        (200, START_BODY),
        (200, GRANT_BODY),
        (200, TOKEN_BODY),
    )
    started = (
        await db_stack.client.post(
            f"{CREDENTIALS}:start-login", headers=manage_headers
        )
    ).json()["data"]
    # 交给浏览器的是句柄，不是 device_code
    assert started["ref"] != START_BODY["device_auth_id"]
    assert started["user_code"] == "ABCD-1234"

    polled = (
        await db_stack.client.post(
            f"{CREDENTIALS}:poll-login",
            headers=manage_headers,
            json={"ref": started["ref"]},
        )
    ).json()["data"]
    assert polled["is_done"] is True
    assert polled["status"]["is_connected"] is True

    async with db_stack.sessions() as session:
        stored = (
            await session.execute(
                text("SELECT token_enc FROM assistant.model_credentials")
            )
        ).scalar_one()
    # 明文令牌进了库的话，一次库泄漏就是整个订阅账号
    assert TOKEN_BODY["access_token"] not in stored
    assert TOKEN_BODY["refresh_token"] not in stored


async def test_the_status_face_never_returns_a_token(
    db_stack: DbStack, manage_headers: dict[str, str]
) -> None:
    _wire_codex(
        db_stack,
        (200, START_BODY),
        (200, GRANT_BODY),
        (200, TOKEN_BODY),
    )
    started = (
        await db_stack.client.post(
            f"{CREDENTIALS}:start-login", headers=manage_headers
        )
    ).json()["data"]
    await db_stack.client.post(
        f"{CREDENTIALS}:poll-login",
        headers=manage_headers,
        json={"ref": started["ref"]},
    )
    raw = (await db_stack.client.get(CREDENTIALS, headers=manage_headers)).text
    assert TOKEN_BODY["access_token"] not in raw
    assert TOKEN_BODY["refresh_token"] not in raw


async def test_forgetting_a_never_logged_in_provider_is_a_404(
    db_stack: DbStack, manage_headers: dict[str, str]
) -> None:
    _wire_codex(db_stack)
    response = await db_stack.client.delete(CREDENTIALS, headers=manage_headers)
    assert response.status_code == 404


async def test_an_unknown_provider_is_rejected(
    db_stack: DbStack, manage_headers: dict[str, str]
) -> None:
    _wire_codex(db_stack)
    response = await db_stack.client.get(
        f"{API_PREFIX}/credentials/nope", headers=manage_headers
    )
    # 放行的话它会建出一行永远没人读的凭据
    assert response.status_code == 400


async def test_a_polled_handle_that_expired_is_a_404(
    db_stack: DbStack, manage_headers: dict[str, str]
) -> None:
    _wire_codex(db_stack)
    response = await db_stack.client.post(
        f"{CREDENTIALS}:poll-login",
        headers=manage_headers,
        json={"ref": "没这个句柄"},
    )
    assert response.status_code == 404


async def _login_once(
    stack: DbStack, headers: dict[str, str], *extra: tuple[int, dict[str, Any]]
) -> CredentialStore:
    """走一遍登录，把装好的 store 交出去。"""
    _wire_codex(
        stack,
        (200, START_BODY),
        (200, GRANT_BODY),
        (200, TOKEN_BODY),
        *extra,
    )
    started = (
        await stack.client.post(f"{CREDENTIALS}:start-login", headers=headers)
    ).json()["data"]
    await stack.client.post(
        f"{CREDENTIALS}:poll-login",
        headers=headers,
        json={"ref": started["ref"]},
    )
    store = stack.app.state.container.credentials
    assert isinstance(store, CredentialStore)
    return store


async def _expire(stack: DbStack) -> None:
    """把库里那一行改成早就过期。

    ⚠ 过期时刻**在密文里**，旁边那一列只是给界面看的：只改列的话，
    取令牌那一路照旧认为它还新鲜，这条用例会安静地什么都没验到。
    """
    cipher = SecretCipher(SECRET, label="test")
    async with stack.sessions() as session:
        current = (
            await session.execute(
                text("SELECT token_enc FROM assistant.model_credentials")
            )
        ).scalar_one()
        bundle = TokenBundle.from_cipher_text(current, cipher)
        assert bundle is not None
        stale = replace(
            bundle, expires_at=datetime.now(UTC) - timedelta(days=1)
        )
        await session.execute(
            text(
                "UPDATE assistant.model_credentials "
                "SET token_enc = :enc, expires_at = now() - interval '1 day'"
            ),
            {"enc": stale.to_cipher_text(cipher)},
        )
        await session.commit()


async def test_a_refresh_is_written_back_and_reused(
    db_stack: DbStack, manage_headers: dict[str, str]
) -> None:
    # 不写回的话，之后**每一次**对话都要先刷一遍——上游很快就会限流
    store = await _login_once(
        db_stack,
        manage_headers,
        (200, {"access_token": "at-2", "expires_in": 3600}),
    )
    await _expire(db_stack)
    assert await store.access_token("codex") == "at-2"
    # 假上游只排了一次刷新的回应：真去打第二次会 StopIteration
    assert await store.access_token("codex") == "at-2"


async def test_a_rejected_refresh_is_remembered_not_swallowed(
    db_stack: DbStack, manage_headers: dict[str, str]
) -> None:
    store = await _login_once(
        db_stack,
        manage_headers,
        (400, {"error": "invalid_grant"}),
    )
    await _expire(db_stack)
    with pytest.raises(LoginRejected):
        await store.access_token("codex")
    body = (
        await db_stack.client.get(CREDENTIALS, headers=manage_headers)
    ).json()["data"]
    # 删行的话界面上是「从来没登录过」，而真实情况是「需要重新登录一次」
    assert body["is_connected"] is True
    assert body["last_error"] is not None


async def test_forgetting_a_logged_in_provider_clears_the_row(
    db_stack: DbStack, manage_headers: dict[str, str]
) -> None:
    await _login_once(db_stack, manage_headers)
    dropped = await db_stack.client.delete(CREDENTIALS, headers=manage_headers)
    assert dropped.status_code == 204
    body = (
        await db_stack.client.get(CREDENTIALS, headers=manage_headers)
    ).json()["data"]
    assert body["is_connected"] is False


async def test_asking_for_a_token_before_logging_in_is_a_404(
    db_stack: DbStack,
) -> None:
    _wire_codex(db_stack)
    store = db_stack.app.state.container.credentials
    assert isinstance(store, CredentialStore)
    with pytest.raises(CredentialNotFound):
        await store.access_token("codex")


async def test_a_fresh_token_is_handed_back_without_touching_the_upstream(
    db_stack: DbStack, manage_headers: dict[str, str]
) -> None:
    # 每次对话都去刷一遍的话，上游很快就会限流
    store = await _login_once(db_stack, manage_headers)
    assert await store.access_token("codex") == TOKEN_BODY["access_token"]


async def test_a_held_refresh_lock_makes_the_loser_wait_and_reread(
    db_stack: DbStack, manage_headers: dict[str, str]
) -> None:
    # 各刷各的话，每一份新令牌都会把上一份顶掉，而被顶掉的那些已经发出去用了
    cache = _wire_codex(
        db_stack,
        (200, START_BODY),
        (200, GRANT_BODY),
        (200, TOKEN_BODY),
    )
    started = (
        await db_stack.client.post(
            f"{CREDENTIALS}:start-login", headers=manage_headers
        )
    ).json()["data"]
    await db_stack.client.post(
        f"{CREDENTIALS}:poll-login",
        headers=manage_headers,
        json={"ref": started["ref"]},
    )
    store = db_stack.app.state.container.credentials
    assert isinstance(store, CredentialStore)
    await _expire(db_stack)
    # 别人占着锁：这一次不许去打上游（假件也确实没排刷新的回应）
    await cache.set_if_absent("credential-refresh:codex", "别人", ttl_s=30)
    assert await store.access_token("codex") == TOKEN_BODY["access_token"]


async def test_a_deployment_without_codex_says_so(
    db_stack: DbStack, manage_headers: dict[str, str]
) -> None:
    # 没接这一路时如实回 503，而不是让整个服务起不来
    db_stack.app.state.container = replace(
        db_stack.app.state.container, credentials=None, device_login=None
    )
    read = await db_stack.client.get(CREDENTIALS, headers=manage_headers)
    assert read.status_code == 503
    started = await db_stack.client.post(
        f"{CREDENTIALS}:start-login", headers=manage_headers
    )
    assert started.status_code == 503


async def test_a_configured_but_unlogged_route_is_listed_as_not_ready(
    db_stack: DbStack,
) -> None:
    # 配了却没登录时摆成可选的话，用户点下去收到的是一条「模型暂时不可用」
    _wire_codex(db_stack)
    body = (await db_stack.client.get(f"{API_PREFIX}/capabilities")).json()[
        "data"
    ]
    codex = next(one for one in body["models"] if one["id"] == "codex")
    assert codex["is_ready"] is False
    assert "xhigh" in codex["efforts"]


async def test_a_logged_in_route_is_listed_as_ready(
    db_stack: DbStack, manage_headers: dict[str, str]
) -> None:
    await _login_once(db_stack, manage_headers)
    body = (await db_stack.client.get(f"{API_PREFIX}/capabilities")).json()[
        "data"
    ]
    codex = next(one for one in body["models"] if one["id"] == "codex")
    assert codex["is_ready"] is True
