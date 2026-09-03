"""知识库这一侧接得了哪几种接入形态（ADR-0041）。

守的是四件只在现场才看得见的事：目录里配的是订阅账号时，装出来的**真的是**
订阅账号那一路的适配器（装成端点那一路的话，报出来的是一条连不上的网络错）；
用的是**分配指的那个**模型；接不了的形态如实缺席而不是静默改走环境变量那一档
（后者的差异只出现在账单上）；以及这一路要改工具名的线形——本服务的工具名是
`kb.search` 这样的，而那个端点不认点号，不改是每一次带工具的对话都撞一条 400。
"""

import re
from typing import Any

import pytest
from pydantic import SecretStr

from knowledge_server.apps.chat.services.tools.knowledge import (
    KNOWLEDGE_SPECS,
)
from knowledge_server.llm_adapters import (
    KIND_BUILDERS,
    AdapterDeps,
    CatalogChatAdapter,
)
from knowledge_server.settings import Settings
from llmcore import (
    EMPTY_CATALOG,
    Assignment,
    CodexOAuthAdapter,
    ModelCatalog,
    ModelChoice,
    ModelSpec,
    OpenAiCompatAdapter,
    ProviderSpec,
)
from llmcore.codex import wire_names

SECRET = SecretStr("s" * 32)
CODEX_ID = "8f0c1e3a-0000-7000-8000-000000000004"
ENDPOINT_ID = "8f0c1e3a-0000-7000-8000-000000000005"
# 端点认的名字长什么样（实测出来的那条正则）
ENDPOINT_PATTERN = re.compile(r"^[a-zA-Z0-9_-]+$")


class _Token:
    """令牌来源回的那一份。"""

    access_token = "at-1"
    account_id: str | None = "acc-1"


class _Tokens:
    """令牌来源的替身：记下问过哪几路。"""

    def __init__(self) -> None:
        self.asked: list[str] = []

    async def usable(self, provider: str) -> _Token:
        self.asked.append(provider)
        return _Token()


class _Catalog:
    """目录源的替身。"""

    def __init__(self, catalog: ModelCatalog) -> None:
        self.catalog = catalog

    def snapshot(self) -> ModelCatalog:
        return self.catalog

    async def refresh(self, *, is_forced: bool = False) -> ModelCatalog:
        del is_forced
        return self.catalog


def _settings(**overrides: object) -> Settings:
    base: dict[str, object] = {
        "postgres_host": "x",
        "postgres_user": "x",
        "postgres_password": SecretStr("x"),
        "postgres_db": "x",
        "redis_host": "x",
        "edge_signing_secret": SECRET,
        "edge_service_key": SECRET,
        "objectstore_endpoint": "http://knowledge-test:9000",
        "objectstore_bucket": "knowledge-test",
        "objectstore_access_key": SecretStr("knowledge-test"),
        "objectstore_secret_key": SecretStr("s" * 16),
    }
    base.update(overrides)
    return Settings(
        **base
    )  # pyright: ignore[reportArgumentType]  # 理由：用例造件按名传参


def _with_env() -> Settings:
    return _settings(
        model_enabled=True,
        model_base_url="https://env/v1",
        model_api_key=SecretStr("sk-env"),
        model_chat="env-chat",
    )


def _codex_provider(*, options: dict[str, Any] | None = None) -> ProviderSpec:
    return ProviderSpec(
        id=CODEX_ID,
        name="我的 Codex",
        kind="codex_oauth",
        base_url="",
        api_key=SecretStr(""),
        is_enabled=True,
        models=(
            ModelSpec(name="gpt-5-codex", kind="chat"),
            ModelSpec(name="another-codex", kind="chat"),
        ),
        options=options,
    )


def _endpoint_provider() -> ProviderSpec:
    return ProviderSpec(
        id=ENDPOINT_ID,
        name="百炼",
        kind="openai_compat",
        base_url="https://catalog/v1",
        api_key=SecretStr("sk-catalog"),
        is_enabled=True,
        models=(ModelSpec(name="qwen-plus", kind="chat"),),
    )


def _adapter(
    catalog: ModelCatalog,
    *,
    settings: Settings | None = None,
    tokens: _Tokens | None = None,
) -> CatalogChatAdapter:
    return CatalogChatAdapter(
        deps=AdapterDeps(
            settings=settings or _settings(),
            catalog=_Catalog(catalog),
            tokens=tokens if tokens is not None else _Tokens(),
        )
    )


def _assigned(provider: ProviderSpec, model: str) -> ModelCatalog:
    return ModelCatalog(
        providers=(provider,),
        assignments=(Assignment("knowledge.chat", provider.id, model),),
        version="v1",
    )


