"""回合这一层的扩展点：模型怎么被调。

⚠ **这一层刻意不给「换一种编排」的口子。** 回合形态是单模型 + 工具循环，
不建 planner/executor 双层——留一个策略接口在这里，等于邀请下一个人去实现那条
已经被否决的路，而它与客户端驱动的回合边界正交性极差。

真要重开那条路时，改的是 ADR 与 `llmcore/turn/loop.py`，不是往这里插一个实现。
"""

from collections.abc import Sequence
from typing import Any, Protocol, runtime_checkable

from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.tools import BaseTool

from llmcore.deltas import DeltaSink
from llmcore.ports import ModelChoice


@runtime_checkable
class Responder(Protocol):
    """要一次补全的那一面。回合循环只碰这一个方法。

    ⚠ 写成结构化协议而不是收一个具体类：熔断、用量记账、思考摘要的抽取各家
    可以不同，而回合循环不该知道这些。助手的 `GuardedModel` 与知识库那边各自
    的实现都按形状对得上。
    """

    async def respond(
        self,
        *,
        choice: ModelChoice,
        messages: list[BaseMessage],
        tools: Sequence[dict[str, Any] | BaseTool],
        on_delta: DeltaSink | None = None,
    ) -> AIMessage: ...
