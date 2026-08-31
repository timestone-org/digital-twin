"""六档 SSE 事件：声明、真帧、两处前端，四份必须对得上。

漏掉任何一处的表现都是同一句「助手做了一步但界面上没有」，而四处单看都对。
其中**前端解帧表那一处此前一道闸都没有**——它只是 `turnRunner.ts` 里一串
字面量，加一档事件忘了改它，那一档就被静默丢弃。
"""

import json
from pathlib import Path
from typing import Any

import pytest

from ai_assistant.apps.chat.services.output import events
from ai_assistant.apps.chat.services.output.events import EVENT_SPECS
from ai_assistant.apps.chat.services.output.ports import EventSpec
from ai_assistant.apps.chat.services.planning.turn_types import (
    ClientToolCall,
    TurnDelta,
    TurnOutcome,
    TurnStep,
)

# ⚠ 用仓库根相对路径找前端：测试的工作目录是服务目录，写死绝对路径换台机器就断。
# 层级是 tests/contract → tests → ai-assistant → services → server → 仓库根
_REPO = Path(__file__).resolve().parents[5]
_TURN_RUNNER = _REPO / "web/app/src/features/ai/turnRunner.ts"
_CONTRACTS = _REPO / "web/packages/contracts/src/assistant.ts"


def _source_of(path: Path) -> str:
    """读一份前端源码。

    ⚠ 读不到就当场说清是**路径错了**，不是前端漏了那一档：原样抛
    `FileNotFoundError` 的话，报出来的是一串与「事件没同步」毫无关系的堆栈。

    Args: path。
    """
    assert path.is_file(), f"找不到 {path}，这条闸没真跑起来"
    return path.read_text(encoding="utf-8")


# 线上的六个名字。⚠ 逐字写死在这里，不从被测代码推导：从被测代码推导的话，
# 谁把某一档改了名，这条闸会跟着一起改口，而前端那边当场就收不到那一档了
WIRE_NAMES = (
    "message.delta",
    "step",
    "client_tool.request",
    "turn.done",
    "error",
    "plan",
)


def _sample_frames() -> dict[str, str]:
    """每一档各造一帧真的。"""
    step = TurnStep(
        kind="server_tool",
        name="points.search",
        state="succeeded",
        title="找点位",
        input_json={"keyword": "温度"},
        output_json={"body": "找到 3 个"},
        error=None,
    )
    calls = (ClientToolCall(call_id="c1", name="dashboard.save", arguments={}),)
    return {
        events.EVENT_DELTA: events.delta_frame(
            TurnDelta(channel="answer", text="好")
        ),
        events.EVENT_STEP: events.step_frame(step),
        events.EVENT_CLIENT_TOOL: events.outcome_frame(
            TurnOutcome(pending=calls)
        ),
        events.EVENT_DONE: events.outcome_frame(TurnOutcome(reply="做完了")),
        events.EVENT_ERROR: events.error_frame(500, "炸了", "t1"),
        events.EVENT_PLAN: events.plan_frame({"title": "计划", "items": []}),
    }


def _body_of(raw: str) -> dict[str, Any]:
    """从一帧 SSE 里把载荷取回来。"""
    line = next(one for one in raw.splitlines() if one.startswith("data: "))
    parsed: dict[str, Any] = json.loads(line[len("data: ") :])
    return parsed


def test_the_wire_names_are_exactly_the_six_that_shipped() -> None:
    """名字是活契约：改一个字，前端那一档就再也收不到。"""
    assert tuple(spec.name for spec in EVENT_SPECS) == WIRE_NAMES


def test_the_name_tuple_is_derived_from_the_specs() -> None:
    """两份并存就会漂：改了声明忘了名单，闭合集合少一个名字。"""
    derived = tuple(spec.name for spec in EVENT_SPECS)
    assert derived == events.EVENT_NAMES


@pytest.mark.parametrize("spec", EVENT_SPECS, ids=lambda one: one.name)
def test_every_declared_payload_matches_the_real_frame(
    spec: EventSpec,
) -> None:
    """声明与真帧逐档比键名——不比的话这份声明就是自说自话的文档。"""
    fields = set(spec.payload.model_fields)
    assert set(_body_of(_sample_frames()[spec.name])) == fields


def test_the_frontend_decoder_handles_every_declared_event() -> None:
    """⚠ 此前没有闸的那一处：`turnRunner.ts` 只有一串字面量。

    加一档事件而忘了改它，那一档就被静默丢弃——助手做了一步，界面上没有。
    """
    source = _source_of(_TURN_RUNNER)
    missing = [one.name for one in EVENT_SPECS if f"'{one.name}'" not in source]
    assert missing == []


def test_the_frontend_name_table_lists_every_declared_event() -> None:
    """前端那份闭合集合与这份声明同集。"""
    source = _source_of(_CONTRACTS)
    missing = [one.name for one in EVENT_SPECS if f"'{one.name}'" not in source]
    assert missing == []
