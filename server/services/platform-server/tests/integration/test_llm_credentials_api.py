"""订阅账号登录态打真库：登录、看状态、退出，以及内部面下发短时令牌。

守的是这一族最要紧的四件事：令牌**只以密文落库**且对外一个字都不回；登录态
只挂得上要登录的那一形态（挂在填端点的那一路上就永远没有人读）；内部面只认
服务级密钥；还有**续期只在这一侧做**——快过期时那一跳由平台自己发出去，
下发的是换好的那一份。
"""

import datetime as dt
from dataclasses import replace
from typing import Any

import httpx
import pytest
from conftest import AppContext, SignHeaders
from pydantic import SecretStr
from sqlalchemy import select

from lib.crypto import SecretCipher
from lib.testing import InMemoryCache
from platform_server.apps.llm_providers.catalog import LLM_VIEW
from platform_server.apps.llm_providers.models import LlmProviderCredential
from platform_server.apps.llm_providers.services import (
    CredentialStore,
    DeviceLogin,
    OAuthClient,
)
from platform_server.apps.llm_providers.services.tokens import TokenBundle
from platform_server.container import LlmParts

pytestmark = pytest.mark.requires_postgres

PROVIDERS = "/api/v1/platform/llm-providers"
LEASE = "/internal/v1/platform/llm-credentials/{id}:token"
SECRET = "llm-provider-secret-0123456789abcdef"
HTTP_CREATED = 201
HTTP_NO_CONTENT = 204
HTTP_BAD_REQUEST = 400
HTTP_UNAUTHORIZED = 401
HTTP_FORBIDDEN = 403
HTTP_NOT_FOUND = 404

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
    "access_token": "at-first",
    "refresh_token": "rt-first",
    "expires_in": 3600,
}
REFRESHED_BODY = {
    "access_token": "at-second",
    "refresh_token": "rt-second",
    "expires_in": 3600,
}


def data_of(response: httpx.Response) -> Any:
    """取信封里的 data。"""
    return response.json()["data"]


class _Upstream:
    """假上游：按预置的应答序列回，并记下发过几跳。"""

    def __init__(self) -> None:
        self.answers: list[tuple[int, dict[str, Any]]] = []
        self.sent = 0

    def queue(self, *answers: tuple[int, dict[str, Any]]) -> None:
        self.answers.extend(answers)

    def handle(self, _request: httpx.Request) -> httpx.Response:
        self.sent += 1
        status, body = self.answers.pop(0)
        return httpx.Response(status, json=body)

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(self.handle))


@pytest.fixture
def upstream() -> _Upstream:
    """这条用例里上游会怎么答。"""
    return _Upstream()


@pytest.fixture
def login_context(app_context: AppContext, upstream: _Upstream) -> AppContext:
    """把加解密器、登录态读写与设备码登录一起装进容器。

    ⚠ 会话工厂用的是用例那条回滚事务的：另开一条连接的话，登录写进去的那一行
    在 HTTP 那侧根本看不见，而现象是「登录成功了、状态却说没登录」。

    Args: app_context, upstream。
    """
    application = (
        app_context.client._transport.app
    )  # pyright: ignore[reportPrivateUsage, reportAttributeAccessIssue]  # 理由：用例要往容器里换件
    container = application.state.container
    cipher = SecretCipher(SECRET, label="test")
    oauth = OAuthClient(upstream.client())
    store = CredentialStore(
        sessions=app_context.sessions.session,
        cipher=cipher,
        oauth=oauth,
        cache=InMemoryCache(),
    )
    application.state.container = replace(
        container,
        llm=LlmParts(
            cipher=cipher,
            credentials=store,
            device_login=DeviceLogin(
                oauth=oauth, cache=InMemoryCache(), store=store
            ),
        ),
        settings=container.settings.model_copy(
            update={"llm_provider_secret": SecretStr(SECRET)}
        ),
    )
    return app_context


async def _codex_provider(client: httpx.AsyncClient) -> str:
    """建一路订阅账号形态的供应商，回它的 id。"""
    response = await client.post(
        PROVIDERS,
        json={
            "name": "订阅账号",
            "kind": "codex_oauth",
            "models": [{"name": "gpt-5-codex", "kind": "chat"}],
        },
    )
    assert response.status_code == HTTP_CREATED, response.text
    return str(data_of(response)["id"])