def test_this_side_takes_both_shipped_kinds() -> None:
    """⚠ 这张表就是「知识库接得了哪几种供应商」的全部答案：平台那边放行了
    一种而这里没有，表现是「界面上分配了、这一侧一句话都说不出来」。"""
    assert set(KIND_BUILDERS) == {"openai_compat", "codex_oauth"}


def test_a_codex_assignment_builds_the_codex_adapter() -> None:
    made = _adapter(_assigned(_codex_provider(), "gpt-5-codex")).current()
    assert isinstance(made, CodexOAuthAdapter)


def test_an_endpoint_assignment_builds_the_endpoint_adapter() -> None:
    made = _adapter(_assigned(_endpoint_provider(), "qwen-plus")).current()
    assert isinstance(made, OpenAiCompatAdapter)


def test_the_assigned_model_is_the_one_that_goes_out() -> None:
    # 挑本路第一个的话，界面上改了分配、这一侧还在打老那一个
    made = _adapter(_assigned(_codex_provider(), "another-codex")).current()
    assert isinstance(made, CodexOAuthAdapter)
    assert made.models == ("another-codex",)


def test_the_effort_configured_on_that_row_is_the_one_used() -> None:
    catalog = _assigned(
        _codex_provider(options={"default_effort": "high"}), "gpt-5-codex"
    )
    made = _adapter(catalog).current()
    assert isinstance(made, CodexOAuthAdapter)
    assert made.default_effort == "high"


async def test_building_leases_a_token_for_that_row() -> None:
    tokens = _Tokens()
    adapter = _adapter(
        _assigned(_codex_provider(), "gpt-5-codex"), tokens=tokens
    )
    await adapter.build(ModelChoice())
    assert tokens.asked == [CODEX_ID]


def test_a_codex_lane_takes_chat_and_summary_but_not_vision() -> None:
    adapter = _adapter(_assigned(_codex_provider(), "gpt-5-codex"))
    assert adapter.supports("chat") is True
    assert adapter.supports("summary") is True
    assert adapter.supports("vision") is False


def test_a_codex_lane_without_a_token_source_is_absent() -> None:
    """没接令牌来源时那一路不出现：令牌无处可领。"""
    adapter = CatalogChatAdapter(
        deps=AdapterDeps(
            settings=_settings(),
            catalog=_Catalog(_assigned(_codex_provider(), "gpt-5-codex")),
        )
    )
    assert adapter.current() is None
    assert adapter.supports("chat") is False


def test_an_unassigned_purpose_falls_back_to_the_environment_lane() -> None:
    adapter = _adapter(EMPTY_CATALOG, settings=_with_env())
    made = adapter.current()
    assert isinstance(made, OpenAiCompatAdapter)
    assert made.supports("chat") is True


def test_a_deployment_with_neither_says_it_cannot_answer() -> None:
    assert _adapter(EMPTY_CATALOG).supports("chat") is False


def test_a_kind_this_side_cannot_build_is_absent_not_silently_metered(
    # 静默改走环境变量那一档的话，差异只出现在账单上
) -> None:
    strange = ProviderSpec(
        id="p9",
        name="将来某一家",
        kind="something_new",
        base_url="",
        api_key=SecretStr(""),
        is_enabled=True,
        models=(ModelSpec(name="m", kind="chat"),),
    )
    adapter = _adapter(_assigned(strange, "m"), settings=_with_env())
    assert adapter.current() is None
    assert adapter.supports("chat") is False


@pytest.mark.parametrize(
    ("catalog", "is_codex"),
    [
        (_assigned(_codex_provider(), "gpt-5-codex"), True),
        (_assigned(_endpoint_provider(), "qwen-plus"), False),
        (EMPTY_CATALOG, False),
    ],
    ids=["codex", "endpoint", "absent"],
)
def test_only_the_codex_lane_asks_for_the_wire_rename(
    catalog: ModelCatalog, is_codex: bool
) -> None:
    """⚠ 问的是适配器自己：这一侧只有一个档位（`default`），按档位名比的话，
    配了订阅账号之后每一次带工具的对话都撞一条 400，而那条 400 里既不说是
    哪个工具、也不说问题出在点号上。"""
    assert _adapter(catalog, settings=_with_env()).is_codex_now() is is_codex


def test_every_tool_this_service_declares_survives_the_wire_rename() -> None:
    # ⚠ 换回来是按 `__` 反着切：规范名里出现 `__` 就分不开了，
    # 现象是「模型说它调了工具，然后什么都没发生」
    for spec in KNOWLEDGE_SPECS:
        wired = wire_names.to_wire(spec.name)
        assert ENDPOINT_PATTERN.fullmatch(wired)
        assert wire_names.from_wire(wired) == spec.name
