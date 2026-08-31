"""把回合里的东西摊成 SSE 事件。

⚠ 事件种类是**闭合集合**。放开成任意字符串的话，前端遇到没见过的种类只能
静默丢弃，而「助手做了一步但界面上没有」是这套东西最难查的一类故障。

⚠ **`error` 事件不等于 HTTP 错误。** 流一旦开始就没法再改状态码了，所以
`:advance` 的状态码只表达「这次请求受不受理」，回合内的失败走这个事件。
"""

import json
from typing import Any

from ai_assistant.apps.chat.services.output import payloads, step_preview
from ai_assistant.apps.chat.services.output.ports import EventSpec
from ai_assistant.apps.chat.services.planning.turn_types import (
    TurnDelta,
    TurnOutcome,
    TurnStep,
)

# 闭合集合
EVENT_DELTA = "message.delta"
EVENT_STEP = "step"
EVENT_CLIENT_TOOL = "client_tool.request"
EVENT_DONE = "turn.done"
EVENT_ERROR = "error"
EVENT_PLAN = "plan"

# 六档事件的**唯一声明**：名字 + 载荷形状 + 什么时候出现。
#
# ⚠ 加一档要同步四处，而漏掉任何一处的表现都是「助手做了一步但界面上没有」：
#   1. 这张表      2. `api/advance.py` 的分帧
#   3. 前端 `contracts/assistant.ts` 的名字表
#   4. 前端 `turnRunner.ts` 的解帧分支 ← **最容易漏的一处**，它只有一串字面量
# 前三处由契约测试对着这张表比，第四处由 `test_event_specs.py` 扫源码比。
EVENT_SPECS: tuple[EventSpec, ...] = (
    EventSpec(
        name=EVENT_DELTA,
        payload=payloads.DeltaPayload,
        note="模型每吐一小块发一帧，不攒",
    ),
    EventSpec(
        name=EVENT_STEP,
        payload=payloads.StepPayload,
        note="一步跑完，带一份钳过的入参与产出预览",
    ),
    EventSpec(
        name=EVENT_CLIENT_TOOL,
        payload=payloads.ClientToolPayload,
        note="回合停下来等浏览器执行这几件",
    ),
    EventSpec(
        name=EVENT_DONE,
        payload=payloads.DonePayload,
        note="回合结束",
    ),
    EventSpec(
        name=EVENT_ERROR,
        payload=payloads.ErrorPayload,
        note="回合内失败；⚠ 不等于 HTTP 错误",
    ),
    EventSpec(
        name=EVENT_PLAN,
        payload=payloads.PlanPayload,
        note="计划变了，整份快照下发（ADR-0024）",
    ),
)

# ⚠ 从声明推导，不再手写第二份：两份并存时改了一处忘了另一处，
# 而闭合集合少一个名字的表现是那一档事件被前端静默丢弃
EVENT_NAMES = tuple(spec.name for spec in EVENT_SPECS)


def frame(name: str, body: dict[str, Any]) -> str:
    """摊成一帧 SSE。

    ⚠ 载荷压成一行：`data:` 里的换行会被读成「这一帧结束」，多行 JSON 于是
    在对端被切成几帧，而每一帧都不是合法 JSON。

    Args: name, body。
    """
    payload = json.dumps(body, ensure_ascii=False, default=str)
    return f"event: {name}\ndata: {payload}\n\n"


def delta_frame(delta: TurnDelta) -> str:
    """模型又吐了一小块。

    ⚠ 一块一帧，不攒：攒起来批量发省不下几个字节，却把「逐字出现」变回
    「一段一段地蹦」，而那正是这条链路存在的理由。

    Args: delta。
    """
    return frame(EVENT_DELTA, {"channel": delta.channel, "text": delta.text})


def step_frame(step: TurnStep) -> str:
    """一步跑完了。

    ⚠ 入参与产出**带一份钳过的预览**。不带的话，界面上一步只有一句标题，
    「它到底把什么写进去了」只能等这个会话重开之后从库里读回来——而那正是
    出错当场最该看见的东西。钳制口径见 `step_preview`。

    Args: step。
    """
    return frame(
        EVENT_STEP,
        {
            "kind": step.kind,
            "name": step.name,
            "state": step.state,
            "title": step.title,
            "error": step.error,
            "input": step_preview.input_preview(step.input_json),
            "output": step_preview.output_preview(step.output_json),
        },
    )


def outcome_frame(outcome: TurnOutcome) -> str:
    """回合结束，或者停下来等浏览器。

    Args: outcome。
    """
    if outcome.is_waiting:
        return frame(
            EVENT_CLIENT_TOOL,
            {
                "calls": [
                    {
                        "call_id": call.call_id,
                        "name": call.name,
                        "arguments": call.arguments,
                    }
                    for call in outcome.pending
                ]
            },
        )
    return frame(EVENT_DONE, {"reply": outcome.reply})


def plan_frame(plan: dict[str, Any]) -> str:
    """计划变了，把整份快照推出去。

    Args: plan。
    """
    return frame(EVENT_PLAN, {"plan": plan})


def error_frame(code: int, message: str, trace_id: str) -> str:
    """回合内失败。

    Args: code, message, trace_id。
    """
    return frame(
        EVENT_ERROR,
        {"code": code, "message": message, "trace_id": trace_id},
    )
