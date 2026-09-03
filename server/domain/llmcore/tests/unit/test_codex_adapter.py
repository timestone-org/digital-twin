"""订阅账号那一形态的适配器。

守的是三件运行期看不出的事：**不接图**（放行的话图会被喂给一个自报不接图的
模型，它多半只回一句「我没看到图」，而调用照样成功、照样计费）；一个模型都
没登记的那一路哪一档都不吃（空模型名是一条 400，那条 400 里不提这件事）；
以及造模型之前**先领一次令牌**——没登录过要在这里失败，而不是等端点回 401。
"""

from dataclasses import dataclass

import pytest

from llmcore.codex.adapter import (
    OPTION_DEFAULT_EFFORT,
    CodexOAuthAdapter,
    effort_of,
)
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


def test_it_eats_chat_and_summary_but_never_vision() -> None:
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
