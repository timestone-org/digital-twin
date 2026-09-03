"""接入形态与用途配不配得上，一处判定。

守的是那条**静默**的错配：把知识库的用途指给一路只有助手接得了的供应商时，
分配写得进去、界面上显示配好了，而知识库那一侧永远沿用环境变量那一档——
两边代码单看都对，只有这条闸看得见。
"""

import pytest

from platform_server.apps.llm_providers.enums import (
    DEFAULT_RERANK_DIALECT,
    PROVIDER_KIND_CODEX_OAUTH,
    PROVIDER_KIND_OPENAI_COMPAT,
    ProviderKindSpec,
    PurposeSpec,
    provider_kind_of,
    purpose_of,
)
from platform_server.apps.llm_providers.rules import (
    allowed_options,
    default_effort_of,
    purpose_mismatch,
    rerank_dialect_of,
)


def _kind(code: str) -> ProviderKindSpec:
    found = provider_kind_of(code)
    assert found is not None
    return found


def _purpose(code: str) -> PurposeSpec:
    found = purpose_of(code)
    assert found is not None
    return found


@pytest.mark.parametrize(
    "purpose",
    ["assistant.chat", "assistant.summary", "knowledge.chat"],
)
def test_the_endpoint_kind_serves_every_consumer(purpose: str) -> None:
    assert (
        purpose_mismatch(
            _kind(PROVIDER_KIND_OPENAI_COMPAT),
            _purpose(purpose),
        )
        is None
    )


def test_the_login_kind_is_rejected_for_the_other_consumer() -> None:
    rejected = purpose_mismatch(
        _kind(PROVIDER_KIND_CODEX_OAUTH),
        _purpose("knowledge.chat"),
    )
    assert rejected is not None
    assert "knowledge" in rejected


def test_the_login_kind_is_rejected_for_embeddings() -> None:
    rejected = purpose_mismatch(
        _kind(PROVIDER_KIND_CODEX_OAUTH),
        _purpose("assistant.embedding"),
    )
    assert rejected is not None
    assert "embedding" in rejected


def test_the_login_kind_serves_chat() -> None:
    assert (
        purpose_mismatch(
            _kind(PROVIDER_KIND_CODEX_OAUTH),
            _purpose("assistant.chat"),
        )
        is None
    )


@pytest.mark.parametrize(
    ("options", "expected"),
    [
        (None, None),
        ({}, None),
        ({"default_effort": "high"}, "high"),
        # ⚠ 非字符串一律当没配：这一格要原样进请求体，塞个数字进去是一条 400
        ({"default_effort": 3}, None),
    ],
)
def test_the_configured_effort_is_read_defensively(
    options: dict[str, object] | None, expected: str | None
) -> None:
    assert default_effort_of(options) == expected


def test_the_endpoint_kind_serves_the_rerank_purpose() -> None:
    assert (
        purpose_mismatch(
            _kind(PROVIDER_KIND_OPENAI_COMPAT), _purpose("knowledge.rerank")
        )
        is None
    )


def test_the_login_kind_is_rejected_for_rerank() -> None:
    rejected = purpose_mismatch(
        _kind(PROVIDER_KIND_CODEX_OAUTH), _purpose("knowledge.rerank")
    )
    assert rejected is not None
    assert "knowledge" in rejected


@pytest.mark.parametrize(
    ("options", "expected"),
    [
        (None, DEFAULT_RERANK_DIALECT),
        ({}, DEFAULT_RERANK_DIALECT),
        # ⚠ 没配这一格的存量供应商打的正是默认那一套线形
        ({"default_effort": "high"}, DEFAULT_RERANK_DIALECT),
        ({"rerank_dialect": "dashscope"}, "dashscope"),
        ({"rerank_dialect": 7}, DEFAULT_RERANK_DIALECT),
        ({"rerank_dialect": ""}, DEFAULT_RERANK_DIALECT),
    ],
)
def test_the_configured_dialect_falls_back_to_the_default(
    options: dict[str, object] | None, expected: str
) -> None:
    assert rerank_dialect_of(options) == expected


def test_only_the_endpoint_kind_offers_a_rerank_dialect() -> None:
    """⚠ 形态之间的键不通用：混着存等于让一个形态读到另一个形态的取值。"""
    assert "rerank_dialect" in allowed_options(
        _kind(PROVIDER_KIND_OPENAI_COMPAT)
    )
    assert "rerank_dialect" not in allowed_options(
        _kind(PROVIDER_KIND_CODEX_OAUTH)
    )
