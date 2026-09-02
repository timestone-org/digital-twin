"""一步做完之后，回答「这一步成没成」。"""

from llmcore.reflection import VERIFIERS, ToolFailureVerifier, check_step
from llmcore.turn.types import StepState, TurnStep


def _step(state: StepState, error: str | None = None) -> TurnStep:
    return TurnStep(
        kind="server_tool",
        name="kb.search",
        state=state,
        title="查一下",
        error=error,
    )


def test_a_failed_step_is_reported_with_its_own_reason() -> None:
    got = ToolFailureVerifier().applies(_step("failed", "上游 503"))

    assert got is True


async def test_the_reason_is_handed_over_verbatim() -> None:
    found = await ToolFailureVerifier().check(_step("failed", "上游 503"))

    assert found.verdict == "failed"
    assert found.message == "上游 503"


async def test_a_failure_with_no_reason_still_says_something() -> None:
    """⚠ 空消息会让模型以为这一步其实成了。"""
    found = await ToolFailureVerifier().check(_step("failed"))

    assert found.message != ""


def test_waiting_on_the_browser_is_not_a_failure() -> None:
    """⚠ 判成失败会让模型以为客户端工具坏了，然后换一条路去做正在做的事。"""
    assert ToolFailureVerifier().applies(_step("awaiting_client")) is False
    assert ToolFailureVerifier().applies(_step("succeeded")) is False


def test_the_verifier_is_named_so_findings_can_be_traced_back() -> None:
    assert ToolFailureVerifier().name == "tool-failure"


async def test_a_clean_step_produces_no_findings() -> None:
    assert await check_step(_step("succeeded"), VERIFIERS) == ()


async def test_a_failed_step_produces_exactly_one_finding() -> None:
    got = await check_step(_step("failed", "炸了"), VERIFIERS)

    assert [one.verdict for one in got] == ["failed"]
