"""模型供应商面的入参校验：拒绝路径逐条至少一条。

守的是几处「放进去不报错、用起来才炸」的形状：嵌入模型没维数（落库对不上账）、
对话模型带维数（读侧会把它当嵌入模型）、同一路上模型重名（分配时不知道指的是
哪个）、端点不是 http(s)（客户端拼出来的地址打不出去）。
"""

import pytest
from pydantic import SecretStr, ValidationError

from platform_server.apps.llm_providers.enums import (
    PROVIDER_KIND_CODEX_OAUTH,
    PROVIDER_KIND_OPENAI_COMPAT,
)
from platform_server.apps.llm_providers.schemas import (
    LlmModelIn,
    LlmProviderIn,
    LlmProviderUpdateIn,
)


def _provider(**overrides: object) -> LlmProviderIn:
    base: dict[str, object] = {
        "name": "百炼",
        "base_url": "https://endpoint/compatible-mode/v1",
        "api_key": SecretStr("sk-x"),
        "models": [{"name": "qwen-plus", "kind": "chat"}],
    }
    base.update(overrides)
    return LlmProviderIn.model_validate(base)


def test_a_minimal_provider_validates() -> None:
    made = _provider()
    assert made.is_enabled is True
    assert made.models[0].has_vision is False
    assert made.extra_body is None


def test_an_embedding_model_needs_dimensions() -> None:
    with pytest.raises(ValidationError, match="维数"):
        LlmModelIn.model_validate({"name": "e", "kind": "embedding"})


def test_a_chat_model_must_not_carry_dimensions() -> None:
    with pytest.raises(ValidationError, match="嵌入模型"):
        LlmModelIn.model_validate(
            {"name": "c", "kind": "chat", "dimensions": 1536}
        )


def test_an_unknown_kind_is_rejected() -> None:
    with pytest.raises(ValidationError, match="种类"):
        LlmModelIn.model_validate({"name": "x", "kind": "audio"})


def test_duplicate_model_names_on_one_provider_are_rejected() -> None:
    with pytest.raises(ValidationError, match="重复"):
        _provider(
            models=[
                {"name": "same", "kind": "chat"},
                {"name": "same", "kind": "chat"},
            ]
        )


@pytest.mark.parametrize(
    "base_url",
    ["ftp://x/v1", "endpoint/v1", "", "https://"],
    ids=["ftp", "no-scheme", "empty", "scheme-only"],
)
def test_a_non_http_endpoint_is_rejected(base_url: str) -> None:
    with pytest.raises(ValidationError):
        _provider(base_url=base_url)


def test_an_empty_api_key_is_rejected() -> None:
    with pytest.raises(ValidationError):
        _provider(api_key=SecretStr(""))


def test_unknown_fields_are_rejected_rather_than_ignored() -> None:
    """⚠ 多带一个字段就拒绝：放行的话，客户端会以为某个拼错的字段生效了。"""
    with pytest.raises(ValidationError):
        _provider(api_key_hint="…abcd")


def test_the_update_body_distinguishes_absent_from_null_extra_body() -> None:
    """缺省是「不动」，`null` 是「清空方言体」——两者不许混。"""
    untouched = LlmProviderUpdateIn.model_validate({"name": "改名"})
    cleared = LlmProviderUpdateIn.model_validate({"extra_body": None})
    assert "extra_body" not in untouched.model_fields_set
    assert "extra_body" in cleared.model_fields_set
    assert cleared.extra_body is None


def test_the_default_kind_is_the_endpoint_one() -> None:
    """⚠ 不带这一格的客户端建出来的正是端点那一形态：换个默认等于让存量
    调用方建出一路没人接得了的供应商。"""
    assert _provider().kind == PROVIDER_KIND_OPENAI_COMPAT


def test_an_endpoint_provider_without_a_base_url_is_rejected() -> None:
    with pytest.raises(ValidationError, match="端点地址"):
        _provider(base_url=None)


def test_an_endpoint_provider_without_a_key_is_rejected() -> None:
    with pytest.raises(ValidationError, match="API 密钥"):
        _provider(api_key=None)


def test_a_login_based_provider_validates_without_an_endpoint() -> None:
    made = LlmProviderIn.model_validate(
        {
            "name": "Codex",
            "kind": PROVIDER_KIND_CODEX_OAUTH,
            "models": [{"name": "gpt-5-codex", "kind": "chat"}],
            "options": {"default_effort": "high"},
        }
    )
    assert made.base_url is None
    assert made.api_key is None


