"""六档 SSE 事件各自的载荷形状。

⚠ 这些模型是**声明**，不是序列化路径。帧仍由 `events.py` 里那几个构造函数拼
出字典再 `json.dumps`——换成模型序列化会悄悄改掉一处口径：`frame()` 带着
`default=str` 兜底，而计划快照那一档是自由 JSON，里面可以有模型不认识的东西。

声明与真实帧的一致由 `tests/contract/test_event_specs.py` 逐档比对键名。
少了它，这份声明就只是一段自说自话的文档。
"""

from typing import Any

from pydantic import BaseModel


class DeltaPayload(BaseModel):
    """模型逐字吐出来的一小块。`channel` 分「说的话」与「想的过程」两路。"""

    channel: str
    text: str


class StepPayload(BaseModel):
    """一步跑完了。`input` / `output` 是钳过的预览，不是原始载荷。"""

    kind: str
    name: str
    state: str
    title: str
    error: str | None
    input: dict[str, str] | None
    output: str | None


class ClientToolCallPayload(BaseModel):
    """要交给浏览器执行的一次调用。"""

    call_id: str
    name: str
    arguments: dict[str, Any]


class ClientToolPayload(BaseModel):
    """回合停下来了，这几件要浏览器去做。"""

    calls: list[ClientToolCallPayload]


class DonePayload(BaseModel):
    """回合结束，这是助手这一轮说的话。"""

    reply: str


class PlanPayload(BaseModel):
    """计划变了，整份快照下发，前端不做增量合并（ADR-0024）。"""

    plan: dict[str, Any]


class ErrorPayload(BaseModel):
    """回合内失败。⚠ 它不等于 HTTP 错误：流一开始就改不了状态码了。"""

    code: int
    message: str
    trace_id: str
