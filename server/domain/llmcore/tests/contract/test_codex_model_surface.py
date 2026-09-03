"""契约：我们从 `langchain_openai.chat_models.codex` 借了哪几样。

⚠ 这是本包第二处踩上游**私有面**的地方（第一处是 `reasoning.py`）。借的是
那个把后端硬约束焊死的模型类——只走 Responses 面、`store=false`、必须流式。
自己重写一遍等于把那几条再踩一次，而每一条都是后端 400 出来的。

⚠ 所以这几条用例的作用是：升级 langchain 之后，**红的是测试**而不是生产。
它们红了不代表功能坏了，而是要人去看一眼那几个名字改成了什么。
"""

from dataclasses import dataclass

from langchain_openai.chat_models import codex as upstream

from llmcore.codex import StoredTokenProvider, build_codex_model


@dataclass(frozen=True)
class _Token:
    access_token: str = "at-1"
    account_id: str | None = "acc-1"


class _Source:
    async def usable(self, provider: str) -> _Token:
        assert provider == "p1"
        return _Token()


def test_the_codex_chat_model_is_still_where_we_look_for_it() -> None:
    # 换了名字的话，红的该是这条用例而不是第一次真实对话
    assert hasattr(upstream, "_ChatOpenAICodex")


def test_the_codex_chat_model_still_forces_the_wire_level_fields() -> None:
    """后端那三条硬约束仍由上游焊死。

    ⚠ 它们松开的话我们不会立刻发现：`store=true` 与非流式都要等到真发一次请求
    才撞 400，而那条 400 的措辞与「上游改了默认值」毫无关系。
    """
    forced = (
        upstream._FORCED_VALUES
    )  # pyright: ignore[reportPrivateUsage]  # 理由：见文件头
    assert forced["use_responses_api"] is True
    assert forced["store"] is False
    assert forced["streaming"] is True


def test_the_codex_base_url_still_points_at_the_backend() -> None:
    assert upstream.CHATGPT_CODEX_BASE_URL.startswith(
        "https://chatgpt.com/backend-api"
    )


def test_the_account_id_header_is_still_the_one_we_fill() -> None:
    # 少了它后端认不出是哪个订阅，而我们是靠 token 的 account_id 喂进去的
    assert upstream.ACCOUNT_ID_HEADER.lower() == "chatgpt-account-id"


async def test_the_async_request_path_still_comes_back_for_a_sync_token(
    # ⚠ 实测出来的：上游把 `api_key` 焊成 `_SyncTokenCallable(provider)`，
    # 而 SDK 对同步可调用件的异步适配是丢进执行器线程再调一次**同步**
    # `get_access_token()`。所以「只实现异步两格」的提供者能装配、能登录，
    # 却在每一次对话上 500——而那条 500 指不回这里。
    # 它变了的话，红的该是这条用例而不是现场的第一次对话。
) -> None:
    model = build_codex_model(
        model="some-codex",
        token_provider=StoredTokenProvider(_Source(), "p1", seed=_Token()),
        effort="medium",
        timeout_s=1.0,
        originator="tests",
    )
    provider = (
        model.root_async_client._api_key_provider  # pyright: ignore[reportPrivateUsage, reportAttributeAccessIssue]  # 理由：见文件头
    )
    assert await provider() == "at-1"
