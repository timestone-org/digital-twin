"""模型供应商面的入参校验：拒绝路径逐条至少一条。

守的是几处「放进去不报错、用起来才炸」的形状：嵌入模型没维数（落库对不上账）、
对话模型带维数（读侧会把它当嵌入模型）、同一路上模型重名（分配时不知道指的是
哪个）、端点不是 http(s)（客户端拼出来的地址打不出去）。
"""

import pytest
from pydantic import SecretStr, ValidationError

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
