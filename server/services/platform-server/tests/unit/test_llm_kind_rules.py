"""接入形态与用途配不配得上，一处判定。

守的是那条**静默**的错配：把知识库的用途指给一路只有助手接得了的供应商时，
分配写得进去、界面上显示配好了，而知识库那一侧永远沿用环境变量那一档——
两边代码单看都对，只有这条闸看得见。
"""

import pytest

from platform_server.apps.llm_providers.enums import (
    PROVIDER_KIND_CODEX_OAUTH,
    PROVIDER_KIND_OPENAI_COMPAT,
    ProviderKindSpec,
    PurposeSpec,
    provider_kind_of,
    purpose_of,
)
from platform_server.apps.llm_providers.rules import (
    default_effort_of,
    purpose_mismatch,
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


def test_the_login_kind_serves_both_consumers() -> None:
    """⚠ 加一个消费方的前提是**它真接得了**（ADR-0041）：光在这里放行只会让
    界面上分配得上、那一侧永远沿用环境变量那一档，而两边代码单看都对。
    知识库那一侧接得了它，由 `llm_adapters.KIND_BUILDERS` 与那组用例证明。"""
    for purpose in ("assistant.chat", "knowledge.chat"):
        assert (
            purpose_mismatch(
                _kind(PROVIDER_KIND_CODEX_OAUTH), _purpose(purpose)
            )
            is None
        )


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
