"""契约：我们从 `langchain_openai.chatgpt_oauth` 借了哪几样。

⚠ 这是本服务第二处踩上游**私有面**的地方（第一处是 `llm/reasoning.py`）。
借的东西全是协议常量——端点地址、client_id、scope——抄一份到自己代码里的话，
上游改地址时我们静默失效，现象是「登录页转圈转到超时」。

⚠ 所以这条用例的作用是：升级 langchain 之后，**红的是测试**而不是生产。
它红了不代表功能坏了，而是要人去看一眼那几个名字改成了什么。
"""

import langchain_openai.chatgpt_oauth as upstream

from ai_assistant.apps.credential.services.tokens import CLAIMS_NAMESPACE


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
