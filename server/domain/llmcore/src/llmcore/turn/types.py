"""一个回合里流动的东西：步骤、待办的客户端调用、回合结果。

⚠ 这些形状同时是**前端渲染的依据**：界面上「AI 做了哪一步」逐条渲染的就是
`TurnStep`。所以它带的是「给人看的一句话」而不是原始载荷——原始载荷落库，
界面按需展开。
"""

from dataclasses import dataclass, field
from typing import Any, Literal

from llmcore import DeltaChannel

StepKind = Literal["model", "server_tool", "client_tool"]
StepState = Literal["succeeded", "failed", "awaiting_client"]


@dataclass(frozen=True)
class ClientToolCall:
    """要交给浏览器执行的一次调用。"""

    # 模型给的调用 id。⚠ 回填结果时必须逐字用它：对不上的话模型看到的是
    # 「我问了 A，回来的是 B 的答案」，而它多半会顺着错的往下走
    call_id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class TurnDelta:
    """模型逐字吐出来的一小块。

    ⚠ 它**不落库**：这一回合结束时落的是攒齐的那条助手消息，而思考过程一路
    连那也不落——下一轮重放要是把它再喂回去，上下文与账单一起翻倍，而模型
    早就把结论写进正文了。
    """

    channel: DeltaChannel
    text: str


@dataclass(frozen=True)
class TurnStep:
    """回合里的一步。"""

    kind: StepKind
    name: str
    state: StepState
    # 给人看的一句话，直接显示在步骤列表上
    title: str
    input_json: dict[str, Any] | None = None
    output_json: dict[str, Any] | None = None
    error: str | None = None


@dataclass(frozen=True)
class TurnOutcome:
    """一个回合跑完（或停在等浏览器）之后的全部产出。"""

    # 本回合新增的消息，按序落库
    messages: list[Any] = field(default_factory=list[Any])
    steps: list[TurnStep] = field(default_factory=list[TurnStep])
    # 非空表示回合**没有结束**，正等浏览器把这些跑完再回来
    pending: tuple[ClientToolCall, ...] = ()
    # 助手这一轮说的话。等浏览器时它是「我准备这么做」那句
    reply: str = ""

    @property
    def is_waiting(self) -> bool:
        """是不是停在等客户端工具上。"""
        return bool(self.pending)