def test_a_login_based_provider_must_not_carry_an_endpoint() -> None:
    """⚠ 带了就拒而不是存下来当没看见：存下来的那一格填了、读得回来，
    唯独没有任何一侧会读它。"""
    with pytest.raises(ValidationError, match="靠登录"):
        LlmProviderIn.model_validate(
            {
                "name": "Codex",
                "kind": PROVIDER_KIND_CODEX_OAUTH,
                "base_url": "https://endpoint/v1",
                "models": [],
            }
        )


def test_a_login_based_provider_rejects_embedding_models() -> None:
    with pytest.raises(ValidationError, match="登记不了"):
        LlmProviderIn.model_validate(
            {
                "name": "Codex",
                "kind": PROVIDER_KIND_CODEX_OAUTH,
                "models": [{"name": "e", "kind": "embedding", "dimensions": 8}],
            }
        )


def test_an_unknown_effort_is_rejected() -> None:
    with pytest.raises(ValidationError, match="推理档位"):
        LlmProviderIn.model_validate(
            {
                "name": "Codex",
                "kind": PROVIDER_KIND_CODEX_OAUTH,
                "models": [],
                "options": {"default_effort": "turbo"},
            }
        )


def test_an_unknown_option_key_is_rejected() -> None:
    with pytest.raises(ValidationError, match="不认识配置项"):
        LlmProviderIn.model_validate(
            {
                "name": "Codex",
                "kind": PROVIDER_KIND_CODEX_OAUTH,
                "models": [],
                "options": {"temperature": 1},
            }
        )


def test_an_endpoint_provider_has_no_reasoning_effort_to_configure() -> None:
    """⚠ 形态之间的键不通用：端点那一路配得出重排线形，配不出推理档位。"""
    with pytest.raises(ValidationError, match="不认识配置项"):
        _provider(options={"default_effort": "high"})


def test_the_endpoint_kind_takes_a_rerank_dialect() -> None:
    made = _provider(
        models=[{"name": "gte-rerank", "kind": "rerank"}],
        options={"rerank_dialect": "dashscope"},
    )
    assert made.options == {"rerank_dialect": "dashscope"}


def test_an_unknown_rerank_dialect_is_rejected() -> None:
    """⚠ 这边配得出而调用侧没装的话，表现是「选得中、调用时说不认识」。"""
    with pytest.raises(ValidationError, match="重排线形"):
        _provider(options={"rerank_dialect": "cohere-v3"})


def test_a_login_based_provider_rejects_rerank_models() -> None:
    """⚠ 订阅那一路打的不是重排端点，登记了也没人读得到。"""
    with pytest.raises(ValidationError, match="登记不了"):
        LlmProviderIn.model_validate(
            {
                "name": "Codex",
                "kind": PROVIDER_KIND_CODEX_OAUTH,
                "models": [{"name": "r", "kind": "rerank"}],
            }
        )


def test_a_login_based_provider_has_no_rerank_dialect_to_configure() -> None:
    with pytest.raises(ValidationError, match="不认识配置项"):
        LlmProviderIn.model_validate(
            {
                "name": "Codex",
                "kind": PROVIDER_KIND_CODEX_OAUTH,
                "models": [],
                "options": {"rerank_dialect": "jina"},
            }
        )


def test_a_rerank_model_carries_no_dimensions() -> None:
    """⚠ 重排什么都不落库：给它一格维数会让读侧把它当成嵌入模型。"""
    with pytest.raises(ValidationError, match="只有嵌入模型"):
        _provider(
            models=[
                {"name": "gte-rerank", "kind": "rerank", "dimensions": 1024}
            ]
        )


def test_an_unknown_provider_kind_is_rejected() -> None:
    with pytest.raises(ValidationError, match="未登记的供应商形态"):
        _provider(kind="ollama")


def test_the_update_body_carries_no_kind() -> None:
    """⚠ 改形态等于换一路接法：密钥、登录态与模型清单全部作废，
    那是删了重建。放行的话，一路配好的供应商会在改名的那一次静默换掉接法。"""
    assert "kind" not in LlmProviderUpdateIn.model_fields
