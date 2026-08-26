"""契约：我们从 `langchain_openai.chatgpt_oauth` 借了哪几样。

⚠ 这是本服务第二处踩上游**私有面**的地方（第一处是 `llm/reasoning.py`）。
借的只是几个**协议常量**——端点地址、client_id、scope；抄一份到自己代码里的话，
上游改地址时我们静默失效，现象是「登录页转圈转到超时」。

⚠ 借的**不包括它那套设备码实现**：那一份对不上现在的端点（详见
`oauth_client` 文件头列的四处差异），线形以我们自己那组实测用例为准。

⚠ 所以这条用例的作用是：升级 langchain 之后，**红的是测试**而不是生产。
它红了不代表功能坏了，而是要人去看一眼那几个名字改成了什么。
"""

from dataclasses import dataclass

import langchain_openai.chatgpt_oauth as upstream
from langchain_openai.chat_models import codex as codex_upstream

from ai_assistant.apps.credential.services.tokens import CLAIMS_NAMESPACE
from ai_assistant.llm.codex import StoredTokenProvider, build_codex_model


@dataclass(frozen=True)
class _Token:
    access_token: str = "at-1"
    account_id: str | None = "acc-1"


class _Source:
    async def usable(self, provider: str) -> _Token:
        assert provider == "codex"
        return _Token()


def test_the_names_we_borrow_are_still_there() -> None:
    borrowed = (
        "CHATGPT_CLIENT_ID",
        "CHATGPT_TOKEN_URL",
        "CHATGPT_DEVICE_CODE_URL",
        "CHATGPT_DEVICE_TOKEN_URL",
        "CHATGPT_DEVICE_REDIRECT_URI",
        "DEFAULT_SCOPE",
        "decode_jwt_claims",
    )
    missing = [name for name in borrowed if not hasattr(upstream, name)]
    assert missing == []


def test_the_endpoints_are_still_https_urls() -> None:
    for name in (
        "CHATGPT_TOKEN_URL",
        "CHATGPT_DEVICE_CODE_URL",
        "CHATGPT_DEVICE_TOKEN_URL",
    ):
        value = getattr(upstream, name)
        assert isinstance(value, str)
        assert value.startswith("https://")


def test_the_scope_still_asks_for_offline_access() -> None:
    # 少了它就没有 refresh_token，而那意味着令牌到期之后只能让人重新登录一次
    assert "offline_access" in upstream.DEFAULT_SCOPE


def test_the_claims_namespace_matches_the_one_we_read() -> None:
    assert upstream.CHATGPT_AUTH_CLAIMS_NAMESPACE == CLAIMS_NAMESPACE


def test_the_codex_chat_model_is_still_where_we_look_for_it() -> None:
    # 换了名字的话，红的该是这条用例而不是第一次真实对话
    assert hasattr(codex_upstream, "_ChatOpenAICodex")


def test_the_codex_chat_model_still_forces_the_wire_level_fields() -> None:
    """后端那三条硬约束仍由上游焊死。

    ⚠ 它们松开的话我们不会立刻发现：`store=true` 与非流式都要等到真发一次请求
    才撞 400，而那条 400 的措辞与「上游改了默认值」毫无关系。
    """
    forced = (
        codex_upstream._FORCED_VALUES
    )  # pyright: ignore[reportPrivateUsage]  # 理由：见文件头
    assert forced["use_responses_api"] is True
    assert forced["store"] is False
    assert forced["streaming"] is True


def test_the_codex_base_url_still_points_at_the_backend() -> None:
    assert codex_upstream.CHATGPT_CODEX_BASE_URL.startswith(
        "https://chatgpt.com/backend-api"
    )


def test_the_account_id_header_is_still_the_one_we_fill() -> None:
    # 少了它后端认不出是哪个订阅，而我们是靠 token 的 account_id 喂进去的
    assert codex_upstream.ACCOUNT_ID_HEADER.lower() == "chatgpt-account-id"


async def test_the_async_request_path_still_comes_back_for_a_sync_token(
    # ⚠ 实测出来的：上游把 `api_key` 焊成 `_SyncTokenCallable(provider)`，
    # 而 SDK 对同步可调用件的异步适配是丢进执行器线程再调一次**同步**
    # `get_access_token()`。所以「只实现异步两格」的提供者能装配、能登录，
    # 却在每一次对话上 500——而那条 500 指不回这里。
    # 它变了的话，红的该是这条用例而不是现场的第一次对话。
) -> None:
    model = build_codex_model(
        model="some-codex",
        token_provider=StoredTokenProvider(_Source(), seed=_Token()),
        effort="medium",
        timeout_s=1.0,
    )
    provider = (
        model.root_async_client._api_key_provider  # pyright: ignore[reportPrivateUsage, reportAttributeAccessIssue]  # 理由：见文件头
    )
    assert await provider() == "at-1"
