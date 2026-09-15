"""订阅适配器的用途选模、能力声明和令牌领取契约。"""

from dataclasses import dataclass, replace

import pytest

from llmcore.codex.adapter import (
    OPTION_DEFAULT_EFFORT,
    CodexOAuthAdapter,
    effort_of,
)
from llmcore.errors import ModelRejected
from llmcore.ports import ModelChoice

EFFORTS = ("low", "medium", "high", "xhigh")


@dataclass(frozen=True)
class _Token:
    access_token: str = "at-1"
    account_id: str | None = "acc-1"


class _Source:
    def __init__(self, *, is_connected: bool = True) -> None:
        self.asked: list[str] = []
        self._is_connected = is_connected

    async def usable(self, provider: str) -> _Token:
        self.asked.append(provider)
        if not self._is_connected:
            raise RuntimeError("还没登录")
        return _Token()


def _adapter(
    source: _Source, *, models: tuple[str, ...] = ("gpt-5-codex",)
) -> CodexOAuthAdapter:
    return CodexOAuthAdapter(
        id="p1",
        label="订阅账号",
        models=models,
        default_effort="medium",
        timeout_s=3.0,
        tokens=source,
        originator="tests",
        efforts=EFFORTS,
    )


def test_without_kind_configuration_only_text_is_supported() -> None:
    made = _adapter(_Source())
    assert made.supports("chat")
    assert made.supports("summary")
    assert not made.supports("vision")


def test_a_lane_with_no_registered_model_eats_nothing() -> None:
    made = _adapter(_Source(), models=())
    assert not made.supports("chat")
    assert not made.supports("summary")


def test_the_profile_reports_no_vision_and_the_configured_efforts() -> None:
    made = _adapter(_Source()).profile()
    assert made.has_vision is False
    assert made.efforts == EFFORTS
    assert made.models == ("gpt-5-codex",)


async def test_building_asks_for_this_lane_s_token_first() -> None:
    source = _Source()
    await _adapter(source).build(ModelChoice())
    assert source.asked == ["p1"]


async def test_vision_uses_the_configured_model() -> None:
    made = replace(
        _adapter(_Source(), models=("text", "vision")),
        models_by_kind={"chat": "text", "vision": "vision"},
    )
    assert made.supports("vision")
    assert made.profile().has_vision
    built = await made.build(ModelChoice(kind="vision"))
    assert built.model_name == "vision"


async def test_an_unregistered_kind_model_is_rejected_before_tokens() -> None:
    source = _Source()
    made = replace(_adapter(source), models_by_kind={"vision": "missing"})
    assert not made.supports("vision")
    with pytest.raises(ModelRejected):
        await made.build(ModelChoice(kind="vision"))
    assert source.asked == []


async def test_a_lane_that_was_never_logged_in_fails_before_the_endpoint(
    # 等端点回 401 的话，报出来的是「模型暂时不可用」，与「去登录一下」对不上
) -> None:
    with pytest.raises(RuntimeError):
        await _adapter(_Source(is_connected=False)).build(ModelChoice())


def test_the_effort_option_is_read_defensively() -> None:
    assert effort_of({OPTION_DEFAULT_EFFORT: "high"}, EFFORTS) == "high"
    assert effort_of(None, EFFORTS) is None
    assert effort_of({}, EFFORTS) is None
    # 这一格要原样进请求体：塞个数字或一个不认的档位过去是一条 400
    assert effort_of({OPTION_DEFAULT_EFFORT: 3}, EFFORTS) is None
    assert effort_of({OPTION_DEFAULT_EFFORT: "turbo"}, EFFORTS) is None
