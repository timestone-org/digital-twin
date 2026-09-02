"""层 6：失败的那一步要如实报出来，以及「先问还是先做」的分界线。

⚠ 检验这条路**本期还没有人调**（`reflection/registry.py` 的文件头写了理由）。
这里的用例守的是接缝本身：注册进来的检验器判得准、`applies` 判得窄、
以及 HITL 那张表认不出的工作面要往严里兜底。
"""

import pytest

from ai_assistant.apps.chat.services.reflection import (
    VERIFIERS,
    ToolFailureVerifier,
    check_step,
    must_propose_only,
    undo_model_of,
)
from llmcore.turn.types import TurnStep


def _step(state: str, error: str | None = None) -> TurnStep:
    return TurnStep(
        kind="server_tool",
        name="dashboard.validate",
        state=state,  # pyright: ignore[reportArgumentType]  # 理由：用例要造非法档位
        title="校验",
        error=error,
    )


def test_a_failed_step_is_reported_with_its_own_reason() -> None:
    """原因原样交出去——模型据它决定要不要重做这一步。"""
    got = ToolFailureVerifier()
    assert got.applies(_step("failed", "点位不存在"))


@pytest.mark.asyncio
async def test_the_reason_survives_into_the_finding() -> None:
    """编一句「执行失败」了事的话，模型会原样再试一次。"""
    found = await ToolFailureVerifier().check(_step("failed", "点位不存在"))
    assert found.verdict == "failed"
    assert found.message == "点位不存在"


@pytest.mark.asyncio
async def test_a_failure_with_no_reason_says_exactly_that() -> None:
    """没带原因就说没带原因，别编一句看着像原因的话。"""
    found = await ToolFailureVerifier().check(_step("failed", None))
    assert "没有带回失败原因" in found.message


def test_waiting_for_the_browser_is_not_a_failure() -> None:
    """判成失败会让模型以为客户端工具坏了，然后换一条路做同一件事。"""
    assert not ToolFailureVerifier().applies(_step("awaiting_client"))


def test_a_succeeded_step_says_nothing() -> None:
    """管得太宽的检验器会把真正要紧的那一条淹掉。"""
    assert not ToolFailureVerifier().applies(_step("succeeded"))


@pytest.mark.asyncio
async def test_the_registry_only_asks_the_ones_that_apply() -> None:
    """成功的那一步一条结论都不该有。"""
    assert await check_step(_step("succeeded")) == ()
    assert len(await check_step(_step("failed", "炸了"))) == 1


def test_every_registered_verifier_satisfies_the_protocol() -> None:
    """注册表本身就是个静默失效点：装进去一个形状不对的，运行期才炸。"""
    for one in VERIFIERS:
        assert isinstance(one.name, str)
        assert one.name
        assert callable(one.applies)


def test_the_two_undo_models_are_told_apart() -> None:
    """有撤销栈的先做后撤，没有的只提议——分界线就是这一格。"""
    assert undo_model_of("dashboard-editor") == "draft"
    assert undo_model_of("dataset-table") == "commit"


def test_an_unknown_surface_falls_back_to_the_strict_side() -> None:
    """⚠ 兜到 `commit`：把没有撤销栈的页面误当成有的，代价是助手直接写库。"""
    assert undo_model_of("no-such-surface") == "commit"
    assert must_propose_only("no-such-surface")