async def _endpoint_provider(client: httpx.AsyncClient) -> str:
    """建一路填端点的供应商，回它的 id。"""
    response = await client.post(
        PROVIDERS,
        json={
            "name": "百炼",
            "base_url": "https://endpoint/compatible-mode/v1",
            "api_key": "sk-very-secret-1234",
            "models": [{"name": "qwen-plus", "kind": "chat"}],
        },
    )
    assert response.status_code == HTTP_CREATED, response.text
    return str(data_of(response)["id"])


async def _logged_in(
    context: AppContext, upstream: _Upstream, provider_id: str
) -> None:
    """走完一次设备码登录。"""
    upstream.queue(
        (200, START_BODY), (200, GRANT_BODY), (200, dict(TOKEN_BODY))
    )
    started = await context.client.post(
        f"{PROVIDERS}/{provider_id}/credential:start-login"
    )
    assert started.status_code == httpx.codes.OK, started.text
    polled = await context.client.post(
        f"{PROVIDERS}/{provider_id}/credential:poll-login",
        json={"ref": data_of(started)["ref"]},
    )
    assert polled.status_code == httpx.codes.OK, polled.text
    assert data_of(polled)["is_done"] is True


async def test_a_fresh_lane_reports_that_it_is_not_connected(
    login_context: AppContext,
) -> None:
    provider_id = await _codex_provider(login_context.client)
    response = await login_context.client.get(
        f"{PROVIDERS}/{provider_id}/credential"
    )
    assert response.status_code == httpx.codes.OK
    assert data_of(response)["is_connected"] is False


async def test_a_finished_login_lands_encrypted_and_never_comes_back_out(
    login_context: AppContext, upstream: _Upstream
) -> None:
    provider_id = await _codex_provider(login_context.client)
    await _logged_in(login_context, upstream, provider_id)
    read = await login_context.client.get(
        f"{PROVIDERS}/{provider_id}/credential"
    )
    body = read.text
    # ⚠ 令牌一个字都不出对外这道门：出去过一次就永远躺在别人的 devtools 里
    assert "at-first" not in body
    assert "rt-first" not in body
    assert data_of(read)["is_connected"] is True
    rows = await login_context.session.execute(select(LlmProviderCredential))
    stored = rows.scalars().one()
    assert "at-first" not in stored.token_enc


async def test_the_internal_face_leases_a_short_lived_token(
    login_context: AppContext, upstream: _Upstream, settings: Any
) -> None:
    provider_id = await _codex_provider(login_context.client)
    await _logged_in(login_context, upstream, provider_id)
    response = await login_context.client.post(
        LEASE.format(id=provider_id),
        headers={"X-Service-Key": settings.edge_service_key.get_secret_value()},
    )
    assert response.status_code == httpx.codes.OK, response.text
    leased = data_of(response)
    assert leased["access_token"] == "at-first"
    assert leased["expires_at"]


async def test_the_internal_face_refuses_without_the_service_key(
    login_context: AppContext,
) -> None:
    provider_id = await _codex_provider(login_context.client)
    response = await login_context.client.post(LEASE.format(id=provider_id))
    assert response.status_code == HTTP_UNAUTHORIZED


async def test_leasing_a_lane_that_never_logged_in_is_a_404(
    login_context: AppContext, settings: Any
) -> None:
    # ⚠ 与「暂时不可用」分开：消费方据它说「去登录一次」而不是「等一等」
    provider_id = await _codex_provider(login_context.client)
    response = await login_context.client.post(
        LEASE.format(id=provider_id),
        headers={"X-Service-Key": settings.edge_service_key.get_secret_value()},
    )
    assert response.status_code == HTTP_NOT_FOUND


