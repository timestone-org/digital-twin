"""把回合里的东西摊成 SSE 事件。

⚠ 事件种类是**闭合集合**。放开成任意字符串的话，前端遇到没见过的种类只能
静默丢弃，而「助手做了一步但界面上没有」是这套东西最难查的一类故障。

⚠ **`error` 事件不等于 HTTP 错误。** 流一旦开始就没法再改状态码了，所以
`:advance` 的状态码只表达「这次请求受不受理」，回合内的失败走这个事件。
"""

import json
from typing import Any

from ai_assistant.apps.chat.services.turn_types import (
    TurnDelta,
    TurnOutcome,
    TurnStep,
)

# 闭合集合。加一档要同时改前端的解帧表
# 模型逐字吐出来的一小块：`channel` 分「说的话」与「想的过程」两路
EVENT_DELTA = "message.delta"
EVENT_STEP = "step"
EVENT_CLIENT_TOOL = "client_tool.request"
EVENT_DONE = "turn.done"
EVENT_ERROR = "error"

EVENT_NAMES = (
    EVENT_DELTA,
    EVENT_STEP,
    EVENT_CLIENT_TOOL,
    EVENT_DONE,
    EVENT_ERROR,
)


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


def error_frame(code: int, message: str, trace_id: str) -> str:
    """回合内失败。

    Args: code, message, trace_id。
    """
    return frame(
        EVENT_ERROR,
        {"code": code, "message": message, "trace_id": trace_id},
    )