async def test_a_stale_token_is_refreshed_on_this_side_before_it_goes_out(
    login_context: AppContext, upstream: _Upstream, settings: Any
) -> None:
    """⚠ 续期只在平台这一侧做：两个消费方各自去刷同一个 refresh_token 会互相
    把对方的令牌作废，而现象是「用着用着就掉登录」。"""
    provider_id = await _codex_provider(login_context.client)
    await _logged_in(login_context, upstream, provider_id)
    await _make_stale(login_context)
    upstream.queue((200, dict(REFRESHED_BODY)))
    before = upstream.sent
    response = await login_context.client.post(
        LEASE.format(id=provider_id),
        headers={"X-Service-Key": settings.edge_service_key.get_secret_value()},
    )
    assert response.status_code == httpx.codes.OK, response.text
    assert data_of(response)["access_token"] == "at-second"
    # 换那一跳是平台自己发的
    assert upstream.sent == before + 1


async def test_a_login_only_hangs_on_a_lane_that_actually_logs_in(
    login_context: AppContext,
) -> None:
    # 挂在填端点的那一路上，那一行永远没有人读，而界面上显示「登录成功」
    provider_id = await _endpoint_provider(login_context.client)
    response = await login_context.client.post(
        f"{PROVIDERS}/{provider_id}/credential:start-login"
    )
    assert response.status_code == HTTP_BAD_REQUEST


async def test_an_unknown_provider_is_a_404(
    login_context: AppContext,
) -> None:
    response = await login_context.client.get(
        f"{PROVIDERS}/00000000-0000-0000-0000-000000000001/credential"
    )
    assert response.status_code == HTTP_NOT_FOUND


async def test_signing_out_removes_the_row_and_says_so_only_once(
    login_context: AppContext, upstream: _Upstream
) -> None:
    provider_id = await _codex_provider(login_context.client)
    await _logged_in(login_context, upstream, provider_id)
    gone = await login_context.client.delete(
        f"{PROVIDERS}/{provider_id}/credential"
    )
    assert gone.status_code == HTTP_NO_CONTENT
    again = await login_context.client.delete(
        f"{PROVIDERS}/{provider_id}/credential"
    )
    assert again.status_code == HTTP_NOT_FOUND


async def test_deleting_the_provider_takes_its_login_with_it(
    login_context: AppContext, upstream: _Upstream
) -> None:
    """⚠ 留着的话，下一个建出来的供应商可能撞上一行没人认领的登录态。"""
    provider_id = await _codex_provider(login_context.client)
    await _logged_in(login_context, upstream, provider_id)
    gone = await login_context.client.delete(f"{PROVIDERS}/{provider_id}")
    assert gone.status_code == HTTP_NO_CONTENT
    rows = await login_context.session.execute(select(LlmProviderCredential))
    assert rows.scalars().all() == []


async def test_a_viewer_can_see_the_login_but_cannot_change_it(
    login_context: AppContext, sign: SignHeaders
) -> None:
    """⚠ 读要 view、写要 manage，与边缘那两条规则逐字一致：把读也收成 manage
    的话，只读用户在边缘处放行、在端点上 403，而两边代码单看都对。
    这一份凭据是整套部署共用的，换掉它等于替所有消费方换了说话的账号。"""
    provider_id = await _codex_provider(login_context.client)
    viewer = sign((LLM_VIEW,))
    read = await login_context.client.get(
        f"{PROVIDERS}/{provider_id}/credential", headers=viewer
    )
    assert read.status_code == httpx.codes.OK
    denied = await login_context.client.post(
        f"{PROVIDERS}/{provider_id}/credential:start-login", headers=viewer
    )
    assert denied.status_code == HTTP_FORBIDDEN


async def _make_stale(context: AppContext) -> None:
    """把库里那一行改成「快过期了」，逼下一次下发先去换一份。

    ⚠ 改的是密文里那一格而不是行上的 `expires_at`：判「该不该换」读的是解开
    之后的那一份，只改行上那一格的话这条用例会绿在一个不存在的判据上。

    Args: context。
    """
    rows = await context.session.execute(select(LlmProviderCredential))
    row = rows.scalars().one()
    cipher = SecretCipher(SECRET, label="test")
    stale = TokenBundle(
        access_token="at-first",
        refresh_token="rt-first",
        expires_at=dt.datetime.now(dt.UTC) + dt.timedelta(seconds=30),
    )
    row.token_enc = stale.to_cipher_text(cipher)
    await context.session.flush()
